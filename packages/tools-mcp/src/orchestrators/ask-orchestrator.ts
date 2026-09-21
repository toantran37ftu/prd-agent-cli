import { ScopeGuard } from "../scope-guard.js";

export interface GeneratedQuestion {
  question: string;
  priority: "critical" | "important" | "nice-to-have";
  context: string;
  relatedGap?: string;
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
 * AskOrchestrator — PRD Section 2.2
 *
 * Orchestrates question generation:
 * 1. Checks if review output exists for the target document
 * 2. If not, calls ReviewOrchestrator first (ensures questions are grounded)
 * 3. Calls Question Generator with review output + summaries + project memory
 * 4. Saves generated questions to project memory
 */
export class AskOrchestrator {
  private config: AskOrchestratorConfig;

  constructor(config?: Partial<AskOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the ask orchestration.
   */
  async run(
    projectToken: string,
    targetDocToken: string,
    docContent: string,
    existingReviewOutput?: string,
    summaries?: string[],
    projectMemory?: string,
  ): Promise<AskResult> {
    // Verify scope
    this.config.scopeGuard.assertCanRead(targetDocToken);

    console.log(`[AskOrchestrator] Starting question generation for ${targetDocToken}`);

    let reviewOutput = existingReviewOutput;
    let basedOnReview = false;

    // Step 1: Check for existing review
    if (!reviewOutput) {
      console.log(
        "[AskOrchestrator] No existing review found. Calling ReviewOrchestrator first...",
      );
      reviewOutput = await this.callReviewOrchestrator(
        projectToken,
        targetDocToken,
        docContent,
      );
      basedOnReview = true;
    } else {
      console.log("[AskOrchestrator] Using existing review output");
    }

    // Step 2: Call Question Generator
    console.log("[AskOrchestrator] Step 2: Calling Question Generator...");
    const questions = await this.callQuestionGenerator(
      reviewOutput,
      docContent,
      summaries ?? [],
      projectMemory ?? "",
    );

    // Step 3: Save questions to project memory
    console.log("[AskOrchestrator] Step 3: Saving questions to project memory...");
    await this.saveQuestionsToMemory(questions);

    return {
      questions,
      basedOnReview,
      summary: `Generated ${questions.length} questions. ${basedOnReview ? "Based on fresh review." : "Based on existing review."}`,
    };
  }

  /**
   * Call the ReviewOrchestrator to get review output.
   */
  private async callReviewOrchestrator(
    projectToken: string,
    targetDocToken: string,
    docContent: string,
  ): Promise<string> {
    // In real implementation, this invokes ReviewOrchestrator
    console.log("[AskOrchestrator] ReviewOrchestrator would be called here");
    return "[Review output placeholder]";
  }

  /**
   * Call the Question Generator agent.
   */
  private async callQuestionGenerator(
    reviewOutput: string,
    docContent: string,
    summaries: string[],
    projectMemory: string,
  ): Promise<GeneratedQuestion[]> {
    // In real implementation, this calls the Question Generator agent
    console.log("[AskOrchestrator] Question Generator agent would be called here");

    // Mock questions for demonstration
    return [
      {
        question: "What is the expected latency for the API response?",
        priority: "critical",
        context: "Performance requirements not specified",
        relatedGap: "Missing acceptance criteria for core feature",
      },
      {
        question: "How should the system handle concurrent users?",
        priority: "important",
        context: "Scalability concerns",
        relatedGap: "External dependency not specified",
      },
    ];
  }

  /**
   * Save generated questions to project memory.
   */
  private async saveQuestionsToMemory(
    questions: GeneratedQuestion[],
  ): Promise<void> {
    // In real implementation, this appends to .prdcli/memory/project_memory.md
    console.log(
      `[AskOrchestrator] Would save ${questions.length} questions to project memory`,
    );
  }
}
