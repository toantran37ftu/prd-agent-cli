/**
 * L1 Lint index — §4.5
 * Runs all deterministic lint rules before LLM verification.
 * 0 tokens consumed.
 */
import { quoteExistsInSource, type LintResult } from "./quote.js";
import { checkNumbersInSource } from "./number.js";
import { checkVagueTerms } from "./vague-vi.js";
import {
  checkMarkers,
  checkAcceptanceCriteria,
  checkP0Ratio,
  checkMetrics,
  checkProcessFields,
  checkOpenQuestions,
  checkSummarySubset,
} from "./structure.js";

export type { LintResult };

export interface LintReport {
  rule: string;
  results: LintResult[];
  passed: boolean;
}

/**
 * Run all L1 lint rules on a draft/review.
 * @param text - The full draft/review text
 * @param citedNodeIds - Node IDs cited in the text
 * @param summaryText - Optional executive summary text for L1-SUMMARY
 * @param maxP0Ratio - Max P0 ratio threshold
 */
export function runAllLint(
  text: string,
  citedNodeIds: string[] = [],
  summaryText?: string,
  maxP0Ratio: number = 0.6,
): { reports: LintReport[]; allPassed: boolean; issueCount: number } {
  const reports: LintReport[] = [];
  let issueCount = 0;

  // L1-MARKER
  const markerResults = checkMarkers(text);
  reports.push({ rule: "L1-MARKER", results: markerResults, passed: markerResults.length === 0 });
  issueCount += markerResults.length;

  // L1-AC
  const acResults = checkAcceptanceCriteria(text);
  reports.push({ rule: "L1-AC", results: acResults, passed: acResults.length === 0 });
  issueCount += acResults.length;

  // L1-P0
  const p0Results = checkP0Ratio(text, maxP0Ratio);
  reports.push({ rule: "L1-P0", results: p0Results, passed: p0Results.length === 0 });
  issueCount += p0Results.length;

  // L1-METRIC
  const metricResults = checkMetrics(text);
  reports.push({ rule: "L1-METRIC", results: metricResults, passed: metricResults.length === 0 });
  issueCount += metricResults.length;

  // L1-PROCESS
  const processResults = checkProcessFields(text);
  reports.push({ rule: "L1-PROCESS", results: processResults, passed: processResults.length === 0 });
  issueCount += processResults.length;

  // L1-OQ
  const oqResults = checkOpenQuestions(text);
  reports.push({ rule: "L1-OQ", results: oqResults, passed: oqResults.length === 0 });
  issueCount += oqResults.length;

  // L1-VAGUE
  const vagueResults = checkVagueTerms(text);
  reports.push({ rule: "L1-VAGUE", results: vagueResults, passed: vagueResults.length === 0 });
  issueCount += vagueResults.length;

  // L1-NUMBER (needs cited docs)
  if (citedNodeIds.length > 0) {
    const numberResults = checkNumbersInSource(text, citedNodeIds);
    reports.push({ rule: "L1-NUMBER", results: numberResults, passed: numberResults.length === 0 });
    issueCount += numberResults.length;
  }

  // L1-SUMMARY (needs summary text)
  if (summaryText) {
    const summaryResults = checkSummarySubset(summaryText, text);
    reports.push({ rule: "L1-SUMMARY", results: summaryResults, passed: summaryResults.length === 0 });
    issueCount += summaryResults.length;
  }

  return {
    reports,
    allPassed: reports.every((r) => r.passed),
    issueCount,
  };
}

/**
 * Run quote verification on individual claims (used in review flow step 6).
 */
export function verifyClaimQuotes(
  claims: Array<{ id: string; evidence: Array<{ node_id: string; quote: string }> }>,
): Map<string, "found" | "not_found"> {
  const results = new Map<string, "found" | "not_found">();

  for (const claim of claims) {
    for (const ev of claim.evidence) {
      if (!ev.quote.trim()) {
        results.set(`${claim.id}:${ev.node_id}`, "not_found");
        continue;
      }
      const { found } = quoteExistsInSource(ev.quote, ev.node_id);
      results.set(`${claim.id}:${ev.node_id}`, found ? "found" : "not_found");
    }
  }

  return results;
}

/**
 * Render lint report as markdown for display.
 */
export function renderLintReport(reports: LintReport[]): string {
  const lines: string[] = ["# L1 Lint Report", ""];

  for (const report of reports) {
    const icon = report.passed ? "PASS" : "FAIL";
    lines.push(`## ${icon} ${report.rule}`);

    if (report.results.length === 0) {
      lines.push("No issues found.");
    } else {
      for (const r of report.results) {
        lines.push(`- [${r.severity.toUpperCase()}] ${r.message}${r.location ? ` (${r.location})` : ""}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
