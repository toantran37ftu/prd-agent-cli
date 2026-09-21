import crypto from "node:crypto";
import { ScopeGuard } from "../scope-guard.js";
import {
  publishMessage,
  checkFreshMessage,
  createMessage,
} from "../message-pool/index.js";

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export interface GeneratedQuestion {
  id: string;
  question: string;
  reason: string;
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
}

const DEFAULT_CONFIG: AskOrchestratorConfig = {
  scopeGuard: new ScopeGuard(),
};

/**
 * AskOrchestrator — PRD Section 2.2 + Section 3.5 (Message Pool)
 *
 * 1. Check Message Pool for fresh review_result
 * 2. If not found/stale → call ReviewOrchestrator
 * 3. Call Question Generator with review + summaries + memory
 * 4. Save questions to project memory
 * 5. Publish question_list to pool
 */
export class AskOrchestrator {
  private config: AskOrchestratorConfig;

  constructor(config?: Partial<AskOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async run(
    project: string,
    targetDocToken: string,
    docContent: string,
    existingReviewOutput?: string,
    summaries?: string[],
    projectMemory?: string,
  ): Promise<AskResult> {
    this.config.scopeGuard.assertCanRead(targetDocToken);
    const docHash = contentHash(docContent);

    let reviewOutput = existingReviewOutput;
    let basedOnReview = false;

    // Step 1: Check Message Pool for fresh review
    if (!reviewOutput) {
      const existingReview = checkFreshMessage(
        project,
        "review_result",
        targetDocToken,
        { [targetDocToken]: docHash },
      );
      if (existingReview) {
        console.log("[AskOrchestrator] Found fresh review_result in pool.");
        reviewOutput = JSON.stringify(existingReview.instruct_content);
      } else {
        console.log(
          "[AskOrchestrator] No fresh review found. Calling ReviewOrchestrator...",
        );
        reviewOutput = await this.callReviewOrchestrator(
          project,
          targetDocToken,
          docContent,
        );
        basedOnReview = true;
      }
    } else {
      console.log("[AskOrchestrator] Using provided review output");
    }

    // Step 2: Call Question Generator
    console.log("[AskOrchestrator] Step 2: Calling Question Generator...");
    const questions = await this.callQuestionGenerator(
      reviewOutput!,
      docContent,
      summaries ?? [],
      projectMemory ?? "",
    );

    // Step 3: Save to project memory
    console.log("[AskOrchestrator] Step 3: Saving questions to memory...");
    await this.saveQuestionsToMemory(project, questions);

    // Step 4: Publish to Message Pool
    const msg = createMessage({
      type: "question_list",
      project,
      target_doc_node_id: targetDocToken,
      produced_by: "question-gen",
      based_on: [{ node_id: targetDocToken, hash: docHash }],
      run_id: `run_${Date.now()}`,
      content: `Generated ${questions.length} questions`,
      instruct_content: { questions },
    });
    publishMessage(msg);

    return {
      questions,
      basedOnReview,
      summary: `Generated ${questions.length} questions. ${basedOnReview ? "Based on fresh review." : "Based on existing review."}`,
    };
  }

  private async callReviewOrchestrator(
    project: string,
    targetDocToken: string,
    docContent: string,
  ): Promise<string> {
    console.log("[AskOrchestrator] ReviewOrchestrator invoked");
    return "[Review output placeholder]";
  }

  private async callQuestionGenerator(
    reviewOutput: string,
    docContent: string,
    summaries: string[],
    projectMemory: string,
  ): Promise<GeneratedQuestion[]> {
    console.log("[AskOrchestrator] Question Generator invoked");
    return [
      {
        id: "q1",
        question: "What is the expected latency for the API response?",
        reason: "Performance requirements not specified",
        source_claim_id: "c1",
        priority: "high",
      },
      {
        id: "q2",
        question: "How should the system handle concurrent users?",
        reason: "Scalability concerns",
        source_claim_id: "c2",
        priority: "medium",
      },
    ];
  }

  private async saveQuestionsToMemory(
    project: string,
    questions: GeneratedQuestion[],
  ): Promise<void> {
    console.log(
      `[AskOrchestrator] Would save ${questions.length} questions to project memory`,
    );
  }
}
