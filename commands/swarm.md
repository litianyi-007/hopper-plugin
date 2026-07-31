---
description: Multi-vendor swarm — fan a qualitative (review/research/market) task out to a PANEL of vendors in parallel, confirm the panel + config first, then synthesize the perspectives.
allowed-tools: Bash, Read
argument-hint: <target-or-question> [--type review|research|market] [--vendors v1,v2,v3]
---

Get N independent vendor perspectives on the SAME qualitative task (a review, research, or audit), in parallel, then synthesize a merged verdict. **Read-only/qualitative only** — never for implementation (N vendors editing the same files would conflict; `--swarm` refuses non-qualitative task-types).

**Caveat on "read-only":** the task-type only *requests* a read-only sandbox — an instruction carried by the executor prompt frame; enforcement depends on the vendor and, for codex, the platform. **grok** always runs with `--permission-mode bypassPermissions` regardless of the requested mode; **codex** now honors the request on macOS/Linux via its own `-s read-only` sandbox, but still always runs full-access on **Windows** (`--dangerously-bypass-approvals-and-sandbox`, a deliberate workaround) — both are common panelists below. For a genuinely locked-down panelist, use `--subject-root` (macOS, opt-in — see its documented limits in `.hopper/DISPATCH.md`) or pick a vendor whose sandbox is truly argv-enforceable on your platform.

## What this does
1. Pick the task-type + propose a panel of vendors.
2. **Confirmation gate**: present the proposed panel + per-vendor config and WAIT for the user to confirm or adjust.
3. Fan out via `hopper-dispatch --swarm` (or N `--adhoc` for per-vendor config) — each panelist is its own background dispatch under a **requested** read-only sandbox (see the caveat above).
4. Collect every panelist's FULL result and synthesize.

## Steps

### 1. Parse + choose task-type
Parse `$ARGUMENTS`: the leading text is the TARGET/QUESTION. `--type` selects the task-type: `review` → `code-review-acceptance` (or `code-review-adversarial`), `research` → `prd-research`, `market` → `market-research`. Default: infer (a diff/PR → review; a product question → research; a market question → market).

### 2. CONFIRMATION GATE — required, do NOT skip
First run `hopper-dispatch --setup` to see vendor readiness. Then propose a panel and surface it to the user, and STOP for confirmation:
- **Vendors** (default 3, distinct model families): for a review, propose vendors that can read code and produce a verdict, e.g. `codex, grok, claude` (none of these three actually enforce read-only — see the caveat above). For research/market, propose only vendors with `--setup` WebSrch=yes, e.g. `codex, claude, grok`. Only propose vendors showing Installed=yes + Auth=ok (and WebSrch=yes for research/market).
- **Per-vendor config**: note each panelist uses its account-default model and runs under a **requested** read-only sandbox (not enforced for every vendor — see the caveat above); offer to set a model/reasoning per vendor.
Ask the user: "Run the panel with these N vendors + this config? (adjust vendors or per-vendor model/reasoning if you like)". Proceed only once they confirm.

### 3. Launch (after confirmation)
Resolve the binary as in `/hopper:dispatch`. Pick a short `--id-base`, e.g. `swarm-<8-char-slug>`.

- **Shared config** (each vendor's default model) — one command:
```bash
node "$HOPPER_BIN" --swarm --task-type <type> --brief "<composed brief>" --vendors codex,grok,claude --id-base "<base>"
```
It prints `SWARM_IDS: <id1> <id2> <id3>`. (research/market: the task-type auto-enables web search + *requests* read-only — see the caveat above.)

- **Per-vendor config** (different model/reasoning per vendor) — run N background `--adhoc` calls instead, one per vendor with its own `--vendor`/`--model`/`--reasoning` and a distinct `--id` (use the Bash tool with `run_in_background: true` for each):
```bash
node "$HOPPER_BIN" --adhoc --task-type <type> --brief "<brief>" --id "<base>-codex" --vendor codex --model gpt-5.5 --background
node "$HOPPER_BIN" --adhoc --task-type <type> --brief "<brief>" --id "<base>-grok"  --vendor grok  --background
```

### 4. Collect + synthesize
Poll the panelist ids (not faster than ~10s). When each is done, collect the FULL result:
```bash
node "$HOPPER_BIN" --result "<id>" --full
```
Then synthesize: show each panelist's verdict, then a MERGED conclusion — where they AGREE (high confidence), where they DISAGREE (flag for the user), and the strongest unique point from each. Attribute findings to their vendor.

## MUST NOT
- Do NOT swarm a write/implementation task-type (read-only/qualitative only).
- Do NOT skip the confirmation gate.
- Do NOT re-dispatch a failed panelist (single-spawn per panelist); report it and synthesize from the rest.
- Do NOT edit the repo or `queue.md`.
