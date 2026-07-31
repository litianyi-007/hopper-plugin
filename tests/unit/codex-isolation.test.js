// HOPPER-3: codex adapter isolates the dispatched codex from the host's global
// config (skills / hooks / project docs) so dispatch stays deterministic.
// Anchor: tests/unit/codex-isolation.test.js

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexAdapter, codexIsolationConfig, resolveIsolatedCodexHome, stripCodexSkillsConfig, codexOrchestrationDisableFlags, codexSandboxBypassActive } from '../../cli/src/vendors/codex.js';
import { resolveAdapterOptsForTask } from '../../cli/src/dispatch.js';

function withEnv(key, value, fn) {
  return withEnvs({ [key]: value }, fn);
}

function withEnvs(map, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(map)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Build a fake "real" CODEX_HOME with auth + a global skill + config.
function makeFakeCodexHome() {
  const real = mkdtempSync(join(tmpdir(), 'codex-real-'));
  writeFileSync(join(real, 'auth.json'), '{"OPENAI_API_KEY":"sk-fake"}');
  writeFileSync(join(real, 'config.toml'), 'model = "gpt-5.5"\nnotify = ["beep"]\n');
  mkdirSync(join(real, 'skills', 'my-global-skill'), { recursive: true });
  writeFileSync(join(real, 'skills', 'my-global-skill', 'SKILL.md'), '# global skill\n');
  const iso = join(mkdtempSync(join(tmpdir(), 'codex-iso-')), 'home');
  return { real, iso };
}

test('HOPPER-3: codex args() isolate project docs + notify hook by default', () => {
  const argv = codexAdapter.args('hi', {});
  const joined = argv.join(' ');
  assert.match(joined, /-c project_doc_max_bytes=0/, 'must disable AGENTS.md/project-doc loading');
  assert.match(joined, /-c notify=\[\]/, 'must disable the notify hook');
});

test('HOPPER-3: isolation overrides are separate -c argv elements (codex -c contract)', () => {
  const argv = codexAdapter.args('hi', {});
  const i = argv.indexOf('project_doc_max_bytes=0');
  assert.ok(i > 0 && argv[i - 1] === '-c', 'project_doc_max_bytes must be preceded by its own -c');
  const j = argv.indexOf('notify=[]');
  assert.ok(j > 0 && argv[j - 1] === '-c', 'notify must be preceded by its own -c');
});

test('HOPPER-3: reasoning override coexists with isolation overrides', () => {
  const argv = codexAdapter.args('hi', { reasoning: 'high' });
  assert.ok(argv.some((a) => a.includes('model_reasoning_effort="high"')));
  assert.ok(argv.includes('project_doc_max_bytes=0'));
});

test('HOPPER-3: HOPPER_CODEX_ISOLATE=0 escape hatch disables isolation', () => {
  withEnv('HOPPER_CODEX_ISOLATE', '0', () => {
    assert.deepEqual(codexIsolationConfig(), []);
    const argv = codexAdapter.args('hi', {});
    assert.doesNotMatch(argv.join(' '), /project_doc_max_bytes/);
    assert.doesNotMatch(argv.join(' '), /notify=/);
  });
});

test('HOPPER-3: HOPPER_CODEX_EXTRA_CONFIG appends extra -c overrides', () => {
  withEnv('HOPPER_CODEX_EXTRA_CONFIG', 'features.web_search=false, sandbox_workspace_write=false', () => {
    const cfg = codexIsolationConfig();
    assert.ok(cfg.includes('features.web_search=false'));
    assert.ok(cfg.includes('sandbox_workspace_write=false'));
    // Still flat -c pairs.
    const idx = cfg.indexOf('features.web_search=false');
    assert.equal(cfg[idx - 1], '-c');
  });
});

test('HOPPER-3: extra-config is ignored when isolation is disabled', () => {
  withEnv('HOPPER_CODEX_ISOLATE', '0', () => {
    withEnv('HOPPER_CODEX_EXTRA_CONFIG', 'x=1', () => {
      assert.deepEqual(codexIsolationConfig(), []);
    });
  });
});

// ─── auto-isolated CODEX_HOME (zero user setup) ───────────────────────

test('HOPPER-3: resolveIsolatedCodexHome builds a login-preserving home WITHOUT global skills', () => {
  const { real, iso } = makeFakeCodexHome();
  try {
    withEnvs({ CODEX_HOME: real, HOPPER_CODEX_HOME: iso, HOPPER_CODEX_ISOLATE: undefined }, () => {
      const result = resolveIsolatedCodexHome();
      assert.equal(result, iso);
      // auth carried over (login preserved) ...
      assert.ok(existsSync(join(iso, 'auth.json')), 'auth.json must be present in the isolated home');
      assert.equal(readFileSync(join(iso, 'auth.json'), 'utf-8'), '{"OPENAI_API_KEY":"sk-fake"}');
      // ... config carried over ...
      assert.ok(existsSync(join(iso, 'config.toml')), 'config.toml should be copied');
      // ... but the host's global skills are NOT.
      assert.equal(existsSync(join(iso, 'skills')), false, 'global skills must NOT leak into the isolated home');
    });
  } finally {
    rmSync(real, { recursive: true, force: true });
    rmSync(iso, { recursive: true, force: true });
  }
});

test('HOPPER-3: codexAdapter.env() points CODEX_HOME at the isolated home', () => {
  const { real, iso } = makeFakeCodexHome();
  try {
    withEnvs({ CODEX_HOME: real, HOPPER_CODEX_HOME: iso, HOPPER_CODEX_ISOLATE: undefined }, () => {
      const env = codexAdapter.env({});
      assert.equal(env.CODEX_HOME, iso);
    });
  } finally {
    rmSync(real, { recursive: true, force: true });
    rmSync(iso, { recursive: true, force: true });
  }
});

test('HOPPER-3: HOPPER_CODEX_ISOLATE=0 disables the CODEX_HOME swap', () => {
  const { real, iso } = makeFakeCodexHome();
  try {
    withEnvs({ CODEX_HOME: real, HOPPER_CODEX_HOME: iso, HOPPER_CODEX_ISOLATE: '0' }, () => {
      assert.equal(resolveIsolatedCodexHome(), null);
      assert.deepEqual(codexAdapter.env({}), {});
    });
  } finally {
    rmSync(real, { recursive: true, force: true });
    rmSync(iso, { recursive: true, force: true });
  }
});

test('HOPPER-3: refuses an isolated home that lives inside the real CODEX_HOME', () => {
  const { real, iso } = makeFakeCodexHome();
  try {
    // HOPPER_CODEX_HOME pointed INSIDE the real home must be rejected (no
    // writing/symlinking into the real ~/.codex tree).
    withEnvs({ CODEX_HOME: real, HOPPER_CODEX_HOME: join(real, 'sub'), HOPPER_CODEX_ISOLATE: undefined }, () => {
      assert.equal(resolveIsolatedCodexHome(), null);
      assert.equal(existsSync(join(real, 'sub')), false, 'must not create anything inside the real home');
    });
  } finally {
    rmSync(real, { recursive: true, force: true });
    rmSync(iso, { recursive: true, force: true });
  }
});

test('HOPPER-3: no discoverable auth → no isolation (codex keeps its default home)', () => {
  const empty = mkdtempSync(join(tmpdir(), 'codex-noauth-'));
  const iso = join(mkdtempSync(join(tmpdir(), 'codex-iso2-')), 'home');
  try {
    withEnvs({
      CODEX_HOME: empty, HOPPER_CODEX_HOME: iso, HOPPER_CODEX_ISOLATE: undefined,
      CODEX_API_KEY: undefined, OPENAI_API_KEY: undefined,
    }, () => {
      assert.equal(resolveIsolatedCodexHome(), null);
      assert.deepEqual(codexAdapter.env({}), {});
    });
  } finally {
    rmSync(empty, { recursive: true, force: true });
    rmSync(iso, { recursive: true, force: true });
  }
});

// ─── ISSUE-codex-callchain-windows: plugin/skill hijack + 1326 false-success ───

test('callchain: stripCodexSkillsConfig drops skills/plugins/marketplaces/hooks, keeps model+MCP', () => {
  const toml = [
    'model = "gpt-5.5"', '',
    '[features]', 'multi_agent = true', '',
    '[[hooks.PostToolUse]]', 'matcher = "*"',
    '[[hooks.PostToolUse.hooks]]', 'command = "x"', '',
    '[marketplaces.agent-hopper]', 'source = "F:\\\\repo"', '',
    '[plugins."superpowers@openai-curated"]', 'enabled = true', '',
    '[skills.gstack]', 'path = "/x"', '',
    '[mcp_servers.fable]', 'command = "node"',
  ].join('\n');
  const out = stripCodexSkillsConfig(toml);
  assert.match(out, /model = "gpt-5.5"/, 'keeps model config');
  assert.match(out, /\[mcp_servers\.fable\]/, 'keeps MCP servers');
  assert.match(out, /\[features\]/, 'keeps [features] (orchestration disabled at invocation via --disable)');
  assert.doesNotMatch(out, /superpowers@openai-curated/, 'drops marketplace plugins');
  assert.doesNotMatch(out, /\[marketplaces\./, 'drops marketplace registrations');
  assert.doesNotMatch(out, /\[\[hooks\./, 'drops hooks');
  assert.doesNotMatch(out, /\[skills\./, 'drops skills');
});

test('callchain: codexOrchestrationDisableFlags disables multi_agent/hooks/plugin_hooks by default', () => {
  assert.deepEqual(codexOrchestrationDisableFlags(),
    ['--disable', 'multi_agent', '--disable', 'hooks', '--disable', 'plugin_hooks']);
});

test('callchain: HOPPER_CODEX_KEEP_ORCHESTRATION=1 keeps codex orchestration', () => {
  withEnv('HOPPER_CODEX_KEEP_ORCHESTRATION', '1', () => {
    assert.deepEqual(codexOrchestrationDisableFlags(), []);
    assert.ok(!codexAdapter.args('hi', {}).includes('multi_agent'));
  });
});

// ── 2026-07-31: platform split (reverses the 2026-06-25 "codex has NO
// read-only scenario" decision) ────────────────────────────────────────────
// Windows: codex's `-s` sandbox harness cannot spawn ANY child process
// (CreateProcessWithLogonW 1326 — ISSUE-codex-callchain-windows), so bypass
// stays the default there; HOPPER_CODEX_SANDBOX_BYPASS=0 is the escape hatch
// that turns bypass OFF (falls through to the broken `-s` harness).
// macOS/Linux: codex's own `-s <mode>` sandbox is VERIFIED WORKING (manually
// verified 2026-07-31: `-s read-only` denies a write with `operation not
// permitted`, file never created; `--dangerously-bypass...` with the same
// command creates it) — honoring it is now the default; HOPPER_CODEX_SANDBOX_
// BYPASS=1 is the escape hatch that turns bypass ON (opts IN to full-access).
// `platform` is injected via opts for Windows (cannot be exercised for real
// on this test host) and exercised for real via the host's actual
// process.platform on macOS/Linux (see the "real host" tests further down).

test('platform split: Windows ALWAYS bypasses regardless of requested mode; =0 reverts to -s (injected — cannot run real Windows here)', () => {
  for (const mode of ['read-only', 'workspace-write', 'danger-full-access']) {
    const argv = codexAdapter.args('hi', { sandbox: mode, platform: 'win32' });
    assert.ok(argv.includes('--dangerously-bypass-approvals-and-sandbox'), `${mode} must bypass on win32`);
    assert.ok(!argv.includes('-s'), `${mode} must not emit -s on win32`);
  }
  withEnvs({ HOPPER_CODEX_SANDBOX_BYPASS: '0' }, () => {
    const argv = codexAdapter.args('hi', { sandbox: 'read-only', platform: 'win32' });
    assert.equal(argv[argv.indexOf('-s') + 1], 'read-only', 'win32 + BYPASS=0 falls through to the real (broken) -s harness');
    assert.ok(!argv.includes('--dangerously-bypass-approvals-and-sandbox'));
  });
});

test('platform split: macOS/Linux honor the REQUESTED `-s <mode>` by default; =1 forces bypass (injected, both platforms share one branch)', () => {
  for (const platform of ['darwin', 'linux']) {
    for (const mode of ['read-only', 'workspace-write', 'danger-full-access']) {
      const argv = codexAdapter.args('hi', { sandbox: mode, platform });
      assert.ok(!argv.includes('--dangerously-bypass-approvals-and-sandbox'), `${mode} must NOT bypass on ${platform} by default`);
      assert.equal(argv[argv.indexOf('-s') + 1], mode, `${platform} must honor the requested -s ${mode}`);
    }
    withEnvs({ HOPPER_CODEX_SANDBOX_BYPASS: '1' }, () => {
      const argv = codexAdapter.args('hi', { sandbox: 'read-only', platform });
      assert.ok(argv.includes('--dangerously-bypass-approvals-and-sandbox'), `${platform} + BYPASS=1 opts in to full-access bypass`);
      assert.ok(!argv.includes('-s'));
    });
    // Explicit =0 on POSIX is a redundant no-op (default is already non-bypass) — pin that too.
    withEnvs({ HOPPER_CODEX_SANDBOX_BYPASS: '0' }, () => {
      const argv = codexAdapter.args('hi', { sandbox: 'read-only', platform });
      assert.ok(!argv.includes('--dangerously-bypass-approvals-and-sandbox'), `${platform} + BYPASS=0 is a no-op (already non-bypass)`);
    });
  }
});

test('platform split: real host platform (this test machine) matches the darwin/linux branch when non-Windows', { skip: process.platform === 'win32' ? 'this host is Windows; the win32 branch above already covers it' : false }, () => {
  // No `platform` override — exercises process.platform for REAL, proving the
  // production code path (not just the injected-platform tests above) takes
  // the honor-the-request branch on this actual host.
  const argv = codexAdapter.args('hi', { sandbox: 'read-only' });
  assert.ok(!argv.includes('--dangerously-bypass-approvals-and-sandbox'), 'real host must not bypass by default');
  assert.equal(argv[argv.indexOf('-s') + 1], 'read-only', 'real host must honor -s read-only by default');
});

test('destructive counter-proof: removing the platform branch (always bypass) must flip the darwin fixture red', () => {
  // Mirrors the always-bypass formula that shipped 2026-06-25 through
  // 2026-07-31 (`process.env.HOPPER_CODEX_SANDBOX_BYPASS !== '0'`, no platform
  // check at all). If a future edit collapses codexSandboxBypassActive() back
  // to this, this assertion catches it: the darwin branch would wrongly bypass.
  const alwaysBypassFormula = () => process.env.HOPPER_CODEX_SANDBOX_BYPASS !== '0';
  assert.ok(alwaysBypassFormula(), 'sanity: the OLD formula defaults to bypass=true with no env set');
  // The CURRENT (fixed) function must disagree with that old formula on darwin —
  // proving the platform branch is load-bearing, not a no-op that happens to agree.
  assert.notEqual(codexSandboxBypassActive('darwin'), alwaysBypassFormula(),
    'codexSandboxBypassActive(darwin) must differ from the old always-bypass formula, ' +
    'or the platform split has been silently removed');
  assert.equal(codexSandboxBypassActive('darwin'), false);
  assert.equal(codexSandboxBypassActive('linux'), false);
  assert.equal(codexSandboxBypassActive('win32'), true, 'win32 keeps the OLD always-bypass default');
});

// ── ISSUE-codex-bypass-flag-missing-from-argv ──────────────────────────────
// ROOT CAUSE: on Windows codex is reached via a cmd.exe `.cmd` shim whose
// command line is capped at ~8191 chars. The large composed prompt placed
// BEFORE the flags meant an over-long line truncated the TRAILING sandbox /
// bypass flags, so codex fell back to workspace-write and hit 1326. Fix: the
// prompt positional is now LAST, so the safety flags always precede it (and
// survive any tail truncation).

test('ISSUE-bypass-argv: prompt positional is LAST so flags survive Windows cmd.exe truncation', () => {
  const prompt = 'COMPOSED PROMPT BODY (normally several KB)';
  // Windows-specific truncation scenario — inject platform: 'win32' so the
  // bypass flag actually appears (real Windows codex always bypasses; see the
  // platform-split tests above). F:/x-agents is itself a Windows-style path.
  const argv = codexAdapter.args(prompt, {
    sandbox: 'danger-full-access', model: 'gpt-5.5', reasoning: 'xhigh', cwd: 'F:/x-agents', platform: 'win32',
  });
  assert.equal(argv[argv.length - 1], prompt, 'prompt must be the LAST argv element');
  const bypassIdx = argv.indexOf('--dangerously-bypass-approvals-and-sandbox');
  assert.ok(bypassIdx !== -1, 'bypass flag must be present');
  assert.ok(bypassIdx < argv.length - 1, 'bypass flag must come BEFORE the prompt positional');
  // EVERY flag (and its value) must precede the prompt — none may be the truncation casualty.
  for (const flag of ['-m', '--cd', '-c', '--disable']) {
    const i = argv.indexOf(flag);
    if (i !== -1) assert.ok(i < argv.length - 1, `${flag} must precede the prompt positional`);
  }
});

test('ISSUE-bypass-argv: prompt positional is LAST on macOS/Linux too (the real `-s` sandbox path, not just bypass)', () => {
  const prompt = 'COMPOSED PROMPT BODY (normally several KB)';
  for (const platform of ['darwin', 'linux']) {
    const argv = codexAdapter.args(prompt, {
      sandbox: 'read-only', model: 'gpt-5.5', reasoning: 'xhigh', cwd: '/tmp/x-agents', platform,
    });
    assert.equal(argv[argv.length - 1], prompt, `${platform}: prompt must be the LAST argv element`);
    const sIdx = argv.indexOf('-s');
    assert.ok(sIdx !== -1 && sIdx < argv.length - 1, `${platform}: -s must precede the prompt positional`);
    for (const flag of ['-m', '--cd', '-c', '--disable']) {
      const i = argv.indexOf(flag);
      if (i !== -1) assert.ok(i < argv.length - 1, `${platform}: ${flag} must precede the prompt positional`);
    }
  }
});

test('ISSUE-bypass-argv: background-runner code path emits the sandbox bypass flag on Windows', () => {
  // Mirror runBackgroundDispatch EXACTLY: resolveAdapterOptsForTask → effectiveOpts
  // → adapter.args (the same chain the background runner uses). Asserts the flag
  // the live codex argv was missing actually appears, ahead of the prompt.
  // platform: 'win32' drives BOTH resolveAdapterOptsForTask's internal codex-
  // always-full-access check and (via the out/effOpts spread) codexAdapter.args().
  const resolved = { task: { brief: 'implement the fix', taskType: 'code-impl' }, taskSpec: '' };
  const effOpts = resolveAdapterOptsForTask(resolved, {
    sandbox: 'danger-full-access', model: 'gpt-5.5', reasoning: 'xhigh', platform: 'win32',
  });
  const effectiveOpts = { ...effOpts, background: true, logFile: '/tmp/x.log', taskType: 'code-impl', cwd: 'F:/x-agents' };
  const argv = codexAdapter.args('COMPOSED PROMPT', effectiveOpts);
  assert.ok(argv.includes('--dangerously-bypass-approvals-and-sandbox'),
    'the background-runner code path must emit --dangerously-bypass-approvals-and-sandbox on win32');
  assert.equal(argv[argv.length - 1], 'COMPOSED PROMPT', 'prompt stays last (truncation safety)');
});

test('ISSUE-bypass-argv: full-access bypass adds --skip-git-repo-check on Windows (non-git CWD footgun)', () => {
  const argv = codexAdapter.args('hi', { sandbox: 'danger-full-access', platform: 'win32' });
  assert.ok(argv.includes('--skip-git-repo-check'),
    'full-access bypass should skip codex git-repo trust gate (HOPPER_VENDOR_CWD widening)');
  // Escape hatch reverts it.
  withEnv('HOPPER_CODEX_SKIP_GIT_CHECK', '0', () => {
    assert.ok(!codexAdapter.args('hi', { sandbox: 'danger-full-access', platform: 'win32' }).includes('--skip-git-repo-check'));
  });
});

test('ISSUE-bypass-argv (2026-07-31): --skip-git-repo-check now rides EVERY mode/platform, not just bypass', () => {
  // Manually verified 2026-07-31: `codex exec -s read-only` in a non-git dir hits the
  // SAME "Not inside a trusted directory" trust gate as the bypass path — it is not
  // specific to bypass mode. So the flag no longer depends on bypassSandbox at all.
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const sandbox of ['read-only', 'workspace-write', 'danger-full-access']) {
      assert.ok(codexAdapter.args('hi', { sandbox, platform }).includes('--skip-git-repo-check'),
        `${platform}/${sandbox}: --skip-git-repo-check must be present by default`);
    }
  }
  // Escape hatch disables it universally, regardless of platform/mode.
  withEnv('HOPPER_CODEX_SKIP_GIT_CHECK', '0', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      assert.ok(!codexAdapter.args('hi', { sandbox: 'read-only', platform }).includes('--skip-git-repo-check'),
        `${platform}: HOPPER_CODEX_SKIP_GIT_CHECK=0 must disable the flag`);
    }
  });
});

test('callchain: parseResult flags CreateProcessWithLogonW 1326 as permission-fail when NO command succeeded (false success)', () => {
  const res = codexAdapter.parseResult({
    exitCode: 0,
    stdout: 'I reviewed the repo and everything looks good.',
    stderr: 'ERROR codex_core::exec: exec error: windows sandbox: CreateProcessWithLogonW failed: 1326',
    timedOut: false, durationMs: 1000,
  });
  assert.equal(res.status, 'permission-fail');
  assert.match(res.error, /1326/);
});

test('callchain: parseResult does NOT flag 1326 when codex ran commands successfully (quoted/incidental 1326)', () => {
  // ISSUE-codex-1326-false-positive: codex ran real commands (a `succeeded in <N>ms` marker)
  // and merely READ/QUOTED a prior failed run's log that contained the 1326 string. That is a
  // real success, not a sandbox wipeout — must not be downgraded to permission-fail.
  const res = codexAdapter.parseResult({
    exitCode: 0,
    stdout: 'Ran `mimo --version` (succeeded in 1204ms) → 0.1.3. The prior log noted '
      + '"CreateProcessWithLogonW failed: 1326" but that was the earlier read-only run.',
    stderr: 'tokens used\n4096',
    timedOut: false, durationMs: 5000,
  });
  assert.equal(res.status, 'success');
});

test('callchain: parseResult clean success still works (no 1326 in output)', () => {
  const res = codexAdapter.parseResult({ exitCode: 0, stdout: 'PONG', stderr: 'tokens used\n123', timedOut: false, durationMs: 10 });
  assert.equal(res.status, 'success');
});
