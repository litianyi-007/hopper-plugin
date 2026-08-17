// Additional Tier C host adapter tests (copilot/grok/cursor)
// Anchor: tests/unit/extra-hosts.test.js

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { platform, tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const HOSTS = [
  {
    key: 'copilot-cli',
    wrapperBase: 'hopper-copilot',
    title: 'Copilot CLI',
    hostVendor: 'copilot',
    execPattern: /\bexec copilot\b/,
    commandPattern: /command -v copilot/,
  },
  {
    key: 'grok-cli',
    wrapperBase: 'hopper-grok',
    title: 'Grok Build',
    hostVendor: 'grok',
    execPattern: /\bexec grok -p\b/,
    commandPattern: /command -v grok/,
  },
  {
    key: 'cursor-cli',
    wrapperBase: 'hopper-cursor',
    title: 'Cursor CLI',
    hostVendor: 'cursor',
    execPattern: /\bexec agent -p\b/,
    commandPattern: /command -v agent/,
  },
];

for (const spec of HOSTS) {
  const hostDir = join(REPO_ROOT, 'hosts', spec.key);
  const wrapper = join(hostDir, 'bin', spec.wrapperBase);
  const wrapperCmd = join(hostDir, 'bin', `${spec.wrapperBase}.cmd`);
  const readme = join(hostDir, 'README.md');

  test(`${spec.key}: host directory exists with expected structure`, () => {
    assert.ok(existsSync(hostDir));
    assert.ok(existsSync(wrapper));
    assert.ok(existsSync(wrapperCmd));
    assert.ok(existsSync(readme));
  });

  test(`${spec.key}: wrapper has bash shebang and Windows delegator`, () => {
    const sh = readFileSync(wrapper, 'utf-8');
    const cmd = readFileSync(wrapperCmd, 'utf-8');
    assert.match(sh, /^#!\/usr\/bin\/env bash/);
    assert.match(cmd, /bash.*hopper-/i);
  });

  test(`${spec.key}: wrapper enforces canonical validation and symlink-safe resolution`, () => {
    const sh = readFileSync(wrapper, 'utf-8');
    assert.match(sh, /\^\[A-Za-z\]\[A-Za-z0-9\._-\]\{0,99\}\$/);
    assert.match(sh, /\*\.\.\*|contain.*\.\./i);
    assert.match(sh, /\^\[A-Za-z\]\[A-Za-z0-9\._\/:-\]\{0,99\}\$/);
    assert.match(sh, /minimal\|low\|medium\|high\|xhigh/);
    assert.match(sh, /read-only\|workspace-write\|danger-full-access/);
    assert.match(sh, /resolve_script_dir|readlink/);
  });

  test(`${spec.key}: wrapper tags host identity and points at dispatcher`, () => {
    const sh = readFileSync(wrapper, 'utf-8');
    assert.match(sh, new RegExp(`HOPPER_HOST_VENDOR=${spec.hostVendor}`));
    assert.match(sh, /cli\/bin\/hopper-dispatch/);
    assert.match(sh, spec.commandPattern);
  });

  test(`${spec.key}: wrapper invokes outer host exactly once and forbids orchestration`, () => {
    const sh = readFileSync(wrapper, 'utf-8');
    const execLines = sh.split('\n').filter((line) => !/^\s*#/.test(line) && spec.execPattern.test(line));
    assert.equal(execLines.length, 1, `expected exactly one exec line for ${spec.title}`);
    assert.match(sh, /Do NOT diagnose|Do NOT retry|Dispatch \+ surface only/i);
    for (const pat of [/while\b.*hopper-dispatch/i, /backoff|circuit.break|consensus|round.?robin/i]) {
      assert.ok(!pat.test(sh), `wrapper must not contain active orchestration pattern ${pat}`);
    }
  });

  test(`${spec.key}: host README documents install and host!=vendor behavior`, () => {
    const md = readFileSync(readme, 'utf-8');
    assert.match(md, new RegExp(spec.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(md, /Install/);
    assert.match(md, /Prerequisites/);
    assert.match(md, /Troubleshooting/);
    assert.match(md, /host != vendor/);
  });

  test(`${spec.key}: wrapper rejects invalid task-id in dry-run`, { skip: platform() === 'win32' ? 'bash not standardly available on Windows CI' : false }, () => {
    let stderr = '';
    let exitCode = 0;
    try {
      execFileSync('bash', [wrapper, 'T..evil'], {
        env: { ...process.env, HOPPER_PLUGIN_ROOT: REPO_ROOT, PATH: process.env.PATH },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      stderr = err.stderr ? err.stderr.toString() : '';
      exitCode = err.status;
    }
    assert.equal(exitCode, 2);
    assert.match(stderr, /\.\./);
  });

  test(`${spec.key}: wrapper rejects unknown flag in dry-run`, { skip: platform() === 'win32' ? 'bash not standardly available on Windows CI' : false }, () => {
    let stderr = '';
    let exitCode = 0;
    try {
      execFileSync('bash', [wrapper, 'T-OK', '--evil-flag'], {
        env: { ...process.env, HOPPER_PLUGIN_ROOT: REPO_ROOT, PATH: process.env.PATH },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      stderr = err.stderr ? err.stderr.toString() : '';
      exitCode = err.status;
    }
    assert.equal(exitCode, 2);
    assert.match(stderr, /invalid flag/i);
  });

  test(`${spec.key}: wrapper rejects when dispatcher binary missing`, { skip: platform() === 'win32' ? 'bash not standardly available on Windows CI' : false }, () => {
    let stderr = '';
    let exitCode = 0;
    try {
      execFileSync('bash', [wrapper, 'T-OK'], {
        env: { ...process.env, HOPPER_PLUGIN_ROOT: '/nonexistent-root', PATH: process.env.PATH },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      stderr = err.stderr ? err.stderr.toString() : '';
      exitCode = err.status;
    }
    assert.equal(exitCode, 3);
    assert.match(stderr, /hopper-dispatch not found/i);
  });
}

test('copilot-cli: wrapper runs without COPILOT_MODEL set', { skip: platform() === 'win32' ? 'bash not standardly available on Windows CI' : false }, () => {
  const wrapper = join(REPO_ROOT, 'hosts', 'copilot-cli', 'bin', 'hopper-copilot');
  const tmpBin = mkdtempSync(join(tmpdir(), 'hopper-copilot-mock-'));
  const mockCopilot = join(tmpBin, 'copilot');
  try {
    writeFileSync(mockCopilot, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*"\n');
    chmodSync(mockCopilot, 0o755);

    const stdout = execFileSync('bash', [wrapper, 'T-OK'], {
      env: {
        ...process.env,
        HOPPER_PLUGIN_ROOT: REPO_ROOT,
        PATH: `${tmpBin}:${process.env.PATH}`,
        COPILOT_MODEL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();

    assert.match(stdout, /--allow-all-tools/);
    assert.match(stdout, /--allow-all-paths/);
    assert.ok(!/--model\b/.test(stdout), 'COPILOT_MODEL unset should not emit --model');
  } finally {
    rmSync(tmpBin, { recursive: true, force: true });
  }
});

test('grok-cli: wrapper help and README document grok-4.6 and the override', () => {
  const wrapper = join(REPO_ROOT, 'hosts', 'grok-cli', 'bin', 'hopper-grok');
  const wrapperText = readFileSync(wrapper, 'utf-8');
  const readme = readFileSync(join(REPO_ROOT, 'hosts', 'grok-cli', 'README.md'), 'utf-8');
  assert.match(wrapperText, /GROK_HOST_MODEL\s+OUTER grok host model \(default: grok-4\.6; explicit value overrides\)/);
  assert.match(readme, /grok-4\.6/);
  assert.match(readme, /GROK_HOST_MODEL/);
  assert.doesNotMatch(wrapperText, /default:\s*grok-build/);
  assert.doesNotMatch(readme, /default:\s*grok-build/);
});

test('grok-cli: outer host defaults to grok-4.6 and preserves GROK_HOST_MODEL overrides', { skip: platform() === 'win32' ? 'bash not standardly available on Windows CI' : false }, () => {
  const wrapper = join(REPO_ROOT, 'hosts', 'grok-cli', 'bin', 'hopper-grok');
  const tmpBin = mkdtempSync(join(tmpdir(), 'hopper-grok-mock-'));
  const mockGrok = join(tmpBin, 'grok');
  try {
    writeFileSync(mockGrok, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*"\n');
    chmodSync(mockGrok, 0o755);

    const invoke = (model) => execFileSync('bash', [wrapper, 'T-OK'], {
      env: {
        ...process.env,
        HOPPER_PLUGIN_ROOT: REPO_ROOT,
        PATH: `${tmpBin}:${process.env.PATH}`,
        GROK_HOST_MODEL: model,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();

    assert.match(invoke(''), /-m grok-4\.6(?:\s|$)/);
    assert.match(invoke('custom-grok'), /-m custom-grok(?:\s|$)/);
  } finally {
    rmSync(tmpBin, { recursive: true, force: true });
  }
});
