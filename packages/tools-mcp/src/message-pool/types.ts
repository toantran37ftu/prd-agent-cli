/**
 * Message Pool types — v4 (§4.1)
 *
 * Envelope is code-assigned, content is LLM-generated.
 * Messages stored at: .prdcli/messages/<project>/<type>__<target>__<msg_id>.json
 * Never overwrite — new versions use supersedes.
 */

export type MessageType =
  | "doc_summary"
  | "review_result"
  | "question_list"
  | "prd_brief"
  | "draft_prd"
  | "critic_feedback"
  | "change_request"
  | "change_set"
  | "lint_report";

export type ProducedBy =
  | "summarizer"
  | "reviewer"
  | "verifier"
  | "question-gen"
  | "brief-writer"
  | "writer"
  | "critic"
  | "change-planner"
  | "lint";

/** Code-assigned based_on entry for dependency tracking (§4.7) */
export interface BasedOnEntry {
  node_id: string;
  hash: string;
}

/** Envelope: 100% code-assigned. LLM never sees these fields. */
export interface MessageEnvelope {
  id: string;
  type: MessageType;
  project: string;
  target_doc_node_id: string | null;
  produced_by: ProducedBy;
  runtime: { channel: string; model: string };
  based_on: BasedOnEntry[];
  created_at: string;
  supersedes: string | null;
  run_id: string;
  schema_version: number;
}

/** Full message = envelope + LLM-generated payload */
export interface PoolMessage extends MessageEnvelope {
  content: string;            // human-readable
  instruct_content: unknown;  // machine-readable, validated by type-specific schema
}

export interface PoolQuery {
  type?: MessageType;
  target_doc_node_id?: string;
  project: string;
  /** Only return messages where ALL based_on[] hashes match current (not stale) */
  freshOnly?: boolean;
  /** Current node hashes for freshness check */
  currentHashes?: Record<string, string>;
  /** Filter by schema_version */
  schema_version?: number;
}

/**
 * Role Card — declared in each agent prompt (§3.5.4 / §6).
 */
export interface RoleCard {
  profile: string;
  goal: string;
  constraints: string[];
  watch: MessageType[];
  publish: MessageType | null;
  stateless: boolean;
}
