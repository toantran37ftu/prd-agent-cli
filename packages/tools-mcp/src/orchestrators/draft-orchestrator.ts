import crypto from "node:crypto";
import { ScopeGuard } from "../scope-guard.js";
import { publishMessage, createMessage } from "../message-pool/index.js";

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export interface DraftResult {
  draft_markdown: string;
  iterationCount: number;
  needsManualReview: boolean;
  criticApproved: boolean;
  remainingIssues: CriticIssue[];
  summary: string;
}

export interface CriticIssue {
  section: string;
  issue: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
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
 * DraftOrchestrator — PRD Section 2.2 + Section 3.5 (Message Pool)
 *
 * 1. Select template based on topic + context
 * 2. Call Writer → draft
 * 3. If draft is mostly "Chưa đủ thông tin" → skip Critic, return with warning
 * 4. Call Critic → feedback
 * 5. If high-severity issues → Writer revises, loop up to 2 times
 * 6. Publish draft_prd + critic_feedback to pool
 */
export class DraftOrchestrator {
  private config: DraftOrchestratorConfig;
  private iterationCount = 0;

  constructor(config?: Partial<DraftOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async run(
    project: string,
    topic: string,
    summaries?: string[],
    projectMemory?: string,
  ): Promise<DraftResult> {
    console.log(
      `[DraftOrchestrator] Starting PRD draft on topic: "${topic}"`,
    );

    // Step 1: Select template
    const template = this.selectTemplate(topic, summaries);
    console.log(`[DraftOrchestrator] Selected template: ${template}`);

    // Step 2: Call Writer
    console.log("[DraftOrchestrator] Step 2: Calling Writer agent...");
    let draft = await this.callWriter(topic, template, summaries ?? [], projectMemory ?? "");
    this.iterationCount++;

    // Step 3: Check if draft has enough content
    if (this.isMostlyEmpty(draft)) {
      console.log("[DraftOrchestrator] Draft lacks source info — skipping Critic");
      const result: DraftResult = {
        draft_markdown: draft,
        iterationCount: this.iterationCount,
        needsManualReview: false,
        criticApproved: false,
        remainingIssues: [],
        summary: "Draft completed but lacks sufficient source data. Critic review skipped.",
      };
      this.publishDraft(project, topic, result);
      return result;
    }

    // Step 4-5: Critic loop
    let criticApproved = false;
    let lastIssues: CriticIssue[] = [];

    while (
      this.iterationCount <= this.config.maxCriticLoops &&
      !criticApproved
    ) {
      console.log(
        `[DraftOrchestrator] Step 4: Calling Critic (iteration ${this.iterationCount})...`,
      );

      const criticResult = await this.callCritic(draft, template);
      lastIssues = criticResult.issues;

      // Publish critic_feedback to pool
      const criticMsg = createMessage({
        type: "critic_feedback",
        project,
        target_doc_node_id: null,
        produced_by: "critic",
        based_on: [],
        run_id: `run_${Date.now()}`,
        content: JSON.stringify(criticResult),
        instruct_content: criticResult,
      });
      publishMessage(criticMsg);

      if (criticResult.approved) {
        criticApproved = true;
        break;
      }

      const hasHighSeverity = criticResult.issues.some(
        (i) => i.severity === "high",
      );
      if (hasHighSeverity) {
        console.log(
          "[DraftOrchestrator] High-severity issues found. Calling Writer for revision...",
        );
        draft = await this.callWriterRevise(draft, criticResult.issues);
        this.iterationCount++;
      } else {
        break;
      }
    }

    const needsManualReview =
      !criticApproved && this.iterationCount > this.config.maxCriticLoops;

    if (needsManualReview) {
      console.log(
        `[DraftOrchestrator] Loop cap reached (${this.config.maxCriticLoops}). Flagging for manual review.`,
      );
    }

    const result: DraftResult = {
      draft_markdown: draft,
      iterationCount: this.iterationCount,
      needsManualReview,
      criticApproved,
      remainingIssues: needsManualReview ? lastIssues : [],
      summary: needsManualReview
        ? `Draft after ${this.iterationCount} iterations. Needs manual review.`
        : `Draft completed in ${this.iterationCount} iterations. ${criticApproved ? "Critic approved." : "Minor feedback noted."}`,
    };

    this.publishDraft(project, topic, result);
    return result;
  }

  private selectTemplate(topic: string, summaries?: string[]): string {
    const lower = topic.toLowerCase();
    if (/fix|bug|hotfix|small/i.test(lower)) return "lean";
    if (/new product|new feature|launch/i.test(lower)) return "pr-faq";
    if (/metric|data|analytics|growth/i.test(lower)) return "google-style";
    return "comprehensive";
  }

  private isMostlyEmpty(draft: string): boolean {
    const markers = draft.match(/\*\*Chưa đủ thông tin/g);
    const sections = draft.match(/^##/gm);
    if (!sections || sections.length === 0) return true;
    return (markers?.length ?? 0) >= sections.length * 0.6;
  }

  private publishDraft(project: string, topic: string, result: DraftResult): void {
    const msg = createMessage({
      type: "draft_prd",
      project,
      target_doc_node_id: null,
      produced_by: "writer",
      based_on: [],
      run_id: `run_${Date.now()}`,
      content: result.draft_markdown,
      instruct_content: {
        draft_markdown: result.draft_markdown,
        needs_manual_review: result.needsManualReview,
        remaining_issues: result.remainingIssues,
      },
    });
    publishMessage(msg);
  }

  private async callWriter(
    topic: string,
    template: string,
    summaries: string[],
    projectMemory: string,
  ): Promise<string> {
    console.log("[DraftOrchestrator] Writer agent invoked");
    return `# PRD Draft: ${topic}\n\nTemplate: ${template}\n\n[Draft content placeholder]`;
  }

  private async callWriterRevise(
    currentDraft: string,
    issues: CriticIssue[],
  ): Promise<string> {
    console.log("[DraftOrchestrator] Writer revision invoked");
    return `${currentDraft}\n\n[Revised based on ${issues.length} issues]`;
  }

  private async callCritic(
    draft: string,
    template: string,
  ): Promise<{ approved: boolean; issues: CriticIssue[] }> {
    console.log("[DraftOrchestrator] Critic agent invoked");
    if (this.iterationCount >= 2) {
      return { approved: true, issues: [] };
    }
    return {
      approved: false,
      issues: [
        {
          section: "Requirements",
          issue: "Missing acceptance criteria in section 3.1",
          severity: "high",
          suggestion: "Add specific acceptance criteria for each requirement",
        },
      ],
    };
  }

  getIterationCount(): number {
    return this.iterationCount;
  }
}
