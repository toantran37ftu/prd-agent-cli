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

export interface ReviewClaim {
  id: string;
  type: "gap" | "risk" | "recommendation" | "contradiction";
  checklist_item: string;
  severity: "high" | "medium" | "low";
  description: string;
  source_node_ids: string[];
  verified?: "confirmed" | "partially_supported" | "not_found" | "pending";
}

export interface ReviewResult {
  claims: ReviewClaim[];
  verifiedCount: number;
  unverifiedCount: number;
  summary: string;
  based_on_hash: string;
}

export interface ReviewOrchestratorConfig {
  maxVerifierCalls: number;
  scopeGuard: ScopeGuard;
}

const DEFAULT_CONFIG: ReviewOrchestratorConfig = {
  maxVerifierCalls: 2,
  scopeGuard: new ScopeGuard(),
};

/**
 * ReviewOrchestrator — PRD Section 2.2 + Section 3.5 (Message Pool)
 *
 * 1. Check Message Pool for existing fresh review_result
 * 2. If not found/stale → call Reviewer
 * 3. Select claims for verification (high severity, risk)
 * 4. Call Verifier (cap=2)
 * 5. Label unverified claims
 * 6. Publish final review_result to pool
 */
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
  ): Promise<ReviewResult> {
    this.config.scopeGuard.assertCanRead(targetDocToken);
    const docHash = contentHash(docContent);

    // Step 0: Check Message Pool for fresh review
    const existing = checkFreshMessage(
      project,
      "review_result",
      targetDocToken,
      { [targetDocToken]: docHash },
    );
    if (existing) {
      console.log(
        "[ReviewOrchestrator] Found fresh review_result in pool. Reusing.",
      );
      return existing.instruct_content as ReviewResult;
    }

    console.log(`[ReviewOrchestrator] Starting review of ${targetDocToken}`);

    // Step 1: Call Reviewer
    console.log("[ReviewOrchestrator] Step 1: Calling Reviewer agent...");
    const claims = await this.callReviewer(docContent);

    // Step 2: Select claims to verify
    const claimsToVerify = claims.filter(
      (c) => c.severity === "high" || c.type === "risk",
    );
    console.log(
      `[ReviewOrchestrator] Step 2: ${claimsToVerify.length} claims selected for verification`,
    );

    // Step 3: Call Verifier (respecting cap)
    for (const claim of claimsToVerify) {
      if (this.verifierCallCount >= this.config.maxVerifierCalls) {
        console.log(
          `[ReviewOrchestrator] Verifier cap reached (${this.config.maxVerifierCalls}).`,
        );
        break;
      }

      console.log(
        `[ReviewOrchestrator] Verifying claim: "${claim.description.slice(0, 50)}..."`,
      );
      const verification = await this.callVerifier(claim, docContent);
      claim.verified = verification;
      this.verifierCallCount++;
    }

    // Step 4: Label unverified claims
    for (const claim of claims) {
      if (!claim.verified) {
        claim.verified = "pending";
      }
      if (claim.verified === "not_found") {
        claim.description = `[CHƯA XÁC NHẬN NGUỒN] ${claim.description}`;
      }
    }

    const verifiedCount = claims.filter(
      (c) => c.verified === "confirmed",
    ).length;
    const unverifiedCount = claims.filter(
      (c) => c.verified === "pending",
    ).length;

    const result: ReviewResult = {
      claims,
      verifiedCount,
      unverifiedCount,
      summary: `Found ${claims.length} claims. ${verifiedCount} verified, ${unverifiedCount} unverified.`,
      based_on_hash: docHash,
    };

    // Step 5: Publish to Message Pool
    const msg = createMessage({
      type: "review_result",
      project,
      target_doc_node_id: targetDocToken,
      produced_by: "reviewer",
      based_on: [{ node_id: targetDocToken, hash: docHash }],
      run_id: `run_${Date.now()}`,
      content: result.summary,
      instruct_content: result,
    });
    publishMessage(msg);

    return result;
  }

  private async callReviewer(docContent: string): Promise<ReviewClaim[]> {
    console.log("[ReviewOrchestrator] Reviewer agent invoked");
    // Placeholder: real implementation calls agent via MCP/SDK
    return [
      {
        id: "c1",
        type: "gap",
        checklist_item: "requirements",
        severity: "high",
        description: "Missing acceptance criteria for core feature",
        source_node_ids: ["doc123"],
      },
      {
        id: "c2",
        type: "risk",
        checklist_item: "dependency",
        severity: "high",
        description: "External dependency not specified",
        source_node_ids: ["doc123"],
      },
      {
        id: "c3",
        type: "recommendation",
        checklist_item: "scope",
        severity: "medium",
        description: "Consider adding error handling section",
        source_node_ids: ["doc123"],
      },
    ];
  }

  private async callVerifier(
    claim: ReviewClaim,
    docContent: string,
  ): Promise<"confirmed" | "partially_supported" | "not_found"> {
    console.log("[ReviewOrchestrator] Verifier agent invoked");
    // Placeholder: real implementation calls agent via MCP/SDK
    return "confirmed";
  }

  getVerifierCallCount(): number {
    return this.verifierCallCount;
  }
}
