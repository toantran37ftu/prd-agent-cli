import { ScopeGuard } from "../scope-guard.js";

export interface DraftResult {
  draft: string;
  iterationCount: number;
  needsManualReview: boolean;
  criticApproved: boolean;
  feedback?: string;
  summary: string;
}

export interface DraftOrchestratorConfig {
  maxCriticLoops: number;
  scopeGuard: ScopeGuard;
}

const DEFAULT_CONFIG: DraftOrchestratorConfig = {
  maxCriticLoops: 2,
  scopeGuard: new ScopeGuard(),
};

/**
 * DraftOrchestrator — PRD Section 2.2
 *
 * Orchestrates PRD drafting with quality control:
 * 1. Calls Writer to generate PRD draft
 * 2. Evaluates if Critic review is needed (based on draft complexity)
 * 3. If needed, calls Critic to review draft against sources + checklist
 * 4. If Critic has serious feedback, calls Writer to revise
 * 5. Loops up to maxCriticLoops times
 * 6. If loop cap reached without approval, flags for manual review
 */
export class DraftOrchestrator {
  private config: DraftOrchestratorConfig;
  private iterationCount = 0;

  constructor(config?: Partial<DraftOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the draft orchestration.
   */
  async run(
    projectToken: string,
    topic: string,
    summaries?: string[],
    projectMemory?: string,
  ): Promise<DraftResult> {
    console.log(`[DraftOrchestrator] Starting PRD draft on topic: "${topic}"`);

    // Step 1: Call Writer
    console.log("[DraftOrchestrator] Step 1: Calling Writer agent...");
    let draft = await this.callWriter(topic, summaries ?? [], projectMemory ?? "");
    this.iterationCount++;

    // Step 2: Evaluate if Critic is needed
    const needsCritic = this.evaluateCriticNeed(draft);

    if (!needsCritic) {
      console.log("[DraftOrchestrator] Draft is clear/short — skipping Critic review");
      return {
        draft,
        iterationCount: this.iterationCount,
        needsManualReview: false,
        criticApproved: true,
        summary: "Draft completed in 1 iteration. Critic review not needed.",
      };
    }

    // Step 3-5: Critic loop
    let criticApproved = false;
    let lastFeedback: string | undefined;

    while (
      this.iterationCount <= this.config.maxCriticLoops &&
      !criticApproved
    ) {
      console.log(
        `[DraftOrchestrator] Step 3: Calling Critic (iteration ${this.iterationCount})...`,
      );

      const criticResult = await this.callCritic(draft);
      lastFeedback = criticResult.feedback;

      if (criticResult.approved) {
        criticApproved = true;
        console.log("[DraftOrchestrator] Critic approved the draft");
        break;
      }

      // Check if feedback is serious enough to require revision
      if (criticResult.severity === "must-fix") {
        console.log(
          "[DraftOrchestrator] Critic found must-fix issues. Calling Writer for revision...",
        );
        draft = await this.callWriterRevise(draft, criticResult.feedback);
        this.iterationCount++;
      } else {
        // Minor feedback — accept draft with notes
        console.log(
          "[DraftOrchestrator] Critic feedback is minor. Accepting draft with notes.",
        );
        break;
      }
    }

    // Step 6: Check if loop cap reached
    const needsManualReview =
      !criticApproved && this.iterationCount > this.config.maxCriticLoops;

    if (needsManualReview) {
      console.log(
        `[DraftOrchestrator] Loop cap reached (${this.config.maxCriticLoops}). Flagging for manual review.`,
      );
    }

    return {
      draft,
      iterationCount: this.iterationCount,
      needsManualReview,
      criticApproved,
      feedback: lastFeedback,
      summary: needsManualReview
        ? `Draft completed after ${this.iterationCount} iterations. Critic did not fully approve — flagged for manual review.`
        : `Draft completed in ${this.iterationCount} iterations. ${criticApproved ? "Critic approved." : "Minor feedback noted."}`,
    };
  }

  /**
   * Evaluate if the draft needs Critic review.
   * Model decides this based on draft complexity.
   */
  private evaluateCriticNeed(draft: string): boolean {
    // Heuristic: longer drafts with specific claims need review
    const wordCount = draft.split(/\s+/).length;
    const hasClaims = /\d+%|specific|must|should|will/i.test(draft);

    return wordCount > 200 || hasClaims;
  }

  /**
   * Call the Writer agent.
   */
  private async callWriter(
    topic: string,
    summaries: string[],
    projectMemory: string,
  ): Promise<string> {
    // In real implementation, calls Writer agent via MCP
    console.log("[DraftOrchestrator] Writer agent would be called here");
    return `# PRD Draft: ${topic}\n\n[Draft content placeholder]`;
  }

  /**
   * Call Writer for revision based on Critic feedback.
   */
  private async callWriterRevise(
    currentDraft: string,
    feedback: string,
  ): Promise<string> {
    // In real implementation, calls Writer agent with current draft + feedback
    console.log("[DraftOrchestrator] Writer revision would be called here");
    return `${currentDraft}\n\n[Revised based on feedback]`;
  }

  /**
   * Call the Critic agent.
   */
  private async callCritic(draft: string): Promise<{
    approved: boolean;
    severity: "must-fix" | "should-fix" | "nice-to-fix";
    feedback: string;
  }> {
    // In real implementation, calls Critic agent via MCP
    console.log("[DraftOrchestrator] Critic agent would be called here");

    // Mock: approve on second iteration
    if (this.iterationCount >= 2) {
      return { approved: true, severity: "nice-to-fix", feedback: "" };
    }

    return {
      approved: false,
      severity: "must-fix",
      feedback: "Missing acceptance criteria in section 3.1",
    };
  }

  getIterationCount(): number {
    return this.iterationCount;
  }
}
