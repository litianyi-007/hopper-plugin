---
description: Plugin host-lifecycle smoke test. Prints hopper-dispatch readiness banner. Verifies T-PLUGIN-00 Prong 1.
allowed-tools: Bash
---

This command runs inside a Claude Code session. It accepts no arguments.

Run the dispatcher's standalone smoke test:

```bash
node "$CLAUDE_PLUGIN_ROOT/cli/bin/hopper-dispatch" --smoke
```

Expected output starts with `hopper standalone (CLI v0.36.0)` (or current version). If the binary runs and exits 0, the Claude Code plugin host adapter is functional (Tier B verified).

If the binary is not found, surface the exact error and offer specific debugging steps:
- `$CLAUDE_PLUGIN_ROOT` is not set or points to wrong directory → plugin install issue
- `node: command not found` → user needs Node 18+ on PATH
- Anything else → file in `.hopper/HOPPER-FEEDBACK.md` so the install README can be corrected

This command is the verifier for T-PLUGIN-00 Prong 1 (Claude Code plugin install gate). Reports PASS if the smoke banner prints; otherwise reports the specific failure mode without retrying.
