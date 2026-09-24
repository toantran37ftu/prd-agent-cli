import crypto from "node:crypto";
import { ScopeGuard } from "../scope-guard.js";
import {
  publishMessage,
  checkFreshMessage,
  createMessage,
} from "../message-pool/index.js";
import { ReviewOrchestrator, type LLMCaller, type ReviewClaim } from "./review-orchestrator.js";

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export interface GeneratedQuestion {
  id: string;
  question: string;
  context: string;
  options: string[];
  source_claim_id: string;
  priority: "high" | "medium" | "low";
}

export interface AskResult {
  questions: GeneratedQuestion[];
  basedOnReview: boolean;
  summary: string;
}

export interface AskOrchestratorConfig {
  scopeGuard: ScopeGuard;
  llmCaller?: LLMCaller;
  template?: string;
}

const DEFAULT_CONFIG: AskOrchestratorConfig = {
  scopeGuard: new ScopeGuard(),
};

export class AskOrchestrator {
  private config: AskOrchestratorConfig;

  constructor(config?: Partial<AskOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async run(
    project: string,
    targetDocToken: string,
    docContent: string,
    summaries: string = "",
    projectMemory: string = "",
  ): Promise<AskResult> {
    this.config.scopeGuard.assertCanRead(targetDocToken);
    const docHash = contentHash(docContent);

    // Step 1: Check for fresh review
    let reviewResult: { claims: ReviewClaim[] } | null = null;
    let basedOnReview = false;

    const existingReview = checkFreshMessage(
      project,
      "review_result",
      targetDocToken,
      { [targetDocToken]: docHash },
    );

    if (existingReview) {
      console.log("[AskOrchestrator] Found fresh review_result in pool.");
      reviewResult = existingReview.instruct_content as { claims: ReviewClaim[] };
    } else {
      console.log("[AskOrchestrator] No fresh review found. Running ReviewOrchestrator...");
      const reviewOrch = new ReviewOrchestrator({
        scopeGuard: this.config.scopeGuard,
        llmCaller: this.config.llmCaller,
        template: this.config.template,
      });
      const review = await reviewOrch.run(project, targetDocToken, docContent, summaries, projectMemory);
      reviewResult = { claims: review.claims };
      basedOnReview = true;
    }

    // Step 2: Filter eligible claims
    const eligibleClaims = (reviewResult?.claims ?? []).filter(
      (c) =>
        c.severity === "high" ||
        c.severity === "medium" ||
        ["not_found", "partially_supported"].includes(c.verification_status) ||
        ["not_documented", "cannot_determine"].includes(c.type),
    );

    console.log(`[AskOrchestrator] ${eligibleClaims.length} eligible claims for questions`);

    // Step 3: Load existing Open Questions from project memory
    const oqMatch = projectMemory.match(/## Open Questions\s*\n([\s\S]*?)(?=\n## |$)/);
    const existingOQ = oqMatch?.[1]?.trim() ?? "";

    // Step 4: Call Question Generator
    let questions: GeneratedQuestion[] = [];

    if (this.config.llmCaller && eligibleClaims.length > 0) {
      const response = await this.config.llmCaller("question-gen", {
        eligible_claims: JSON.stringify(eligibleClaims),
        existing_open_questions: existingOQ,
      });

      try {
        const parsed = JSON.parse(response);
        questions = (parsed.questions ?? []).map((q: Record<string, unknown>, i: number) => ({
          id: `q${i + 1}`,
          question: q.question ?? "",
          context: q.context ?? "",
          options: q.options ?? [],
          source_claim_id: q.source_claim_id ?? "",
          priority: q.priority ?? "medium",
        }));
      } catch {
        console.error("[AskOrchestrator] Failed to parse Question Generator response");
      }
    }

    // Step 5: Enforce owner/due = "unassigned"
    // (Questions don't have these fields in our schema, but enforce in memory writes)

    // Step 6: Publish to Message Pool
    const runId = `run_${Date.now()}`;
    const msg = createMessage({
      type: "question_list",
      project,
      target_doc_node_id: targetDocToken,
      produced_by: "question-gen",
      based_on: [{ node_id: targetDocToken, hash: docHash }],
      run_id: runId,
      content: JSON.stringify({ questions }),
      instruct_content: { questions },
    });
    publishMessage(msg);

    // Step 7: Output
    let output = "# Generated Questions\n\n";
    for (const q of questions) {
      output += `### ${q.id} [${q.priority.toUpperCase()}]\n`;
      output += `**Q**: ${q.question}\n`;
      output += `**Context**: ${q.context}\n`;
      if (q.options.length > 0) {
        output += `**Options**: ${q.options.join(", ")}\n`;
      }
      output += `**Source**: ${q.source_claim_id}\n\n`;
    }

    console.log(output);

    return {
      questions,
      basedOnReview,
      summary: `Generated ${questions.length} questions. ${basedOnReview ? "Based on fresh review." : "Based on existing review."}`,
    };
  }
}
