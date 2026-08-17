// Shared types for hopper-plugin CLI (T-PLUGIN-04.5 vendor adapter contract)
// Anchor: cli/src/types.js
//
// JSDoc-only types — keeps the plugin dependency-free (no TypeScript build step).
// Type safety enforced by JSDoc tools / IDE; runtime is plain ES modules.
//
// Per spec v2.0.3 §3 #4 (no harness reaction core): these types describe
// SINGLE-ATTEMPT dispatch. No retry types, no fallback chains, no circuit
// breaker state.

/**
 * Task row parsed from .hopper/queue.md (v2 schema with Task-type column).
 * @typedef {object} TaskRow
 * @property {string} id              Task ID (e.g. "T-PLUGIN-02")
 * @property {string} taskType        Task-type (e.g. "code-impl") — matches a frame in .hopper/tasks/
 * @property {'pending'|'in-progress'|'done'|'failed'|'removed'} status
 * @property {string[]} depends       Array of task IDs this depends on
 * @property {'high'|'normal'|'low'} priority  Default 'normal' if absent
 * @property {string} brief           Free-text task summary
 * @property {string|null} vendor     Optional per-row vendor override (null = use default lookup)
 * @property {string|null} [govern]   Optional per-row governance override: 'off' disables the governance preamble for this task (null = use .hopper/GOVERNANCE.md default)
 */

/**
 * Agent binding from .hopper/AGENTS.md.
 * @typedef {object} AgentBinding
 * @property {string} nickname        e.g. "codex-builder"
 * @property {string} uuid            Stable across model swaps
 * @property {string} vendor          CLI command name (e.g. "codex", "kimi", "opencode", "mimo")
 * @property {string[]} taskTypePref  Task-types this binding prefers (e.g. ["code-impl", "spec-write"])
 */

/**
 * Resolved task: queue row + frame content + chosen vendor adapter.
 * @typedef {object} ResolvedTask
 * @property {TaskRow} task
 * @property {string} frame           Content of .hopper/tasks/<task-type>.md
 * @property {VendorAdapter} adapter
 */

/**
 * Adapter invocation options.
 * @typedef {object} AdapterOpts
 * @property {'read-only'|'workspace-write'|'danger-full-access'} [sandbox]  Vendor permission mode. Dispatcher defaults to danger-full-access unless task text explicitly says read-only.
 * @property {string} [reasoning]     Reasoning effort hint (codex honors the enum directly; mimo maps it to --variant; OpenCode forwards only an explicit caller value as a provider-specific --variant; other adapters may ignore or use config/vendor-specific knobs)
 * @property {'user-argv'|'policy'|'default'} [reasoningSource] Provenance of the effective reasoning value. Set by resolveAdapterOptsForTask so adapters can distinguish an explicit CLI selection from AGENTS/default fallback.
 * @property {string} [model]         Optional model override
 * @property {string|null} [requestedSelector] Original user `--model` value for audit only; set by the dispatcher and never used for runtime comparison
 * @property {string|null} [effectiveSelector] Policy-resolved selector actually passed to the adapter; null means vendor default
 * @property {'user-argv'|'policy'|'vendor-default'} [effectiveSelectorSource] Provenance of effectiveSelector
 * @property {boolean} [webSearch]    Optional web search enable
 * @property {string} [conversationId] Optional session resume ID
 * @property {string} [logFile]       Adapter log file path (set by runner before adapter.args() so adapter can thread it through)
 * @property {string} [taskType]      Phase 6c F1: task-type for timeoutMs() floor calculation (e.g. 'code-review-adversarial')
 * @property {boolean} [background]   Set true by runner for background-mode dispatches
 * @property {string} [subjectRoot]   Absolute tree denied file-write* by the macOS process guard; legal only with effective read-only sandbox
 */

/**
 * Result of `envPreflight()` — adapter declaring whether the user environment is ready.
 * @typedef {object} PreflightResult
 * @property {boolean} ok
 * @property {string[]} missing       Human-readable list of what's missing (e.g. ["Run `codex login`"])
 * @property {'key-present-unverified'|'credential-artifact-present-unverified'|'not-detected'|'unknown'} [authContext] Optional local, non-secret credential-context observation. Presence never verifies remote authentication.
 */

/**
 * Result of a subprocess invocation. Returned by runSubprocessOnce.
 * @typedef {object} SubprocessResult
 * @property {number} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut       True if process was killed for exceeding timeoutMs
 * @property {'idle'|'ceiling'|null} timeoutReason  First timeout source; null when no timeout fired
 * @property {{status: string, method: string|null}} processCleanup  First timeout cleanup result, or not-needed
 * @property {number} durationMs
 * @property {string} [logFileContent] Optional content of a --log-file if adapter requested one
 */

/**
 * Structured output after subprocess runs and adapter parses raw output.
 * @typedef {object} ModelAttestation
 * @property {string[]} observedModels Stable, vendor-reported actual model identifiers for this result only
 * @property {string} source Closed adapter metadata source for observedModels
 * @property {string} observedAt ISO-8601 observation time
 */

/**
 * Pi CLI session-effective reasoning observation. This is intentionally NOT a
 * provider terminal attestation: Pi emits it from `thinking_level_changed`
 * after applying its model-capability clamp to the local agent session.
 * @typedef {object} SessionEffectiveReasoning
 * @property {'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max'} level Pi session-effective level
 * @property {'pi-cli-session-effective'} source Fixed Pi CLI/session provenance
 * @property {string} observedAt ISO-8601 adapter observation time
 */

/**
 * Sanitized versioned selector metadata used for zero-spawn classification.
 * @typedef {object} SelectorMetadataEnvelope
 * @property {number} schema_version Currently 1
 * @property {string} vendor Exact adapter vendor binding
 * @property {object[]} selectors Exact-literal alias or concrete records only; never an auto record
 */

/**
 * Structured output after subprocess runs and adapter parses raw output.
 * @typedef {object} OutputEvidence
 * @property {'verified-complete'|'unknown-completeness'|'no-text'} completeness
 * @property {'structured-envelope'|'event-stream'|'vendor-result-field'|'none'} source
 * @property {'opencode-step-finish'|'opencode-message-completed'|'opencode-result-success'|'claude-result-success'|'grok-end-turn'|'pi-agent-settled'|'none'} terminalMarker
 */

/**
 * Structured output after subprocess runs and adapter parses raw output.
 * @typedef {object} TaskOutput
 * @property {string} text            Primary response text
 * @property {object} [usage]         Optional token usage info (vendor-specific shape)
 * @property {string} [error]         Set if adapter detected failure (e.g. silent auth-fail)
 * @property {'success'|'auth-fail'|'timeout'|'permission-fail'|'unknown-fail'} status
 * @property {OutputEvidence} [outputEvidence] Optional closed parser provenance for text
 * @property {ModelAttestation} [modelAttestation] Optional structured runtime evidence; absent means no runtime proof
 * @property {SessionEffectiveReasoning} [sessionEffectiveReasoning] Optional Pi CLI session observation. It is not provider-produced terminal effort evidence and must not be used as such.
 * @property {string} [sessionId] Optional vendor-reported session identifier for resume, when the
 *   vendor emits one in its own output (pi does, in its `session` stream header). Persisted to the
 *   background handoff's `vendor_session_id` so a long dispatch can be resumed instead of re-run.
 *   VENDOR-CONTROLLED TEXT: the writer sanitizes it against a strict charset before it reaches
 *   frontmatter (see parsedVendorSessionId in cli/src/handoff-attestation.js). Adapters SHOULD
 *   attach it to failures too — a ceiling timeout is precisely when resuming is worth the most.
 */

/**
 * VendorAdapter contract — per spec v2.0.3 §3 #4 + T-PLUGIN-04.5.
 *
 * IMPORTANT: this contract is intentionally MINIMAL. Adapters do NOT implement
 * retry, fallback, circuit breaker, consensus, or any orchestration logic.
 * One adapter call = one subprocess attempt = success OR specific failure.
 *
 * @typedef {object} VendorAdapter
 * @property {string} name                                    Vendor name (e.g. "codex", "kimi", "agy", "mimo")
 * @property {string} command                                 CLI command to spawn
 * @property {function(string, AdapterOpts): string[]} args   Build CLI args from input + opts
 * @property {function(): PreflightResult} envPreflight       Check auth / env readiness
 * @property {function(AdapterOpts): number} timeoutMs        Hard timeout in milliseconds (Phase 6c: opts.taskType may elevate via applyTaskTypeFloor)
 * @property {function(SubprocessResult): TaskOutput} parseResult  Parse subprocess output to structured form
 * @property {string} [stdinMode]                             'none' (args carry input) | 'pipe' (input piped to stdin)
 * @property {function(AdapterOpts): Record<string,string>} [env]  Optional extra env vars merged over process.env for the vendor spawn (e.g. codex CODEX_HOME auto-isolation). Threaded by dispatch.js + hopper-runner.
 * @property {function(string, string): {logPath: string|null}} [prepareLog]  Optional per-dispatch log file setup
 * @property {string[]} [knownInstallPaths]                   Phase 6c F2: deterministic vendor-installer locations (NOT vendor-retry orchestration). Walked by resolveCommandWithKnownPaths when PATH lookup fails. Each entry must be an absolute path to the binary (e.g. ~/AppData/Local/agy/bin/agy.exe; expand via os.homedir() before declaring).
 * @property {SelectorMetadataEnvelope} [selectorMetadata]   Optional sanitized, versioned local selector metadata; classification remains zero-spawn.
 * @property {object} [runtimeModelMetadata]                  Closed, versioned terminal-result paths/fields that may produce runtime model evidence.
 */

// Re-export marker (no actual exports — JSDoc only)
export const TYPES_VERSION = '0.2.0-phase-6c';
