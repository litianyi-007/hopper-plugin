// Canonical startup snapshot and event-first terminal attestation finalizer.
// This module is intentionally file-backed and zero-spawn: callers supply the
// already-resolved selector/catalog snapshot and parsed vendor result.

import { existsSync, lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { readFrontmatter, writeFrontmatter } from './background.js';
import { appendProgressEvent, readProgressEvents } from './progress.js';
import { resolveAttestation } from './model-attestation.js';
import { validateTaskId } from './validation.js';
import { projectInventoryEntry } from './inventory-contract.js';
import { adapterDiagnostic, publicAdapterDiagnostic } from './adapter-diagnostics.js';
import { publicModelIdentifier, publicModelIdentifiers } from './public-identifiers.js';
import { noTextOutputEvidence, validateOutputEvidence } from './output-evidence.js';

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled', 'orphaned', 'timeout']);
const DISPLAY_STATUSES = new Set([...TERMINAL_STATUSES, 'in-progress']);
const RESOLUTION_STATUSES = new Set(['exact', 'mismatch', 'alias-resolved', 'config-only', 'unverified']);
const SELECTOR_KINDS = new Set(['alias', 'concrete', 'auto', 'unknown']);
const SAFE_CATALOG_FIELDS = Object.freeze([
  'catalog_source_kind', 'catalog_source_label', 'catalog_observed_at',
  'catalog_freshness', 'binary_availability', 'binary_basename',
]);
const PUBLIC_VENDORS = new Set(['agy', 'claude', 'codex', 'copilot', 'grok', 'kimi', 'mimo', 'opencode', 'pi']);
const PUBLIC_PHASES = new Set(['starting', 'running', 'done', 'failed', 'cancelled', 'orphaned', 'timeout', 'unknown']);
const PUBLIC_EVENT_KINDS = new Set(['finding', 'progress', 'terminal', 'process_alive', 'status', 'unknown']);
const PUBLIC_RESOLUTION_DETAILS = new Set([
  'policy-effective-default', 'no-effective-selector', 'selector-kind-unknown', 'alias-runtime-resolved',
  'alias-config-only-no-runtime', 'alias-no-runtime-metadata', 'concrete-config-only-no-runtime',
  'concrete-runtime-unverifiable', 'concrete-no-runtime-metadata', 'concrete-runtime-exact',
  'concrete-runtime-mismatch',
]);

function nullableString(value) {
  return typeof value === 'string' ? value : null;
}

function scalar(value, fallback = 'unknown') {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function catalogSnapshot(catalog = {}) {
  return {
    sourceKind: scalar(catalog.sourceKind ?? catalog.source_kind),
    sourceLabel: scalar(catalog.sourceLabel ?? catalog.source_label),
    observedAt: nullableString(catalog.observedAt ?? catalog.observed_at),
    freshness: scalar(catalog.freshness),
    binaryAvailability: scalar(catalog.binaryAvailability ?? catalog.binary_availability),
    binaryBasename: nullableString(catalog.binaryBasename ?? catalog.binary_basename),
    binding: catalog.binding ?? null,
  };
}

/**
 * Build the one startup snapshot that is carried from dispatch policy resolution
 * to the terminal writer. It performs no cache I/O, probing, spawning, or model
 * derivation; the passed catalog/metadata are an existing snapshot only.
 */
export function buildAttestationStartupSnapshot({
  requestedSelector = null,
  effectiveSelector = null,
  effectiveSelectorSource = 'vendor-default',
  catalog = {},
  selectorMetadata = {},
  binding = null,
} = {}) {
  const safeCatalog = catalogSnapshot(catalog);
  const selectorVendor = safeCatalog.binding?.vendor ?? binding?.vendor ?? null;
  const safeRequested = publicModelIdentifier(requestedSelector, selectorVendor);
  const safeEffective = publicModelIdentifier(effectiveSelector, selectorVendor);
  const safeSource = ['user-argv', 'policy', 'vendor-default'].includes(effectiveSelectorSource)
    ? effectiveSelectorSource
    : 'vendor-default';
  const snapshot = {
    requestedSelector: safeRequested,
    effectiveSelector: safeEffective,
    effectiveSelectorSource: safeSource,
    catalog: safeCatalog,
    selectorMetadata: selectorMetadata && typeof selectorMetadata === 'object' ? selectorMetadata : {},
    binding: binding ?? safeCatalog.binding ?? null,
  };
  snapshot.frontmatter = {
    requested_selector: snapshot.requestedSelector,
    effective_selector: snapshot.effectiveSelector,
    effective_selector_source: snapshot.effectiveSelectorSource,
    selector_kind: snapshot.effectiveSelector === null ? 'auto' : 'unknown',
    catalog_source_kind: safeCatalog.sourceKind,
    catalog_source_label: safeCatalog.sourceLabel,
    catalog_observed_at: safeCatalog.observedAt,
    catalog_freshness: safeCatalog.freshness,
    binary_availability: safeCatalog.binaryAvailability,
    binary_basename: safeCatalog.binaryBasename,
  };
  return snapshot;
}

function startupSnapshotFromFrontmatter(fm) {
  return buildAttestationStartupSnapshot({
    requestedSelector: fm.requested_selector,
    effectiveSelector: fm.effective_selector,
    effectiveSelectorSource: fm.effective_selector_source,
    catalog: {
      source_kind: fm.catalog_source_kind,
      source_label: fm.catalog_source_label,
      observed_at: fm.catalog_observed_at,
      freshness: fm.catalog_freshness,
      binary_availability: fm.binary_availability,
      binary_basename: fm.binary_basename,
    },
  });
}

function fallbackBinding(snapshot, fm, completion) {
  return snapshot.binding ?? snapshot.catalog?.binding ?? {
    vendor: scalar(fm.adapter ?? completion.vendor),
    adapterId: scalar(fm.adapter ?? completion.vendor),
    adapterVersion: '',
    catalogId: '',
    catalogVersion: '',
  };
}

function terminalStatus(value) {
  return TERMINAL_STATUSES.has(value) ? value : 'failed';
}

function recoveredOutputProjection(completion = {}, parsed = {}, status) {
  const noRecovery = {
    recovered_output: false,
    recovered_output_state: 'no-text',
    recovered_output_source: 'none',
  };
  const candidate = completion.outputEvidence ?? parsed.outputEvidence;
  // Attestation only records parser provenance already selected by the runner;
  // it never receives or persists the answer text itself.
  const evidence = validateOutputEvidence('attested parser output', candidate)
    ?? noTextOutputEvidence();
  if (status !== 'failed' || completion.recoveredOutput !== true
    || !['verified-complete', 'unknown-completeness'].includes(evidence.completeness)) {
    return noRecovery;
  }
  return {
    recovered_output: true,
    recovered_output_state: evidence.completeness,
    recovered_output_source: evidence.source,
  };
}

function persistedRecoveredOutputProjection(record, status) {
  const completeness = record?.recovered_output_state;
  return recoveredOutputProjection({
    recoveredOutput: record?.recovered_output,
    outputEvidence: {
      completeness,
      source: record?.recovered_output_source,
      terminalMarker: completeness === 'verified-complete' ? 'opencode-step-finish' : 'none',
    },
  }, {}, status);
}

function publicRecoveredOutput(projection) {
  return {
    recovered: projection.recovered_output,
    state: projection.recovered_output_state,
    source: projection.recovered_output_source,
  };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function nullableNonEmptyString(value) {
  return nonEmptyString(value) ? value : null;
}

function normalizeObservedModels(value, vendor = null) {
  return publicModelIdentifiers(value, vendor);
}

/**
 * Encode the JSON-array string as one JSON double-quoted YAML scalar. This is
 * intentionally separate from the generic frontmatter scalar emitter: model
 * evidence must survive YAML comments, document markers, escapes, and Unicode.
 */
export function encodeObservedModelsJsonScalar(value, vendor = null) {
  return JSON.stringify(JSON.stringify(normalizeObservedModels(value, vendor)));
}

/**
 * Parse only the serialized JSON-array string carried in observed_models_json.
 * Non-strings, scalar JSON, objects, malformed JSON, and mixed lists are not
 * evidence; strings are first-seen de-duplicated in file order.
 */
export function parseObservedModelsJson(value, vendor = null) {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((model) => !nonEmptyString(model))) return [];
    return normalizeObservedModels(parsed, vendor);
  } catch (_) {
    return [];
  }
}

function normalizeDisplayStatus(value) {
  return DISPLAY_STATUSES.has(value) ? value : 'unknown';
}

function normalizeResolutionStatus(value) {
  return RESOLUTION_STATUSES.has(value) ? value : 'unverified';
}

function normalizeSelectorKind(value) {
  return SELECTOR_KINDS.has(value) ? value : 'unknown';
}

function safeCatalogFromFrontmatter(fm = {}) {
  return Object.fromEntries(SAFE_CATALOG_FIELDS.map((key) => [key, nullableNonEmptyString(fm[key])]));
}

function publicVendor(value) {
  return PUBLIC_VENDORS.has(value) ? value : 'unknown';
}

function publicPhase(value) {
  return PUBLIC_PHASES.has(value) ? value : 'unknown';
}

function publicEventKind(value) {
  return PUBLIC_EVENT_KINDS.has(value) ? value : 'unknown';
}

function publicCatalog(vendor, fm) {
  return projectInventoryEntry(vendor, {
    provenance: {
      source_kind: fm.catalog_source_kind,
      binary_availability: fm.binary_availability,
      binary_basename: fm.binary_basename,
    },
    diagnostic_code: fm.diagnostic_code,
  }, 'ok-v1');
}

function publicRecentEvents(events) {
  return events.map((event) => ({
    seq: Number.isInteger(event.seq) ? event.seq : null,
    phase: publicPhase(event.phase),
    kind: publicEventKind(event.kind),
    terminal: event.terminal === true,
    status: normalizeDisplayStatus(event.status),
    adapterDiagnosticCode: publicAdapterDiagnostic({
      diagnosticCode: event.adapter_diagnostic_code ?? event.adapterDiagnosticCode,
      status: event.adapter_status ?? (event.status === 'done' ? 'success' : 'unknown-fail'),
    }),
  }));
}

function isUsableEvent(event, taskId) {
  return event && typeof event === 'object'
    && event.task_id === taskId
    && nonEmptyString(event.vendor)
    && nonEmptyString(event.phase)
    && nonEmptyString(event.kind)
    && nonEmptyString(event.message)
    && nonEmptyString(event.source)
    && typeof event.terminal === 'boolean';
}

function isValidTerminalEvent(event, taskId) {
  return isUsableEvent(event, taskId)
    && event.terminal === true
    && event.kind === 'terminal'
    && TERMINAL_STATUSES.has(event.status);
}

function safeReadEvents(readEvents, hopperDir, taskId) {
  try {
    const events = readEvents({ hopperDir, taskId });
    return Array.isArray(events) ? events.filter((event) => isUsableEvent(event, taskId)) : [];
  } catch (_) {
    return [];
  }
}

function canonicalOutputPath(hopperDir, taskId, outputMdPath) {
  return outputMdPath ?? join(hopperDir, 'handoffs', `${taskId}-output.md`);
}

function readCanonicalFrontmatter(readFm, outputMdPath) {
  if (!existsSync(outputMdPath)) return { fm: { _body: '' }, state: 'missing' };
  try {
    const fm = readFm(outputMdPath);
    const hasFrontmatter = Object.keys(fm).some((key) => key !== '_body');
    return { fm, state: hasFrontmatter ? 'present' : 'missing' };
  } catch (_) {
    return { fm: { _body: '' }, state: 'corrupt' };
  }
}

/**
 * Read one event-first terminal attestation record. `finalizing` and `partial`
 * are reader-only crash-window labels and are never persisted by this reader.
 */
export function readCanonicalAttestation({ hopperDir, taskId, outputMdPath } = {}) {
  const path = canonicalOutputPath(hopperDir, taskId, outputMdPath);
  const { fm, state: frontmatterState } = readCanonicalFrontmatter(readFrontmatter, path);
  const events = safeReadEvents(readProgressEvents, hopperDir, taskId);
  const recentEvents = events.slice(-5);
  const terminals = events.filter((event) => isValidTerminalEvent(event, taskId));
  const terminalEvent = terminals.length === 1 ? terminals[0] : null;
  const fmStatus = normalizeDisplayStatus(fm.status);
  const fmTerminal = TERMINAL_STATUSES.has(fmStatus);
  let displayStatus = fmStatus;
  let attestationConsistency = 'none';

  if (terminalEvent) {
    if (fmTerminal && fmStatus === terminalEvent.status) {
      attestationConsistency = 'agreement';
      displayStatus = terminalEvent.status;
    } else if (fmTerminal) {
      attestationConsistency = 'conflict';
      displayStatus = 'partial';
    } else if (fmStatus === 'in-progress') {
      attestationConsistency = 'event-only';
      displayStatus = 'finalizing';
    } else {
      attestationConsistency = 'event-only';
      displayStatus = 'partial';
    }
  } else if (terminals.length > 1) {
    attestationConsistency = 'conflict';
    displayStatus = 'partial';
  } else if (fmTerminal) {
    attestationConsistency = 'frontmatter-only';
  }

  const adapter = publicVendor(nullableNonEmptyString(terminalEvent?.vendor ?? fm.adapter));
  const evidence = Array.isArray(terminalEvent?.observed_models)
    ? normalizeObservedModels(terminalEvent.observed_models, adapter)
    : parseObservedModelsJson(fm.observed_models_json, adapter);
  const selectorSource = {
    requested_selector: terminalEvent?.requested_selector ?? fm.requested_selector,
    effective_selector: terminalEvent?.effective_selector ?? fm.effective_selector,
    selector_kind: terminalEvent?.selector_kind ?? fm.selector_kind,
    effective_selector_source: terminalEvent?.effective_selector_source ?? fm.effective_selector_source,
  };
  const resolutionSource = {
    resolution_status: terminalEvent?.resolution_status ?? fm.resolution_status,
    resolution_detail: terminalEvent?.resolution_detail ?? fm.resolution_detail,
  };
  const selector = {
    requested: publicModelIdentifier(selectorSource.requested_selector, adapter),
    effective: publicModelIdentifier(selectorSource.effective_selector, adapter),
    kind: normalizeSelectorKind(selectorSource.selector_kind),
  };
  const resolution = {
    status: normalizeResolutionStatus(resolutionSource.resolution_status),
    detail: PUBLIC_RESOLUTION_DETAILS.has(resolutionSource.resolution_detail) ? resolutionSource.resolution_detail : null,
  };
  const phase = publicPhase(nullableNonEmptyString(terminalEvent?.phase ?? fm.phase) ?? displayStatus);
  const adapterDiagnosticCode = publicAdapterDiagnostic({
    diagnosticCode: terminalEvent?.adapter_diagnostic_code ?? fm.adapter_diagnostic_code,
    status: terminalEvent?.adapter_status ?? fm.adapter_status ?? (displayStatus === 'done' ? 'success' : 'unknown-fail'),
  });
  const recoverySource = terminalEvent ?? fm;
  const recoveryProjection = persistedRecoveredOutputProjection(
    recoverySource,
    terminalEvent?.status ?? fmStatus,
  );
  const recoveredOutput = publicRecoveredOutput(recoveryProjection);
  const safeCatalog = safeCatalogFromFrontmatter(fm);
  return {
    taskId,
    outputMdPath: path,
    frontmatter: fm,
    frontmatterState,
    displayStatus,
    phase,
    adapter,
    adapterDiagnosticCode,
    recoveredOutput,
    selector,
    observedModels: evidence,
    resolution,
    safeCatalog,
    recentEvents,
    terminalEvent,
    terminalEventCount: terminals.length,
    attestation_consistency: attestationConsistency,
    public: {
      taskId,
      adapter,
      adapterDiagnosticCode,
      recoveredOutput,
      displayStatus,
      phase,
      selector: {
        ...selector,
        source: ['user-argv', 'policy', 'vendor-default'].includes(selectorSource.effective_selector_source)
          ? selectorSource.effective_selector_source
          : 'vendor-default',
      },
      observedModels: evidence,
      resolution,
      safeCatalog: publicCatalog(adapter, fm),
      recentEvents: publicRecentEvents(recentEvents),
      terminal: terminalEvent !== null,
      attestationConsistency,
    },
  };
}

function isRepairPathSafe(hopperDir, taskId, outputMdPath) {
  try {
    validateTaskId(taskId);
    const expected = resolve(hopperDir, 'handoffs', `${taskId}-output.md`);
    if (resolve(outputMdPath) !== expected) return false;
    const handoffs = resolve(hopperDir, 'handoffs');
    if (!expected.startsWith(handoffs + sep)) return false;
    return existsSync(outputMdPath) && !lstatSync(outputMdPath).isSymbolicLink();
  } catch (_) {
    return false;
  }
}

function repairablePartialFrontmatter(fm, taskId) {
  return fm && typeof fm === 'object'
    && fm.task_id === taskId
    && fm.status === 'in-progress'
    && fm.terminal_event_emitted !== true;
}

function repairFrontmatterFromEvent(fm, taskId, event) {
  const observedModels = normalizeObservedModels(event.observed_models, publicVendor(event.vendor));
  const recoveryProjection = persistedRecoveredOutputProjection(event, event.status);
  return {
    task_id: taskId,
    adapter: nullableNonEmptyString(event.vendor) ?? 'unknown',
    status: event.status,
    phase: nullableNonEmptyString(event.phase) ?? event.status,
    end_time: nullableNonEmptyString(event.ts),
    last_progress_at: nullableNonEmptyString(event.ts),
    last_progress: nullableNonEmptyString(event.message),
    progress_seq: Number.isInteger(event.seq) ? event.seq : undefined,
    terminal_event_emitted: true,
    requested_selector: nullableNonEmptyString(event.requested_selector),
    effective_selector: nullableNonEmptyString(event.effective_selector),
    effective_selector_source: nullableNonEmptyString(event.effective_selector_source),
    selector_kind: normalizeSelectorKind(event.selector_kind),
    observed_models_json: JSON.stringify(observedModels),
    model_attestation_source: nullableNonEmptyString(event.model_attestation_source),
    model_attestation_observed_at: nullableNonEmptyString(event.model_attestation_observed_at),
    resolution_status: normalizeResolutionStatus(event.resolution_status),
    resolution_detail: nullableNonEmptyString(event.resolution_detail),
    diagnostic_code: nullableNonEmptyString(event.diagnostic_code),
    adapter_diagnostic_code: publicAdapterDiagnostic({
      diagnosticCode: event.adapter_diagnostic_code ?? event.adapterDiagnosticCode,
      status: event.adapter_status ?? (event.status === 'done' ? 'success' : 'unknown-fail'),
    }),
    ...recoveryProjection,
    ...safeCatalogFromFrontmatter(fm),
    _body: typeof fm._body === 'string' ? fm._body : '',
  };
}

/**
 * Repair only the event-first crash window where exactly one safe terminal JSONL
 * record exists but frontmatter is still in progress. It never appends JSONL and
 * re-reads immediately before the atomic frontmatter replace.
 */
export function repairOrphanTerminalHandoff({ hopperDir, taskId, outputMdPath, io = {} } = {}) {
  const path = canonicalOutputPath(hopperDir, taskId, outputMdPath);
  const readFm = io.readFrontmatter ?? readFrontmatter;
  const writeFm = io.writeFrontmatter ?? writeFrontmatter;
  const readEvents = io.readProgressEvents ?? readProgressEvents;
  if (!isRepairPathSafe(hopperDir, taskId, path)) return { repaired: false, reason: 'unsafe-path' };

  let firstFm;
  try { firstFm = readFm(path); } catch (_) { return { repaired: false, reason: 'malformed-frontmatter' }; }
  if (!repairablePartialFrontmatter(firstFm, taskId)) return { repaired: false, reason: 'not-partial' };
  const firstEvents = safeReadEvents(readEvents, hopperDir, taskId).filter((event) => isValidTerminalEvent(event, taskId));
  if (firstEvents.length !== 1) return { repaired: false, reason: 'terminal-event-count' };

  let latestFm;
  try { latestFm = readFm(path); } catch (_) { return { repaired: false, reason: 'malformed-frontmatter' }; }
  if (TERMINAL_STATUSES.has(normalizeDisplayStatus(latestFm.status))) return { repaired: false, reason: 'already-complete' };
  if (!repairablePartialFrontmatter(latestFm, taskId)) return { repaired: false, reason: 'changed-frontmatter' };
  const latestEvents = safeReadEvents(readEvents, hopperDir, taskId).filter((event) => isValidTerminalEvent(event, taskId));
  if (latestEvents.length !== 1) return { repaired: false, reason: 'terminal-event-changed' };
  const event = latestEvents[0];
  writeFm(path, repairFrontmatterFromEvent(latestFm, taskId, event));
  return { repaired: true, event };
}

function parsedModelAttestation(parsed) {
  const attestation = parsed?.modelAttestation;
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    return { observedModels: [], source: null, observedAt: null };
  }
  return {
    observedModels: Object.hasOwn(attestation, 'observedModels') ? attestation.observedModels : [],
    source: nullableString(attestation.source),
    observedAt: nullableString(attestation.observedAt),
  };
}

function existingTerminalEvents(readEvents, hopperDir, taskId) {
  return readEvents({ hopperDir, taskId })
    .filter((event) => event && event.terminal === true && event.kind === 'terminal' && event.task_id === taskId);
}

function completionValue(completion, camel, snake, fallback = undefined) {
  return completion[camel] ?? completion[snake] ?? fallback;
}

// Kept internal so all writers construct byte/field-equivalent terminal records.
function buildCanonicalTerminalRecord({ fm, startupSnapshot, parsed, completion, now }) {
  const snapshot = startupSnapshot ?? startupSnapshotFromFrontmatter(fm);
  const evidence = parsedModelAttestation(parsed);
  const vendor = scalar(completion.vendor ?? fm.adapter);
  const observedModels = normalizeObservedModels(evidence.observedModels, vendor);
  const resolved = resolveAttestation({
    effectiveSelector: snapshot.effectiveSelector,
    effectiveSelectorSource: snapshot.effectiveSelectorSource,
    binding: fallbackBinding(snapshot, fm, completion),
    selectorMetadata: snapshot.selectorMetadata,
    observedModels,
    catalogSourceKind: snapshot.catalog.sourceKind,
    runtimeDiagnosticCode: completion.runtimeDiagnosticCode ?? completion.runtime_diagnostic_code ?? 'none',
    now,
  });
  const status = terminalStatus(completion.status);
  const recoveryProjection = recoveredOutputProjection(completion, parsed, status);
  const phase = scalar(completion.phase, status);
  const message = scalar(completion.message, status === 'done' ? 'Task completed successfully.' : 'Task failed.');
  const adapterDiagnosticCode = adapterDiagnostic(
    completion.adapterDiagnosticCode
      ?? completion.adapter_diagnostic_code
      ?? publicAdapterDiagnostic(parsed),
  );
  const event = {
    vendor: scalar(completion.vendor ?? fm.adapter),
    phase,
    kind: 'terminal',
    message,
    source: scalar(completion.source, 'runner'),
    terminal: true,
    status,
    duration_ms: completionValue(completion, 'durationMs', 'duration_ms'),
    exit_code: completionValue(completion, 'exitCode', 'exit_code'),
    signal: completion.signal ?? null,
    adapter_status: completionValue(completion, 'adapterStatus', 'adapter_status'),
    adapter_diagnostic_code: adapterDiagnosticCode,
    timed_out: completionValue(completion, 'timedOut', 'timed_out'),
    timeout_reason: completionValue(completion, 'timeoutReason', 'timeout_reason'),
    process_cleanup: completionValue(completion, 'processCleanup', 'process_cleanup'),
    requested_selector: snapshot.requestedSelector,
    effective_selector: snapshot.effectiveSelector,
    effective_selector_source: snapshot.effectiveSelectorSource,
    selector_kind: resolved.selectorKind,
    observed_models: resolved.observedModels,
    model_attestation_source: evidence.source,
    model_attestation_observed_at: evidence.observedAt,
    resolution_status: resolved.resolutionStatus,
    resolution_detail: resolved.resolutionDetail,
    ...recoveryProjection,
  };
  const attestationFrontmatter = {
    ...snapshot.frontmatter,
    selector_kind: resolved.selectorKind,
    observed_models_json: JSON.stringify(resolved.observedModels),
    model_attestation_source: evidence.source,
    model_attestation_observed_at: evidence.observedAt,
    resolution_status: resolved.resolutionStatus,
    resolution_detail: resolved.resolutionDetail,
    diagnostic_code: resolved.diagnosticCode,
    adapter_diagnostic_code: adapterDiagnosticCode,
    ...recoveryProjection,
  };
  return { snapshot, resolved, status, phase, message, event, attestationFrontmatter };
}

/**
 * Emit exactly one terminal JSONL event before atomically persisting canonical
 * frontmatter. A pre-existing terminal event is a deterministic refusal, never
 * an opportunity to append a second event or silently repair it.
 */
export function finalizeTerminalAttestation({
  hopperDir,
  taskId,
  outputMdPath,
  startupSnapshot = null,
  parsed = {},
  completion = {},
  now = new Date(),
  io = {},
}) {
  const readEvents = io.readProgressEvents ?? readProgressEvents;
  const appendEvent = io.appendProgressEvent ?? appendProgressEvent;
  const readFm = io.readFrontmatter ?? readFrontmatter;
  const writeFm = io.writeFrontmatter ?? writeFrontmatter;
  const terminals = existingTerminalEvents(readEvents, hopperDir, taskId);
  if (terminals.length > 0) {
    return { refused: true, reason: 'terminal-event-exists', terminalCount: terminals.length };
  }

  const fm = readFm(outputMdPath);
  if (fm.terminal_event_emitted === true || TERMINAL_STATUSES.has(fm.status)) {
    return { refused: true, reason: 'terminal-frontmatter-exists', terminalCount: 0 };
  }

  const record = buildCanonicalTerminalRecord({ fm, startupSnapshot, parsed, completion, now });
  // Event first: an append error must leave frontmatter visibly in-progress.
  const event = appendEvent({ hopperDir, taskId, event: record.event });
  // The only writer state transition after successful append. `finalizing` and
  // `partial` are reader-derived crash-window labels and are never persisted.
  writeFm(outputMdPath, {
    ...fm,
    ...record.attestationFrontmatter,
    status: record.status,
    phase: record.phase,
    end_time: completion.endTime ?? completion.end_time ?? new Date().toISOString(),
    exit_code: completionValue(completion, 'exitCode', 'exit_code', fm.exit_code),
    signal: completion.signal ?? null,
    timed_out: completionValue(completion, 'timedOut', 'timed_out', fm.timed_out),
    timeout_reason: completionValue(completion, 'timeoutReason', 'timeout_reason', fm.timeout_reason),
    process_cleanup: completionValue(completion, 'processCleanup', 'process_cleanup', fm.process_cleanup),
    process_cleanup_method: completionValue(completion, 'processCleanupMethod', 'process_cleanup_method', fm.process_cleanup_method),
    duration_ms: completionValue(completion, 'durationMs', 'duration_ms', fm.duration_ms),
    adapter_status: completionValue(completion, 'adapterStatus', 'adapter_status', fm.adapter_status),
    last_progress_at: event.ts,
    last_progress: event.message,
    progress_seq: event.seq,
    terminal_event_emitted: true,
    _body: (fm._body || '') + (completion.bodyAppend || ''),
  });
  return { refused: false, event, record };
}
