import { ScopeGuard } from "../scope-guard.js";

export interface ReviewClaim {
  type: "gap" | "risk" | "recommendation";
  severity: "high" | "medium" | "low";
  description: string;
  sourceSection?: string;
  sourceNodeId?: string;
  verified?: "confirmed" | "not_found" | "pending";
}

export interface ReviewResult {
  claims: ReviewClaim[];
  verifiedCount: number;
  unverifiedCount: number;
  summary: string;
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
 * ReviewOrchestrator — PRD Section 2.2
 *
 * Orchestrates the review process:
 * 1. Calls Reviewer to generate claims (gaps/risks/recommendations)
 * 2. Decides which claims need verification (high severity/risk)
 * 3. Calls Verifier to check those claims against source docs
 * 4. Labels unverified claims appropriately
 * 5. Returns final review with verification status
 */
export class ReviewOrchestrator {
  private config: ReviewOrchestratorConfig;
  private verifierCallCount = 0;

  constructor(config?: Partial<ReviewOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the review orchestration.
   * In real implementation, this calls the Reviewer and Verifier agents via MCP.
   * For now, returns a structured plan of what would happen.
   */
  async run(
    projectToken: string,
    targetDocToken: string,
    docContent: string,
  ): Promise<ReviewResult> {
    // Verify scope
    this.config.scopeGuard.assertCanRead(targetDocToken);

    console.log(`[ReviewOrchestrator] Starting review of ${targetDocToken}`);

    // Step 1: Call Reviewer agent
    console.log("[ReviewOrchestrator] Step 1: Calling Reviewer agent...");
    const claims = await this.callReviewer(docContent);

    // Step 2: Decide which claims to verify
    const claimsToVerify = claims.filter(
      (c) => c.severity === "high" || c.type === "risk",
    );
    console.log(
      `[ReviewOrchestrator] Step 2: ${claimsToVerify.length} claims selected for verification`,
    );

    // Step 3: Call Verifier for selected claims (respecting cap)
    for (const claim of claimsToVerify) {
      if (this.verifierCallCount >= this.config.maxVerifierCalls) {
        console.log(
          `[ReviewOrchestrator] Verifier call cap reached (${this.config.maxVerifierCalls}). Skipping remaining claims.`,
        );
        break;
      }

      console.log(
        `[ReviewOrchestrator] Step 3: Verifying claim: "${claim.description.slice(0, 50)}..."`,
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
    }

    const verifiedCount = claims.filter(
      (c) => c.verified === "confirmed",
    ).length;
    const unverifiedCount = claims.filter(
      (c) => c.verified === "pending",
    ).length;

    return {
      claims,
      verifiedCount,
      unverifiedCount,
      summary: `Found ${claims.length} claims. ${verifiedCount} verified, ${unverifiedCount} unverified (marked as "pending source confirmation").`,
    };
  }

  /**
   * Call the Reviewer agent.
   * In production, this invokes the agent via MCP tool.
   */
  private async callReviewer(docContent: string): Promise<ReviewClaim[]> {
    // Placeholder: In real implementation, this calls the Reviewer agent
    // via MCP tool and parses the structured output
    console.log("[ReviewOrchestrator] Reviewer agent would be called here");

    // Mock claims for demonstration
    return [
      {
        type: "gap",
        severity: "high",
        description: "Missing acceptance criteria for core feature",
        sourceSection: "Requirements",
        sourceNodeId: "doc123",
      },
      {
        type: "risk",
        severity: "high",
        description: "External dependency not specified",
        sourceSection: "Dependencies",
        sourceNodeId: "doc123",
      },
      {
        type: "recommendation",
        severity: "medium",
        description: "Consider adding error handling section",
        sourceSection: "Technical Design",
        sourceNodeId: "doc123",
      },
    ];
  }

  /**
   * Call the Verifier agent for a specific claim.
   * In production, this invokes the agent via MCP tool.
   */
  private async callVerifier(
    claim: ReviewClaim,
    docContent: string,
  ): Promise<"confirmed" | "not_found"> {
    // Placeholder: In real implementation, this calls the Verifier agent
    // via MCP tool with the claim and source doc
    console.log("[ReviewOrchestrator] Verifier agent would be called here");
    return "confirmed";
  }

  getVerifierCallCount(): number {
    return this.verifierCallCount;
  }
}
