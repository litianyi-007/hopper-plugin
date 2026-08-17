import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readFrontmatter, writeFrontmatter } from '../../cli/src/background.js';
import { appendProgressEvent, readProgressEvents } from '../../cli/src/progress.js';
import {
  buildAttestationStartupSnapshot,
  encodeObservedModelsJsonScalar,
  finalizeTerminalAttestation,
  parseObservedModelsJson,
  readCanonicalAttestation,
  repairOrphanTerminalHandoff,
} from '../../cli/src/handoff-attestation.js';

const NOW = '2026-07-21T12:00:00.000Z';
const BINDING = {
  vendor: 'claude', adapterId: 'claude', adapterVersion: '2026.07.21',
  catalogId: 'claude-selectors', catalogVersion: '1',
};

function selectorMetadata() {
  return {
    capabilitiesCache: {
      schema_version: 1,
      vendor: 'claude',
      adapter: {
        id: 'claude', version: '2026.07.21',
        identity_declaration: { identity_kind: 'opaque-id', provider_registry: [], provider_sentinels: [] },
      },
      catalog: { id: 'claude-selectors', version: '1' },
      source_kind: 'capabilities-cache',
      generated_at: '2026-07-21T00:00:00.000Z',
      expires_at: '2026-07-22T00:00:00.000Z',
      validity: 'accepted',
      selectors: [{ literal: 'fable', kind: 'alias' }],
    },
  };
}

function catalog() {
  return {
    sourceKind: 'adapter-aliases',
    sourceLabel: 'claude-selector-metadata',
    observedAt: NOW,
    freshness: 'fresh',
    binaryAvailability: 'present',
    binaryBasename: 'claude',
    binding: BINDING,
  };
}

function setup(taskId = 'T-attestation') {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-attestation-'));
  const hopperDir = join(tmp, '.hopper');
  const handoffs = join(hopperDir, 'handoffs');
  mkdirSync(handoffs, { recursive: true });
  const outputMdPath = join(handoffs, `${taskId}-output.md`);
  writeFrontmatter(outputMdPath, {
    task_id: taskId,
    adapter: 'claude',
    status: 'in-progress',
    mode: 'background',
    terminal_event_emitted: false,
    _body: '# body\n',
  });
  return { tmp, hopperDir, outputMdPath, taskId };
}

function completion() {
  return {
    vendor: 'claude', status: 'done', phase: 'done', message: 'Task completed successfully.',
    source: 'runner', durationMs: 42, exitCode: 0, adapterStatus: 'success',
  };
}

function parsed() {
  return {
    modelAttestation: {
      observedModels: ['claude-opus-4-6', 'claude-opus-4-6'],
      source: 'claude.result.modelUsage.keys', observedAt: NOW,
    },
  };
}

function recoveredFailure() {
  return {
    ...completion(), status: 'failed', phase: 'failed', message: 'Task failed.',
    adapterStatus: 'permission-fail', recoveredOutput: true,
    outputEvidence: {
      completeness: 'unknown-completeness', source: 'event-stream', terminalMarker: 'none',
    },
  };
}

test('startup snapshot preserves equal requested and effective selectors', () => {
  const snapshot = buildAttestationStartupSnapshot({
    requestedSelector: 'fable', effectiveSelector: 'fable', effectiveSelectorSource: 'user-argv',
    catalog: catalog(), selectorMetadata: selectorMetadata(),
  });
  assert.equal(snapshot.requestedSelector, 'fable');
  assert.equal(snapshot.effectiveSelector, 'fable');
  assert.equal(snapshot.effectiveSelectorSource, 'user-argv');
});

test('startup snapshot preserves policy replacement without mutating the request', () => {
  const snapshot = buildAttestationStartupSnapshot({
    requestedSelector: 'fable', effectiveSelector: 'claude-sonnet-4-6', effectiveSelectorSource: 'policy',
    catalog: catalog(), selectorMetadata: selectorMetadata(),
  });
  assert.equal(snapshot.requestedSelector, 'fable');
  assert.equal(snapshot.effectiveSelector, 'claude-sonnet-4-6');
  assert.equal(snapshot.effectiveSelectorSource, 'policy');
});

test('startup snapshot preserves a policy-cleared effective selector as auto', () => {
  const snapshot = buildAttestationStartupSnapshot({
    requestedSelector: 'fable', effectiveSelector: null, effectiveSelectorSource: 'policy',
    catalog: catalog(), selectorMetadata: selectorMetadata(),
  });
  assert.equal(snapshot.requestedSelector, 'fable');
  assert.equal(snapshot.effectiveSelector, null);
  assert.equal(snapshot.effectiveSelectorSource, 'policy');
});

test('same parsed result produces byte-equivalent terminal attestation fields for sync and background', () => {
  const left = setup('T-sync');
  const right = setup('T-background');
  const snapshot = buildAttestationStartupSnapshot({
    requestedSelector: 'fable', effectiveSelector: 'fable', effectiveSelectorSource: 'user-argv',
    catalog: catalog(), selectorMetadata: selectorMetadata(),
  });
  try {
    finalizeTerminalAttestation({ hopperDir: left.hopperDir, taskId: left.taskId, outputMdPath: left.outputMdPath, startupSnapshot: snapshot, parsed: parsed(), completion: completion(), now: NOW });
    finalizeTerminalAttestation({ hopperDir: right.hopperDir, taskId: right.taskId, outputMdPath: right.outputMdPath, startupSnapshot: snapshot, parsed: parsed(), completion: completion(), now: NOW });

    const fields = [
      'requested_selector', 'effective_selector', 'effective_selector_source', 'selector_kind',
      'observed_models_json', 'model_attestation_source', 'model_attestation_observed_at',
      'resolution_status', 'resolution_detail', 'diagnostic_code',
    ];
    const syncFm = readFrontmatter(left.outputMdPath);
    const backgroundFm = readFrontmatter(right.outputMdPath);
    assert.deepEqual(Object.fromEntries(fields.map((field) => [field, syncFm[field]])),
      Object.fromEntries(fields.map((field) => [field, backgroundFm[field]])));
    assert.equal(syncFm.status, 'done');
    assert.equal(syncFm.terminal_event_emitted, true);
    assert.deepEqual(JSON.parse(syncFm.observed_models_json), ['claude-opus-4-6']);

    for (const { hopperDir, taskId } of [left, right]) {
      const terminal = readProgressEvents({ hopperDir, taskId }).filter((event) => event.terminal);
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].observed_models[0], 'claude-opus-4-6');
      assert.equal(terminal[0].resolution_status, 'alias-resolved');
      assert.equal(terminal[0].requested_selector, 'fable');
    }
  } finally {
    rmSync(left.tmp, { recursive: true, force: true });
    rmSync(right.tmp, { recursive: true, force: true });
  }
});

test('finalizeTerminalAttestation persists one closed recovered-output projection event-first', () => {
  const state = setup('T-recovered');
  try {
    const out = finalizeTerminalAttestation({
      hopperDir: state.hopperDir,
      taskId: state.taskId,
      outputMdPath: state.outputMdPath,
      parsed: {},
      completion: recoveredFailure(),
      now: NOW,
    });
    assert.equal(out.event.status, 'failed');
    assert.equal(out.event.recovered_output, true);
    assert.equal(out.event.recovered_output_state, 'unknown-completeness');
    assert.equal(out.event.recovered_output_source, 'event-stream');
    assert.equal('terminalMarker' in out.event, false);

    const fm = readFrontmatter(state.outputMdPath);
    assert.equal(fm.recovered_output, true);
    assert.equal(fm.recovered_output_state, 'unknown-completeness');
    assert.equal(fm.recovered_output_source, 'event-stream');
    assert.deepEqual(readCanonicalAttestation(state).public.recoveredOutput, {
      recovered: true, state: 'unknown-completeness', source: 'event-stream',
    });
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('terminal adapter diagnostics stay closed from failed local fixtures through public rendering', () => {
  const fixtures = [
    ['kimi', 'adapter-auth-failed', 'KIMI_RAW_SENTINEL_should_never_escape'],
    ['opencode', 'adapter-protocol-invalid', 'OPENCODE_RAW_SENTINEL_should_never_escape'],
    ['claude', 'adapter-permission-failed', 'CLAUDE_RAW_SENTINEL_should_never_escape'],
  ];
  for (const [vendor, adapterDiagnosticCode, hostileRaw] of fixtures) {
    const state = setup(`T-${vendor}-closed-diagnostic`);
    try {
      writeFrontmatter(state.outputMdPath, {
        task_id: state.taskId, adapter: vendor, status: 'in-progress', mode: 'background',
        terminal_event_emitted: false, _body: '# body\n',
      });
      finalizeTerminalAttestation({
        hopperDir: state.hopperDir,
        taskId: state.taskId,
        outputMdPath: state.outputMdPath,
        parsed: { status: 'unknown-fail', error: hostileRaw, diagnosticCode: adapterDiagnosticCode },
        completion: {
          vendor, status: 'failed', phase: 'failed', message: 'Task failed.', source: 'runner',
          durationMs: 42, exitCode: 1, adapterStatus: 'unknown-fail', adapterDiagnosticCode,
        },
        now: NOW,
      });

      const fm = readFrontmatter(state.outputMdPath);
      const terminal = readProgressEvents({ hopperDir: state.hopperDir, taskId: state.taskId })
        .find((event) => event.terminal === true);
      const canonical = readCanonicalAttestation({ hopperDir: state.hopperDir, taskId: state.taskId, outputMdPath: state.outputMdPath });

      assert.equal(fm.adapter_diagnostic_code, adapterDiagnosticCode, vendor);
      assert.equal(terminal.adapter_diagnostic_code, adapterDiagnosticCode, vendor);
      assert.equal(canonical.public.adapterDiagnosticCode, adapterDiagnosticCode, vendor);
      assert.doesNotMatch(readFileSync(state.outputMdPath, 'utf8'), new RegExp(hostileRaw), vendor);
      assert.doesNotMatch(JSON.stringify(terminal), new RegExp(hostileRaw), vendor);
    } finally {
      rmSync(state.tmp, { recursive: true, force: true });
    }
  }
});

test('finalizer consumes only parsed modelAttestation and never synthesizes observed models from request or catalog', () => {
  const state = setup('T-no-synthesis');
  const snapshot = buildAttestationStartupSnapshot({
    requestedSelector: 'fable', effectiveSelector: 'fable', effectiveSelectorSource: 'user-argv',
    catalog: { ...catalog(), models: ['claude-catalog-only'] }, selectorMetadata: selectorMetadata(),
  });
  try {
    finalizeTerminalAttestation({ hopperDir: state.hopperDir, taskId: state.taskId, outputMdPath: state.outputMdPath, startupSnapshot: snapshot, parsed: {}, completion: completion(), now: NOW });
    const fm = readFrontmatter(state.outputMdPath);
    assert.equal(fm.observed_models_json, '[]');
    assert.equal(fm.resolution_status, 'unverified');
    assert.equal(fm.resolution_detail, 'alias-no-runtime-metadata');
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('append failure leaves frontmatter in-progress with no terminal marker', () => {
  const state = setup('T-append-failure');
  const snapshot = buildAttestationStartupSnapshot({
    requestedSelector: 'fable', effectiveSelector: 'fable', effectiveSelectorSource: 'user-argv', catalog: catalog(), selectorMetadata: selectorMetadata(),
  });
  try {
    assert.throws(() => finalizeTerminalAttestation({
      hopperDir: state.hopperDir, taskId: state.taskId, outputMdPath: state.outputMdPath, startupSnapshot: snapshot,
      parsed: parsed(), completion: completion(), io: { appendProgressEvent: () => { throw new Error('append failed'); } },
    }), /append failed/);
    const fm = readFrontmatter(state.outputMdPath);
    assert.equal(fm.status, 'in-progress');
    assert.equal(fm.terminal_event_emitted, false);
    assert.equal(readProgressEvents({ hopperDir: state.hopperDir, taskId: state.taskId }).filter((event) => event.terminal).length, 0);
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('frontmatter failure after event keeps exactly one JSONL terminal and reentry refuses duplicate append', () => {
  const state = setup('T-frontmatter-failure');
  const snapshot = buildAttestationStartupSnapshot({
    requestedSelector: 'fable', effectiveSelector: 'fable', effectiveSelectorSource: 'user-argv', catalog: catalog(), selectorMetadata: selectorMetadata(),
  });
  try {
    assert.throws(() => finalizeTerminalAttestation({
      hopperDir: state.hopperDir, taskId: state.taskId, outputMdPath: state.outputMdPath, startupSnapshot: snapshot,
      parsed: parsed(), completion: completion(), io: { writeFrontmatter: () => { throw new Error('frontmatter failed'); } },
    }), /frontmatter failed/);
    assert.equal(readProgressEvents({ hopperDir: state.hopperDir, taskId: state.taskId }).filter((event) => event.terminal).length, 1);
    const retry = finalizeTerminalAttestation({ hopperDir: state.hopperDir, taskId: state.taskId, outputMdPath: state.outputMdPath, startupSnapshot: snapshot, parsed: parsed(), completion: completion() });
    assert.equal(retry.refused, true);
    assert.equal(readProgressEvents({ hopperDir: state.hopperDir, taskId: state.taskId }).filter((event) => event.terminal).length, 1);
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('existing terminal event refuses reentry and terminal writers never persist finalizing or partial', () => {
  const state = setup('T-reentry');
  const snapshot = buildAttestationStartupSnapshot({
    requestedSelector: 'fable', effectiveSelector: 'fable', effectiveSelectorSource: 'user-argv', catalog: catalog(), selectorMetadata: selectorMetadata(),
  });
  try {
    const first = finalizeTerminalAttestation({ hopperDir: state.hopperDir, taskId: state.taskId, outputMdPath: state.outputMdPath, startupSnapshot: snapshot, parsed: parsed(), completion: completion() });
    assert.equal(first.refused, false);
    const retry = finalizeTerminalAttestation({ hopperDir: state.hopperDir, taskId: state.taskId, outputMdPath: state.outputMdPath, startupSnapshot: snapshot, parsed: parsed(), completion: completion() });
    assert.equal(retry.refused, true);
    assert.equal(readProgressEvents({ hopperDir: state.hopperDir, taskId: state.taskId }).filter((event) => event.terminal).length, 1);
    const raw = readFileSync(state.outputMdPath, 'utf8');
    assert.doesNotMatch(raw, /^status: (?:finalizing|partial)$/m);
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('observed model JSON scalar retains only shared-safe public identifiers', () => {
  const models = [
    'fable', 'tokenbox/deepseek-v4-pro', 'sk_live_0123456789abcdefghijklmnop',
    'C:\\private\\model', 'https://private.example/model', 'line\nbreak',
    'fable', '', 42,
  ];
  const encoded = encodeObservedModelsJsonScalar(models);
  assert.match(encoded, /^"/);
  assert.deepEqual(parseObservedModelsJson(JSON.parse(encoded)), [
    'fable', 'tokenbox/deepseek-v4-pro',
  ]);
  for (const hostile of [null, {}, 'not-json', 'null', '{}', '42', '["ok", null, 7, "ok", "next", ""]']) {
    assert.deepEqual(parseObservedModelsJson(hostile), [], String(hostile));
  }
});

test('canonical reader derives status from one valid terminal event and exposes normalized attestation fields', () => {
  const state = setup('T-reader-agree');
  try {
    writeFrontmatter(state.outputMdPath, {
      task_id: state.taskId, adapter: 'claude', status: 'done', phase: 'done', terminal_event_emitted: true,
      requested_selector: 'fable', effective_selector: 'fable', selector_kind: 'alias',
      observed_models_json: JSON.stringify(['frontmatter-model']), resolution_status: 'alias-resolved',
      catalog_source_kind: 'cache', catalog_source_label: 'trusted', catalog_observed_at: NOW,
      catalog_freshness: 'fresh', binary_availability: 'present', binary_basename: 'claude', _body: '# body\n',
    });
    appendProgressEvent({
      hopperDir: state.hopperDir, taskId: state.taskId,
      event: {
        vendor: 'claude', phase: 'done', kind: 'terminal', message: 'done', source: 'runner', terminal: true, status: 'done',
        requested_selector: 'fable', effective_selector: 'fable', selector_kind: 'alias',
        observed_models: ['event-model', 'event-model', '', 3], resolution_status: 'alias-resolved', resolution_detail: 'alias-runtime-resolved',
      },
    });
    const record = readCanonicalAttestation(state);
    assert.equal(record.displayStatus, 'done');
    assert.equal(record.attestation_consistency, 'agreement');
    assert.deepEqual(record.observedModels, ['event-model']);
    assert.deepEqual(record.selector, { requested: 'fable', effective: 'fable', kind: 'alias' });
    assert.equal(record.resolution.status, 'alias-resolved');
    assert.deepEqual(record.safeCatalog, {
      catalog_source_kind: 'cache', catalog_source_label: 'trusted', catalog_observed_at: NOW,
      catalog_freshness: 'fresh', binary_availability: 'present', binary_basename: 'claude',
    });
    assert.equal(record.recentEvents.length, 1);
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('canonical reader safely degrades corrupt frontmatter values and event/frontmatter crash windows', () => {
  const state = setup('T-reader-crash');
  try {
    writeFileSync(state.outputMdPath, [
      '---', `task_id: ${state.taskId}`, 'status: in-progress', 'observed_models_json: ["flow"]', 'truncated: "unterminated', '---', '# body',
    ].join('\n'), 'utf-8');
    appendProgressEvent({
      hopperDir: state.hopperDir, taskId: state.taskId,
      event: { vendor: 'claude', phase: 'done', kind: 'terminal', message: 'done', source: 'runner', terminal: true, status: 'done', observed_models: ['event-model'] },
    });
    const finalizing = readCanonicalAttestation(state);
    assert.equal(finalizing.displayStatus, 'finalizing');
    assert.equal(finalizing.attestation_consistency, 'event-only');
    assert.deepEqual(finalizing.observedModels, ['event-model']);

    writeFrontmatter(state.outputMdPath, { task_id: state.taskId, status: 'failed', observed_models_json: '{}', resolution_status: 'nonsense', _body: '' });
    const conflict = readCanonicalAttestation(state);
    assert.equal(conflict.displayStatus, 'partial');
    assert.equal(conflict.attestation_consistency, 'conflict');
    assert.equal(conflict.resolution.status, 'unverified');

    writeFileSync(state.outputMdPath, 'not frontmatter\n', 'utf-8');
    const corrupt = readCanonicalAttestation(state);
    assert.equal(corrupt.displayStatus, 'partial');
    assert.equal(corrupt.attestation_consistency, 'event-only');
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('canonical reader treats frontmatter-only completion as complete and invalid status as unknown', () => {
  const state = setup('T-reader-frontmatter');
  try {
    writeFrontmatter(state.outputMdPath, { task_id: state.taskId, status: 'done', terminal_event_emitted: true, observed_models_json: null, _body: '' });
    const complete = readCanonicalAttestation(state);
    assert.equal(complete.displayStatus, 'done');
    assert.equal(complete.attestation_consistency, 'frontmatter-only');
    assert.deepEqual(complete.observedModels, []);
    writeFrontmatter(state.outputMdPath, { task_id: state.taskId, status: 'what-even-is-this', _body: '' });
    const invalid = readCanonicalAttestation(state);
    assert.equal(invalid.displayStatus, 'unknown');
    assert.equal(invalid.resolution.status, 'unverified');
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('canonical reader projects legacy selector and observed model metadata through the shared safe identifier boundary', () => {
  const state = setup('T-legacy-public-identifiers');
  try {
    writeFrontmatter(state.outputMdPath, {
      task_id: state.taskId, adapter: 'claude', status: 'done', phase: 'done', terminal_event_emitted: true,
      requested_selector: 'sk_live_0123456789abcdefghijklmnop',
      effective_selector: 'https://private.example/model',
      observed_models_json: JSON.stringify([
        'ghp_0123456789abcdefghijklmnop', 'fable', 'C:\\private\\model', 'fable',
      ]),
      _body: '# body\n',
    });
    const record = readCanonicalAttestation(state);
    assert.deepEqual(record.selector, { requested: null, effective: null, kind: 'unknown' });
    assert.deepEqual(record.public.observedModels, ['fable']);
    assert.doesNotMatch(JSON.stringify(record.public), /sk_live|ghp_|private\\model|https:/);
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('orphan frontmatter repair only commits one matching terminal event and safe catalog fields', () => {
  const state = setup('T-repair');
  try {
    writeFrontmatter(state.outputMdPath, {
      task_id: state.taskId, status: 'in-progress', adapter: 'forged-adapter', requested_selector: 'forged',
      catalog_source_kind: 'cache', catalog_source_label: 'trusted', catalog_observed_at: NOW,
      catalog_freshness: 'fresh', binary_availability: 'present', binary_basename: 'claude', unsafe_field: 'must-not-copy', _body: '# body\n',
    });
    appendProgressEvent({
      hopperDir: state.hopperDir, taskId: state.taskId,
      event: {
        vendor: 'claude', phase: 'done', kind: 'terminal', message: 'done', source: 'runner', terminal: true, status: 'done',
        requested_selector: 'fable', effective_selector: 'fable', selector_kind: 'alias', observed_models: ['claude-opus-4-6'],
        model_attestation_source: 'runtime', model_attestation_observed_at: NOW, resolution_status: 'alias-resolved', resolution_detail: 'alias-runtime-resolved',
      },
    });
    const repaired = repairOrphanTerminalHandoff(state);
    assert.equal(repaired.repaired, true);
    const fm = readFrontmatter(state.outputMdPath);
    assert.equal(fm.status, 'done');
    assert.equal(fm.adapter, 'claude');
    assert.equal(fm.requested_selector, 'fable');
    assert.equal(fm.catalog_source_label, 'trusted');
    assert.equal(fm.unsafe_field, undefined);
    assert.equal(readProgressEvents({ hopperDir: state.hopperDir, taskId: state.taskId }).filter((event) => event.terminal).length, 1);
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('orphan frontmatter repair copies only the closed recovered-output projection from its terminal event', () => {
  const state = setup('T-repair-recovered');
  try {
    appendProgressEvent({
      hopperDir: state.hopperDir,
      taskId: state.taskId,
      event: {
        vendor: 'claude', phase: 'failed', kind: 'terminal', message: 'Task failed.', source: 'runner', terminal: true, status: 'failed',
        recovered_output: true,
        recovered_output_state: 'unknown-completeness',
        recovered_output_source: 'event-stream',
      },
    });
    const terminal = readProgressEvents({ hopperDir: state.hopperDir, taskId: state.taskId })
      .find((event) => event.terminal === true);
    assert.deepEqual({
      recovered_output: terminal.recovered_output,
      recovered_output_state: terminal.recovered_output_state,
      recovered_output_source: terminal.recovered_output_source,
    }, {
      recovered_output: true,
      recovered_output_state: 'unknown-completeness',
      recovered_output_source: 'event-stream',
    });
    const repaired = repairOrphanTerminalHandoff(state);
    assert.equal(repaired.repaired, true);
    const fm = readFrontmatter(state.outputMdPath);
    assert.equal(fm.status, 'failed');
    assert.equal(fm.recovered_output, true);
    assert.equal(fm.recovered_output_state, 'unknown-completeness');
    assert.equal(fm.recovered_output_source, 'event-stream');
    assert.equal(readProgressEvents({ hopperDir: state.hopperDir, taskId: state.taskId }).filter((event) => event.terminal).length, 1);
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

test('canonical reader normalizes invalid recovered-output event and frontmatter fields to no-text', () => {
  const cases = [
    { recovered_output: true, recovered_output_state: 'unknown-completeness', recovered_output_source: 'raw-stdout' },
    { recovered_output: true, recovered_output_state: 'verified-complete', recovered_output_source: 'none' },
  ];
  for (const [index, recovery] of cases.entries()) {
    const state = setup(`T-invalid-recovery-${index}`);
    try {
      writeFrontmatter(state.outputMdPath, {
        task_id: state.taskId, adapter: 'claude', status: 'failed', phase: 'failed', terminal_event_emitted: true,
        ...recovery, _body: '# body\n',
      });
      appendProgressEvent({
        hopperDir: state.hopperDir,
        taskId: state.taskId,
        event: {
          vendor: 'claude', phase: 'failed', kind: 'terminal', message: 'Task failed.', source: 'runner', terminal: true, status: 'failed',
          ...recovery,
        },
      });
      assert.deepEqual(readCanonicalAttestation(state).public.recoveredOutput, {
        recovered: false, state: 'no-text', source: 'none',
      });
    } finally {
      rmSync(state.tmp, { recursive: true, force: true });
    }
  }
});

test('orphan frontmatter repair refuses zero/multiple/mismatched terminal events and late completion', () => {
  const state = setup('T-repair-guards');
  try {
    assert.equal(repairOrphanTerminalHandoff(state).repaired, false, 'zero terminal events');
    appendProgressEvent({ hopperDir: state.hopperDir, taskId: state.taskId, event: { vendor: 'claude', phase: 'done', kind: 'terminal', message: 'done', source: 'runner', terminal: true, status: 'done' } });
    appendProgressEvent({ hopperDir: state.hopperDir, taskId: state.taskId, event: { vendor: 'claude', phase: 'done', kind: 'terminal', message: 'again', source: 'runner', terminal: true, status: 'done' } });
    assert.equal(repairOrphanTerminalHandoff(state).repaired, false, 'multiple terminal events');

    const mismatch = setup('T-repair-mismatch');
    try {
      writeFileSync(join(mismatch.hopperDir, 'handoffs', `${mismatch.taskId}-progress.log`), JSON.stringify({ task_id: 'other', terminal: true, kind: 'terminal', status: 'done' }) + '\n', 'utf-8');
      assert.equal(repairOrphanTerminalHandoff(mismatch).repaired, false, 'mismatched terminal event');
    } finally {
      rmSync(mismatch.tmp, { recursive: true, force: true });
    }

    const malformed = setup('T-repair-malformed');
    try {
      writeFileSync(malformed.outputMdPath, 'not frontmatter\n', 'utf-8');
      appendProgressEvent({ hopperDir: malformed.hopperDir, taskId: malformed.taskId, event: { vendor: 'claude', phase: 'done', kind: 'terminal', message: 'done', source: 'runner', terminal: true, status: 'done' } });
      assert.equal(repairOrphanTerminalHandoff(malformed).repaired, false, 'malformed frontmatter');
      const unsafePath = join(malformed.tmp, 'outside-output.md');
      writeFileSync(unsafePath, '---\ntask_id: T-repair-malformed\nstatus: in-progress\n---\n', 'utf-8');
      assert.equal(repairOrphanTerminalHandoff({ ...malformed, outputMdPath: unsafePath }).repaired, false, 'unsafe output path');
    } finally {
      rmSync(malformed.tmp, { recursive: true, force: true });
    }

    let reads = 0;
    const completeFm = { task_id: state.taskId, status: 'done', terminal_event_emitted: true, _body: '' };
    const late = repairOrphanTerminalHandoff({
      ...state,
      io: {
        readFrontmatter: () => (++reads > 1 ? completeFm : { task_id: state.taskId, status: 'in-progress', _body: '' }),
        readProgressEvents: () => [{ task_id: state.taskId, terminal: true, kind: 'terminal', status: 'done', vendor: 'claude', phase: 'done', message: 'done', source: 'runner' }],
        writeFrontmatter: () => assert.fail('late complete frontmatter must not be replaced'),
      },
    });
    assert.equal(late.repaired, false);

    let changedReads = 0;
    const changed = repairOrphanTerminalHandoff({
      ...state,
      io: {
        readFrontmatter: () => (++changedReads > 1 ? { task_id: 'other', status: 'in-progress', _body: '' } : { task_id: state.taskId, status: 'in-progress', _body: '' }),
        readProgressEvents: () => [{ task_id: state.taskId, terminal: true, kind: 'terminal', status: 'done', vendor: 'claude', phase: 'done', message: 'done', source: 'runner' }],
        writeFrontmatter: () => assert.fail('late changed frontmatter must not be replaced'),
      },
    });
    assert.equal(changed.repaired, false);
  } finally {
    rmSync(state.tmp, { recursive: true, force: true });
  }
});

// ── vendor_session_id: declared in v1, hardcoded null until 2026-08-10 ──

test('a vendor-reported session id is persisted to vendor_session_id', () => {
  // pi hands its session id over on the first line of its stream; the field had
  // been sitting `null` for every vendor since v1 ("reserved for v1.2"). With it
  // written, a 12-minute background review can be resumed with `--session <id>`
  // instead of re-run and re-paid.
  const ctx = setup(`T-session-${Math.abs(Math.round(process.hrtime()[1]))}`);
  finalizeTerminalAttestation({
    hopperDir: ctx.hopperDir,
    taskId: ctx.taskId,
    outputMdPath: ctx.outputMdPath,
    parsed: { ...parsed(), sessionId: '019fea74-c6c9-7dc3-b538-db5c6c014279' },
    completion: completion(),
    now: new Date(NOW),
  });
  const fm = readFrontmatter(ctx.outputMdPath);
  assert.equal(fm.vendor_session_id, '019fea74-c6c9-7dc3-b538-db5c6c014279');
});

test('an absent session id leaves vendor_session_id alone instead of clobbering it', () => {
  const ctx = setup(`T-session-${Math.abs(Math.round(process.hrtime()[1]))}`);
  writeFrontmatter(ctx.outputMdPath, { ...readFrontmatter(ctx.outputMdPath), vendor_session_id: 'preexisting-id' });
  finalizeTerminalAttestation({
    hopperDir: ctx.hopperDir,
    taskId: ctx.taskId,
    outputMdPath: ctx.outputMdPath,
    parsed: parsed(),                       // no sessionId — most adapters report none
    completion: completion(),
    now: new Date(NOW),
  });
  assert.equal(readFrontmatter(ctx.outputMdPath).vendor_session_id, 'preexisting-id');
});

test('a malformed or hostile session id is REFUSED, not escaped into frontmatter', () => {
  // This is vendor-controlled text entering a YAML-ish file. An id is an opaque
  // handle, so anything carrying a newline, a quote, a colon or absurd length is
  // not a mangled id worth salvaging — it is something with no business in this
  // field, and validating beats escaping.
  for (const hostile of [
    'id\nstatus: done',                       // frontmatter injection
    'id: "quoted"',
    'id with spaces',
    'C:/PRIVATE/path/to/session',             // a path is not an id
    'x'.repeat(129),                          // over the length bound
    '',
    42,
    null,
  ]) {
    const ctx = setup(`T-session-${Math.abs(Math.round(process.hrtime()[1]))}`);
    finalizeTerminalAttestation({
      hopperDir: ctx.hopperDir,
      taskId: ctx.taskId,
      outputMdPath: ctx.outputMdPath,
      parsed: { ...parsed(), sessionId: hostile },
      completion: completion(),
      now: new Date(NOW),
    });
    const fm = readFrontmatter(ctx.outputMdPath);
    assert.notEqual(fm.vendor_session_id, hostile, `must refuse ${JSON.stringify(hostile)}`);
    assert.equal(fm.status, 'done', 'frontmatter must remain structurally intact');
    assert.equal(fm.task_id, ctx.taskId);
  }
});
