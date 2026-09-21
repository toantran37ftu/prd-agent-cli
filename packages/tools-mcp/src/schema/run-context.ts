/**
 * RunContext — §4.2
 * Code injects this into every prompt. LLM never guesses these values.
 */
import { z } from "zod";

export const DocIndexEntry = z.object({
  node_id: z.string(),
  title: z.string(),
  type: z.string(),
  updated_time: z.string(),
  hash: z.string(),
  word_count: z.number(),
  readable: z.boolean(),
});

export const RunContext = z.object({
  today: z.string(),                    // "2026-09-21"
  timezone: z.string(),                 // "Asia/Ho_Chi_Minh"
  project: z.object({
    name: z.string(),
    folder_token: z.string(),
  }),
  doc_index: z.array(DocIndexEntry),
  run_id: z.string(),
  budget: z.object({
    max_llm_calls: z.number(),
    max_tokens: z.number(),
  }),
});

export type DocIndexEntry = z.infer<typeof DocIndexEntry>;
export type RunContext = z.infer<typeof RunContext>;

/**
 * Render RunContext as injectable text for prompts.
 */
export function renderRunContext(ctx: RunContext): string {
  const docTable = ctx.doc_index.length > 0
    ? ctx.doc_index
        .map(
          (d) =>
            `| ${d.node_id} | ${d.title} | ${d.type} | ${d.updated_time} | ${d.word_count} | ${d.readable ? "yes" : "no (permission denied)"} |`,
        )
        .join("\n")
    : "(no documents in project)";

  return [
    `- Today: ${ctx.today} (${ctx.timezone})`,
    `- Project: ${ctx.project.name}`,
    `- Documents in project:`,
    `| node_id | title | type | updated | words | readable |`,
    `|---|---|---|---|---|---|`,
    docTable,
    `- Run budget: max ${ctx.budget.max_llm_calls} LLM calls, max ${ctx.budget.max_tokens} tokens`,
  ].join("\n");
}
