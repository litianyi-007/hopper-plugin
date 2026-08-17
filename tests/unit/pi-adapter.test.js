// pi vendor adapter tests (T-VENDOR-PI)
// Anchor: tests/unit/pi-adapter.test.js
//
// Every fixture below is shaped after a REAL `pi -p --mode json` stream captured
// on pi 0.84.1 / 2026-08-10 (see the V-verified notes in cli/src/vendors/pi.js),
// not after a guess at the protocol.
//
// The load-bearing test in this file is "exit 0 + stopReason error is NOT a
// success": pi exits 0 even when the model errored out, so an adapter that
// trusted the exit code would file an empty answer as a completed dispatch.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getAdapter } from '../../cli/src/vendors/index.js';
import { piKnownInstallPaths, piIsolationFlags, resolvePiThinking, PI_READ_ONLY_TOOLS } from '../../cli/src/vendors/pi.js';
import { parsePiModelsList, piProvidersFromModels, parsePiAuthStatus } from '../../cli/src/vendor-probe/pi.js';
import { sandboxControl } from '../../cli/src/setup.js';
import { validateOutputEvidence } from '../../cli/src/output-evidence.js';

const pi = getAdapter('pi');

/** Run `fn` with env vars set to given values (undefined = delete), then restore. */
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Build one NDJSON line. */
const ev = (o) => JSON.stringify(o);

/** A healthy single-turn stream: assistant text, stop, settled. */
function successStream(text = 'PI_ANSWER', extra = {}) {
  const message = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    model: 'gpt-5.6-terra',
    usage: { input: 5842, output: 5, totalTokens: 5847, cost: { input: 0.011684, total: 0.011744 } },
    stopReason: 'stop',
    rawStopReason: 'completed',
    ...extra,
  };
  return [
    ev({ type: 'session', version: 3, id: '019fe9e7-9066-79fd-a0ea-a6092ec8589d', cwd: '/repo' }),
    ev({ type: 'agent_start' }),
    ev({ type: 'turn_start' }),
    ev({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'q' }] } }),
    ev({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'q' }] } }),
    ev({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } }),
    ev({ type: 'message_end', message }),
    ev({ type: 'turn_end', message, toolResults: [] }),
    ev({ type: 'agent_end', messages: [{ role: 'user', content: [] }, message], willRetry: false }),
    ev({ type: 'agent_settled' }),
  ].join('\n');
}

const ok = (stdout, over = {}) => ({ exitCode: 0, stdout, stderr: '', timedOut: false, durationMs: 200, ...over });

// ── args(): headless shape ───────────────────────────────────────────────

test('pi args() builds the headless NDJSON invocation with the prompt LAST', () => {
  const argv = pi.args('THE PROMPT', {});
  assert.ok(argv.includes('-p'), 'non-interactive print mode');
  assert.equal(argv[argv.indexOf('--mode') + 1], 'json', '--mode json is the NDJSON event stream');
  assert.equal(argv[argv.length - 1], 'THE PROMPT',
    'the prompt positional MUST be last so a Windows command-line truncation eats prompt tail, never a safety flag');
  // No --model unless asked: pi falls back to settings.json defaultProvider/defaultModel.
  assert.ok(!argv.includes('--model'), 'no --model without opts.model');
});

test('pi args() forwards model and session only when supplied', () => {
  const withModel = pi.args('x', { model: 'openai-codex/gpt-5.6-terra' });
  assert.equal(withModel[withModel.indexOf('--model') + 1], 'openai-codex/gpt-5.6-terra');
  assert.ok(!pi.args('x', {}).includes('--session'), 'no --session without a conversation id');
  const resumed = pi.args('x', { conversationId: '019fe9e7-9066' });
  assert.equal(resumed[resumed.indexOf('--session') + 1], '019fe9e7-9066');
});

test('pi args() drops the positional under promptViaStdin (keeps -p; reads prompt from stdin)', () => {
  // npm installs pi as `pi.cmd` on Windows → always the cmd-shim regime, where a
  // multi-line argv positional truncates at the first newline.
  const stdinArgs = pi.args('LINE1\nLINE2', { promptViaStdin: true });
  assert.ok(stdinArgs.includes('-p'), 'keeps -p');
  assert.ok(!stdinArgs.includes('LINE1\nLINE2'), 'prompt is OFF argv in stdin mode');
  assert.equal(pi.promptStdin, 'supported');
  assert.equal(pi.promptStdinDefault, true);
});

// ── args(): reasoning ─────────────────────────────────────────────────────

test('pi forwards hopper\'s canonical xhigh effort UNCLAMPED (pi\'s enum is a superset)', () => {
  // The point of interest: grok/copilot clamp xhigh→high. pi accepts
  // off|minimal|low|medium|high|xhigh|max, so hopper's default survives intact.
  const argv = pi.args('x', { reasoning: 'xhigh' });
  assert.equal(argv[argv.indexOf('--thinking') + 1], 'xhigh');
  for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
    const a = pi.args('x', { reasoning: level });
    assert.equal(a[a.indexOf('--thinking') + 1], level, `${level} must pass through unchanged`);
  }
  // Every canonical level is declared in range, so policy.js never clamps pi.
  for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
    assert.ok(pi.capabilities.reasoningArg.knownGood.includes(level), `${level} must be declared in range`);
  }
});

test('pi omits --thinking when no effort is resolved, and honors HOPPER_PI_THINKING', () => {
  assert.ok(!pi.args('x', {}).includes('--thinking'), 'no effort → settings.json defaultThinkingLevel wins');
  withEnv({ HOPPER_PI_THINKING: 'max' }, () => {
    const a = pi.args('x', { reasoning: 'low' });
    assert.equal(a[a.indexOf('--thinking') + 1], 'max', 'env override reaches pi-only levels hopper cannot name');
  });
  withEnv({ HOPPER_PI_THINKING: '' }, () => {
    assert.ok(!pi.args('x', { reasoning: 'xhigh' }).includes('--thinking'), 'empty env omits the flag entirely');
  });
  assert.equal(resolvePiThinking('not-a-level'), null, 'an unknown level is dropped, never forwarded verbatim');
});

// ── args(): sandbox ───────────────────────────────────────────────────────

test('pi read-only maps to the tool allowlist and full-access keeps every tool', () => {
  const full = pi.args('x', { sandbox: 'danger-full-access' });
  assert.ok(!full.includes('--tools'), 'full access passes no allowlist');
  const ro = pi.args('x', { sandbox: 'read-only' });
  assert.equal(ro[ro.indexOf('--tools') + 1], PI_READ_ONLY_TOOLS);
  for (const writeTool of ['bash', 'edit', 'write']) {
    assert.ok(!PI_READ_ONLY_TOOLS.split(',').includes(writeTool),
      `read-only allowlist must not contain the write-capable tool '${writeTool}'`);
  }
  // workspace-write has no distinct pi mapping — pi draws no such line.
  assert.deepEqual(pi.args('x', { sandbox: 'workspace-write' }), full);
});

test('doc-truth pin: sandboxControl(pi) is `argv` — a read-only request IS a real argv downgrade', () => {
  // Unlike grok (whose read-only argv still carries --permission-mode
  // bypassPermissions) pi's read-only argv carries NO unconditional-access flag:
  // the allowlist genuinely removes bash/edit/write from the model's toolset.
  // V-verified 2026-08-10: a run told to create a file under this allowlist
  // executed zero tools and created nothing.
  //
  // This is NOT a claim of OS-level confinement — pi has no built-in sandbox
  // (pi.dev/docs/latest/security). If this ever stops being 'argv', pi has lost
  // the only write restriction it has; update cli/src/scaffold.js's pi row and
  // the README vendor tables in the SAME change.
  assert.equal(sandboxControl(pi), 'argv');
});

// ── args(): host isolation ────────────────────────────────────────────────

test('pi isolates the dispatch from host AGENTS.md / extensions / skills by default', () => {
  const argv = pi.args('x', {});
  for (const flag of ['--no-context-files', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-approve']) {
    assert.ok(argv.includes(flag), `${flag} required so the composed brief is the only instruction (Host != Vendor)`);
  }
  assert.ok(argv.includes('--offline'), 'startup update checks must not inject non-JSON noise into the stream');
});

test('HOPPER_PI_ISOLATE=0 and HOPPER_PI_OFFLINE=0 restore pi\'s own defaults', () => {
  withEnv({ HOPPER_PI_ISOLATE: '0' }, () => {
    assert.deepEqual(piIsolationFlags(), []);
    assert.ok(!pi.args('x', {}).includes('--no-context-files'));
  });
  withEnv({ HOPPER_PI_OFFLINE: '0' }, () => {
    assert.ok(!pi.args('x', {}).includes('--offline'));
  });
});

// ── platform adaptation (macOS / Linux / Windows) ────────────────────────

test('piKnownInstallPaths is platform-specific and always absolute', () => {
  const home = '/home/u';
  const linux = piKnownInstallPaths('linux', home);
  const darwin = piKnownInstallPaths('darwin', home);
  const win = piKnownInstallPaths('win32', 'C:\\Users\\u');

  // Homebrew's Apple-Silicon prefix is macOS-only — listing it on Linux would be
  // a stat() that can never hit.
  assert.ok(darwin.includes('/opt/homebrew/bin/pi'), 'macOS must try the Homebrew arm64 prefix');
  assert.ok(!linux.includes('/opt/homebrew/bin/pi'), 'Linux must not try a Homebrew-only path');

  // The npm-global bin dirs that routinely miss an inherited PATH.
  for (const p of ['/usr/local/bin/pi', '/usr/bin/pi', `${home}/.local/bin/pi`, `${home}/.npm-global/bin/pi`]) {
    assert.ok(linux.includes(p), `Linux must try ${p}`);
    assert.ok(darwin.includes(p), `macOS must try ${p}`);
  }

  // Windows: the npm prefix holds `pi.cmd`, which resolveCommandWithKnownPaths
  // routes through cmd.exe.
  assert.ok(win.some((p) => p.endsWith('pi.cmd')), 'Windows candidates must be the .cmd shim');
  assert.ok(!win.some((p) => p.endsWith('/bin/pi')), 'Windows must not offer POSIX bin paths');

  // Contract from cli/src/path-resolve.js: absolute, no globs, no unexpanded ~.
  for (const p of [...linux, ...darwin, ...win]) {
    assert.ok(!p.includes('~') && !p.includes('*'), `${p} must be a literal absolute path (no ~ or glob)`);
  }
  assert.ok(Array.isArray(pi.knownInstallPaths) && pi.knownInstallPaths.length > 0,
    'the adapter must declare the resolved list for the running host');
});

// ── parseResult(): the outcome contract ──────────────────────────────────

test('pi parseResult() extracts assistant text, usage and runtime model from a healthy stream', () => {
  const r = pi.parseResult(ok(successStream('PI_ANSWER')));
  assert.equal(r.status, 'success');
  assert.equal(r.text, 'PI_ANSWER');
  assert.equal(r.usage.totalTokens, 5847);
  assert.equal(r.usage.totalCostUsd, 0.011744);
  assert.deepEqual(r.outputEvidence, {
    completeness: 'verified-complete', source: 'event-stream', terminalMarker: 'pi-agent-settled',
  });
  assert.deepEqual(r.modelAttestation.observedModels, ['openai-codex/gpt-5.6-terra']);
  assert.equal(r.modelAttestation.source, 'pi.message.provider-model');
  assert.match(r.modelAttestation.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  // The evidence the parser declares must survive the closed validator.
  assert.deepEqual(validateOutputEvidence(r.text, r.outputEvidence), r.outputEvidence);
});

test('pi parseResult() captures only Pi CLI session-effective thinking evidence with explicit provenance', () => {
  const valid = pi.parseResult(ok([
    ev({ type: 'session', version: 3, id: 's-effective' }),
    ev({ type: 'thinking_level_changed', level: 'high' }),
    successStream('SESSION_EFFECTIVE_OK'),
  ].join('\n')));
  assert.equal(valid.status, 'success');
  assert.deepEqual(valid.sessionEffectiveReasoning, {
    level: 'high', source: 'pi-cli-session-effective', observedAt: valid.sessionEffectiveReasoning.observedAt,
  });
  assert.match(valid.sessionEffectiveReasoning.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(valid.modelAttestation.source, 'pi.message.provider-model',
    'session-effective provenance stays separate from terminal runtime-model evidence');

  const absent = pi.parseResult(ok(successStream('NO_SESSION_EFFECTIVE_EVENT')));
  assert.equal(absent.sessionEffectiveReasoning, undefined, 'never infer this from --thinking or a terminal message');

  const malformed = pi.parseResult(ok([
    ev({ type: 'thinking_level_changed', level: 'requested-high-but-not-a-pi-level' }),
    successStream('MALFORMED_SESSION_EFFECTIVE_EVENT'),
  ].join('\n')));
  assert.equal(malformed.sessionEffectiveReasoning, undefined, 'unknown event values are not persisted');
});

test('pi session-effective thinking evidence does not convert a vendor failure into success', () => {
  const message = {
    role: 'assistant', content: [], provider: 'openai-codex', model: 'not-a-real-model',
    stopReason: 'error', errorMessage: 'model is not supported',
  };
  const result = pi.parseResult(ok([
    ev({ type: 'thinking_level_changed', level: 'high' }),
    ev({ type: 'turn_end', message, toolResults: [] }),
    ev({ type: 'agent_settled' }),
  ].join('\n')));
  assert.equal(result.status, 'unknown-fail');
  assert.equal(result.sessionEffectiveReasoning.level, 'high');
  assert.equal(result.sessionEffectiveReasoning.source, 'pi-cli-session-effective');
  assert.equal(result.modelAttestation, undefined, 'failed vendor terminal data is still not runtime model evidence');
});

test('pi parseResult(): exit 0 with stopReason "error" is a FAILURE, not a silent empty success', () => {
  // THE reason this adapter never trusts the exit code. Captured verbatim from a
  // real run (`--model openai-codex/not-a-real-model`): pi exited 0, emitted a
  // full event stream, and reported the failure only in stopReason/errorMessage.
  const message = {
    role: 'assistant',
    content: [],
    provider: 'openai-codex',
    model: 'not-a-real-model',
    stopReason: 'error',
    errorMessage: "Codex error: The 'not-a-real-model' model is not supported when using Codex with a ChatGPT account.",
  };
  const r = pi.parseResult(ok([
    ev({ type: 'session', version: 3, id: 's-1' }),
    ev({ type: 'turn_end', message, toolResults: [] }),
    ev({ type: 'agent_end', messages: [message], willRetry: false }),
    ev({ type: 'agent_settled' }),
  ].join('\n')));
  assert.notEqual(r.status, 'success', 'a model error must never be recorded as a completed dispatch');
  assert.equal(r.status, 'unknown-fail');
  assert.equal(r.diagnosticCode, 'adapter-protocol-invalid');
  assert.equal(r.error, 'adapter-protocol-invalid');
  assert.equal(r.text, '', 'there was no answer to keep');
  assert.equal(r.modelAttestation, undefined, 'a failed run declares no runtime model evidence');
});

test('pi parseResult() keeps reasoning OUT of the answer text', () => {
  // pi puts `thinking` blocks in the SAME content array as the answer. Splicing
  // them in would write chain-of-thought into the recorded result.
  const message = {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'LEAKED_REASONING', thinkingSignature: '{"id":"rs_x"}' },
      { type: 'text', text: 'CLEAN_ANSWER' },
    ],
    provider: 'openai-codex', model: 'gpt-5.6-terra', stopReason: 'stop',
  };
  const r = pi.parseResult(ok([
    ev({ type: 'agent_end', messages: [message], willRetry: false }),
    ev({ type: 'agent_settled' }),
  ].join('\n')));
  assert.equal(r.status, 'success');
  assert.equal(r.text, 'CLEAN_ANSWER');
  assert.ok(!r.text.includes('LEAKED_REASONING'));
});

test('pi parseResult() selects the LAST assistant message of a multi-turn (tool-using) run', () => {
  const first = {
    role: 'assistant', content: [{ type: 'text', text: 'INTERMEDIATE' }],
    provider: 'openai-codex', model: 'gpt-5.6-terra', stopReason: 'toolUse',
  };
  const last = {
    role: 'assistant', content: [{ type: 'text', text: 'FINAL' }],
    provider: 'openai-codex', model: 'gpt-5.6-terra', stopReason: 'stop',
  };
  const r = pi.parseResult(ok([
    ev({ type: 'message_end', message: first }),
    ev({ type: 'tool_execution_end', tool: 'write' }),
    ev({ type: 'message_end', message: last }),
    ev({ type: 'agent_end', messages: [{ role: 'user', content: [] }, first, last], willRetry: false }),
    ev({ type: 'agent_settled' }),
  ].join('\n')));
  assert.equal(r.status, 'success');
  assert.equal(r.text, 'FINAL', 'an intermediate tool-use turn must not become the answer');
});

test('pi parseResult() keeps a partial answer as recovered output when the stream never settles', () => {
  // Text is present and the vendor said `stop`, but `agent_settled` never
  // arrived (a killed/truncated stream). Honest label: unknown-completeness.
  const message = {
    role: 'assistant', content: [{ type: 'text', text: 'SAFE_PARTIAL' }],
    provider: 'openai-codex', model: 'gpt-5.6-terra', stopReason: 'stop',
  };
  const r = pi.parseResult({
    exitCode: 1, stdout: ev({ type: 'turn_end', message, toolResults: [] }),
    stderr: 'transport closed', timedOut: false, durationMs: 10,
  });
  assert.equal(r.status, 'unknown-fail');
  assert.equal(r.text, 'SAFE_PARTIAL');
  assert.deepEqual(r.outputEvidence, {
    completeness: 'unknown-completeness', source: 'event-stream', terminalMarker: 'none',
  });
});

test('pi parseResult() detects auth-fail from pi\'s own missing-credential wording', () => {
  // Captured verbatim: an unauthenticated provider exits 1, writes only the
  // `session` header to stdout, and puts the reason on stderr.
  const r = pi.parseResult({
    exitCode: 1,
    stdout: ev({ type: 'session', version: 3, id: 's-1' }),
    stderr: 'No API key found for anthropic.\n\nUse /login to log into a provider via OAuth or API key.',
    timedOut: false, durationMs: 90,
  });
  assert.equal(r.status, 'auth-fail');
  assert.equal(r.error, 'adapter-auth-failed');
});

test('pi parseResult() reserves auth-fail for specific evidence (the grok false-positive lesson)', () => {
  // A completed review that merely CONTAINS the word "invalid", or a bare 401 that
  // is really a line number, must not be filed as an auth failure — that pattern
  // discarded two paid grok reviews (cli/src/vendor-signal.js).
  const proseWithScaryWords = pi.parseResult({
    exitCode: 1, stdout: '', timedOut: false, durationMs: 10,
    stderr: 'the config had an invalid matcher group at line 401; unauthorised spelling not used here',
  });
  assert.equal(proseWithScaryWords.status, 'unknown-fail', 'bare "invalid" / naked 401 must not mean auth-fail');

  // And a genuinely successful run is never re-classified by prose at all.
  const successDespiteScaryProse = pi.parseResult(
    ok(successStream('The API returned HTTP 401 Unauthorized — here is why that test fails.')),
  );
  assert.equal(successDespiteScaryProse.status, 'success',
    'a vendor-confirmed completion must not be vetoed by words inside the assistant\'s own answer');
});

test('pi parseResult() maps harness-established failures without reading vendor prose', () => {
  const timedOut = pi.parseResult({ exitCode: -1, stdout: 'RAW_PRIVATE', stderr: '', timedOut: true, durationMs: 30000 });
  assert.equal(timedOut.status, 'timeout');
  assert.equal(timedOut.error, 'adapter-timeout');
  assert.equal(timedOut.text, '', 'a timeout must not promote raw stdout as an answer');

  const missing = pi.parseResult({ exitCode: 127, stdout: '', stderr: '', timedOut: false, durationMs: 5 });
  assert.equal(missing.status, 'permission-fail');
  assert.equal(missing.error, 'adapter-binary-missing');
});

test('pi parseResult() returns only closed diagnostics and never leaks raw streams', () => {
  const r = pi.parseResult({
    exitCode: 1,
    stdout: 'RAW_STDOUT_PRIVATE C:\\PRIVATE\\pi.log sk-private-token',
    stderr: 'RAW_STDERR_PRIVATE https://private.example.invalid',
    timedOut: false, durationMs: 42,
  });
  assert.equal(r.status, 'unknown-fail');
  assert.equal(r.diagnosticCode, 'adapter-unknown-failed');
  assert.equal(r.text, '');
  assert.equal(r.outputEvidence, undefined);
  assert.equal(JSON.stringify(r).includes('RAW_'), false);
  assert.equal(JSON.stringify(r).includes('sk-private-token'), false);
});

test('pi parseResult() ignores a non-JSON preamble around the event stream', () => {
  // Background mode writes runner notices, vendor stderr and vendor stdout into
  // ONE interleaved file, which is then handed to the parser as stdout.
  const r = pi.parseResult(ok([
    '[hopper] spawning vendor pi (background)',
    'Warning: something the vendor printed { with: braces }',
    successStream('INTERLEAVED_OK'),
    '[hopper] vendor exited 0',
  ].join('\n')));
  assert.equal(r.status, 'success');
  assert.equal(r.text, 'INTERLEAVED_OK');
});

test('pi model attestation requires a well-formed provider/model pair', () => {
  // A provider containing a slash would make the joined identity ambiguous, so it
  // is dropped rather than recorded as evidence.
  const message = {
    role: 'assistant', content: [{ type: 'text', text: 'A' }],
    provider: 'weird/provider', model: 'm', stopReason: 'stop',
  };
  const r = pi.parseResult(ok([
    ev({ type: 'agent_end', messages: [message], willRetry: false }),
    ev({ type: 'agent_settled' }),
  ].join('\n')));
  assert.equal(r.status, 'success');
  assert.equal(r.modelAttestation, undefined);
});

// ── timeouts ──────────────────────────────────────────────────────────────

test('pi timeoutMs() scales with reasoning like codex (pi routes to the same top-tier models)', () => {
  assert.equal(pi.timeoutMs({}), 300_000);
  assert.equal(pi.timeoutMs({ reasoning: 'high' }), 600_000);
  assert.equal(pi.timeoutMs({ reasoning: 'xhigh' }), 900_000);
});

// ── probe parsers (pure — no spawn) ──────────────────────────────────────

test('parsePiModelsList() reads the --list-models table and drops its header', () => {
  const stdout = [
    'provider      model          context  max-out  thinking  images',
    'openai-codex  gpt-5.6-terra  272K     128K     yes       yes   ',
    'openai-codex  gpt-5.6-sol    272K     128K     yes       yes   ',
    '',
    'openai-codex  gpt-5.6-terra  272K     128K     yes       yes   ',
  ].join('\n');
  assert.deepEqual(parsePiModelsList(stdout), ['openai-codex/gpt-5.6-terra', 'openai-codex/gpt-5.6-sol']);
  assert.deepEqual(parsePiModelsList(''), []);
  assert.deepEqual(parsePiModelsList('some prose line with no columns'), []);
});

test('piProvidersFromModels() returns distinct providers in first-seen order', () => {
  assert.deepEqual(
    piProvidersFromModels(['openai-codex/a', 'anthropic/b', 'openai-codex/c']),
    ['openai-codex', 'anthropic'],
  );
  assert.deepEqual(piProvidersFromModels(undefined), []);
});

test('parsePiAuthStatus() maps `pi auth check --json` onto a closed vocabulary', () => {
  assert.equal(parsePiAuthStatus({ stdout: '{"status":"ready","provider":"openai-codex","authType":"oauth"}' }), 'ready');
  assert.equal(parsePiAuthStatus({ stdout: '{"status":"not_ready","provider":"openai","reason":"credentials_not_configured"}' }), 'not_ready');
  assert.equal(parsePiAuthStatus({ stdout: 'not json at all' }), 'unknown');
  assert.equal(parsePiAuthStatus({ stdout: '{"status":"SOMETHING_NEW"}' }), 'unknown',
    'an unrecognized status must degrade to unknown, never become a raw note');
});

// ── preflight ─────────────────────────────────────────────────────────────

// ── model spelling: `openai` is NOT `openai-codex` ───────────────────────

test('pi model normalization absorbs bare, loose, and WRONG-PREFIX spellings of a known model', async () => {
  // The real trap (V-verified 2026-08-10 on pi 0.84.1): pi ships BOTH an
  // `openai` provider (API key) and an `openai-codex` provider (ChatGPT OAuth),
  // and the gpt-5.6 family lives under `openai-codex`. Writing a prefix PINS the
  // provider — `--model openai/gpt-5.6-terra` exits 1 with "No API key found for
  // openai." even on a machine where openai-codex is logged in and that exact
  // model works. hopper absorbs it for anything in knownGood.
  const { normalizeModel } = await import('../../cli/src/model-normalize.js');
  const knownGood = pi.capabilities.modelArg.knownGood;
  const canonical = 'openai-codex/gpt-5.6-terra';
  for (const spelling of ['gpt-5.6-terra', canonical, 'openai/gpt-5.6-terra', 'GPT 5.6 Terra']) {
    assert.equal(normalizeModel('pi', spelling, knownGood), canonical,
      `"${spelling}" must normalize to the canonical provider-qualified id`);
  }
});

test('pi model normalization passes an UNKNOWN model through verbatim — the documented footgun', () => {
  // The asymmetry that makes --check-model worth running: a model absent from
  // knownGood (a newly released one) is NOT rewritten, so a wrong prefix reaches
  // pi intact and hard-fails there. Pinned so nobody "fixes" it into a silent
  // guess — inventing a provider for an unknown model would be worse.
  const knownGood = pi.capabilities.modelArg.knownGood;
  return import('../../cli/src/model-normalize.js').then(({ normalizeModel }) => {
    assert.equal(normalizeModel('pi', 'openai/gpt-5.7-future', knownGood), 'openai/gpt-5.7-future');
    assert.equal(normalizeModel('pi', 'gpt-5.7-future', knownGood), 'gpt-5.7-future');
  });
});

test('the pi sourceNote actually documents the openai vs openai-codex distinction', () => {
  // NOTE ON WHERE THIS IS VISIBLE: `sourceNote` is in-code documentation only —
  // no CLI surface renders it (checked 2026-08-10: `--capabilities <vendor>`
  // prints four fixed lines and never the note, for every vendor). The
  // operator-facing answer to "what will hopper actually send?" is
  // `--check-model <vendor> <model> --json`, whose `normalized` field shows the
  // rewritten selector. This test guards the in-code knowledge, which is the
  // only written record of behavior pi's own docs do not specify.
  const note = pi.capabilities.modelArg.sourceNote;
  assert.match(note, /openai-codex/, 'must name the OAuth provider');
  assert.match(note, /No API key found for openai/, 'must carry the verified wrong-prefix failure');
  assert.match(note, /check-model/, 'must point at the pre-dispatch guard');
});

test('pi envPreflight() soft-warns and never hard-fails (auth is per provider, and remote)', () => {
  const r = pi.envPreflight();
  assert.equal(r.ok, true, 'a zero-spawn check can never disprove a remote login → never a hard fail');
  assert.ok(Array.isArray(r.missing));
  assert.ok(['credential-artifact-present-unverified', 'key-present-unverified', 'not-detected', 'unknown']
    .includes(r.authContext), `unexpected authContext: ${r.authContext}`);
});
