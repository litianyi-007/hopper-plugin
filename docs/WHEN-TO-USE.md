# When to use Hopper — and when not to

> Canonical positioning. The skills and commands point here rather than restating it,
> so there is one place to change when this changes.

**Hopper is accountable for a result. It is not a place to run a process you need to
steer.**

Everything below follows from that one sentence, and it is not a philosophy — it is a
description of the architecture. One adapter call is one subprocess spawn, with no
retry, no fallback, and no reroute (spec §3 #4). The vendor runs in a separate process
with none of your context. You cannot redirect it mid-flight; a follow-up is a *new
dispatch*. Fixed cost per dispatch is high; marginal cost of steering is infinite.

---

## The two questions

Ask both before dispatching. Either one failing means do it in-host.

### 1. Could the host compute the one correct answer itself?

If yes — **do not dispatch**. That is a determinate query, and routing it through a
separate model costs minutes and dollars to obtain a *less* reliable answer.

`git log --oneline -20` returns in 40ms and has exactly one right answer. A measured
review dispatch on the same machine took **5m16s, 16 model calls, 1.53M tokens and
$0.74**. Those are not two points on a spectrum; they are different kinds of operation.

### 2. Can the whole question be stated right now?

If no — **do not dispatch**. This is the operational form of "not accountable for the
process": if you cannot write the brief without first knowing what the vendor will
find, the work is exploratory, and exploration needs the steering Hopper does not
offer.

Only when both pass, ask the question that decides it: **is independence the point?**
If the value comes from an answer that does *not* share your context, priors, or
mistakes — dispatch. If not, doing it yourself is faster and cheaper.

---

## Method vs deliverable

The discriminator is not the topic. It is what is being handed back.

A code review **must** read source — that is the method. Its deliverable is a judgment.
Dispatch it.

"Summarize what this module does" also reads source, but the deliverable is data the
host can produce directly. Do not dispatch it.

| Ask | Deliverable | Verdict |
|---|---|---|
| "Review this diff adversarially" | judgment | dispatch |
| "Read `auth/` and tell me what it does" | data | in-host |
| "We're split between A and B — rule on it" | judgment | dispatch |
| "List the commits since v1.2" | data | in-host |
| "Given this commit history, is our release cadence a risk?" | judgment | dispatch (rarely worth it) |
| "Which version of X is in the lockfile?" | data | in-host |

---

## Three tiers

### Recommended

Work whose deliverable is a judgment you cannot trust yourself to make.

| Task-type | For |
|---|---|
| `decision-review` | You are genuinely torn on a fork. Supply the options, the constraints and what you already ruled out; get an independent ruling. |
| `code-review-adversarial` | Hunt for defects the author would miss. |
| `code-review-acceptance` | Verify a change against stated acceptance criteria. |
| `spec-blindspot-hunt` | Surface unknown-unknowns in a plan before implementation. |
| `prd-research` | What should we build — needs, prior art, comparable products. |
| `tech-research` | How should we build it — compare candidate libraries, patterns, architectures. |
| `market-research` | Market / competitor / trend brief. |

For `decision-review` the answering vendor **must be heterogeneous to the host**. A
ruling from the same model family is not an independent ruling; it is your own reasoning
with extra latency.

### Not recommended

Source summaries, commit-log queries, file searches, version lookups — anything with one
determinate answer the host can compute in seconds.

**There is no task-type for these, and that is the enforcement.** The registry *is* the
policy surface. Nothing needs to guess at your brief's intent, because there is no
`source-read` type to dispatch to. Adding one would be the mistake, not a feature.

### Forbidden

Every write-capable action: code and document writes, test execution, builds, commits,
deploys, restarts, external triggers. Route these to the `native-only` sentinel, which
fails closed.

This tier is separate from "not recommended" on purpose. Merging them loses a safety
boundary: one is a waste of money, the other is an unreviewed process writing to your
repository.

---

## Two obligations that ride along with "recommended"

**Read-only is not always enforced.** The task-type requests a read-only sandbox, but
whether it is *enforced* depends on the vendor and the platform. On Windows, codex runs
full-access by design (its `-s` sandbox cannot spawn child processes there) and reports
that honestly; grok runs `--permission-mode bypassPermissions` on every platform while
*displaying* `read-only`. So: **after any read-only dispatch to codex or grok, check
`git status`.** `hopper-dispatch --setup` shows the real per-vendor Sandbox column.

`pi` sits in between and is worth understanding rather than trusting: a read-only request
really does change its argv (`--tools read,grep,find,ls`), which removes `bash`, `edit`
and `write` from the model's toolset — a model cannot call a tool it was not given. But pi
ships **no sandbox of its own**, so this is a capability restriction inside pi, not an OS
boundary. On macOS, `--subject-root` adds the kernel-enforced half.

**Batch, don't fan out.** N sub-questions should be ONE brief, not N dispatches. Each
dispatch pays full fixed cost and shares no context with the others, so fanning out is
N× the price for a *worse* answer. (`--swarm` is the deliberate exception: N vendors on
the *same* question, which is the point — most valuable on `decision-review`.)

---

## Why the architecture forces this

- **Single spawn, no retry.** Built for "hand over a well-specified question, get back a
  verdict", not for iteration.
- **No shared context.** The vendor re-derives from scratch what the host already knows.
  For a review that is the *feature* — independence is the product. For a data lookup it
  is pure waste.
- **The output channel is verdict-shaped.** `output.md` carries parser-designated answer
  text under a preview cap, with the raw log kept as protected diagnostics. Measured
  case: a vendor emitted 5.8MB to stdout, so the 8000-character preview was 100% dump
  and the actual conclusion was pushed out of view. Using a verdict channel to move data
  fights the design and loses.

---

## Related

- `docs/cookbook.md` — worked dispatch examples
- `MIGRATION.md` — upgrading an existing `.hopper/`
- `hopper-dispatch --task-types` — what this project can dispatch, with the same
  for/not-for note per type
