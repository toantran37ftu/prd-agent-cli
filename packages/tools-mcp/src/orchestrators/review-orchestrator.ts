import crypto from "node:crypto";
import { ScopeGuard } from "../scope-guard.js";
import {
  publishMessage,
  checkFreshMessage,
  createMessage,
} from "../message-pool/index.js";
import { runAllLint, renderLintReport } from "../lint/index.js";
import { getReviewerItems, getHumanGateItems } from "../registry/loader.js";
import { createGateState, renderGate, type GateIssue, type GateChecklistItem } from "../gate/index.js";
import { frameDoc, frameSummary, type DocMeta } from "../tools/frame-doc.js";

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export type LLMCaller = (agentName: string, vars: Record<string, string>) => Promise<string>;

export interface ReviewClaim {
  id: string;
  type: "gap" | "risk" | "recommendation" | "contradiction" | "not_documented" | "cannot_determine";
  checklist_item_id: string;
  severity: "high" | "medium" | "low";
  text: string;
  evidence: Array<{ node_id: string; quote: string; evidence_level: string }>;
  verification_status: "confirmed" | "partially_supported" | "not_found" | "not_checked";
}

export interface ReviewResult {
  claims: ReviewClaim[];
  verifiedCount: number;
  unverifiedCount: number;
  lintReport: string;
  gateRendered: string;
  summary: string;
  based_on_hash: string;
}

export interface ReviewOrchestratorConfig {
  maxVerifierCalls: number;
  scopeGuard: ScopeGuard;
  llmCaller?: LLMCaller;
  template?: string;
}

const DEFAULT_CONFIG: ReviewOrchestratorConfig = {
  maxVerifierCalls: 2,
  scopeGuard: new ScopeGuard(),
  template: "comprehensive",
};

export class ReviewOrchestrator {
  private config: ReviewOrchestratorConfig;
  private verifierCallCount = 0;

  constructor(config?: Partial<ReviewOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async run(
    project: string,
    targetDocToken: string,
    docContent: string,
    summaries: string = "",
    projectMemory: string = "",
  ): Promise<ReviewResult> {
    this.config.scopeGuard.assertCanRead(targetDocToken);
    const docHash = contentHash(docContent);

    // Step 1: Check Message Pool for fresh review
    const existing = checkFreshMessage(
      project,
      "review_result",
      targetDocToken,
      { [targetDocToken]: docHash },
    );
    if (existing) {
      console.log("[ReviewOrchestrator] Found fresh review_result in pool. Reusing.");
      return existing.instruct_content as ReviewResult;
    }

    console.log(`[ReviewOrchestrator] Starting review of ${targetDocToken}`);

    // Step 2: Run L1 lint (0 tokens)
    const lintResult = runAllLint(docContent);
    const lintReport = renderLintReport(lintResult.reports);
    console.log(`[ReviewOrchestrator] L1 lint: ${lintResult.issueCount} issues`);

    // Step 3: Load checklist (exclude human_only)
    const template = this.config.template ?? "comprehensive";
    const checklistItems = getReviewerItems(template);
    const checklistText = checklistItems
      .map((item) => `- [${item.id}] ${item.text} (on_fail: ${item.on_fail.join(", ")})`)
      .join("\n");

    // Step 4: Call Reviewer
    console.log("[ReviewOrchestrator] Calling Reviewer agent...");
    let claims: ReviewClaim[] = [];

    if (this.config.llmCaller) {
      const docMeta: DocMeta = {
        node_id: targetDocToken,
        type: "prd",
        updatedTime: new Date().toISOString(),
        truncated: false,
        word_count: docContent.split(/\s+/).length,
        readable: true,
      };
      const framedDoc = frameDoc(targetDocToken, docContent, docMeta);

      const response = await this.config.llmCaller("reviewer", {
        framed_target_doc: framedDoc,
        framed_summaries: summaries,
        project_memory: projectMemory,
        lint_report: lintReport,
        checklist_items: checklistText,
        target_doc: targetDocToken,
      });

      try {
        const parsed = JSON.parse(response);
        claims = (parsed.claims ?? []).map((c: Record<string, unknown>, i: number) => ({
          id: `c${i + 1}`,
          type: c.type ?? "gap",
          checklist_item_id: c.checklist_item_id ?? "unknown",
          severity: c.severity ?? "medium",
          text: c.text ?? "",
          evidence: c.evidence ?? [],
          verification_status: "not_checked" as const,
        }));
      } catch {
        console.error("[ReviewOrchestrator] Failed to parse Reviewer response");
      }
    }

    // Step 5: L1 quote-check on claims
    for (const claim of claims) {
      if (["gap", "contradiction", "risk"].includes(claim.type)) {
        const hasQuote = claim.evidence.some((e) => e.quote.trim().length > 0);
        if (!hasQuote) {
          claim.verification_status = "not_found";
        }
      }
    }

    // Step 6: Select claims for L2 verification
    const claimsToVerify = claims.filter(
      (c) =>
        (c.severity === "high" || c.severity === "medium") &&
        c.verification_status === "not_checked",
    );

    console.log(`[ReviewOrchestrator] ${claimsToVerify.length} claims selected for verification`);

    // Step 7: Call Verifier (1 claim/call, stateless, capped)
    for (const claim of claimsToVerify) {
      if (this.verifierCallCount >= this.config.maxVerifierCalls) {
        console.log(`[ReviewOrchestrator] Verifier cap reached (${this.config.maxVerifierCalls})`);
        break;
      }

      if (this.config.llmCaller && claim.evidence.length > 0) {
        const evidence = claim.evidence[0];
        const docMeta: DocMeta = {
          node_id: evidence.node_id,
          type: "prd",
          updatedTime: new Date().toISOString(),
          truncated: false,
          word_count: 1000,
          readable: true,
        };
        const framedDoc = frameDoc(evidence.node_id, docContent, docMeta);

        const response = await this.config.llmCaller("verifier", {
          claim_text: claim.text,
          framed_doc: framedDoc,
        });

        try {
          const parsed = JSON.parse(response);
          claim.verification_status = parsed.status ?? "not_checked";
        } catch {
          claim.verification_status = "not_checked";
        }
      }
      this.verifierCallCount++;
    }

    // Step 8: Label unverified claims
    for (const claim of claims) {
      if (claim.verification_status === "not_checked") {
        claim.verification_status = "not_found";
      }
    }

    // Step 9: Render 6 blocks
    const confirmed = claims.filter((c) => c.verification_status === "confirmed");
    const partial = claims.filter((c) => c.verification_status === "partially_supported");
    const notFound = claims.filter((c) => c.verification_status === "not_found");
    const notDocumented = claims.filter((c) => c.type === "not_documented");
    const cannotDetermine = claims.filter((c) => c.type === "cannot_determine");
    const unchecked = claims.filter((c) => c.verification_status === "not_checked");

    let output = "# Review Result\n\n";
    if (confirmed.length > 0) {
      output += "## A. Đã xác nhận nguồn\n";
      confirmed.forEach((c) => output += `- [${c.severity}] ${c.text}\n`);
      output += "\n";
    }
    if (partial.length > 0) {
      output += "## B. Xác nhận một phần\n";
      partial.forEach((c) => output += `- [${c.severity}] ${c.text}\n`);
      output += "\n";
    }
    if (notFound.length > 0) {
      output += "## C. KHÔNG tìm thấy trong nguồn — nghi bịa\n";
      notFound.forEach((c) => output += `- [${c.severity}] ${c.text}\n`);
      output += "\n";
    }
    if (unchecked.length > 0) {
      output += "## D. Chưa kiểm chứng (hết ngân sách)\n";
      unchecked.forEach((c) => output += `- [${c.severity}] ${c.text}\n`);
      output += "\n";
    }
    if (notDocumented.length > 0) {
      output += "## E. Tài liệu không ghi nhận\n";
      notDocumented.forEach((c) => output += `- ${c.text}\n`);
      output += "\n";
    }
    if (cannotDetermine.length > 0) {
      output += "## F. Không đủ dữ liệu để kết luận\n";
      cannotDetermine.forEach((c) => output += `- ${c.text}\n`);
      output += "\n";
    }

    // Step 10: L3 Gate
    const gateIssues: GateIssue[] = claims
      .filter((c) => c.severity === "high" || c.verification_status === "not_found")
      .map((c) => ({
        id: c.id,
        severity: c.severity,
        section: c.checklist_item_id,
        rule: c.type,
        message: c.text,
        quote: c.evidence[0]?.quote,
      }));

    const humanChecklist: GateChecklistItem[] = getHumanGateItems(template).map((item) => ({
      id: item.id,
      text: item.text,
      checked: false,
    }));

    const runId = `run_${Date.now()}`;
    const gateState = createGateState(runId, targetDocToken, gateIssues, humanChecklist);
    const gateRendered = renderGate(gateState);

    const verifiedCount = confirmed.length;
    const unverifiedCount = unchecked.length + notFound.length;

    const result: ReviewResult = {
      claims,
      verifiedCount,
      unverifiedCount,
      lintReport,
      gateRendered,
      summary: `Found ${claims.length} claims. ${verifiedCount} verified, ${unverifiedCount} unverified.`,
      based_on_hash: docHash,
    };

    // Step 11: Publish to Message Pool
    const msg = createMessage({
      type: "review_result",
      project,
      target_doc_node_id: targetDocToken,
      produced_by: "reviewer",
      based_on: [{ node_id: targetDocToken, hash: docHash }],
      run_id: runId,
      content: output,
      instruct_content: result,
    });
    publishMessage(msg);

    console.log(output);
    console.log(gateRendered);

    return result;
  }

  getVerifierCallCount(): number {
    return this.verifierCallCount;
  }
}
