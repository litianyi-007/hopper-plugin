export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'failed' | 'removed';

export interface Task {
  id: string;
  taskType: string;
  status: TaskStatus;
  depends: string[];
  priority: 'high' | 'normal' | 'low';
  brief: string;
  vendor: string | null;
}

export interface TaskDetail {
  id: string;
  status: TaskDetailStatus;
  terminal: boolean;
  selector: {
    requested: string | null;
    effective: string | null;
    kind: 'alias' | 'concrete' | 'auto' | 'unknown';
    source: 'user-argv' | 'policy' | 'vendor-default';
  };
  observedModels: string[];
  resolution: {
    status: 'exact' | 'mismatch' | 'alias-resolved' | 'config-only' | 'unverified';
    detail: string | null;
  };
  inventory: {
    binaryAvailability: VendorBinaryAvailability;
    binaryBasename: VendorBinaryBasename;
    sourceKind: VendorSourceKind;
    sourceLabel: VendorSourceLabel;
    diagnosticCode: VendorDiagnosticCode;
    diagnosticState: VendorDiagnosticState;
  };
  events: ProgressEvent[];
}

export type TaskDetailStatus = TaskStatus | 'cancelled' | 'orphaned' | 'timeout' | 'partial' | 'finalizing' | 'unknown';

export type ProgressEvent = {
  seq: number;
  phase: string;
  kind: string;
  terminal: boolean;
  status: string;
  adapterDiagnosticCode: string;
};

export interface TaskProgressResponse {
  id: string;
  events: ProgressEvent[];
}

export type VendorBinaryAvailability = 'present' | 'missing' | 'unknown';
export type VendorBinaryBasename = 'agy' | 'claude' | 'codex' | 'copilot' | 'grok' | 'kimi' | 'mimo' | 'opencode' | 'pi' | 'unknown' | null;
export type VendorSourceKind = 'static' | 'unavailable' | 'adapter-aliases' | 'cli-catalog' | 'config' | 'unknown';
export type VendorSourceLabel = 'adapter-static-selectors' | 'unavailable' | 'claude-selector-metadata' | 'opencode-cli-catalog' | 'pi-cli-catalog' | 'kimi-configured-aliases' | 'unknown';
export type VendorDiagnosticCode =
  | 'none'
  | 'metadata-envelope-malformed'
  | 'selector-metadata-cache-schema-unsupported'
  | 'selector-metadata-cache-adapter-mismatch'
  | 'selector-metadata-cache-expired'
  | 'selector-metadata-cache-missing'
  | 'runtime-model-metadata-malformed'
  | 'runtime-model-metadata-conflict'
  | 'runtime-model-metadata-absent'
  | 'inventory-cache-version-unsupported'
  | 'inventory-cache-malformed'
  | 'inventory-cache-recovery-backup-create-failed'
  | 'inventory-cache-recovery-replace-failed'
  | 'inventory-cache-recovery-durability-unknown'
  | 'capability-failed'
  | 'probe-failed'
  | 'catalog-unavailable'
  | 'unknown';
export type VendorDiagnosticState = 'none' | 'unavailable' | 'degraded' | 'unknown';

export interface Vendor {
  name: string;
  cachedAt: string | null;
  cachedModels: string[];
  reasoningLevels: string[];
  binaryAvailability: VendorBinaryAvailability;
  binaryBasename: VendorBinaryBasename;
  sourceKind: VendorSourceKind;
  sourceLabel: VendorSourceLabel;
  diagnosticCode: VendorDiagnosticCode;
  diagnosticState: VendorDiagnosticState;
  notes: [];
  cacheError: null;
  modelsSource: null;
  binaryPath: null;
}

export interface VendorsResponse {
  vendors: Vendor[];
  generatedAt: string;
  inventoryContractVersion?: number | null;
}

const VISIBLE_BINARY_AVAILABILITY = new Set(['present', 'missing']);
const VISIBLE_BINARY_BASENAMES = new Set(['agy', 'claude', 'codex', 'copilot', 'grok', 'kimi', 'mimo', 'opencode', 'pi']);
const VISIBLE_SOURCE_KINDS = new Set(['static', 'unavailable', 'adapter-aliases', 'cli-catalog', 'config']);
const VISIBLE_SOURCE_LABELS = new Set([
  'adapter-static-selectors', 'unavailable', 'claude-selector-metadata', 'opencode-cli-catalog',
  'pi-cli-catalog', 'kimi-configured-aliases',
]);
const VISIBLE_DIAGNOSTIC_CODES = new Set([
  'none', 'metadata-envelope-malformed', 'selector-metadata-cache-schema-unsupported',
  'selector-metadata-cache-adapter-mismatch', 'selector-metadata-cache-expired', 'selector-metadata-cache-missing',
  'runtime-model-metadata-malformed', 'runtime-model-metadata-conflict', 'runtime-model-metadata-absent',
  'inventory-cache-version-unsupported', 'inventory-cache-malformed', 'inventory-cache-recovery-backup-create-failed',
  'inventory-cache-recovery-replace-failed', 'inventory-cache-recovery-durability-unknown', 'capability-failed',
  'probe-failed', 'catalog-unavailable',
]);
const VISIBLE_DIAGNOSTIC_STATES = new Set(['none', 'unavailable', 'degraded']);

function visibleValue(value: unknown, allowed: Set<string>) {
  return typeof value === 'string' && allowed.has(value) ? value : 'unavailable';
}

/**
 * Old, missing, or future inventory contracts must render as unavailable.
 * This helper intentionally accepts untyped JSON and never reads legacy shims.
 */
export function normalizeVendorDisplay(vendor: Partial<Vendor> | null | undefined) {
  const binaryAvailability = visibleValue(vendor?.binaryAvailability, VISIBLE_BINARY_AVAILABILITY);
  const binaryBasename = visibleValue(vendor?.binaryBasename, VISIBLE_BINARY_BASENAMES);
  const sourceKind = visibleValue(vendor?.sourceKind, VISIBLE_SOURCE_KINDS);
  const sourceLabel = visibleValue(vendor?.sourceLabel, VISIBLE_SOURCE_LABELS);
  const diagnosticCode = visibleValue(vendor?.diagnosticCode, VISIBLE_DIAGNOSTIC_CODES);
  const diagnosticState = visibleValue(vendor?.diagnosticState, VISIBLE_DIAGNOSTIC_STATES);
  return {
    binary: binaryAvailability === 'unavailable' ? 'unavailable' : `${binaryAvailability} (${binaryBasename})`,
    diagnostic: diagnosticCode === 'unavailable' || diagnosticState === 'unavailable' ? 'unavailable' : diagnosticCode,
    source: sourceKind === 'unavailable' || sourceLabel === 'unavailable' ? 'unavailable' : sourceLabel,
  };
}

export interface ProbeResponse {
  vendor: string;
  status: 'done' | 'failed';
  diagnosticCode: VendorDiagnosticCode;
  diagnosticState: VendorDiagnosticState;
}

export interface CostRow {
  date: string;
  task: string;
  role: string;
  model: string;
  vendor: string;
  tokensIn: number;
  tokensOut: number;
  approxUsd: number;
  tier: string;
  notes: string;
}

export interface CostTotals {
  rows: number;
  tokensIn: number;
  tokensOut: number;
  approxUsd: number;
}

export interface CostByVendor {
  vendor: string;
  tokensIn: number;
  tokensOut: number;
  approxUsd: number;
  count: number;
}

export interface CostResponse {
  rows: CostRow[];
  totals: CostTotals;
  byVendor: CostByVendor[];
}
