// Documentation-truth guard for user-facing "read-only" security claims.
// Anchor: tests/unit/vendor-security-claims.test.js
//
// 2026-07-29 audit: commands/review.md, research.md, market.md, swarm.md, and
// README.md asserted or implied that a codex/grok dispatch is read-only
// ENFORCED — e.g. "so the reviewer never edits the repo", the README Core
// Skills table's bare "(ad-hoc, read-only)", swarm.md's "each panelist ...
// runs read-only". That was false AT THE TIME: codex ALWAYS ran full-access
// (a deliberate Windows-sandbox workaround, not a bug) and grok ALWAYS runs
// `--permission-mode bypassPermissions` (cli/src/vendors/grok.js — the mode
// never varies with `sandbox`; only `--always-approve` is dropped for a
// read-only REQUEST, which does not restrict anything since bypassPermissions
// already skips all approval — grok is UNCHANGED by the update below).
//
// UPDATE (2026-07-31, user-approved platform split): codex's "ALWAYS
// full-access" default was reversed for macOS/Linux — see
// codexSandboxBypassActive() in cli/src/vendors/codex.js. codex's own `-s
// <mode>` sandbox is verified working there (manually verified: `-s read-only`
// denies a write with `operation not permitted`, file never created), so a
// read-only REQUEST is now genuinely enforced on macOS/Linux. **Windows is
// UNCHANGED** — codex's `-s` harness still cannot spawn children there (1326),
// so it still ALWAYS runs full-access on Windows regardless of the request.
// This is exactly the scenario the (a)/(a2) guards below were built to catch:
// "the moment either vendor is genuinely fixed to honor read-only, one of
// these assertions goes RED — forcing whoever makes that fix to update the
// doc set in the SAME change." Codex's assertions below were updated
// (platform-split, not simply flipped) in the SAME change as commands/*.md +
// README.md (see git history for this file's diff alongside those docs').
//
// This file carries three independent guards:
//
//   (a) PINS the real argv codex/grok produce for a `sandbox: 'read-only'`
//       REQUEST — for codex, now split by platform (win32 vs darwin/linux);
//       for grok, unconditionally (grok is untouched by the 2026-07-31 fix).
//       If either assertion ever goes red, that means real vendor behavior
//       changed again; do not "fix" the test in isolation without also
//       revisiting the docs.
//
//   (a2) PINS that cli/src/setup.js's sandboxControl() classifier reports the
//       above truthfully (T-a/T-b/T-c) — codex's T-b pin is now platform-split
//       too (full on win32, argv on darwin/linux), added in the SAME 2026-07-31
//       change as the (a) pin above.
//
//   (b) SCANS commands/*.md (except setup.md — see SCAN note below) and
//       README.md for a DENYLIST of the exact phrasings this audit found and
//       fixed. This is a denylist, NOT a semantic / completeness checker: it
//       only catches recurrence of these specific phrasings (or close
//       variants matched by the same regex). A differently-worded false
//       claim ("guaranteed sandboxed", "cannot write outside X", etc.) will
//       NOT be caught by this test. A green run here means "no known-bad
//       phrase came back" — never "the docs are honest." The 2026-07-31 doc
//       rewrites describe codex's behavior as platform-split (not an
//       unconditional claim in either direction), so they do not trip this
//       denylist; re-verify by hand if a future edit tightens the wording.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { getAdapter } from '../../cli/src/vendors/index.js';
import { sandboxControl } from '../../cli/src/setup.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── (a) pin the real (non-)enforcement behavior ──────────────────────────

test('doc-truth pin: codex read-only REQUEST carries no real write restriction on WINDOWS', () => {
  const a = getAdapter('codex');
  const ro = a.args('test', { sandbox: 'read-only', platform: 'win32' });
  // codex's -s sandbox harness is broken on Windows (CreateProcessWithLogonW
  // 1326 on every child — ISSUE-codex-callchain-windows), so the adapter
  // ALWAYS bypasses it there, even when the caller requests read-only.
  assert.ok(ro.includes('--dangerously-bypass-approvals-and-sandbox'),
    'codex must always emit the full-access bypass flag on Windows, even for a read-only ' +
    'REQUEST. If this ever fails, codex has gained genuine read-only enforcement on Windows ' +
    'too — update commands/review.md, research.md, market.md, swarm.md, and README.md ' +
    '(the Windows caveat) in the SAME change as whatever fixed this.');
  assert.ok(!ro.includes('-s'),
    'no real `-s <mode>` sandbox flag should reach argv while the bypass is active — ' +
    'a read-only REQUEST must not produce a real `-s read-only` on Windows.');
});

test('doc-truth pin (2026-07-31): codex read-only REQUEST IS genuinely enforced on macOS/Linux', () => {
  // The other half of the platform split: verified 2026-07-31 that codex's own
  // `-s read-only` denies a write (`operation not permitted`, file never
  // created) on a real macOS host. If this ever fails (argv reverts to the
  // bypass flag on darwin/linux), codex has LOST enforcement there — update
  // commands/review.md, research.md, market.md, swarm.md, README.md, and
  // cli/src/rules.js's --sandbox note in the SAME change as whatever broke this.
  for (const platform of ['darwin', 'linux']) {
    const ro = getAdapter('codex').args('test', { sandbox: 'read-only', platform });
    assert.ok(!ro.includes('--dangerously-bypass-approvals-and-sandbox'),
      `${platform}: codex must NOT bypass its sandbox for a read-only REQUEST by default`);
    assert.equal(ro[ro.indexOf('-s') + 1], 'read-only', `${platform}: codex must emit a real -s read-only`);
  }
});

test('doc-truth pin: grok read-only REQUEST carries no real write restriction', () => {
  const a = getAdapter('grok');
  // background:true forces headless detection deterministically (no TTY dependency).
  const ro = a.args('test', { sandbox: 'read-only', background: true });
  const idx = ro.indexOf('--permission-mode');
  assert.ok(idx !== -1, 'grok always needs an explicit permission mode headless');
  assert.equal(ro[idx + 1], 'bypassPermissions',
    'grok\'s --permission-mode does not vary with `sandbox` — it is bypassPermissions ' +
    'unconditionally (cli/src/vendors/grok.js). If this ever becomes something other than ' +
    'bypassPermissions for a read-only REQUEST, grok has gained genuine enforcement — update ' +
    'the same doc set as the codex pin above in the SAME change.');
  assert.ok(!ro.includes('--always-approve'),
    'the ONLY thing that changes for a read-only request is dropping --always-approve — ' +
    'not a real restriction, since bypassPermissions already skips all approval regardless.');
});

// ── (a2) sandboxControl() classification pin (2026-07-29 same-day follow-up) ─
//
// The (a) pin tests above proved codex/grok's ACTUAL argv never restricts writes
// for a read-only REQUEST. This block pins that cli/src/setup.js's sandboxControl()
// classifier now reports that truthfully instead of independently going stale: a
// same-day follow-up to this audit found sandboxControl() classified grok as
// 'argv' (implying downgradable/enforceable to anyone reading `--setup` output)
// solely because grok's argv differs by mode (`--always-approve` toggles) — but
// grok's `--permission-mode` stays `bypassPermissions` regardless, so nothing is
// actually restricted. Fixed by additionally checking whether the READ-ONLY argv
// itself still carries an unconditional-access flag/permission-mode
// (argvPinsUnconditionalAccess in cli/src/setup.js); grok now classifies 'full',
// same bucket as codex.

test('T-a: sandboxControl(grok) must NOT be argv (grok never actually restricts writes)', () => {
  const a = getAdapter('grok');
  // Destructive counter-check performed by hand while authoring this fix (not
  // encoded here, since it requires editing cli/src/setup.js): commenting out the
  // `argvPinsUnconditionalAccess(roArgv)` check in sandboxControl() flips this
  // back to 'argv' and turns this assertion red — confirming the check is load-
  // bearing, not a no-op that happens to agree with the current implementation.
  assert.notEqual(sandboxControl(a), 'argv',
    'grok\'s read-only argv still carries `--permission-mode bypassPermissions` (an unconditional-access ' +
    'flag) — reporting \'argv\' here would falsely imply hopper can force a real read-only downgrade for grok, ' +
    'exactly the misclassification this same-day follow-up fixed.');
  assert.equal(sandboxControl(a), 'full',
    'grok grants unconditional access regardless of the requested sandbox (same bucket as codex): argv ' +
    'differs by mode on paper (--always-approve toggles) but the read-only form never restricts anything.');
});

test('T-b: sandboxControl(codex) is platform-split (2026-07-31) — full on Windows, argv on macOS/Linux', () => {
  assert.equal(sandboxControl(getAdapter('codex'), { platform: 'win32' }), 'full');
  assert.equal(sandboxControl(getAdapter('codex'), { platform: 'darwin' }), 'argv');
  assert.equal(sandboxControl(getAdapter('codex'), { platform: 'linux' }), 'argv');
});

test('T-c: sandboxControl reports argv for an adapter that genuinely downgrades (positive control)', () => {
  // A fake adapter whose read-only argv differs from full-access AND carries no
  // unconditional-access flag/permission-mode. This is the most important guard in
  // this trio: it proves the grok fix targets the SPECIFIC "argv differs but the
  // read-only form still pins unconditional access" case, rather than degenerating
  // sandboxControl() into "everything is full" (which would silently defeat the
  // whole point of the function — no vendor could ever be reported as argv-
  // downgradable again). Destructive counter-check performed by hand: making
  // argvPinsUnconditionalAccess() unconditionally return true turns this red.
  const fakeDowngradableAdapter = {
    args(_input, opts) {
      return opts.sandbox === 'read-only' ? ['--ro-mode'] : ['--full-mode', '--go'];
    },
  };
  assert.equal(sandboxControl(fakeDowngradableAdapter), 'argv',
    'an adapter with a genuinely different, unconditional-access-free read-only argv must still classify as ' +
    '\'argv\' — this is the fix\'s positive control, proving it did not collapse every vendor into \'full\'.');
});

// ── (b) denylist scan over user-facing docs ──────────────────────────────

// NOTE on scope: commands/setup.md and skills/hopper-setup/SKILL.md are
// DELIBERATELY excluded from this scan. Both carry "prefer a vendor whose
// Sandbox=argv so read-only is actually enforced" — a conditional
// vendor-SELECTION recommendation (verified during the 2026-07-29 audit as
// legitimately conditional wording, not an unconditional claim about every
// dispatch), which would collide with denylist entries below if scanned.
//
// UPDATE (2026-07-29, same-day follow-up): the audit also found that the
// `Sandbox=argv` classification itself (cli/src/setup.js's sandboxControl())
// was unreliable for grok — see the T-a/T-b/T-c pins directly above. That WAS a
// CODE classification bug (not a doc-wording issue) and has now been FIXED in
// the same release: grok reports 'full', matching its real (never-restricted)
// behavior. commands/setup.md and skills/hopper-setup/SKILL.md were updated in
// the same change to explain the 'full' value and to note that hopper's two
// built-in reviewer defaults (codex, grok) are both 'full' — so this exclusion
// remains warranted (the wording is still a conditional recommendation, now
// resting on a classifier that is actually correct).
const SETUP_DOC_EXCLUSIONS = new Set(['setup.md']);

function scanTargets() {
  const commandsDir = join(REPO, 'commands');
  const commandFiles = readdirSync(commandsDir)
    .filter((f) => f.endsWith('.md') && !SETUP_DOC_EXCLUSIONS.has(f))
    .map((f) => join('commands', f));
  // DISCOVERY, not a hand-enumerated 'README.md': glob every README*.md at the
  // repo root so a newly-added translation (README.en.md, README.ja.md, a future
  // README.ko.md, ...) is automatically brought into scan range without a second
  // hand-edit here landing this file back in the exact "checklist rots, guard
  // doesn't" trap this project keeps re-discovering (sister project harnessloop
  // made the identical doc_paths -> glob fix for the same reason). Sorted for a
  // deterministic scan order.
  //
  // HONEST LIMITATION (do not upgrade this comment to "all READMEs are covered"):
  // the DENYLIST below is a set of ENGLISH regexes. Globbing README*.md in gives
  // README.en.md genuine coverage (English prose, patterns can actually match),
  // but README.ja.md is effectively NOT covered by this guard — a Japanese-worded
  // restatement of the same false claim will NOT match an English regex; only
  // incidentally-English fragments (code blocks, flag names) inside it could ever
  // trip a pattern. A green run here for README.ja.md means "no English denylist
  // phrase happens to appear", not "the Japanese prose was checked for honesty."
  const readmeFiles = readdirSync(REPO)
    .filter((f) => /^README.*\.md$/.test(f))
    .sort();
  return [...commandFiles, ...readmeFiles];
}

const DENYLIST = [
  {
    pattern: /never edits? the repo/i,
    why: 'unconditional "never edits the repo" claim (was in commands/review.md before the 2026-07-29 fix)',
  },
  {
    pattern: /\bruns read-only\b/i,
    why: 'unconditional "runs read-only" claim about a panelist/vendor (was in commands/swarm.md)',
  },
  {
    pattern: /\(ad-hoc, read-only\)/i,
    why: 'unconditional "(ad-hoc, read-only)" descriptor with no enforcement caveat (was in README.md\'s Core Skills table)',
  },
  {
    pattern: /auto-applies (?:a |an )?\*{0,2}read-only\*{0,2} sandbox/i,
    why: 'unconditional "auto-applies a read-only sandbox" claim (was in commands/review.md) — the task-type only REQUESTS it, it does not enforce it',
  },
];

test('commands/*.md (excl. setup.md) + README*.md: no known-bad unconditional read-only-enforcement phrasing', () => {
  for (const relPath of scanTargets()) {
    const text = readFileSync(join(REPO, relPath), 'utf-8');
    for (const { pattern, why } of DENYLIST) {
      assert.ok(!pattern.test(text),
        `${relPath} matches a denylisted phrase (${pattern}): ${why}. ` +
        'This denylist only catches recurrence of KNOWN-bad phrasings — a differently-worded ' +
        'false claim will not be caught; re-verify by hand if you suspect one.');
    }
  }
});
