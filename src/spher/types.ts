export type GateStatus = "gate_allowed" | "gate_denied" | "unknown";

export interface DataphyEnvelope {
  anchor_sha256: string;
  config_hash: string;
  features_fixed: number[];
}

export interface SpherState {
  ok: boolean;
  status?: string;
  spher_mode?: boolean;
  strict_mutation_proof?: boolean;
  llm_read_only?: boolean;
  [k: string]: unknown;
}

export interface ComputeEvent {
  event_id?: number;
  ts?: string;
  trace_id?: string;
  action?: string;
  status?: string;
  gate_status?: GateStatus | string;
  decision?: string;
  proof_root?: string;
  root_hash?: string;
  worm_ref?: string;
  payload?: unknown;
  [k: string]: unknown;
}

export interface EventsResponse {
  page: number;
  per_page: number;
  total: number;
  items: ComputeEvent[];
}

export interface GovernedActionResult {
  ok: boolean;
  mode: "read_only" | "mutating";
  blocked?: string;
  detail?: string;
  response?: unknown;
  dataphy_envelope?: DataphyEnvelope;
}

