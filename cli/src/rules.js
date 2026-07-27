// Dispatch-rules renderer (`hopper-dispatch --rules`) + scaffold DISPATCH.md.
// Anchor: cli/src/rules.js
//
// Renders the per-vendor parameter-capability matrix as Markdown so users get a
// SINGLE SOURCE OF TRUTH for the dispatch contract that NEVER drifts: every cell
// is derived from the live adapter (its capability metadata + its actual args()
// output), not hand-maintained. This is the fix for the failure mode where a
// project hand-copies invocation strings into its own docs and they rot (the
// x-agents 03-dispatch-protocol.md case).
//
// No subprocess spawn: only adapter.args() (pure arg-building) + capability
// metadata are read. Safe to import anywhere.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listAdapters, getAdapter, capabilitiesForAdapter } from './vendors/index.js';

const PROMPT_SENTINEL = '__HOPPER_PROMPT__';
const MODEL_SENTINEL = '__HOPPER_MODEL__';
const CWD_SENTINEL = '__HOPPER_CWD__';

function pkgVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf-8')).version;
  } catch (_) { return 'unknown'; }
}

function safeArgs(adapter, opts) {
  try { return adapter.args(PROMPT_SENTINEL, { background: true, ...opts }); } catch (_) { return []; }
}

// codex review P2: adapter.args() reads these env vars (e.g. HOPPER_CLAUDE_BARE
// adds --bare; HOPPER_GROK_EFFORT changes --effort), which would make the
// rendered matrix shell-dependent. Neutralize them during introspection so the
// generated DISPATCH.md is deterministic regardless of the generating shell.
const ENV_AFFECTING_ARGS = [
  'HOPPER_CLAUDE_BARE', 'HOPPER_CLAUDE_PERMISSION_MODE',
  'HOPPER_GROK_PERMISSION_MODE', 'HOPPER_GROK_EFFORT',
];
function withNeutralEnv(fn) {
  const saved = {};
  for (const k of ENV_AFFECTING_ARGS) { saved[k] = process.env[k]; delete process.env[k]; }
  try { return fn(); } finally {
    for (const k of ENV_AFFECTING_ARGS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

/** Leading invocation form, e.g. `exec <prompt>` / `-p <prompt>` / `run <prompt>`. */
function promptForm(adapter) {
  const argv = safeArgs(adapter, {});
  const i = argv.indexOf(PROMPT_SENTINEL);
  if (i === -1) return `${adapter.command} <prompt>`;
  const lead = argv.slice(0, i);
  return `${adapter.command} ${[...lead, '<prompt>'].join(' ')}`;
}

/** How --model is forwarded, or "ignored" when the adapter drops opts.model. */
function modelCell(adapter) {
  const argv = safeArgs(adapter, { model: MODEL_SENTINEL });
  const i = argv.indexOf(MODEL_SENTINEL);
  if (i === -1) return 'ignored (account default)';
  const flag = i > 0 && argv[i - 1].startsWith('-') ? argv[i - 1] : '';
  return flag ? `\`${flag} <model>\`` : '`<model>` (positional)';
}

/** Working-dir flag the adapter threads opts.cwd through, or "none". */
function cwdCell(adapter) {
  const argv = safeArgs(adapter, { cwd: CWD_SENTINEL });
  const i = argv.indexOf(CWD_SENTINEL);
  if (i === -1) return 'none';
  const flag = i > 0 && argv[i - 1].startsWith('-') ? argv[i - 1] : '';
  return flag ? `\`${flag}\`` : '(positional)';
}

// Permission-related argv tokens (flags + their immediate values).
const PERM_RE = /permission|approve|skip|allow|sandbox|danger|yolo|^-s$|^--agent$/i;

/**
 * Full permission argv a vendor gets for danger-full-access. codex review P2:
 * we show the FULL set (not the delta vs read-only) so flags shared by BOTH
 * modes are not hidden — e.g. grok keeps `--permission-mode bypassPermissions`
 * even in read-only, which a delta would mask. "not argv-enforced" means the
 * vendor has no argv permission control (kimi).
 */
function permsCell(adapter) {
  const full = safeArgs(adapter, { sandbox: 'danger-full-access' });
  const out = [];
  for (let i = 0; i < full.length; i++) {
    const t = full[i];
    if (t === PROMPT_SENTINEL) continue;
    if (PERM_RE.test(t)) {
      out.push(t);
      const next = full[i + 1];
      if (next && !next.startsWith('-') && next !== PROMPT_SENTINEL) { out.push(next); i++; }
    }
  }
  return out.length ? '`' + out.join(' ') + '`' : 'not argv-enforced';
}

function reasoningCell(adapter) {
  const r = capabilitiesForAdapter(adapter.name)?.reasoningArg;
  if (!r) return '—';
  if (r.accepted === 'ignored') return 'ignored';
  const kg = (r.knownGood || []).join('/');
  return kg ? `${r.accepted} (${kg})` : r.accepted;
}

function timeoutCell(adapter) {
  try { return Math.round(adapter.timeoutMs({}) / 1000) + 's'; } catch (_) { return '—'; }
}

function staleCell(adapter) {
  return capabilitiesForAdapter(adapter.name)?.staleAfter || '—';
}

/**
 * Render the dispatch-rules Markdown. Deterministic (no timestamps) so the
 * scaffolded DISPATCH.md and any committed copy stay diff-stable.
 * @param {object} [opts]
 * @param {string} [opts.version]  hopper version stamp (defaults to package.json)
 * @returns {string}
 */
export function renderRulesMarkdown({ version = pkgVersion() } = {}) {
  const names = listAdapters();
  const rows = withNeutralEnv(() => names.map((name) => {
    const a = getAdapter(name);
    return `| ${name} | \`${promptForm(a)}\` | ${modelCell(a)} | ${reasoningCell(a)} | ${permsCell(a)} | ${cwdCell(a)} | ${timeoutCell(a)} | ${staleCell(a)} |`;
  }));
  const oldestStale = names
    .map((n) => capabilitiesForAdapter(n)?.staleAfter)
    .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()[0] || 'unknown';

  return `# Hopper Dispatch Rules — GENERATED, do not hand-edit

> Source of truth: the hopper vendor adapters (\`cli/src/vendors/*.js\`). Every cell
> below is derived from the LIVE adapter, so it cannot drift. **Do not hand-copy
> vendor invocation strings into other docs** — that is exactly what rots.
>
> - Regenerate after upgrading hopper: \`hopper-dispatch --rules > .hopper/DISPATCH.md\`
> - Live single-vendor check: \`hopper-dispatch --capabilities <vendor>\`
> - Live model catalog (per your account): \`hopper-dispatch --probe <vendor>\`
> - Generated by hopper v${version}. Oldest capability \`staleAfter\`: ${oldestStale}.

## What you set per dispatch (the stable contract)

- \`--model <name>\` — forwarded only to vendors whose **model** column is not "ignored". Exact ids are account/subscription gated; confirm with \`--probe <vendor>\`. Fallback chain when omitted: \`--model\` flag > \`.hopper/AGENTS.md\`'s task-vendor-preference **Model rule** cell > vendor CLI default (no \`--model\` at all). \`Model rule: verified-latest\` is a SENTINEL — it resolves to the bound vendor's adapter \`knownGood[0]\` at dispatch time (the resolved REAL name, not the sentinel, is what reaches argv and \`output.md\` frontmatter). Check pre-dispatch: \`hopper-dispatch --check-model <vendor> <model>\`.
- \`--reasoning <minimal|low|medium|high|xhigh>\` — **defaults to \`xhigh\`** (override: \`HOPPER_DEFAULT_REASONING\`). Only vendors whose **reasoning** column is not "ignored" consume it. Fallback chain when omitted: \`--reasoning\` flag > \`.hopper/AGENTS.md\`'s **Effort policy** cell (single token like \`medium\`, or a per-vendor table like \`codex:xhigh, grok:high\`) > \`HOPPER_DEFAULT_REASONING\` > \`xhigh\`. **OpenCode is deliberately different:** only an explicit CLI \`--reasoning\` is forwarded as its provider-specific \`--variant\`; a policy/default value is omitted so arbitrary providers remain compatible. \`HOPPER_OPENCODE_VARIANT=<value>\` has highest precedence and is forwarded verbatim. A resolved level outside a vendor's **reasoning** enum is NOT an error — it dispatches and gets clamped, but hopper now prints \`effort X → clamped to Y (<vendor> max/min)\` instead of remapping it silently; \`hopper-dispatch --setup\` also lints Effort policy cells ahead of time ("Task-type policy" section).
- \`--sandbox <read-only|workspace-write|danger-full-access>\` — **defaults to \`danger-full-access\`**; auto-downgrades to read-only when the task brief/spec says \`read-only\` / \`只读\`. The **full-access perms** column shows the danger-full-access argv each vendor gets. NOTE: read-only is **not always argv-enforceable** — Kimi has no argv permission control, so an effective Kimi read-only dispatch is refused before spawn with \`E_KIMI_READ_ONLY_UNENFORCEABLE\`; Grok still runs with \`bypassPermissions\` (just without \`--always-approve\`). \`--write\` only writes Hopper's synchronous output artifact; it is not a Kimi permission flag or a read-only remedy. For a genuinely locked-down review, use a vendor with enforceable read-only controls or a separately proven Hopper-supported external process guard.
- \`--subject-root <absolute-path>\` — opt-in macOS process guard for one specific tree. Valid only with the **effective** \`read-only\` sandbox; it fails closed if \`/usr/bin/sandbox-exec\` or path validation is unavailable. During guarded execution it blocks vendor/child \`file-write*\` in the tree and new subject-scoped \`file-link\` creation (preventing new external hard-link aliases). It cannot revoke a hard link created before the guard: a known alias outside the subject can still mutate the same inode through otherwise allowed outside writes. It also does **not** block reads or network/IPC, and is not a confidentiality boundary.
- \`--timeout <ms>\` — absolute **ceiling** override (env: \`HOPPER_DISPATCH_TIMEOUT_MS\`). Timeouts are **idle + ceiling**, not a single total cap: a run is killed after \`HOPPER_IDLE_TIMEOUT_MS\` of silence (default 180s) or the ceiling (≥30min), whichever first. The **timeout** column is the per-vendor baseline that seeds the ceiling.
- \`HOPPER_VENDOR_CWD\` — working directory for the dispatched vendor (default: the repo root that owns \`.hopper/\`). The **cwd** column shows the flag each vendor receives it through.

## Per-vendor capability matrix

| vendor | invocation | model | reasoning | full-access perms | cwd | timeout (baseline) | staleAfter |
|--------|------------|-------|-----------|-------------------|-----|--------------------|------------|
${rows.join('\n')}

## Escape hatches (env)

\`HOPPER_DEFAULT_REASONING\` · \`HOPPER_WEB_SEARCH\` · \`HOPPER_OPENCODE_VARIANT\` · \`HOPPER_DISPATCH_TIMEOUT_MS\` · \`HOPPER_IDLE_TIMEOUT_MS\` · \`HOPPER_VENDOR_CWD\` · \`HOPPER_GROK_EFFORT\` · \`HOPPER_GROK_PERMISSION_MODE\` · \`HOPPER_CLAUDE_PERMISSION_MODE\` · \`HOPPER_CLAUDE_BARE\` · \`HOPPER_CODEX_ISOLATE\` · \`HOPPER_CODEX_HOME\` · \`HOPPER_CODEX_EXTRA_CONFIG\`

## host ≠ vendor

A host CLI never dispatches to its own vendor identity (enforced). Run hopper from
one host (e.g. codex / opencode) to dispatch a task to a different vendor (e.g. claude).
`;
}
