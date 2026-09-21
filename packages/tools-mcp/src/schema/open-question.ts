/**
 * Open Question schema — §4.9
 * Agent CANNOT fill owner/due — code enforces "unassigned".
 */
import { z } from "zod";

export const OpenQuestion = z.object({
  id: z.string(),
  question: z.string(),
  owner: z.string().default("unassigned"),      // agent CẤM tự điền
  due: z.string().default("unassigned"),        // agent CẤM tự điền
  options: z.array(z.string()).default([]),     // chỉ điền nếu có trong nguồn
  impact: z.string().nullable(),
  status: z.enum(["open", "answered", "deferred", "obsolete"]).default("open"),
  source_claim_id: z.string().nullable(),
  source_node_ids: z.array(z.string()),
  created_at: z.string(),                        // code gán
});

export type OpenQuestion = z.infer<typeof OpenQuestion>;

/**
 * Enforce owner/due = "unassigned" regardless of what LLM returns.
 * Also validates that options only come from source docs.
 */
export function enforceOpenQuestion(oq: OpenQuestion): OpenQuestion {
  return {
    ...oq,
    owner: "unassigned",
    due: "unassigned",
    created_at: oq.created_at || new Date().toISOString(),
  };
}

/**
 * Normalize a raw LLM output into a valid OpenQuestion.
 * Strips any owner/due the model might have filled.
 */
export function normalizeOpenQuestion(raw: Record<string, unknown>): OpenQuestion {
  return enforceOpenQuestion({
    id: (raw.id as string) || `oq_${Date.now()}`,
    question: (raw.question as string) || "",
    owner: "unassigned",
    due: "unassigned",
    options: Array.isArray(raw.options) ? (raw.options as string[]) : [],
    impact: (raw.impact as string) ?? null,
    status: (raw.status as OpenQuestion["status"]) || "open",
    source_claim_id: (raw.source_claim_id as string) ?? null,
    source_node_ids: Array.isArray(raw.source_node_ids)
      ? (raw.source_node_ids as string[])
      : [],
    created_at: new Date().toISOString(),
  });
}
