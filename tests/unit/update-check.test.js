// Upgrade-reconciliation tests.
// Anchor: tests/unit/update-check.test.js
//
// The load-bearing property is what this does NOT do: it must never install,
// download, or replace plugin code. Everything else is reporting, and every
// network path must degrade to a local-only report rather than failing closed.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectInstallKind, declaredRepository, fetchUpstreamVersion,
  parseMigrationEntries, entriesBetween, buildUpdateReport,
} from '../../cli/src/update-check.js';

const BIN = fileURLToPath(new URL('../../cli/bin/hopper-dispatch', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url));

// ─── install-kind detection ──────────────────────────────────────────────────

test('detectInstallKind: recognises each install path and names its upgrade command', () => {
  // The whole point of naming the kind is producing the RIGHT upgrade command —
  // this plugin is installed six different ways across six hosts.
  const mp = detectInstallKind('/home/u/.claude/plugins/cache/agent-hopper/hopper/0.47.0');
  assert.equal(mp.kind, 'claude-marketplace');
  assert.match(mp.upgradeHint, /\/plugin update hopper@agent-hopper/);

  const npm = detectInstallKind('/usr/lib/node_modules/hopper-plugin');
  assert.equal(npm.kind, 'npm-global');
  assert.match(npm.upgradeHint, /npm i -g/);

  const unknown = detectInstallKind('/opt/somewhere/else');
  assert.equal(unknown.kind, 'unknown');
});

test('detectInstallKind: this checkout reports as a git working copy', () => {
  const here = detectInstallKind();
  assert.equal(here.kind, 'repo');
  assert.equal(here.upgradeHint, 'git pull');
});

test('declaredRepository: reads the canonical repo out of the plugin manifest', () => {
  assert.equal(declaredRepository(), 'litianyi-007/hopper-plugin');
});

// ─── upstream fetch (injected — no network in tests) ─────────────────────────

test('fetchUpstreamVersion: reads the version from the upstream manifest', async () => {
  const res = await fetchUpstreamVersion({
    repo: 'o/r',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ version: '9.9.9' }) }),
  });
  assert.equal(res.version, '9.9.9');
  assert.equal(res.error, null);
});

test('fetchUpstreamVersion: offline / HTTP failure degrades, never throws', async () => {
  const thrown = await fetchUpstreamVersion({ repo: 'o/r', fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(thrown.version, null);
  assert.match(thrown.error, /ENOTFOUND/);

  const http = await fetchUpstreamVersion({ repo: 'o/r', fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(http.version, null);
  assert.match(http.error, /404/);

  const noRepo = await fetchUpstreamVersion({ repo: null });
  assert.equal(noRepo.version, null);
});

// ─── MIGRATION.md parsing ────────────────────────────────────────────────────

test('parseMigrationEntries: pulls versions and flags BREAKING bodies', () => {
  const md = `# Migration Guide

## v0.40.0 (2026-07-31) — Approved Vendors is now a gate

This is BREAKING for existing projects.

## v0.39.0 (2026-07-20) — no action needed

Nothing to do.
`;
  const entries = parseMigrationEntries(md);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].version, '0.40.0');
  assert.equal(entries[0].breaking, true);
  assert.equal(entries[1].breaking, false);
});

test('parseMigrationEntries: the real MIGRATION.md parses and finds its BREAKING entry', () => {
  const entries = parseMigrationEntries(readFileSync(join(REPO, 'MIGRATION.md'), 'utf-8'));
  assert.ok(entries.length > 3, 'several release entries found');
  assert.ok(entries.some((e) => e.breaking), 'the documented BREAKING release is detected');
});

test('entriesBetween: only releases strictly newer than the installed one', () => {
  const entries = [{ version: '0.48.0' }, { version: '0.45.0' }, { version: '0.40.0' }];
  const got = entriesBetween(entries, '0.40.0', '0.48.0').map((e) => e.version);
  assert.deepEqual(got, ['0.48.0', '0.45.0'], 'the installed version itself is not "pending"');
  assert.deepEqual(entriesBetween(entries, null, '0.48.0'), []);
});

// ─── report assembly ─────────────────────────────────────────────────────────

test('buildUpdateReport: behind upstream surfaces BREAKING entries and the host upgrade command', () => {
  const r = buildUpdateReport({
    install: detectInstallKind('/home/u/.claude/plugins/cache/agent-hopper/hopper/0.40.0'),
    running: '0.40.0',
    upstream: { version: '0.48.0', error: null },
    migrationEntries: [{ version: '0.45.0', title: 'x', breaking: true }],
    workspacePlan: null,
  });
  const text = r.lines.join('\n');
  assert.equal(r.upToDate, false);
  assert.match(text, /BREAKING/);
  assert.match(text, /\/plugin update hopper@agent-hopper/);
  // It must hand the command over, not run it.
  assert.match(text, /does not install for you/);
});

test('buildUpdateReport: an unreachable upstream still reports local state', () => {
  const r = buildUpdateReport({
    install: detectInstallKind('/opt/x'),
    running: '0.47.0',
    upstream: { version: null, error: 'ENOTFOUND' },
    workspacePlan: { stamp: '0.28.0', errors: [], entries: [{ id: 'task-policy-columns', reason: 'r', breaking: false }] },
  });
  assert.equal(r.upToDate, null, 'unknown is not the same as up-to-date');
  assert.equal(r.workspaceDrifted, true, 'the local half still runs');
  assert.match(r.lines.join('\n'), /migrate-config/);
});

// ─── CLI surface ─────────────────────────────────────────────────────────────

test('CLI: --update-check runs outside a workspace and does not fail on --offline', () => {
  const empty = mkdtempSync(join(tmpdir(), 'hopper-no-ws-'));
  try {
    const out = execFileSync(process.execPath, [BIN, '--update-check', '--offline'], {
      encoding: 'utf-8', timeout: 120_000, cwd: empty,
    });
    assert.match(out, /update check/);
    assert.match(out, /not inside a \.hopper workspace/);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test('CLI: --migrate-config defaults to a dry run and writes nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'hopper-cli-migrate-'));
  const hopperDir = join(root, '.hopper');
  mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
  const original = `# Agent Instances

## Task-type → vendor default preference

| Task-type | Default vendor | Why |
|---|---|---|
| \`prd-research\` | codex | default |
`;
  writeFileSync(join(hopperDir, 'AGENTS.md'), original);
  try {
    const out = execFileSync(process.execPath, [BIN, '--migrate-config'], {
      encoding: 'utf-8', timeout: 120_000, cwd: root,
    });
    assert.match(out, /dry run/);
    assert.match(out, /nothing was written/);
    assert.equal(readFileSync(join(hopperDir, 'AGENTS.md'), 'utf-8'), original, 'nothing written without --yes');

    const applied = execFileSync(process.execPath, [BIN, '--migrate-config', '--yes'], {
      encoding: 'utf-8', timeout: 120_000, cwd: root,
    });
    assert.match(applied, /backup:/);
    assert.notEqual(readFileSync(join(hopperDir, 'AGENTS.md'), 'utf-8'), original);

    const again = execFileSync(process.execPath, [BIN, '--migrate-config'], {
      encoding: 'utf-8', timeout: 120_000, cwd: root,
    });
    assert.match(again, /nothing to migrate/, 'idempotent through the CLI too');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI: --migrate-config outside a workspace fails with a specific message', () => {
  const empty = mkdtempSync(join(tmpdir(), 'hopper-no-ws2-'));
  try {
    assert.throws(
      () => execFileSync(process.execPath, [BIN, '--migrate-config'], { encoding: 'utf-8', timeout: 120_000, cwd: empty, stdio: 'pipe' }),
      (err) => /not inside a \.hopper workspace/.test(String(err.stderr)),
    );
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test('a freshly scaffolded workspace is stamped and needs no migration', async () => {
  // Closing the loop: the scaffold must WRITE the stamp, or every new project
  // starts out looking like a pre-stamp legacy workspace.
  const { scaffoldHopper } = await import('../../cli/src/scaffold.js');
  const { planWorkspaceMigrations, readScaffoldStamp, currentVersion } = await import('../../cli/src/workspace-drift.js');
  const root = mkdtempSync(join(tmpdir(), 'hopper-fresh-'));
  try {
    const { hopperDir } = scaffoldHopper(root);
    const stamp = readScaffoldStamp(readFileSync(join(hopperDir, 'AGENTS.md'), 'utf-8'));
    assert.equal(stamp, currentVersion(), 'scaffold stamps with the running version');
    assert.deepEqual(planWorkspaceMigrations(hopperDir).entries, [], 'a fresh workspace has zero drift');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
