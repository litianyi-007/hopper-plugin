// Upgrade reconciliation: what is installed, what is upstream, what must change.
// Anchor: cli/src/update-check.js
//
// SCOPE — THIS IS NOT A SELF-UPDATER, AND MUST NOT BECOME ONE
// -----------------------------------------------------------
// Installing plugin code is the HOST's job. Claude Code already owns
// installed_plugins.json, the version pin, and the cache layout; npm owns the
// global link; each of the other five hosts has its own path. A plugin that
// fetched and replaced its own code from a hard-coded URL would:
//   * bypass the host's install record, creating a second source of truth,
//   * be replacing the very code it is executing, and
//   * have to reimplement six install paths correctly — and the npm-link path is
//     exactly where the silent-exit-0 entry-guard bug lived for ten releases.
// So this module REPORTS and hands the install command back to the operator. It
// never downloads, unpacks, or replaces anything.
//
// What it does own is the half nobody else does: after an upgrade, the project's
// `.hopper/` is still shaped for the OLD plugin (see workspace-drift.js), and the
// vendor CLIs on this machine may have drifted too. That reconciliation is the
// actual product here.
//
// NETWORK
// -------
// One read-only GET, and everything degrades to a local-only report without it.
// An upgrade check that fails closed on a flaky network would be worse than none.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentVersion, compareVersionDesc, isOlder } from './workspace-drift.js';

/** Repo root of the running plugin (two levels up from cli/src/). */
export function pluginRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * Where is the running plugin installed from, and therefore HOW does the operator
 * upgrade it? Path-shape based; no network, no host API.
 *
 * @param {string} [root] injectable for tests
 * @returns {{ kind: string, root: string, label: string, upgradeHint: string }}
 */
export function detectInstallKind(root = pluginRoot()) {
  const norm = root.split(sep).join('/');

  // Claude Code marketplace cache: .../.claude/plugins/cache/<marketplace>/<plugin>/<version>
  const mp = norm.match(/\.claude\/plugins\/cache\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (mp) {
    return {
      kind: 'claude-marketplace',
      root,
      label: `Claude Code marketplace (${mp[1]}/${mp[2]} @ ${mp[3]})`,
      upgradeHint: `/plugin update ${mp[2]}@${mp[1]}`,
    };
  }
  if (/node_modules\/[^/]+$/.test(norm)) {
    return {
      kind: 'npm-global',
      root,
      label: 'npm global install',
      upgradeHint: 'npm i -g hopper-plugin@latest',
    };
  }
  if (existsSync(join(root, '.git'))) {
    return {
      kind: 'repo',
      root,
      label: 'git working copy (development)',
      upgradeHint: 'git pull',
    };
  }
  return {
    kind: 'unknown',
    root,
    label: 'unrecognized install layout',
    upgradeHint: 'reinstall through whichever host manages this plugin',
  };
}

/** Canonical upstream repo, read from the plugin's own declared metadata. */
export function declaredRepository(root = pluginRoot()) {
  for (const rel of ['.claude-plugin/plugin.json', 'package.json']) {
    try {
      const j = JSON.parse(readFileSync(join(root, rel), 'utf-8'));
      const raw = typeof j.repository === 'string' ? j.repository : j.repository?.url;
      if (!raw) continue;
      const m = String(raw).match(/github\.com[/:]([^/]+\/[^/.]+)/);
      if (m) return m[1];
    } catch (_) { /* try the next file */ }
  }
  return null;
}

/**
 * Latest upstream version, read from the repo's own plugin manifest at HEAD.
 *
 * Deliberately NOT tag-based: this repo had zero tags until 0.46.0, so tags are
 * not a reliable anchor for older installs. The manifest is the version the
 * marketplace itself serves.
 *
 * @param {object} [o]
 * @param {string} [o.repo]      owner/name
 * @param {Function} [o.fetchImpl] injectable for tests
 * @param {number} [o.timeoutMs]
 * @returns {Promise<{ version: string|null, source: string, error: string|null }>}
 */
export async function fetchUpstreamVersion({ repo = declaredRepository(), fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!repo) return { version: null, source: 'none', error: '插件元数据里没有声明 GitHub repository' };
  if (typeof fetchImpl !== 'function') return { version: null, source: 'none', error: '此 Node 运行时没有 fetch' };
  const url = `https://raw.githubusercontent.com/${repo}/HEAD/.claude-plugin/plugin.json`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!res || !res.ok) return { version: null, source: url, error: `HTTP ${res ? res.status : '?'}` };
    const body = await res.json();
    const version = typeof body?.version === 'string' ? body.version : null;
    return { version, source: url, error: version ? null : '上游清单里没有 version 字段' };
  } catch (err) {
    // Offline is a normal outcome, not a failure of the command.
    return { version: null, source: url, error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Release entries from MIGRATION.md, newest first, flagging the BREAKING ones.
 * MIGRATION.md is hand-written prose, so this parses only its stable shape:
 * `## vX.Y.Z (date) — title`, and looks for the word BREAKING in the body.
 */
export function parseMigrationEntries(md) {
  const out = [];
  const lines = String(md || '').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const h = line.match(/^##\s+v([0-9][0-9A-Za-z.\-+]*[0-9A-Za-z])\s*(?:\(([^)]*)\))?\s*(?:—|--|-)?\s*(.*)$/);
    if (h) {
      if (current) out.push(current);
      const title = (h[3] || '').trim();
      // BREAKING can be declared in the HEADING as well as the body — the real
      // MIGRATION.md puts it in the heading for its one breaking release
      // (`## v0.40.0 (…) — BREAKING: every existing .hopper/AGENTS.md …`), so a
      // body-only scan finds zero breaking entries in the very file this exists
      // to read.
      current = { version: h[1], date: h[2] || null, title, breaking: /\bBREAKING\b/.test(title) };
      continue;
    }
    if (current && /\bBREAKING\b/.test(line)) current.breaking = true;
  }
  if (current) out.push(current);
  return out;
}

/** MIGRATION.md entries strictly newer than `from` and no newer than `to`. */
export function entriesBetween(entries, from, to) {
  if (!from || !to) return [];
  return entries.filter((e) => isOlder(from, e.version) && compareVersionDesc(e.version, to) >= 0);
}

/**
 * Assemble the full report. Pure aggregation over the pieces above plus the
 * workspace plan, so the CLI layer stays I/O-only and this stays testable.
 *
 * @param {object} o
 * @param {object} o.install      detectInstallKind() result
 * @param {string} o.running      running plugin version
 * @param {{version:string|null,error:string|null}} o.upstream
 * @param {Array} o.migrationEntries
 * @param {object|null} o.workspacePlan  planWorkspaceMigrations() result, or null
 * @returns {{ upToDate: boolean|null, behind: Array, workspaceDrifted: boolean, lines: string[] }}
 */
export function buildUpdateReport({ install, running, upstream, migrationEntries = [], workspacePlan = null }) {
  const lines = [];
  lines.push('Install');
  lines.push(`  Running        v${running}`);
  lines.push(`  Source         ${install.label}`);

  let upToDate = null;
  let behind = [];
  lines.push('');
  lines.push('Upstream');
  if (upstream.version) {
    upToDate = !isOlder(running, upstream.version);
    lines.push(`  Latest         v${upstream.version}`);
    lines.push(`  Status         ${upToDate ? '已是最新' : `落后 —— 可升级到 v${upstream.version}`}`);
    if (!upToDate) {
      behind = entriesBetween(migrationEntries, running, upstream.version);
      const breaking = behind.filter((e) => e.breaking);
      if (breaking.length) {
        lines.push(`  ⚠ BREAKING     区间内有 ${breaking.length} 条破坏性变更：`);
        for (const b of breaking) lines.push(`                 · v${b.version} ${b.title}`);
      }
      lines.push(`  Upgrade with   ${install.upgradeHint}`);
      lines.push('                 （hopper 不代为安装：装代码是宿主的职责，见 cli/src/update-check.js 顶部说明）');
    }
  } else {
    lines.push(`  Latest         未知 —— ${upstream.error}`);
    lines.push('  （只读网络查询失败不影响下面的本地检查）');
  }

  lines.push('');
  lines.push('Workspace');
  let workspaceDrifted = false;
  if (!workspacePlan) {
    lines.push('  不在 .hopper 工作区内 —— 跳过');
  } else if (workspacePlan.errors.length) {
    for (const e of workspacePlan.errors) lines.push(`  ⚠ ${e}`);
  } else if (!workspacePlan.entries.length) {
    lines.push(`  .hopper/ 与 v${running} 一致（水印 ${workspacePlan.stamp || '无'}）`);
  } else {
    workspaceDrifted = true;
    lines.push(`  水印 ${workspacePlan.stamp || '无'}，当前 v${running} —— ${workspacePlan.entries.length} 项待迁移：`);
    for (const e of workspacePlan.entries) {
      lines.push(`    ${e.breaking ? '⚠ BREAKING ' : '           '}${e.id.padEnd(26)} ${e.reason}`);
    }
    lines.push('  预览：hopper-dispatch --migrate-config --dry-run');
    lines.push('  应用：hopper-dispatch --migrate-config --yes');
  }

  return { upToDate, behind, workspaceDrifted, lines };
}

export { currentVersion };
