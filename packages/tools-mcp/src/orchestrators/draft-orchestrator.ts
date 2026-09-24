import crypto from "node:crypto";
import { ScopeGuard } from "../scope-guard.js";
import { publishMessage, createMessage } from "../message-pool/index.js";
import { runAllLint, renderLintReport } from "../lint/index.js";
import { getHumanGateItems } from "../registry/loader.js";
import { createGateState, renderGate, type GateIssue, type GateChecklistItem } from "../gate/index.js";
import type { LLMCaller } from "./review-orchestrator.js";

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export interface DraftResult {
  draft_markdown: string;
  iterationCount: number;
  needsManualReview: boolean;
  criticApproved: boolean;
  remainingIssues: CriticIssue[];
  lintReport: string;
  gateRendered: string;
  summary: string;
}

export interface CriticIssue {
  section: string;
  quote_from_draft: string;
  issue: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
}

export interface DraftOrchestratorConfig {
  maxCriticLoops: number;
  scopeGuard: ScopeGuard;
  llmCaller?: LLMCaller;
  template?: string;
}

const DEFAULT_CONFIG: DraftOrchestratorConfig = {
  maxCriticLoops: 2,
  scopeGuard: new ScopeGuard(),
};

export class DraftOrchestrator {
  private config: DraftOrchestratorConfig;
  private iterationCount = 0;

  constructor(config?: Partial<DraftOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async run(
    project: string,
    topic: string,
    summaries: string = "",
    projectMemory: string = "",
    templateContent: string = "",
  ): Promise<DraftResult> {
    console.log(`[DraftOrchestrator] Starting PRD draft on topic: "${topic}"`);

    // Step 1: Select template
    const template = this.config.template ?? this.selectTemplate(topic);
    console.log(`[DraftOrchestrator] Selected template: ${template}`);

    // PHASE 1: BRIEF
    console.log("[DraftOrchestrator] Phase 1: Generating brief...");
    let briefContent = "";
    if (this.config.llmCaller) {
      const response = await this.config.llmCaller("brief-writer", {
        topic,
        template_name: template,
        template_content: templateContent,
      });
      try {
        briefContent = response;
        const parsed = JSON.parse(response);
        console.log(`[DraftOrchestrator] Brief: ${parsed.sections_planned?.length ?? 0} sections planned`);
        if (parsed.missing_inputs?.length > 0) {
          console.log(`[DraftOrchestrator] Missing inputs: ${parsed.missing_inputs.length}`);
          for (const mi of parsed.missing_inputs) {
            console.log(`  - ${mi.what} (for ${mi.needed_for_section}, ask ${mi.who_can_provide})`);
          }
        }
      } catch {
        briefContent = response;
      }
    }

    // BRIEF GATE: In real impl, this would pause for human approval
    console.log("[DraftOrchestrator] Brief gate: auto-approved (mock mode)");

    // PHASE 2: FULL DRAFT
    console.log("[DraftOrchestrator] Phase 2: Writing full draft...");
    let draft = "";

    if (this.config.llmCaller) {
      const response = await this.config.llmCaller("writer", {
        topic,
        template_name: template,
        template_content: templateContent,
        approved_brief: briefContent,
        summaries,
        project_memory: projectMemory,
      });
      draft = response;
    } else {
      draft = `# PRD Draft: ${topic}\n\nTemplate: ${template}\n\n[Draft content placeholder]`;
    }
    this.iterationCount++;

    // L1 lint on draft
    const lintResult = runAllLint(draft);
    const lintReport = renderLintReport(lintResult.reports);
    console.log(`[DraftOrchestrator] L1 lint: ${lintResult.issueCount} issues`);

    // Check if draft is mostly empty
    if (this.isMostlyEmpty(draft)) {
      console.log("[DraftOrchestrator] Draft lacks source info — skipping Critic");
      const result: DraftResult = {
        draft_markdown: draft,
        iterationCount: this.iterationCount,
        needsManualReview: false,
        criticApproved: false,
        remainingIssues: [],
        lintReport,
        gateRendered: "",
        summary: "Draft completed but lacks sufficient source data. Critic review skipped.",
      };
      this.publishDraft(project, topic, result);
      return result;
    }

    // PHASE 2: CRITIC LOOP
    let criticApproved = false;
    let lastIssues: CriticIssue[] = [];

    while (this.iterationCount <= this.config.maxCriticLoops && !criticApproved) {
      console.log(`[DraftOrchestrator] Calling Critic (iteration ${this.iterationCount})...`);

      const criticResult = await this.callCriticPerSection(draft, template);
      lastIssues = criticResult.issues;

      // Publish critic_feedback
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

      const hasHigh = lastIssues.some((i) => i.severity === "high");
      if (hasHigh && this.config.llmCaller) {
        console.log("[DraftOrchestrator] High-severity issues found. Calling Writer for revision...");
        const response = await this.config.llmCaller("writer", {
          topic,
          template_name: template,
          template_content: templateContent,
          approved_brief: briefContent,
          critic_feedback: JSON.stringify(lastIssues),
          current_draft: draft,
        });
        draft = response;
        this.iterationCount++;
      } else {
        break;
      }
    }

    const needsManualReview = !criticApproved && this.iterationCount > this.config.maxCriticLoops;

    // PHASE 3: L3 GATE
    const gateIssues: GateIssue[] = lastIssues.map((issue, i) => ({
      id: `ci${i + 1}`,
      severity: issue.severity,
      section: issue.section,
      rule: "Critic",
      message: issue.issue,
      quote: issue.quote_from_draft,
    }));

    // Add lint issues to gate
    for (const report of lintResult.reports) {
      if (!report.passed) {
        for (const r of report.results) {
          gateIssues.push({
            id: `li_${report.rule}`,
            severity: r.severity as "high" | "medium" | "low",
            section: r.location ?? "general",
            rule: report.rule,
            message: r.message,
          });
        }
      }
    }

    const humanChecklist: GateChecklistItem[] = getHumanGateItems(template).map((item) => ({
      id: item.id,
      text: item.text,
      checked: false,
    }));

    const runId = `run_${Date.now()}`;
    const gateState = createGateState(runId, topic, gateIssues, humanChecklist);
    const gateRendered = renderGate(gateState);

    const result: DraftResult = {
      draft_markdown: draft,
      iterationCount: this.iterationCount,
      needsManualReview,
      criticApproved,
      remainingIssues: needsManualReview ? lastIssues : [],
      lintReport,
      gateRendered,
      summary: needsManualReview
        ? `Draft after ${this.iterationCount} iterations. Needs manual review.`
        : `Draft completed in ${this.iterationCount} iterations. ${criticApproved ? "Critic approved." : "Minor feedback noted."}`,
    };

    this.publishDraft(project, topic, result);

    console.log("\n" + lintReport);
    console.log(gateRendered);

    return result;
  }

  private selectTemplate(topic: string): string {
    const lower = topic.toLowerCase();
    if (/fix|bug|hotfix|small/i.test(lower)) return "lean";
    if (/new product|new feature|launch/i.test(lower)) return "pr-faq";
    if (/metric|data|analytics|growth/i.test(lower)) return "google-style";
    return "comprehensive";
  }

  private isMostlyEmpty(draft: string): boolean {
    const markers = draft.match(/\*\*\[CHƯA ĐỦ THÔNG TIN/g);
    const sections = draft.match(/^##/gm);
    if (!sections || sections.length === 0) return true;
    return (markers?.length ?? 0) >= sections.length * 0.6;
  }

  private async callCriticPerSection(
    draft: string,
    template: string,
  ): Promise<{ approved: boolean; issues: CriticIssue[] }> {
    const sections = this.extractSections(draft);
    const allIssues: CriticIssue[] = [];

    for (const [sectionName, sectionContent] of sections) {
      if (this.config.llmCaller) {
        const response = await this.config.llmCaller("critic", {
          section_name: sectionName,
          section_content: sectionContent,
          template_section_spec: `Section: ${sectionName}`,
          framed_cited_docs: "",
          lint_findings_for_section: "",
          other_sections_digest: sections
            .filter(([name]) => name !== sectionName)
            .map(([name, content]) => `### ${name}\n${content.slice(0, 200)}`)
            .join("\n"),
        });

        try {
          const parsed = JSON.parse(response);
          if (parsed.issues) {
            for (const issue of parsed.issues) {
              allIssues.push({
                section: sectionName,
                quote_from_draft: issue.quote_from_draft ?? "",
                issue: issue.issue ?? "",
                severity: issue.severity ?? "medium",
                suggestion: issue.suggestion ?? "",
              });
            }
          }
        } catch {
          // Parse error, skip
        }
      }
    }

    return {
      approved: allIssues.filter((i) => i.severity === "high").length === 0,
      issues: allIssues,
    };
  }

  private extractSections(draft: string): Array<[string, string]> {
    const sections: Array<[string, string]> = [];
    const lines = draft.split("\n");
    let currentName = "Header";
    let currentContent: string[] = [];

    for (const line of lines) {
      if (line.startsWith("## ")) {
        if (currentContent.length > 0) {
          sections.push([currentName, currentContent.join("\n")]);
        }
        currentName = line.replace(/^##\s*/, "").trim();
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }
    if (currentContent.length > 0) {
      sections.push([currentName, currentContent.join("\n")]);
    }

    return sections;
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

  getIterationCount(): number {
    return this.iterationCount;
  }
}
