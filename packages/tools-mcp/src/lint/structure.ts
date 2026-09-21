/**
 * L1 structure checks — §4.5
 * L1-MARKER, L1-AC, L1-P0, L1-METRIC, L1-SUMMARY, L1-OQ, L1-PROCESS
 */
import type { LintResult } from "./quote.js";

/** L1-MARKER: check [[src:node|type=..|date=..]] syntax */
export function checkMarkers(text: string): LintResult[] {
  const results: LintResult[] = [];
  const markerRegex = /\[\[src:([^\]|]+)(\|[^\]]+)?\]\]/g;
  let match;

  while ((match = markerRegex.exec(text)) !== null) {
    const full = match[0];
    const nodeId = match[1];
    const attrs = match[2] || "";

    if (!nodeId.trim()) {
      results.push({
        rule: "L1-MARKER",
        passed: false,
        severity: "medium",
        message: `Marker missing node_id: ${full}`,
      });
    }

    // Check for type and date attributes
    if (!attrs.includes("type=")) {
      results.push({
        rule: "L1-MARKER",
        passed: false,
        severity: "medium",
        message: `Marker missing type attribute: ${full}`,
      });
    }
    if (!attrs.includes("date=")) {
      results.push({
        rule: "L1-MARKER",
        passed: false,
        severity: "medium",
        message: `Marker missing date attribute: ${full}`,
      });
    }
  }

  return results;
}

/** L1-AC: REQ blocks must have acceptance criteria or escape hatch label */
export function checkAcceptanceCriteria(text: string): LintResult[] {
  const results: LintResult[] = [];
  const reqBlocks = text.split(/(?=###?\s*REQ-)/i);

  for (const block of reqBlocks) {
    const reqMatch = block.match(/REQ-(\d+)/i);
    if (!reqMatch) continue;

    const reqId = `REQ-${reqMatch[1]}`;
    const hasAC =
      block.toLowerCase().includes("acceptance criteria") ||
      block.toLowerCase().includes("ac:");
    const hasEscapeHatch =
      block.includes("[GIẢ ĐỊNH") ||
      block.includes("[CHƯA XÁC ĐỊNH");

    if (!hasAC && !hasEscapeHatch) {
      results.push({
        rule: "L1-AC",
        passed: false,
        severity: "medium",
        message: `${reqId} missing acceptance criteria and no escape hatch label`,
        location: reqId,
      });
    }
  }

  return results;
}

/** L1-P0: ratio of P0 requirements (warn if too high) */
export function checkP0Ratio(
  text: string,
  maxRatio: number = 0.6,
): LintResult[] {
  const results: LintResult[] = [];
  const reqMatches = text.match(/REQ-\d+/gi);
  if (!reqMatches || reqMatches.length === 0) return results;

  const totalReqs = new Set(reqMatches.map((m) => m.toUpperCase())).size;
  const p0Blocks = text.split(/(?=###?\s*REQ-)/i).filter(
    (block) => /priority[:\s]*P0/i.test(block),
  );
  const p0Count = p0Blocks.length;

  if (totalReqs > 0 && p0Count / totalReqs > maxRatio) {
    results.push({
      rule: "L1-P0",
      passed: false,
      severity: "low",
      message: `High P0 ratio: ${p0Count}/${totalReqs} (${Math.round((p0Count / totalReqs) * 100)}%) > ${Math.round(maxRatio * 100)}%`,
    });
  }

  return results;
}

/** L1-METRIC: metrics must have baseline + target + measurement time */
export function checkMetrics(text: string): LintResult[] {
  const results: LintResult[] = [];
  const metricSection = text.match(/success\s*metrics?([\s\S]*?)(?=\n##|\n#|$)/i);
  if (!metricSection) return results;

  const tableRows = metricSection[1].match(/\|.+\|/g) || [];
  for (const row of tableRows) {
    if (row.includes("---")) continue; // separator
    if (row.toLowerCase().includes("metric")) continue; // header

    const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 4) continue;

    const [name, , baseline, target] = cells;
    if (name && (!baseline || baseline === "" || !target || target === "")) {
      results.push({
        rule: "L1-METRIC",
        passed: false,
        severity: "medium",
        message: `Metric "${name}" missing baseline or target`,
      });
    }
  }

  return results;
}

/** L1-PROCESS: Status/Approver/Approval date must be TBD (agent cannot fill) */
export function checkProcessFields(text: string): LintResult[] {
  const results: LintResult[] = [];
  const processFields = ["Status", "Approver", "Approval date", "Reviewer"];

  for (const field of processFields) {
    const regex = new RegExp(`\\|\\s*${field}\\s*\\|\\s*([^T|]+)\\|`, "i");
    const match = text.match(regex);
    if (match && match[1].trim() && !match[1].trim().startsWith("TBD")) {
      results.push({
        rule: "L1-PROCESS",
        passed: false,
        severity: "high",
        message: `Process field "${field}" has value "${match[1].trim()}" — only human can fill this`,
      });
    }
  }

  return results;
}

/** L1-OQ: Open Questions must have status; owner/due must be unassigned */
export function checkOpenQuestions(text: string): LintResult[] {
  const results: LintResult[] = [];
  const oqSection = text.match(/open\s*questions?([\s\S]*?)(?=\n##|\n#|$)/i);
  if (!oqSection) return results;

  // Check for agent-filled owner/due
  if (/owner[:\s]*(?!unassigned)[A-Z]/i.test(oqSection[1])) {
    results.push({
      rule: "L1-OQ",
      passed: false,
      severity: "high",
      message: "Agent filled owner field in Open Questions (must be unassigned)",
    });
  }
  if (/due[:\s]*(?!unassigned)\d/i.test(oqSection[1])) {
    results.push({
      rule: "L1-OQ",
      passed: false,
      severity: "high",
      message: "Agent filled due field in Open Questions (must be unassigned)",
    });
  }

  return results;
}

/** L1-SUMMARY: executive summary facts must appear in body too */
export function checkSummarySubset(
  summaryText: string,
  bodyText: string,
): LintResult[] {
  const results: LintResult[] = [];
  // Extract factual sentences from summary (those with numbers or specific claims)
  const sentences = summaryText
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .filter((s) => /\d+%|\d+\s*(users|người|requests|phiên)/i.test(s));

  for (const sentence of sentences) {
    // Check if the fact appears in body
    const keyPhrase = sentence
      .replace(/\d+[\d.,]*\s*%?/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50);

    if (keyPhrase.length > 10 && !bodyText.toLowerCase().includes(keyPhrase.toLowerCase())) {
      results.push({
        rule: "L1-SUMMARY",
        passed: false,
        severity: "high",
        message: `Summary fact not found in body: "${sentence.slice(0, 80)}..."`,
      });
    }
  }

  return results;
}
