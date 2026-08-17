// Vendor-stream progress heartbeats — which stream events count as a lifecycle
// transition, and what must never ride along with them.
// Anchor: tests/unit/progress-vendor-stream.test.js
//
// WHY (2026-08-10). `findLatestVendorProgressEvent` held an inline, hardcoded
// vocabulary of opencode's `step_*` plus claude's `result`. Measured on a real
// 12-minute pi background review — and across all 194 background tasks in that
// project, 616 progress events — `source: "vendor-stream"` appeared ZERO times
// for ANY vendor. pi's 25-turn, 176-tool-call run therefore reported exactly two
// progress events ("queued", "done"), and the operator hand-rolled a poller out
// of `--jobs` and `wc -c`.
//
// The rule this file defends: a token may join the vocabulary when it names a
// PHASE TRANSITION, and only `type` + `reason` may ever reach a progress record.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { findLatestVendorProgressEvent } from '../../cli/src/progress.js';

const ev = (o) => JSON.stringify(o);

test('pi lifecycle events are recognized (the regression that made pi invisible)', () => {
  const cases = [
    ['agent_start', { type: 'agent_start' }],
    ['turn_start', { type: 'turn_start' }],
    ['tool_execution_start', { type: 'tool_execution_start', toolName: 'read', args: { path: '/x' }, toolCallId: 'c1' }],
    ['tool_execution_end', { type: 'tool_execution_end', toolName: 'read', result: 'FILE BODY', isError: false, toolCallId: 'c1' }],
    ['turn_end', { type: 'turn_end', message: { role: 'assistant', content: [] }, toolResults: [] }],
    ['agent_end', { type: 'agent_end', messages: [], willRetry: false }],
    ['agent_settled', { type: 'agent_settled' }],
  ];
  for (const [expected, event] of cases) {
    const got = findLatestVendorProgressEvent(ev(event));
    assert.ok(got, `${expected} must be recognized as a lifecycle transition`);
    assert.equal(got.event, expected);
    assert.equal(got.reason, null, `${expected} carries no reason in pi's stream`);
  }
});

test('pi compaction surfaces its reason, because that is the useful part', () => {
  // The one pi lifecycle event that DOES carry a reason, and it is a clean
  // protocol token. "The vendor is compacting because it overflowed" is exactly
  // what a 12-minute silence should be able to say.
  for (const type of ['compaction_start', 'compaction_end']) {
    const got = findLatestVendorProgressEvent(ev({ type, reason: 'overflow' }));
    assert.deepEqual(got, { event: type, reason: 'overflow' });
  }
});

test('content-bearing stream events are NOT lifecycle transitions', () => {
  // These are the bulk of pi's stream (2101 message_update events in the real
  // run). They carry model text, reasoning and tool arguments — admitting them
  // would be both a content leak and a flood.
  for (const event of [
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'SECRET' } },
    { type: 'text', text: 'SECRET' },
    { type: 'text_delta', delta: 'SECRET' },
    { type: 'thinking', thinking: 'SECRET' },
    { type: 'thinking_delta', delta: 'SECRET' },
    { type: 'toolcall_delta', delta: 'SECRET' },
    { type: 'message_start', message: { role: 'assistant', content: [] } },
  ]) {
    assert.equal(findLatestVendorProgressEvent(ev(event)), null,
      `${event.type} must not become a progress heartbeat`);
  }
});

test('a recognized event never carries vendor content into the progress record', () => {
  // tool_execution_end holds `result` — real file contents. Only `type` and
  // `reason` may be read. Listing the token explicitly ALSO stops the recursion
  // from descending into `result` hunting for a nested lifecycle event, which is
  // precisely where tool output lives.
  const got = findLatestVendorProgressEvent(ev({
    type: 'tool_execution_end',
    toolName: 'read',
    result: { type: 'result', reason: 'PRIVATE_TOOL_OUTPUT', body: 'C:/PRIVATE/secrets.env' },
    isError: false,
  }));
  assert.deepEqual(got, { event: 'tool_execution_end', reason: null });
  assert.equal(JSON.stringify(got).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(got).includes('secrets.env'), false);
});

test('the pre-existing opencode/claude vocabulary still resolves (no regression)', () => {
  assert.deepEqual(findLatestVendorProgressEvent(ev({ type: 'step_finish', part: { reason: 'stop' } })),
    { event: 'step_finish', reason: 'stop' });
  assert.deepEqual(findLatestVendorProgressEvent(ev({ type: 'step_start' })),
    { event: 'step_start', reason: null });
  assert.deepEqual(findLatestVendorProgressEvent(ev({ type: 'result', reason: 'success' })),
    { event: 'result', reason: 'success' });
  // Nested protocol wrappers keep working.
  assert.deepEqual(findLatestVendorProgressEvent(ev({ event: { type: 'session_started' } })),
    { event: 'session_started', reason: null });
});

test('the LATEST transition in a chunk wins, and non-JSON noise is skipped', () => {
  const chunk = [
    '[hopper] runner notice, not JSON',
    ev({ type: 'turn_start' }),
    ev({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } }),
    ev({ type: 'tool_execution_start', toolName: 'bash' }),
    'another non-JSON line',
  ].join('\n');
  assert.deepEqual(findLatestVendorProgressEvent(chunk), { event: 'tool_execution_start', reason: null });
  assert.equal(findLatestVendorProgressEvent(''), null);
  assert.equal(findLatestVendorProgressEvent('no json at all'), null);
});

test('a real pi stream yields lifecycle heartbeats instead of silence', () => {
  // Shaped after the actual 15.9MB stream: mostly deltas, punctuated by phase
  // transitions. Before the fix this returned null for the whole thing.
  const stream = [
    ev({ type: 'session', version: 3, id: '019fea74-c6c9-7dc3-b538-db5c6c014279', cwd: '/repo' }),
    ev({ type: 'agent_start' }),
    ev({ type: 'turn_start' }),
    ...Array.from({ length: 40 }, (_, i) => ev({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: `t${i}` } })),
    ev({ type: 'tool_execution_start', toolName: 'read', args: { path: '/repo/src/a.rs' } }),
    ev({ type: 'tool_execution_end', toolName: 'read', result: 'CONTENTS', isError: false }),
    ev({ type: 'turn_end', message: { role: 'assistant', content: [] }, toolResults: [] }),
    ev({ type: 'agent_settled' }),
  ].join('\n');
  const got = findLatestVendorProgressEvent(stream);
  assert.deepEqual(got, { event: 'agent_settled', reason: null });
  assert.equal(JSON.stringify(got).includes('a.rs'), false, 'no tool argument may reach the record');
  assert.equal(JSON.stringify(got).includes('CONTENTS'), false, 'no tool result may reach the record');
});
