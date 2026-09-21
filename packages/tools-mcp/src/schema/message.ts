/**
 * Message schema — §4.1
 * Envelope (100% code-assigned) + content (LLM-generated).
 * LLM NEVER sees or fills envelope fields.
 */
import { z } from "zod";

export const MessageType = z.enum([
  "doc_summary",
  "review_result",
  "question_list",
  "prd_brief",
  "draft_prd",
  "critic_feedback",
  "change_request",
  "change_set",
  "lint_report",
]);

export type MessageType = z.infer<typeof MessageType>;

/** Envelope: 100% do code gán. LLM không thấy và không điền các field này. */
export const MessageEnvelope = z.object({
  id: z.string(),                              // code: `msg_${ulid()}`
  type: MessageType,
  project: z.string(),
  target_doc_node_id: z.string().nullable(),
  produced_by: z.enum([
    "summarizer", "reviewer", "verifier", "question-gen",
    "brief-writer", "writer", "critic", "change-planner", "lint",
  ]),
  runtime: z.object({
    channel: z.string(),
    model: z.string(),
  }),
  based_on: z.array(z.object({                 // D2: KHÔNG chỉ target doc
    node_id: z.string(),
    hash: z.string(),                          // sha256 lúc đọc
  })),
  created_at: z.string().datetime(),
  supersedes: z.string().nullable(),
  run_id: z.string(),
  schema_version: z.number().default(1),
});

/** Payload: phần duy nhất LLM sinh ra. */
export const Message = MessageEnvelope.extend({
  content: z.string(),                         // bản cho người đọc
  instruct_content: z.unknown(),               // bản cho máy, validate bằng schema riêng của từng type
});

export type MessageEnvelope = z.infer<typeof MessageEnvelope>;
export type Message = z.infer<typeof Message>;

/** Validate instruct_content for each message type. */
export const DocSummaryContent = z.object({
  doc_type: z.enum(["prd", "meeting_note", "partner_record", "other"]),
  summary: z.string().max(1000),
  key_points: z.array(z.string()),
  open_items: z.array(z.string()),
  dates_mentioned: z.array(z.string()),
  readable: z.boolean(),
});

export const ReviewResultContent = z.object({
  claims: z.array(z.unknown()),  // validated by Claim schema separately
  overall: z.string().max(500),
});

export const QuestionListContent = z.object({
  questions: z.array(z.object({
    question: z.string(),
    context: z.string(),
    options: z.array(z.string()).default([]),
    source_claim_id: z.string().nullable(),
    priority: z.enum(["high", "medium", "low"]),
  })),
});

export const PrdBriefContent = z.object({
  direction: z.string(),
  sections_planned: z.array(z.object({
    section: z.string(),
    intent: z.string(),
    claims_planned: z.array(z.object({
      statement: z.string(),
      intended_source_node_id: z.string(),
    })),
    status: z.enum(["has_source", "needs_decision", "missing_data"]),
  })),
  missing_inputs: z.array(z.object({
    what: z.string(),
    needed_for_section: z.string(),
    who_can_provide: z.string(),
  })),
});

export const CriticFeedbackContent = z.object({
  section: z.string(),
  issues: z.array(z.object({
    quote_from_draft: z.string(),
    issue: z.string(),
    severity: z.enum(["high", "medium", "low"]),
    suggestion: z.string(),
  })),
  section_ok: z.boolean(),
});

export type DocSummaryContent = z.infer<typeof DocSummaryContent>;
export type ReviewResultContent = z.infer<typeof ReviewResultContent>;
export type QuestionListContent = z.infer<typeof QuestionListContent>;
export type PrdBriefContent = z.infer<typeof PrdBriefContent>;
export type CriticFeedbackContent = z.infer<typeof CriticFeedbackContent>;
