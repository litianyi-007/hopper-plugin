// Positioning-doc consistency.
// Anchor: tests/unit/positioning.test.js
//
// The "when to use Hopper" rule is stated ONCE in docs/WHEN-TO-USE.md; every
// decision-point surface points at it rather than restating it. That only holds if
// the pointers keep pointing — a doc renamed or a skill rewritten leaves an agent
// with mechanics and no criterion, which is the state that let source-reading and
// commit-log lookups get dispatched in the first place.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCAFFOLD_TASK_TYPES, buildScaffoldFiles } from '../../cli/src/scaffold.js';
import { READ_ONLY_DEFAULT_TASK_TYPES, WEB_SEARCH_TASK_TYPES } from '../../cli/src/validation.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const DOC = 'docs/WHEN-TO-USE.md';

test('the canonical positioning doc exists', () => {
  assert.ok(existsSync(join(REPO, DOC)), `${DOC} is the single source for this rule`);
});

test('every decision-point surface points at the canonical doc', () => {
  // These are the places an agent reads BEFORE deciding to dispatch. Anything else
  // (result, status, probe...) is downstream of the decision and deliberately silent.
  for (const rel of [
    'skills/hopper/SKILL.md',
    'skills/hopper-dispatch/SKILL.md',
    'commands/dispatch.md',
    'README.md',
    'README.en.md',
    'README.ja.md',
  ]) {
    const body = readFileSync(join(REPO, rel), 'utf-8');
    assert.match(body, /WHEN-TO-USE\.md/, `${rel} must point at ${DOC}`);
  }
});

test('the doc states the accountability principle and both gate questions', () => {
  const doc = readFileSync(join(REPO, DOC), 'utf-8');
  assert.match(doc, /accountable for a result/i, 'the principle itself');
  assert.match(doc, /Could the host compute the one correct answer itself/i, 'gate 1');
  assert.match(doc, /Can the whole question be stated right now/i, 'gate 2');
  // The three tiers must stay three — collapsing "not recommended" into "forbidden"
  // loses the boundary between wasting money and letting an unreviewed process write.
  for (const tier of ['### Recommended', '### Not recommended', '### Forbidden']) {
    assert.ok(doc.includes(tier), `tier heading "${tier}" is missing`);
  }
});

test('the doc keeps the read-only obligation attached to the recommendation', () => {
  // Recommending Hopper for review without this is unsafe advice: on Windows neither
  // codex nor grok actually enforce the read-only sandbox they are dispatched under.
  const doc = readFileSync(join(REPO, DOC), 'utf-8');
  assert.match(doc, /git status/, 'the post-dispatch verification obligation');
  assert.match(doc, /bypassPermissions/, 'names why grok\'s displayed read-only is not enforcement');
});

test('every shipped task-type has a for/not-for note in --task-types', () => {
  // A type with no note is a type whose "should I dispatch this" question is
  // unanswered exactly where it is asked.
  const bin = readFileSync(join(REPO, 'cli', 'bin', 'hopper-dispatch'), 'utf-8');
  const block = bin.slice(bin.indexOf('const TASK_TYPE_NOTES'), bin.indexOf('function findHopperDir'));
  for (const t of SCAFFOLD_TASK_TYPES) {
    assert.ok(block.includes(`'${t}':`), `task-type '${t}' has no --task-types note`);
  }
});

test('read-only and web-search registries agree with the shipped task-types', () => {
  // A type absent from READ_ONLY_DEFAULT_TASK_TYPES silently dispatches at
  // danger-full-access and is refused by --swarm — both silent, both wrong.
  for (const t of ['decision-review', 'tech-research']) {
    assert.ok(SCAFFOLD_TASK_TYPES.includes(t), `${t} is shipped`);
    assert.ok(READ_ONLY_DEFAULT_TASK_TYPES.includes(t), `${t} must default to a read-only sandbox`);
  }
  assert.ok(WEB_SEARCH_TASK_TYPES.includes('tech-research'), 'tech-research surveys the option space — it needs the web');
  assert.ok(!WEB_SEARCH_TASK_TYPES.includes('decision-review'),
    'decision-review rules on context the host supplied; auto-enabling search would invite it to go re-survey instead');

  // Every read-only default must actually be a shipped type, or the list is stale.
  for (const t of READ_ONLY_DEFAULT_TASK_TYPES) {
    assert.ok(SCAFFOLD_TASK_TYPES.includes(t), `READ_ONLY_DEFAULT_TASK_TYPES names '${t}', which is not shipped`);
  }
});

test('the scaffold ships a frame for every shipped task-type', () => {
  // A type without a frame is in the registry but not dispatchable.
  const files = buildScaffoldFiles().map((f) => f.rel.split('\\').join('/'));
  for (const t of SCAFFOLD_TASK_TYPES) {
    assert.ok(files.includes(`tasks/${t}.md`), `no scaffold frame for '${t}'`);
  }
});

test('the scaffolded AGENTS.md carries the positioning and a row per task-type', () => {
  const agents = buildScaffoldFiles().find((f) => f.rel === 'AGENTS.md').content;
  assert.match(agents, /WHEN-TO-USE\.md/, 'new projects inherit the pointer');
  assert.match(agents, /judgment you cannot trust yourself to make/i, 'and the criterion itself');
  for (const t of SCAFFOLD_TASK_TYPES) {
    assert.ok(agents.includes(`\`${t}\``), `AGENTS.md task-type table has no row for '${t}'`);
  }
});

test('the archive exists and the root is no longer littered with ISSUE files', () => {
  const archive = join(REPO, 'docs', 'archive', 'ISSUES.md');
  assert.ok(existsSync(archive), 'consolidated issue archive');
  const body = readFileSync(archive, 'utf-8');
  assert.match(body, /## Status index/, 'the index is what makes open issues MORE visible than 18 loose files');
  assert.match(body, /### Open/, 'open issues are surfaced, not buried');

  // The root should hold only the documents a first-time reader needs.
  const stray = readdirSync(REPO).filter((f) => /^ISSUE-.*\.md$/.test(f));
  assert.deepEqual(stray, [], 'issue records live in docs/archive/ISSUES.md now');
});
