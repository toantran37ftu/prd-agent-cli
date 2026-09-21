/**
 * Claim model — §4.4
 * 6 claim types with CL-1..CL-5 code enforcement rules.
 */
import { z } from "zod";

export const ClaimType = z.enum([
  "gap",              // tài liệu CÓ nói và nội dung thiếu/sai → phát biểu về nội dung
  "contradiction",    // hai nguồn nói ngược nhau → phải cite ≥2 node
  "risk",             // rủi ro suy ra từ nội dung có nguồn
  "not_documented",   // tài liệu KHÔNG nhắc tới → phát biểu về tài liệu, KHÔNG về thực tế
  "cannot_determine", // không đủ dữ liệu/doc bị truncate/không có quyền đọc
  "recommendation",   // đề xuất, ngoài checklist
]);

export type ClaimType = z.infer<typeof ClaimType>;

export const EvidenceLevel = z.enum(["full_doc", "summary_only"]);
export type EvidenceLevel = z.infer<typeof EvidenceLevel>;

export const ClaimEvidence = z.object({
  node_id: z.string(),
  quote: z.string().max(300),         // BẮT BUỘC với type ∈ {gap, contradiction, risk}
  evidence_level: EvidenceLevel,
});

export const Claim = z.object({
  id: z.string(),                     // code gán: c1, c2...
  type: ClaimType,
  checklist_item_id: z.string(),      // trỏ về registry §8
  text: z.string(),
  evidence: z.array(ClaimEvidence),
  severity: z.enum(["high", "medium", "low"]),
  verification_status: z.enum([
    "confirmed",
    "partially_supported",
    "not_found",
    "not_checked",
  ]),
});

export type Claim = z.infer<typeof Claim>;
export type ClaimEvidence = z.infer<typeof ClaimEvidence>;

/**
 * CL-1..CL-5 enforcement — run by code, not by prompt.
 * Returns list of violations. Empty = valid.
 */
export function enforceClaimRules(claim: Claim): string[] {
  const violations: string[] = [];

  // CL-1: type = not_documented → severity forced to low,
  //        text must start with "Tài liệu không ghi nhận" or "PRD không đề cập"
  if (claim.type === "not_documented") {
    if (claim.severity !== "low") {
      violations.push(
        `CL-1: not_documented claim must have severity=low, got ${claim.severity}`,
      );
    }
    if (
      !claim.text.startsWith("Tài liệu không ghi nhận") &&
      !claim.text.startsWith("PRD không đề cập")
    ) {
      violations.push(
        `CL-1: not_documented claim text must start with "Tài liệu không ghi nhận" or "PRD không đề cập"`,
      );
    }
  }

  // CL-2: type ∈ {gap, contradiction, risk} → must have ≥1 non-empty evidence.quote
  if (["gap", "contradiction", "risk"].includes(claim.type)) {
    const hasQuote = claim.evidence.some((e) => e.quote.trim().length > 0);
    if (!hasQuote) {
      violations.push(
        `CL-2: ${claim.type} claim must have at least one non-empty evidence.quote`,
      );
    }
  }

  // CL-3: type = contradiction → must have ≥2 different node_ids
  if (claim.type === "contradiction") {
    const uniqueNodes = new Set(claim.evidence.map((e) => e.node_id));
    if (uniqueNodes.size < 2) {
      violations.push(
        `CL-3: contradiction claim must cite at least 2 different node_ids`,
      );
    }
  }

  // CL-4: evidence_level = summary_only → severity ceiling = low
  if (
    claim.evidence.some((e) => e.evidence_level === "summary_only") &&
    claim.severity !== "low"
  ) {
    violations.push(
      `CL-4: claim with summary_only evidence must have severity=low, got ${claim.severity}`,
    );
  }

  // CL-5: type = cannot_determine → severity cannot be high; rendered as question
  if (claim.type === "cannot_determine" && claim.severity === "high") {
    violations.push(
      `CL-5: cannot_determine claim cannot have severity=high`,
    );
  }

  return violations;
}

/**
 * Validate and enforce rules on a batch of claims.
 * Returns {valid, rejected} with reasons.
 */
export function validateClaims(claims: Claim[]): {
  valid: Claim[];
  rejected: Array<{ claim: Claim; violations: string[] }>;
} {
  const valid: Claim[] = [];
  const rejected: Array<{ claim: Claim; violations: string[] }> = [];

  for (const claim of claims) {
    const violations = enforceClaimRules(claim);
    if (violations.length === 0) {
      valid.push(claim);
    } else {
      rejected.push({ claim, violations });
    }
  }

  return { valid, rejected };
}
