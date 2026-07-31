// Size-gated pointer prompt delivery (ISSUE-codex-bypass-flag-missing-from-argv follow-up).
// Anchor: tests/unit/prompt-delivery.test.js
//
// When the would-be vendor command line is too large for the OS limit (cmd.exe
// ~8191 / CreateProcess 32767), hopper writes the composed prompt to a file and
// passes the vendor a SMALL pointer instruction ("read file X and follow it").
// The size decision must be ENCODING-AWARE: Chinese/mixed text costs more bytes
// than its character count, and the regime (cmd.exe shim vs native .exe vs POSIX)
// sets the budget.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync, statSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import {
  commandLineRegime,
  commandLineBytes,
  inlineBudgetBytes,
  buildPointerInstruction,
  resolvePromptDelivery,
  useStdinPrompt,
  DEFAULT_INLINE_BUDGETS,
} from '../../cli/src/prompt-delivery.js';
import { codexAdapter } from '../../cli/src/vendors/codex.js';
import { claudeAdapter } from '../../cli/src/vendors/claude.js';
import { mimoAdapter } from '../../cli/src/vendors/mimo.js';
import { copilotAdapter } from '../../cli/src/vendors/copilot.js';
import { listAdapters, getAdapter } from '../../cli/src/vendors/index.js';

// A minimal real fake adapter (no mock framework): prompt is the last positional.
const fakeAdapter = { name: 'fake', command: 'fake', args: (input) => ['run', '--flag', input] };

// ── commandLineBytes: UTF-8, encoding-aware (the multilingual concern) ──
test('commandLineBytes counts ASCII as 1 byte/char', () => {
  assert.equal(commandLineBytes(['abc']), 3);
});

test('commandLineBytes counts each Chinese char as 3 UTF-8 bytes (not 1)', () => {
  // 100 Chinese chars = 100 .length but 300 UTF-8 bytes — the whole point.
  assert.equal(commandLineBytes(['中'.repeat(100)]), 300);
});

test('commandLineBytes handles mixed scripts and emoji additively', () => {
  // 'a' (1) + '中' (3) + '😀' (4) + one join-space-less single part
  assert.equal(commandLineBytes(['a中😀']), 1 + 3 + 4);
});

test('commandLineBytes joins multiple argv parts with single spaces', () => {
  assert.equal(commandLineBytes(['ab', 'cd']), 2 + 1 + 2); // "ab cd"
});

// ── commandLineRegime: which OS limit applies ──
test('commandLineRegime: cmd.exe wrapper is cmd-shim', () => {
  assert.equal(commandLineRegime('C:\\Windows\\System32\\cmd.exe', ['/c', 'C:\\x\\codex.cmd'], { isWindows: true }), 'cmd-shim');
});

test('commandLineRegime: .cmd/.bat in prependArgs is cmd-shim even if cmd path lowercased', () => {
  assert.equal(commandLineRegime('cmd.exe', ['/c', 'foo.BAT'], { isWindows: true }), 'cmd-shim');
});

test('commandLineRegime: native .exe on Windows is native-exe', () => {
  assert.equal(commandLineRegime('C:\\Users\\me\\.bun\\bin\\kimi.EXE', [], { isWindows: true }), 'native-exe');
});

test('commandLineRegime: POSIX is always posix', () => {
  assert.equal(commandLineRegime('/usr/bin/codex', [], { isWindows: false }), 'posix');
});

// ── inlineBudgetBytes: per-regime defaults + env override ──
test('inlineBudgetBytes returns conservative per-regime defaults', () => {
  assert.equal(inlineBudgetBytes('cmd-shim', {}), DEFAULT_INLINE_BUDGETS['cmd-shim']);
  assert.equal(inlineBudgetBytes('native-exe', {}), DEFAULT_INLINE_BUDGETS['native-exe']);
  assert.equal(inlineBudgetBytes('posix', {}), DEFAULT_INLINE_BUDGETS['posix']);
  assert.ok(DEFAULT_INLINE_BUDGETS['cmd-shim'] < DEFAULT_INLINE_BUDGETS['native-exe']);
});

test('inlineBudgetBytes honors env override per regime', () => {
  assert.equal(inlineBudgetBytes('cmd-shim', { HOPPER_INLINE_PROMPT_MAX_CMDSHIM: '1234' }), 1234);
  assert.equal(inlineBudgetBytes('native-exe', { HOPPER_INLINE_PROMPT_MAX_NATIVE: '9999' }), 9999);
});

// ── buildPointerInstruction ──
test('buildPointerInstruction references the path and tells the agent to read+follow it', () => {
  const p = 'F:/repo/.hopper/handoffs/T-1-prompt.md';
  const s = buildPointerInstruction(p);
  assert.ok(s.includes(p), 'must include the absolute path');
  assert.match(s, /read/i);
  assert.match(s, /follow/i);
});

test('buildPointerInstruction is a SINGLE line with the path front-loaded (cmd-shim argv safety)', () => {
  const p = 'F:/repo/.hopper/handoffs/T-1-prompt.md';
  const s = buildPointerInstruction(p);
  assert.ok(!/\r?\n/.test(s), 'the pointer itself travels as an argv positional — it must contain NO newline');
  assert.ok(s.indexOf(p) < s.length / 2, 'the prompt file path must appear in the first half of the line');
});

test('regression: cmd-shim pointer delivery puts NO newline anywhere in argv (the pointer is truncation-safe itself)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: 'header line\nsecond line\nthird line', opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: dir, taskId: 'T-PTR-1L', isWindows: true, env: {},
    });
    assert.equal(res.channel, 'argv-pointer');
    assert.equal(res.inlined, false, 'multi-line prompt on cmd-shim forces pointer delivery');
    for (const a of res.args) {
      assert.ok(!/\r?\n/.test(String(a)), `argv element must not contain a newline: ${JSON.stringify(a).slice(0, 80)}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── resolvePromptDelivery: the gating decision ──
test('resolvePromptDelivery INLINES a small prompt (no file written)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: 'do the thing', opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: dir, taskId: 'T-SMALL', isWindows: true, env: {},
    });
    assert.equal(res.inlined, true);
    assert.equal(res.promptFilePath, null);
    assert.deepEqual(res.args, ['run', '--flag', 'do the thing']);
    assert.equal(existsSync(join(dir, 'T-SMALL-prompt.md')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolvePromptDelivery switches to POINTER for an over-budget prompt and writes the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const big = 'x'.repeat(7000); // > 6000 cmd-shim budget (ASCII)
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: big, opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: dir, taskId: 'T-BIG', isWindows: true, env: {},
    });
    assert.equal(res.inlined, false);
    const f = join(dir, 'T-BIG-prompt.md');
    assert.equal(res.promptFilePath, f);
    assert.equal(existsSync(f), true);
    assert.equal(readFileSync(f, 'utf-8'), big, 'file holds the full composed prompt verbatim');
    // args now carry the small pointer, NOT the 7000-char prompt
    assert.ok(!res.args.includes(big), 'over-long prompt must NOT be in argv');
    // argv references the prompt file (path is forward-slashed in the pointer for
    // agent safety; assert by basename so the check is slash-direction-agnostic).
    assert.ok(res.args.some((a) => typeof a === 'string' && a.includes('T-BIG-prompt.md')), 'argv must reference the prompt file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolvePromptDelivery: Chinese prompt triggers pointer by BYTES even when char count is under budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    // 2500 Chinese chars: .length = 2500 (< 6000), but UTF-8 bytes = 7500 (> 6000).
    // A char-based gate would WRONGLY inline this; the byte gate must switch to pointer.
    const zh = '中'.repeat(2500);
    assert.ok(zh.length < DEFAULT_INLINE_BUDGETS['cmd-shim'], 'precondition: char count under budget');
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: zh, opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: dir, taskId: 'T-ZH', isWindows: true, env: {},
    });
    assert.equal(res.inlined, false, 'Chinese prompt over the BYTE budget must use the pointer');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolvePromptDelivery: same Chinese prompt INLINES under the larger native-exe budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const zh = '中'.repeat(2500); // 7500 bytes < native-exe budget (28000)
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: zh, opts: {},
      resolvedCmd: 'C:\\bin\\kimi.EXE', prependArgs: [],
      handoffsDir: dir, taskId: 'T-ZH-NATIVE', isWindows: true, env: {},
    });
    assert.equal(res.inlined, true, 'native-exe regime tolerates a much larger inline prompt');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolvePromptDelivery: env override lowers the budget so a small prompt uses the pointer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: 'modest prompt text here', opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: dir, taskId: 'T-ENV', isWindows: true,
      env: { HOPPER_INLINE_PROMPT_MAX_CMDSHIM: '10' },
    });
    assert.equal(res.inlined, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── stdin delivery decision + codex sentinel (win-cmd-shim fix) ──
test('useStdinPrompt: only on cmd-shim for a stdin-capable, enabled vendor', () => {
  const codex = { name: 'codex', promptStdin: 'supported', promptStdinDefault: true };
  assert.equal(useStdinPrompt(codex, 'cmd-shim', {}), true, 'cmd-shim + supported + default-on');
  assert.equal(useStdinPrompt(codex, 'native-exe', {}), false, 'native-exe argv is safe — no stdin');
  assert.equal(useStdinPrompt(codex, 'posix', {}), false, 'posix argv is safe — no stdin');
  assert.equal(useStdinPrompt(codex, 'cmd-shim', { HOPPER_CODEX_STDIN: '0' }), false, 'env opt-out wins');
  assert.equal(useStdinPrompt({ name: 'mimo', promptStdin: 'unsupported' }, 'cmd-shim', {}), false, 'unsupported vendor stays argv');
  const optIn = { name: 'copilot', promptStdin: 'supported', promptStdinDefault: false };
  assert.equal(useStdinPrompt(optIn, 'cmd-shim', {}), false, 'opt-in vendor OFF by default');
  assert.equal(useStdinPrompt(optIn, 'cmd-shim', { HOPPER_COPILOT_STDIN: '1' }), true, 'opt-in vendor ON with env=1');
});

test('P5 invariant: only stdin-capable vendors route to stdin on cmd-shim; agy NEVER (hang guard); native/posix never', () => {
  // Default-ON stdin vendors today (copilot is opt-in → default OFF; kimi/opencode/
  // grok/agy = argv). mimo 0.1.3+ reads stdin. Locks the channel matrix against drift.
  const STDIN_ON_CMDSHIM = new Set(['codex', 'claude', 'mimo']);
  for (const name of listAdapters()) {
    const a = getAdapter(name);
    const routed = useStdinPrompt(a, 'cmd-shim', {}); // default env (no opt-in/opt-out)
    if (STDIN_ON_CMDSHIM.has(name)) {
      assert.equal(routed, true, `${name} must route to stdin on cmd-shim`);
    } else {
      assert.equal(routed, false, `${name} must STAY argv on cmd-shim (no stdin)`);
    }
    // agy HANGS forever on an open stdin pipe — it must never declare stdin support.
    if (name === 'agy') assert.notEqual(a.promptStdin, 'supported', 'agy must NOT be stdin-capable (open-pipe hang)');
    // native-exe and POSIX argv are multi-line-safe → never route to stdin there.
    assert.equal(useStdinPrompt(a, 'native-exe', {}), false, `${name} native-exe stays argv`);
    assert.equal(useStdinPrompt(a, 'posix', {}), false, `${name} posix stays argv`);
  }
});

test('codex args() emits the `-` stdin sentinel under promptViaStdin (and the prompt otherwise)', () => {
  const stdinArgs = codexAdapter.args('THE PROMPT', { sandbox: 'read-only', promptViaStdin: true });
  assert.equal(stdinArgs[stdinArgs.length - 1], '-', 'stdin mode → trailing `-` (codex exec … -)');
  assert.ok(!stdinArgs.includes('THE PROMPT'), 'prompt is OFF argv in stdin mode');
  const argvArgs = codexAdapter.args('THE PROMPT', { sandbox: 'read-only' });
  assert.equal(argvArgs[argvArgs.length - 1], 'THE PROMPT', 'argv mode → prompt is the last positional');
});

test('claude args() drops the positional under promptViaStdin (keeps -p; reads prompt from stdin)', () => {
  const stdinArgs = claudeAdapter.args('THE PROMPT', { sandbox: 'read-only', promptViaStdin: true });
  assert.ok(stdinArgs.includes('-p'), 'keeps -p (print/headless)');
  assert.ok(!stdinArgs.includes('THE PROMPT'), 'prompt is OFF argv in stdin mode');
  const i = stdinArgs.indexOf('-p');
  assert.equal(stdinArgs[i + 1], '--output-format', '`-p` is immediately followed by a flag, not a prompt positional');
  const argvArgs = claudeAdapter.args('THE PROMPT', { sandbox: 'read-only' });
  assert.equal(argvArgs[argvArgs.indexOf('-p') + 1], 'THE PROMPT', 'argv mode → prompt follows -p');
});

test('mimo args() drops the positional message under promptViaStdin (mimo run reads stdin)', () => {
  const stdinArgs = mimoAdapter.args('THE PROMPT', { sandbox: 'read-only', promptViaStdin: true });
  assert.equal(stdinArgs[0], 'run');
  assert.ok(!stdinArgs.includes('THE PROMPT'), 'prompt is OFF argv (read from stdin) in stdin mode');
  assert.equal(stdinArgs[1] !== 'THE PROMPT' && stdinArgs[1].startsWith('--'), true, '`run` is immediately followed by a flag, not a message positional');
  const argvArgs = mimoAdapter.args('THE PROMPT', { sandbox: 'read-only' });
  assert.equal(argvArgs[1], 'THE PROMPT', 'argv mode → message is the positional after run');
});

test('copilot args(): default keeps -p+prompt; opt-in stdin drops both + adds --allow-all-tools', () => {
  const argvArgs = copilotAdapter.args('THE PROMPT', { sandbox: 'read-only' });
  assert.deepEqual(argvArgs.slice(0, 2), ['-p', 'THE PROMPT'], 'default: -p + prompt positional (argv)');
  const stdinArgs = copilotAdapter.args('THE PROMPT', { sandbox: 'read-only', promptViaStdin: true });
  assert.ok(!stdinArgs.includes('-p') && !stdinArgs.includes('THE PROMPT'), 'stdin: bare copilot (no -p, no positional)');
  assert.ok(stdinArgs.includes('--allow-all-tools'), 'stdin: --allow-all-tools for non-interactive');
  // opt-in gating: copilot is default OFF (promptStdinDefault:false), ON only with env=1.
  assert.equal(useStdinPrompt(copilotAdapter, 'cmd-shim', {}), false, 'copilot stdin default OFF');
  assert.equal(useStdinPrompt(copilotAdapter, 'cmd-shim', { HOPPER_COPILOT_STDIN: '1' }), true, 'copilot stdin ON with opt-in');
});

// ── real codex adapter: win-cmd-shim routes the prompt to STDIN (the fix) ──
test('REAL codex adapter: cmd-shim routes the FULL prompt to STDIN (off argv, `-` sentinel, bypass flag survives)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const multiline = 'line one of the brief\nline two — the real task\nline three';
    const res = resolvePromptDelivery({
      // platform: 'win32' — this scenario simulates the Windows cmd.exe shim
      // (isWindows: true below); since 2026-07-31's platform split, codex only
      // bypasses its sandbox by default on win32 (see codexSandboxBypassActive
      // in cli/src/vendors/codex.js) — inject it so the bypass flag this test
      // asserts on actually appears, matching the real Windows behavior.
      adapter: codexAdapter, composedPrompt: multiline, opts: { sandbox: 'danger-full-access', cwd: 'F:/x', platform: 'win32' },
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'codex.cmd'],
      handoffsDir: dir, taskId: 'T-CDX-STDIN', isWindows: true, env: {},
    });
    assert.equal(res.channel, 'stdin');
    assert.equal(res.stdinPrompt, multiline, 'full multi-line prompt delivered via stdin (no newline truncation)');
    assert.equal(res.args[res.args.length - 1], '-', 'codex exec … - reads the prompt from stdin');
    assert.ok(!res.args.includes(multiline), 'prompt is OFF the command line');
    assert.ok(res.args.includes('--dangerously-bypass-approvals-and-sandbox'), 'bypass flag still reaches codex');
    assert.ok(res.promptFilePath && readFileSync(res.promptFilePath, 'utf-8') === multiline, 'prompt file written for the background runner to pipe');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── env opt-out keeps the argv inline/pointer path covered (for argv vendors / forced argv) ──
test('REAL codex adapter: HOPPER_CODEX_STDIN=0 forces argv — small inline (prompt last); huge -> pointer file', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  const handoffsDir = join(root, '.hopper', 'handoffs'); // under the vendor cwd (root)
  const off = { HOPPER_CODEX_STDIN: '0' };
  try {
    const small = resolvePromptDelivery({
      // platform: 'win32' — see the comment on the previous test: this is a
      // simulated Windows cmd.exe scenario, and codex's sandbox-bypass default
      // is platform-split since 2026-07-31.
      adapter: codexAdapter, composedPrompt: 'small task', opts: { sandbox: 'danger-full-access', cwd: root, platform: 'win32' },
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'codex.cmd'], handoffsDir, taskId: 'T-CDX-SM', isWindows: true, env: off,
    });
    assert.equal(small.inlined, true);
    assert.equal(small.channel, 'argv-inline');
    assert.equal(small.args[small.args.length - 1], 'small task', 'prompt stays the last positional');
    assert.ok(small.args.includes('--dangerously-bypass-approvals-and-sandbox'));

    const huge = 'PROMPT '.repeat(2000); // ~14000 bytes >> cmd-shim budget
    const big = resolvePromptDelivery({
      adapter: codexAdapter, composedPrompt: huge, opts: { sandbox: 'danger-full-access', cwd: root, platform: 'win32' },
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'codex.cmd'], handoffsDir, taskId: 'T-CDX-BIG', isWindows: true, env: off,
    });
    assert.equal(big.inlined, false);
    assert.equal(readFileSync(big.promptFilePath, 'utf-8'), huge, 'prompt file holds the full brief');
    assert.ok(!big.args.includes(huge), 'huge prompt must be OFF the command line');
    assert.ok(big.args.includes('--dangerously-bypass-approvals-and-sandbox'), 'bypass flag still reaches codex');
    assert.ok(big.args.some((a) => typeof a === 'string' && a.includes('T-CDX-BIG-prompt.md')), 'argv points at the prompt file');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── review fix: re-dispatch must re-tighten the prompt file to 0600 ──
test('resolvePromptDelivery re-applies 0600 even when the prompt file already exists (POSIX)', { skip: platform() === 'win32' ? 'POSIX mode bits only' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const f = join(dir, 'T-REWRITE-prompt.md');
    writeFileSync(f, 'stale', { mode: 0o644 });
    chmodSync(f, 0o644); // pre-existing world-readable file (e.g. from a prior run)
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: 'z'.repeat(7000), opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: dir, taskId: 'T-REWRITE', isWindows: true, env: {},
    });
    assert.equal(res.inlined, false);
    assert.equal(statSync(res.promptFilePath).mode & 0o777, 0o600, 'overwrite must re-tighten perms to owner-only');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── review fix: pointer file outside the vendor cwd -> fall back to inline (not a silent no-op) ──
test('resolvePromptDelivery falls back to INLINE when the prompt file would be outside opts.cwd', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vendorcwd-'));
  const handoffsDir = mkdtempSync(join(tmpdir(), 'elsewhere-')); // NOT under cwd
  try {
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: 'q'.repeat(7000), opts: { cwd },
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir, taskId: 'T-OUTSIDE', isWindows: true, env: {},
    });
    assert.equal(res.inlined, true, 'unreadable pointer target must not be used');
    assert.equal(res.promptFilePath, null);
    assert.ok(res.fallbackReason && /cwd|scope|outside/i.test(res.fallbackReason), 'fallbackReason must explain the cwd-scope miss');
    assert.equal(existsSync(join(handoffsDir, 'T-OUTSIDE-prompt.md')), false, 'no file written outside cwd');
  } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(handoffsDir, { recursive: true, force: true }); }
});

// ── review fix: write failure must fall back to inline (never break dispatch) with a fallbackReason ──
test('resolvePromptDelivery falls back to INLINE with fallbackReason when the prompt file cannot be written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    // handoffsDir under a regular FILE -> mkdirSync throws ENOTDIR (cross-platform).
    const blocker = join(dir, 'iam-a-file');
    writeFileSync(blocker, 'x');
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: 'w'.repeat(7000), opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: join(blocker, 'sub'), taskId: 'T-WRITEFAIL', isWindows: true, env: {},
    });
    assert.equal(res.inlined, true, 'write failure must not break dispatch — fall back to inline');
    assert.equal(res.promptFilePath, null);
    assert.ok(res.fallbackReason, 'fallbackReason must be set so the caller can warn loudly');
    assert.deepEqual(res.args, fakeAdapter.args('w'.repeat(7000), {}), 'inline args are the full prompt');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolvePromptDelivery writes the prompt file owner-only (0600) on POSIX', { skip: platform() === 'win32' ? 'POSIX mode bits only' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: 'y'.repeat(7000), opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: dir, taskId: 'T-MODE', isWindows: true, env: {},
    });
    const mode = statSync(res.promptFilePath).mode & 0o777;
    assert.equal(mode, 0o600, 'prompt file must be owner-only (contains the sensitive brief)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── win-cmd-shim MULTI-LINE truncation gate (ISSUE-opencode-windows-multiline-prompt-truncation) ──
test('resolvePromptDelivery: a SMALL multi-line prompt takes the pointer on cmd-shim for a non-stdin adapter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const multiline = 'header line\nsecond line with the real task\nthird line';
    assert.ok(commandLineBytes(['cmd.exe', '/c', 'fake.cmd', 'run', '--flag', multiline]) < DEFAULT_INLINE_BUDGETS['cmd-shim'],
      'precondition: prompt is well under the size budget — size gate alone would inline it');
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: multiline, opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: dir, taskId: 'T-ML', isWindows: true, env: {},
    });
    assert.equal(res.inlined, false, 'cmd.exe truncates a multi-line argv positional at the first newline — must use the pointer');
    assert.equal(readFileSync(res.promptFilePath, 'utf-8'), multiline, 'prompt file holds the FULL multi-line prompt');
    assert.ok(!res.args.includes(multiline), 'multi-line prompt must be OFF the command line');
    assert.ok(res.args.some((a) => typeof a === 'string' && a.includes('T-ML-prompt.md')), 'argv points at the prompt file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolvePromptDelivery: a single-line prompt still INLINES on cmd-shim for a non-stdin adapter (no regression)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const res = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: 'do the thing', opts: {},
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'fake.cmd'],
      handoffsDir: dir, taskId: 'T-1L', isWindows: true, env: {},
    });
    assert.equal(res.inlined, true);
    assert.equal(res.channel, 'argv-inline');
    assert.deepEqual(res.args, ['run', '--flag', 'do the thing']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolvePromptDelivery: multi-line prompt still INLINES on native-exe and posix (no cmd.exe truncation there)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const multiline = 'line one\nline two\nline three';
    const native = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: multiline, opts: {},
      resolvedCmd: 'C:\\bin\\kimi.EXE', prependArgs: [],
      handoffsDir: dir, taskId: 'T-ML-EXE', isWindows: true, env: {},
    });
    assert.equal(native.inlined, true, 'native-exe argv is multi-line-safe');
    const posix = resolvePromptDelivery({
      adapter: fakeAdapter, composedPrompt: multiline, opts: {},
      resolvedCmd: '/usr/bin/fake', prependArgs: [],
      handoffsDir: dir, taskId: 'T-ML-POSIX', isWindows: false, env: {},
    });
    assert.equal(posix.inlined, true, 'posix argv is multi-line-safe');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolvePromptDelivery: stdin-capable adapters are UNAFFECTED by the multi-line gate (still stdin, not pointer)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const multiline = 'one\ntwo\nthree';
    const res = resolvePromptDelivery({
      adapter: codexAdapter, composedPrompt: multiline, opts: { sandbox: 'read-only' },
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'codex.cmd'],
      handoffsDir: dir, taskId: 'T-ML-STDIN', isWindows: true, env: {},
    });
    assert.equal(res.channel, 'stdin', 'codex keeps the stdin channel on cmd-shim');
    assert.equal(res.stdinPrompt, multiline);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('REAL opencode adapter: cmd-shim routes a multi-line composed prompt to the POINTER file (the reported bug)', async () => {
  const { opencodeAdapter } = await import('../../cli/src/vendors/opencode.js');
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  try {
    const multiline = 'Task: review the diff\nFocus on defect classes A and B\nWrite findings to the output file';
    const res = resolvePromptDelivery({
      adapter: opencodeAdapter, composedPrompt: multiline, opts: { sandbox: 'read-only' },
      resolvedCmd: 'cmd.exe', prependArgs: ['/c', 'C:\\nvm4w\\nodejs\\opencode.cmd'],
      handoffsDir: dir, taskId: 'T-OC-ML', isWindows: true, env: {},
    });
    assert.equal(res.inlined, false, 'opencode has no stdin prompt channel — multi-line must go pointer-file');
    assert.equal(readFileSync(res.promptFilePath, 'utf-8'), multiline);
    assert.ok(!res.args.includes(multiline), 'truncation-prone prompt must be off argv');
    assert.equal(res.args[0], 'run', 'opencode argv shape preserved');
    assert.ok(res.args.some((a) => typeof a === 'string' && a.includes('T-OC-ML-prompt.md')), 'pointer instruction references the prompt file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
