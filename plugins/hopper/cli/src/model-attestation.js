// Strict, zero-spawn selector classification and runtime model attestation.
// This module deliberately accepts already-sanitized metadata only: it performs
// no cache I/O, vendor invocation, probing, network access, or alias expansion.

import { compareRuntimeIdentity, parseStrictProviderModel } from './model-normalize.js';

export { compareRuntimeIdentity, parseStrictProviderModel };

/** Closed, cross-domain diagnostic precedence from the frozen attestation design. */
export const DIAGNOSTIC_PRECEDENCE = Object.freeze([
  'runtime-model-metadata-malformed',
  'runtime-model-metadata-conflict',
  'metadata-envelope-malformed',
  'selector-metadata-cache-schema-unsupported',
  'selector-metadata-cache-adapter-mismatch',
  'selector-metadata-cache-expired',
  'selector-metadata-cache-missing',
  'inventory-cache-version-unsupported',
  'inventory-cache-malformed',
  'inventory-cache-recovery-backup-create-failed',
  'inventory-cache-recovery-replace-failed',
  'inventory-cache-recovery-durability-unknown',
  'capability-failed',
  'probe-failed',
  'catalog-unavailable',
  'runtime-model-metadata-absent',
  'unknown',
]);

const DIAGNOSTIC_SET = new Set(DIAGNOSTIC_PRECEDENCE);
const SELECTOR_SOURCE_KINDS = new Set(['capabilities-cache', 'adapter-manifest']);
const SELECTOR_KINDS = new Set(['alias', 'concrete']);
const NON_LIVE_PROVIDER_LITERALS = new Set(['dead', 'unavailable', 'unknown', 'placeholder']);

function result(valid, diagnosticCode, envelope = null) {
  return { valid, diagnosticCode, envelope };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactStringList(value) {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) return false;
  return new Set(value).size === value.length;
}

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function hasOnlyOwnKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.has(key));
}

function declarationIsValid(vendor, declaration) {
  if (!hasOnlyOwnKeys(declaration, new Set(['identity_kind', 'provider_registry', 'provider_sentinels']))) return false;
  if (!exactStringList(declaration.provider_registry) || !exactStringList(declaration.provider_sentinels)) return false;
  const registry = new Set(declaration.provider_registry);
  if (declaration.provider_sentinels.some((provider) => registry.has(provider))) return false;
  if (vendor === 'claude') {
    return declaration.identity_kind === 'opaque-id'
      && declaration.provider_registry.length === 0
      && declaration.provider_sentinels.length === 0;
  }
  return vendor === 'opencode' && declaration.identity_kind === 'provider-model'
    && !declaration.provider_registry.some((provider) => NON_LIVE_PROVIDER_LITERALS.has(provider.toLowerCase()));
}

function expectedIdentityIsValid(vendor, declaration, record) {
  const identity = record.expected_runtime_identity;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return false;
  if (vendor === 'claude') {
    return declaration.identity_kind === 'opaque-id'
      && hasOnlyOwnKeys(identity, new Set(['identity_kind', 'id']))
      && identity.identity_kind === 'opaque-id'
      && isNonEmptyString(identity.id)
      && record.literal === identity.id;
  }
  if (vendor === 'opencode') {
    if (declaration.identity_kind !== 'provider-model'
      || !hasOnlyOwnKeys(identity, new Set(['identity_kind', 'provider', 'model']))
      || identity.identity_kind !== 'provider-model'
      || !isNonEmptyString(identity.provider)
      || !isNonEmptyString(identity.model)) return false;
    const literal = parseStrictProviderModel(record.literal);
    return declaration.provider_registry.includes(identity.provider)
      && !declaration.provider_sentinels.includes(identity.provider)
      && !NON_LIVE_PROVIDER_LITERALS.has(identity.provider.toLowerCase())
      && literal !== null
      && literal.provider === identity.provider
      && literal.model === identity.model;
  }
  return false;
}

function selectorRecordsAreValid(vendor, declaration, selectors) {
  if (!Array.isArray(selectors)) return false;
  const literals = new Set();
  for (const record of selectors) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || !isNonEmptyString(record.literal) || !SELECTOR_KINDS.has(record.kind)
      || literals.has(record.literal)) return false;
    literals.add(record.literal);
    if (record.kind === 'alias') {
      if (Object.hasOwn(record, 'expected_runtime_identity')) return false;
    } else if (!expectedIdentityIsValid(vendor, declaration, record)) {
      return false;
    }
  }
  return true;
}

/**
 * Validate a sanitized schema-v1 selector metadata envelope without I/O.
 * Unknown forward fields are preserved by callers and ignored here; required
 * identity union members remain closed so they cannot widen comparison rules.
 * @param {unknown} envelope
 * @param {{vendor:string,adapterId:string,adapterVersion:string,catalogId:string,catalogVersion:string}} binding
 * @param {string|Date} [now]
 * @param {'capabilities-cache'|'adapter-manifest'|null} [expectedSourceKind]
 * @returns {{valid:boolean, diagnosticCode:string, envelope:object|null}}
 */
export function validateSelectorMetadataEnvelope(envelope, binding, now = new Date(), expectedSourceKind = null) {
  if (envelope === null || envelope === undefined) return result(false, 'selector-metadata-cache-missing');
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return result(false, 'metadata-envelope-malformed');
  if (typeof envelope.schema_version !== 'number') return result(false, 'metadata-envelope-malformed');
  if (envelope.schema_version !== 1) return result(false, 'selector-metadata-cache-schema-unsupported');

  const adapter = envelope.adapter;
  const catalog = envelope.catalog;
  if (!isNonEmptyString(envelope.vendor) || !adapter || typeof adapter !== 'object' || Array.isArray(adapter)
    || !catalog || typeof catalog !== 'object' || Array.isArray(catalog)
    || !isNonEmptyString(adapter.id) || !isNonEmptyString(adapter.version)
    || !isNonEmptyString(catalog.id) || !isNonEmptyString(catalog.version)
    || !binding || typeof binding !== 'object') return result(false, 'metadata-envelope-malformed');

  if (envelope.vendor !== binding.vendor || adapter.id !== binding.adapterId
    || adapter.version !== binding.adapterVersion || catalog.id !== binding.catalogId
    || catalog.version !== binding.catalogVersion) {
    return result(false, 'selector-metadata-cache-adapter-mismatch');
  }

  if (!SELECTOR_SOURCE_KINDS.has(envelope.source_kind)
    || (expectedSourceKind && envelope.source_kind !== expectedSourceKind)) return result(false, 'metadata-envelope-malformed');

  const generatedAt = dateValue(envelope.generated_at);
  const expiresAt = dateValue(envelope.expires_at);
  const current = now instanceof Date ? now.getTime() : dateValue(now);
  if (generatedAt === null || expiresAt === null || current === null || generatedAt > expiresAt || expiresAt < current
    || envelope.validity !== 'accepted') {
    return result(false, 'selector-metadata-cache-expired');
  }

  const declaration = adapter.identity_declaration;
  if (!declarationIsValid(envelope.vendor, declaration)
    || !selectorRecordsAreValid(envelope.vendor, declaration, envelope.selectors)) {
    return result(false, 'metadata-envelope-malformed');
  }
  return result(true, 'none', envelope);
}

/**
 * Select the first valid local metadata source and classify an effective selector.
 * A null effective selector is the only path that emits `auto`; it does not read
 * or match a metadata record.
 * @param {{effectiveSelector:string|null,binding:object,selectorMetadata?:{capabilitiesCache?:object|null,adapterManifest?:object|null},now?:string|Date}} input
 * @returns {{selectorKind:'alias'|'concrete'|'auto'|'unknown',diagnosticCode:string,source:string|null,record:object|null}}
 */
export function classifyEffectiveSelector({ effectiveSelector, binding, selectorMetadata = {}, now = new Date() }) {
  if (effectiveSelector === null) {
    return { selectorKind: 'auto', diagnosticCode: 'none', source: null, record: null };
  }

  const candidates = [
    ['capabilitiesCache', 'capabilities-cache'],
    ['adapterManifest', 'adapter-manifest'],
  ];
  const diagnostics = [];
  for (const [key, source] of candidates) {
    if (selectorMetadata[key] === null || selectorMetadata[key] === undefined) continue;
    const validation = validateSelectorMetadataEnvelope(selectorMetadata[key], binding, now, source);
    if (!validation.valid) {
      diagnostics.push(validation.diagnosticCode);
      continue;
    }
    const record = validation.envelope.selectors.find((candidate) => candidate.literal === effectiveSelector) || null;
    return {
      selectorKind: record ? record.kind : 'unknown',
      diagnosticCode: 'none',
      source,
      record,
    };
  }

  return {
    selectorKind: 'unknown',
    diagnosticCode: diagnostics.length > 0 ? chooseDiagnosticCode(diagnostics) : 'selector-metadata-cache-missing',
    source: null,
    record: null,
  };
}

/**
 * Select the highest-priority closed diagnostic. Unrecognized diagnostic input
 * deliberately degrades to `unknown` instead of becoming public raw text.
 * @param {string[]} codes
 * @returns {string}
 */
export function chooseDiagnosticCode(codes) {
  const input = Array.isArray(codes) ? codes.filter((code) => code && code !== 'none') : [];
  if (input.length === 0) return 'none';
  const known = input.filter((code) => DIAGNOSTIC_SET.has(code));
  if (known.length === 0) return 'unknown';
  return known.sort((left, right) => DIAGNOSTIC_PRECEDENCE.indexOf(left) - DIAGNOSTIC_PRECEDENCE.indexOf(right))[0];
}

function normalizeObservedModels(observedModels) {
  if (observedModels === null || observedModels === undefined) return { models: [], malformed: false };
  if (!Array.isArray(observedModels)) return { models: [], malformed: true };
  const models = [];
  let malformed = false;
  for (const model of observedModels) {
    if (!isNonEmptyString(model)) {
      malformed = true;
      continue;
    }
    if (!models.includes(model)) models.push(model);
  }
  return { models, malformed };
}

function isStableObservedIdentity(vendor, model) {
  // `pi` joins the terminal message's `provider` + `model` fields, so its
  // observed identity is the same strict provider/model pair opencode emits.
  // A vendor absent from this list that nonetheless reports observedModels
  // would be classified `runtime-model-metadata-malformed` — so an adapter
  // gaining modelAttestation must be added here in the same change.
  return vendor === 'claude'
    ? isNonEmptyString(model)
    : (vendor === 'opencode' || vendor === 'pi') && parseStrictProviderModel(model) !== null;
}

function configOnlySource(sourceKind) {
  return sourceKind === 'config' || sourceKind === 'config-only';
}

/**
 * Resolve a validated selector classification against one task's runtime evidence.
 * This is intentionally a pure final classification step; writers and readers map
 * its camelCase result to their file protocol separately.
 * @param {{effectiveSelector:string|null,effectiveSelectorSource?:string,binding:object,selectorMetadata?:object,observedModels?:unknown,catalogSourceKind?:string,runtimeDiagnosticCode?:string,now?:string|Date}} input
 * @returns {{selectorKind:string,resolutionStatus:'exact'|'mismatch'|'alias-resolved'|'config-only'|'unverified',resolutionDetail:string,observedModels:string[],diagnosticCode:string}}
 */
export function resolveAttestation({
  effectiveSelector,
  effectiveSelectorSource = 'vendor-default',
  binding,
  selectorMetadata = {},
  observedModels = [],
  catalogSourceKind = 'unknown',
  runtimeDiagnosticCode = 'none',
  now = new Date(),
}) {
  const classified = classifyEffectiveSelector({ effectiveSelector, binding, selectorMetadata, now });
  const observed = normalizeObservedModels(observedModels);
  const runtimeMalformed = observed.malformed || observed.models.some((model) => !isStableObservedIdentity(binding?.vendor, model));
  const runtimeDiagnostic = runtimeMalformed
    ? 'runtime-model-metadata-malformed'
    : (DIAGNOSTIC_SET.has(runtimeDiagnosticCode) || runtimeDiagnosticCode === 'none' ? runtimeDiagnosticCode : 'unknown');
  const diagnosticCode = chooseDiagnosticCode([classified.diagnosticCode, runtimeDiagnostic]);
  const base = {
    selectorKind: classified.selectorKind,
    observedModels: observed.models,
    diagnosticCode,
  };

  if (classified.selectorKind === 'auto') {
    return {
      ...base,
      resolutionStatus: 'unverified',
      resolutionDetail: effectiveSelectorSource === 'policy' ? 'policy-effective-default' : 'no-effective-selector',
    };
  }
  if (classified.selectorKind === 'unknown') {
    return { ...base, resolutionStatus: 'unverified', resolutionDetail: 'selector-kind-unknown' };
  }

  const hasUsableRuntimeEvidence = observed.models.length > 0 && !runtimeMalformed && runtimeDiagnostic === 'none';
  if (classified.selectorKind === 'alias') {
    if (hasUsableRuntimeEvidence) {
      return { ...base, resolutionStatus: 'alias-resolved', resolutionDetail: 'alias-runtime-resolved' };
    }
    if (observed.models.length === 0 && !runtimeMalformed && configOnlySource(catalogSourceKind)) {
      return { ...base, resolutionStatus: 'config-only', resolutionDetail: 'alias-config-only-no-runtime' };
    }
    return { ...base, resolutionStatus: 'unverified', resolutionDetail: 'alias-no-runtime-metadata' };
  }

  if (!hasUsableRuntimeEvidence) {
    if (observed.models.length === 0 && !runtimeMalformed && configOnlySource(catalogSourceKind)) {
      return { ...base, resolutionStatus: 'config-only', resolutionDetail: 'concrete-config-only-no-runtime' };
    }
    return {
      ...base,
      resolutionStatus: 'unverified',
      resolutionDetail: observed.models.length > 0 ? 'concrete-runtime-unverifiable' : 'concrete-no-runtime-metadata',
    };
  }

  const comparisons = observed.models.map((model) => compareRuntimeIdentity(binding.vendor, classified.record.expected_runtime_identity, model));
  if (comparisons.includes('match')) {
    return { ...base, resolutionStatus: 'exact', resolutionDetail: 'concrete-runtime-exact' };
  }
  if (comparisons.every((comparison) => comparison === 'non-match')) {
    return { ...base, resolutionStatus: 'mismatch', resolutionDetail: 'concrete-runtime-mismatch' };
  }
  return { ...base, resolutionStatus: 'unverified', resolutionDetail: 'concrete-runtime-unverifiable' };
}
