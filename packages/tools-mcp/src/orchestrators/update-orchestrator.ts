/**
 * UpdateOrchestrator — §5.5
 * change_request → change_set → gate → writer-update → diff → amendment
 */
import crypto from "node:crypto";
import { ScopeGuard } from "../scope-guard.js";
import { publishMessage, createMessage } from "../message-pool/index.js";
import { runAllLint, renderLintReport } from "../lint/index.js";
import { getHumanGateItems } from "../registry/loader.js";
import { createGateState, renderGate, type GateIssue, type GateChecklistItem } from "../gate/index.js";
import { bumpVersion } from "../naming/index.js";
import type { LLMCaller } from "./review-orchestrator.js";

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export interface ChangeSetItem {
  kind: "add" | "modify" | "remove" | "fix";
  target_section: string;
  what_changes: string;
  rationale_source: string;
  impact_sections: string[];
}

export interface ChangeSet {
  items: ChangeSetItem[];
  conflicts_with_decisions: Array<{ decision: string; node_id: string; note: string }>;
  needs_clarification: string[];
}

export interface UpdateResult {
  updated_draft: string;
  change_set: ChangeSet;
  diff: string;
  lintReport: string;
  gateRendered: string;
  version: { major: number; minor: number };
  summary: string;
}

export interface UpdateOrchestratorConfig {
  scopeGuard: ScopeGuard;
  llmCaller?: LLMCaller;
  maxCriticLoops: number;
}

const DEFAULT_CONFIG: UpdateOrchestratorConfig = {
  scopeGuard: new ScopeGuard(),
  maxCriticLoops: 2,
};

export class UpdateOrchestrator {
  private config: UpdateOrchestratorConfig;

  constructor(config?: Partial<UpdateOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async run(
    project: string,
    targetDocToken: string,
    currentPrd: string,
    changeRequest: string,
  ): Promise<UpdateResult> {
    const docHash = contentHash(currentPrd);
    const runId = `run_${Date.now()}`;

    console.log(`[UpdateOrchestrator] Processing change request for ${targetDocToken}`);
    console.log(`[UpdateOrchestrator] Request: ${changeRequest}`);

    // Step 1: Save change_request as message
    const crMsg = createMessage({
      type: "change_request",
      project,
      target_doc_node_id: targetDocToken,
      produced_by: "change-planner",
      based_on: [{ node_id: targetDocToken, hash: docHash }],
      run_id: runId,
      content: changeRequest,
      instruct_content: { raw_request: changeRequest, source: "user" },
    });
    publishMessage(crMsg);

    // Step 2: Call Change Planner
    console.log("[UpdateOrchestrator] Step 2: Calling Change Planner...");
    let changeSet: ChangeSet = { items: [], conflicts_with_decisions: [], needs_clarification: [] };

    if (this.config.llmCaller) {
      const response = await this.config.llmCaller("change-planner", {
        change_request: changeRequest,
        current_prd: currentPrd,
      });

      try {
        changeSet = JSON.parse(response);
      } catch {
        console.error("[UpdateOrchestrator] Failed to parse Change Planner response");
      }
    }

    // Step 3: Check for conflicts
    if (changeSet.needs_clarification.length > 0) {
      console.log("[UpdateOrchestrator] Change request needs clarification:");
      for (const q of changeSet.needs_clarification) {
        console.log(`  - ${q}`);
      }
    }

    // Step 4: Gate — human approves change_set
    console.log("[UpdateOrchestrator] Change set:");
    for (const item of changeSet.items) {
      console.log(`  - [${item.kind}] ${item.target_section}: ${item.what_changes}`);
    }
    console.log("[UpdateOrchestrator] Change set gate: auto-approved (mock mode)");

    // Step 5: Call Writer-update
    console.log("[UpdateOrchestrator] Step 5: Calling Writer-update...");
    let updatedDraft = currentPrd;

    if (this.config.llmCaller && changeSet.items.length > 0) {
      const response = await this.config.llmCaller("writer-update", {
        current_prd: currentPrd,
        approved_change_set: JSON.stringify(changeSet),
      });
      updatedDraft = response;
    }

    // Step 6: L1 lint + diff
    const lintResult = runAllLint(updatedDraft);
    const lintReport = renderLintReport(lintResult.reports);
    const diff = this.computeDiff(currentPrd, updatedDraft);

    // Step 7: Critic on changed sections
    let criticIssues: Array<{ section: string; issue: string; severity: string; suggestion: string }> = [];

    if (this.config.llmCaller) {
      const changedSections = changeSet.items.map((i) => i.target_section);
      for (const section of changedSections) {
        const response = await this.config.llmCaller("critic", {
          section_name: section,
          section_content: this.extractSection(updatedDraft, section),
          template_section_spec: "",
          framed_cited_docs: "",
          lint_findings_for_section: "",
          other_sections_digest: "",
        });

        try {
          const parsed = JSON.parse(response);
          if (parsed.issues) {
            criticIssues.push(...parsed.issues);
          }
        } catch {
          // Skip
        }
      }
    }

    // Step 8: L3 Gate on diff
    const gateIssues: GateIssue[] = criticIssues.map((issue, i) => ({
      id: `uci${i + 1}`,
      severity: issue.severity as "high" | "medium" | "low",
      section: issue.section,
      rule: "Critic",
      message: issue.issue,
    }));

    const humanChecklist: GateChecklistItem[] = getHumanGateItems("comprehensive").map((item) => ({
      id: item.id,
      text: item.text,
      checked: false,
    }));

    const gateState = createGateState(runId, targetDocToken, gateIssues, humanChecklist, diff);
    const gateRendered = renderGate(gateState);

    // Step 9: Version bump
    const newVersion = bumpVersion({ major: 0, minor: 1 }, "amendment");

    // Publish change_set + updated draft
    const csMsg = createMessage({
      type: "change_set",
      project,
      target_doc_node_id: targetDocToken,
      produced_by: "change-planner",
      based_on: [{ node_id: targetDocToken, hash: docHash }],
      run_id: runId,
      content: JSON.stringify(changeSet),
      instruct_content: changeSet,
    });
    publishMessage(csMsg);

    const draftMsg = createMessage({
      type: "draft_prd",
      project,
      target_doc_node_id: targetDocToken,
      produced_by: "writer",
      based_on: [{ node_id: targetDocToken, hash: docHash }],
      run_id: runId,
      content: updatedDraft,
      instruct_content: { draft_markdown: updatedDraft, needs_manual_review: false },
      supersedes: targetDocToken,
    });
    publishMessage(draftMsg);

    const result: UpdateResult = {
      updated_draft: updatedDraft,
      change_set: changeSet,
      diff,
      lintReport,
      gateRendered,
      version: newVersion,
      summary: `Update applied: ${changeSet.items.length} changes. Version v${newVersion.major}.${newVersion.minor}.`,
    };

    console.log("\n" + lintReport);
    console.log(gateRendered);
    console.log(`\nVersion: v${newVersion.major}.${newVersion.minor}`);

    return result;
  }

  private computeDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const diff: string[] = [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i] ?? "";
      const newLine = newLines[i] ?? "";
      if (oldLine !== newLine) {
        if (oldLine) diff.push(`- ${oldLine}`);
        if (newLine) diff.push(`+ ${newLine}`);
      }
    }

    return diff.join("\n").slice(0, 2000);
  }

  private extractSection(draft: string, sectionName: string): string {
    const regex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = draft.match(regex);
    return match?.[1]?.trim() ?? "";
  }
}
