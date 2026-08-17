// Copilot vendor adapter (T-PLUGIN-05d)
// Anchor: cli/src/vendors/copilot.js
//
// Per T-PLUGIN-00b smoke: `copilot -p "<input>"` returns response.
// Per subagent research: requires GH_TOKEN env with "Copilot Requests" PAT permission.
// Quota meter: every -p call consumes premium request quota; use sparingly.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyTaskTypeFloor } from '../subprocess.js';

// Copilot `--effort` (alias `--reasoning-effort`) enum is MODEL-dependent: GPT
// models document low|medium|high; some models add none/max and the set has
// grown across releases. hopper's canonical 5-level scale is clamped to the
// universally-valid {low,medium,high} so the 'xhigh' dispatch default never
// breaks a GPT dispatch (minimal->low, xhigh->high). Escape hatch:
// HOPPER_COPILOT_EFFORT passes a raw value verbatim (e.g. `max`/`none` for
// models that accept them), or '' to omit --effort entirely.
export function clampCopilotEffort(raw) {
  if (raw == null || raw === '') return null;
  const map = { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'high' };
  return map[raw] ?? raw; // unknown values pass through; copilot validates server-side.
}

/** @type {import('../types.js').VendorAdapter} */
export const copilotAdapter = {
  name: 'copilot',
  command: 'copilot',
  stdinMode: 'none',
  // Prompt-delivery capability (win-cmd-shim multi-line truncation fix). Bare `copilot`
  // (no -p) reads the prompt from stdin — DELIVERY-verified on 1.0.65 (the piped prompt was
  // consumed and reached inference) but the OUT round-trip is currently quota-blocked, so
  // this stays OPT-IN: default OFF, enable with HOPPER_COPILOT_STDIN=1. Flip the default ON
  // only after a content-asserting round-trip passes on the min supported build (#3186 hang
  // risk on older builds). The delivery layer routes to stdin ONLY on win-cmd-shim.
  promptStdin: 'supported',
  promptStdinDefault: false,

  // Phase 6a static capability hint.
  capabilities: {
    modelArg: {
      accepted: 'freeform',
      // Same value the sentinel already inferred from knownGood[0] — declared
      // explicitly so the intent survives a future reordering of the catalog.
      // `auto` asks Copilot to route; the reachable set is subscription-tiered,
      // so naming a specific model here would break lower tiers.
      hopperDefault: 'auto',
      knownGood: ['auto', 'claude-sonnet-4.6', 'claude-opus-4.8', 'claude-haiku-4.5', 'claude-fable-5', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gemini-3.1-pro-preview', 'gemini-3.5-flash'],  // advisory; tier-dependent — `copilot help config` is authoritative
      sourceNote: 'copilot --model <name>. Available models depend on YOUR Copilot subscription tier (premium-request meter applies; Business/Enterprise tiers see different models). Not hardcoded in this adapter.',
    },
    reasoningArg: {
      accepted: 'enumerated',
      knownGood: ['low', 'medium', 'high'],
      // ISSUE-codex-vendor-model-effort (2026-06): adapter now forwards effort via
      // `--effort`. Copilot's enum is MODEL-dependent and has grown across releases
      // (GPT models: low|medium|high; some models add none/max). We clamp hopper's
      // 5-level scale to the universally-valid {low,medium,high} (xhigh->high,
      // minimal->low) so the canonical xhigh default never breaks a GPT dispatch.
      // Override: HOPPER_COPILOT_EFFORT=<raw|''> (raw passes verbatim, '' omits).
      sourceNote: 'Copilot CLI `--effort` (alias --reasoning-effort); adapter forwards opts.reasoning clamped to {low,medium,high} (ISSUE-codex-vendor-model-effort, 2026-06). Enum is model-dependent and growing (GPT: low/medium/high; some models add none/max), so we clamp the canonical xhigh default to high rather than risk a server-side rejection. Override raw value via HOPPER_COPILOT_EFFORT, or set it to "" to omit. NOTE: copilot non-interactive mode requires --allow-all-tools / --allow-all-paths or it silently blocks ALL writes (including its own output.md) and may escalate to General-purpose sub-agents that write to wrong files; args() passes these for danger-full-access.',
    },
    features: {
      sessionResume: { supported: true, mechanism: '`copilot --resume` (picker; UNCONFIRMED whether takes ID arg) / `--continue`. Sessions at ~/.copilot/session-state/ + SQLite.' },
      fileOutput: { supported: false, mechanism: 'stdout only.' },
      streaming: { supported: true, mechanism: 'copilot -p streams during execution.' },
    },
    webSearch: { headless: true, hopperEnabled: false, how: 'bundled GitHub-MCP web_search; enabled by --allow-all-tools under danger-full-access — read-only --allow-tool token unverified (treat as manual)' },
    staleAfter: '2026-08-21',
  },

  args(input, opts) {
    const sandbox = opts.sandbox ?? 'danger-full-access';
    const viaStdin = opts.promptViaStdin === true;
    return [
      // STDIN MODE (opt-in, win-cmd-shim): drop -p + the positional so bare `copilot`
      // reads the FULL prompt from stdin — bypassing the cmd.exe argv newline truncation.
      ...(viaStdin ? [] : ['-p', input]),
      // Phase 6c follow-up (T-AUDIT-PH6C-copilot sub-agent escape investigation):
      // Without --allow-all-tools, copilot CLI's non-interactive permission
      // model blocks ALL write attempts (file edits, shell, Python, Node — every
      // exec path probed) AND blocks `copilot` from writing its own dispatched
      // output.md. Copilot then escalates to a General-purpose sub-agent which
      // runs in a DIFFERENT permission scope and writes content to a DIFFERENT
      // file (T-AUDIT-PH6C-agy-output.md got contaminated in the dogfood run).
      // --allow-all-tools makes the permission model match hopper's default:
      // implementation dispatches can use shell/file-edit tools and write their
      // own output. Explicit read-only tasks omit this grant and rely on
      // Copilot's native permission model.
      // stdin (no -p) needs --allow-all-tools for non-interactive mode (copilot docs);
      // otherwise gate on the danger-full-access sandbox as before.
      ...((sandbox === 'danger-full-access' || viaStdin) ? ['--allow-all-tools', '--allow-all-paths'] : []),
      // Optional --model when explicitly chosen
      ...(opts.model ? ['--model', opts.model] : []),
      // Web search: copilot's web_search is a bundled GitHub-MCP tool. Under
      // danger-full-access the --allow-all-tools grant above already enables it. The
      // read-only `--allow-tool <token>` form needs the MCP-namespaced tool identifier
      // (copilot docs: shell(CMD) | write | MCP_SERVER(tool)) — a bare `web_search` is
      // NOT valid and would silently fail to register, so we do NOT forward a guessed
      // token. capabilities.webSearch is 'manual' until the real token is smoke-verified.
      // Reasoning effort -> --effort, clamped to copilot's universal {low,medium,high}
      // (ISSUE-codex-vendor-model-effort). HOPPER_COPILOT_EFFORT overrides the level
      // (empty string omits --effort entirely, for builds/models that predate it).
      ...(() => {
        const raw = process.env.HOPPER_COPILOT_EFFORT !== undefined
          ? process.env.HOPPER_COPILOT_EFFORT
          : opts.reasoning;
        const eff = clampCopilotEffort(raw);
        return eff ? ['--effort', eff] : [];
      })(),
    ];
  },

  envPreflight() {
    // Auth sources in confidence order (mirrors the file-checking pattern of every
    // other adapter — copilot previously checked ONLY env vars, so a CLI-logged-in
    // copilot always fell to the soft-warn branch and rendered as Auth=NO).
    // 1) explicit env tokens.
    if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.COPILOT_GITHUB_TOKEN) {
      return { ok: true, missing: [] };
    }
    // 2) gh CLI cached auth (copilot can fall back to it) — Windows + XDG locations.
    const ghHosts = [
      join(homedir(), '.config', 'gh', 'hosts.yml'),
      join(homedir(), 'AppData', 'Roaming', 'GitHub CLI', 'hosts.yml'),
    ];
    if (ghHosts.some((p) => existsSync(p))) return { ok: true, missing: [] };
    // 3) copilot CLI's own login profile. The token itself is OS-keychain / session-db
    //    backed (NOT a readable file), so the presence of the ~/.copilot profile is the
    //    on-disk signal that `copilot` has been set up; parseResult is the backstop for
    //    an expired/revoked session at dispatch time.
    // Key on session-store.db only: config.json/settings.json are written merely by
    // launching the CLI (persist after logout), whereas the session store reflects
    // actual authenticated use. Still a heuristic — parseResult catches a stale session.
    if (existsSync(join(homedir(), '.copilot', 'session-store.db'))) {
      return { ok: true, missing: [] };
    }
    // Soft warn — nothing detected; copilot may still auth via keychain.
    return {
      ok: true,
      missing: ['Note: no GH_TOKEN/GITHUB_TOKEN/COPILOT_GITHUB_TOKEN env var, gh CLI auth (~/.config/gh or %APPDATA%/GitHub CLI), or ~/.copilot login profile found. Run `copilot` once to log in, or set a token. See https://docs.github.com/copilot/concepts/agents/about-copilot-cli'],
    };
  },

  timeoutMs(opts) {
    // Native: 120s for typical copilot -p call
    // Phase 6c F1: review task-types get raised to 30min floor (was the
    // most aggressively misaligned vendor — killed in 122s before context-load done)
    return applyTaskTypeFloor(120_000, opts);
  },

  parseResult(raw) {
    if (raw.timedOut) {
      return { text: raw.stdout, status: 'timeout', error: `copilot -p timed out after ${raw.durationMs}ms` };
    }
    if (raw.exitCode === 127) {
      return {
        text: '',
        status: 'permission-fail',
        error: 'copilot binary not found. Install: npm install -g @github/copilot OR brew install copilot-cli',
      };
    }
    // Auth failure backstop: envPreflight's profile heuristic can't tell a logged-OUT
    // copilot (stale ~/.copilot session-store) from a logged-in one, so catch a real
    // auth failure here and label it (don't bury it in the generic unknown-fail bucket).
    const authFail = /not (authenticated|logged in|signed in)|unauthorized|\bHTTP\s*401\b|\bstatus(?:\s*code)?[:=]?\s*401\b|authentication (failed|required)|please (sign in|log in|authenticate)|run `?copilot`? to (sign in|log in)|invalid (token|credentials)/i;
    if ((raw.exitCode !== 0) && (authFail.test(raw.stderr || '') || authFail.test(raw.stdout || ''))) {
      return {
        text: '',
        status: 'auth-fail',
        error: 'copilot is not authenticated. Run `copilot` once to log in, or set GH_TOKEN/GITHUB_TOKEN/COPILOT_GITHUB_TOKEN.',
      };
    }
    // Copilot quota exhaustion: surfaces as specific error in stdout/stderr
    if (raw.stderr.match(/quota|rate.limit|premium request/i) || raw.stdout.match(/quota exceeded|rate.limit/i)) {
      return {
        text: raw.stdout,
        status: 'permission-fail',
        error: 'Copilot premium request quota exceeded. Upgrade subscription or wait for monthly reset.',
      };
    }
    if (raw.exitCode === 0) {
      // Strip Copilot footer: "Changes / Requests / Tokens" usage block
      let text = raw.stdout;
      // Try to find and trim the usage footer (starts at "Changes" or "Requests" near end)
      const footerStart = text.search(/\n\s*(Changes|Requests)\s+[+\-]?\d/);
      if (footerStart > 0) text = text.slice(0, footerStart);
      // Parse usage from footer if present
      const usageMatch = raw.stdout.match(/Requests\s+([\d.]+)\s+Premium/);
      const usage = usageMatch ? { premiumRequests: parseFloat(usageMatch[1]) } : undefined;
      return { text: text.trim(), status: 'success', usage };
    }
    return {
      text: raw.stdout,
      status: 'unknown-fail',
      error: `copilot exited ${raw.exitCode}: ${(raw.stderr || '').slice(0, 500)}`,
    };
  },
};
