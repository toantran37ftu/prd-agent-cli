/**
 * L1-NUMBER — §4.5
 * Every number in draft must appear literally in at least one cited node.
 * Excludes REQ-xxx IDs and dates from the source doc itself.
 */
import fs from "node:fs";
import path from "node:path";
import type { LintResult } from "./quote.js";

/** Extract number tokens from text, excluding REQ IDs and ISO dates */
export function extractNumbers(text: string): string[] {
  // Remove REQ-xxx references
  const cleaned = text.replace(/REQ-\d+/g, "");
  // Remove ISO dates (YYYY-MM-DD)
  const cleaned2 = cleaned.replace(/\d{4}-\d{2}-\d{2}/g, "");
  // Remove version numbers (v0.1, v1.0)
  const cleaned3 = cleaned2.replace(/v\d+\.\d+/g, "");

  // Match numbers with optional %, currency, units
  const matches = cleaned3.match(/\d[\d.,]*\s*%?|\$[\d.,]+/g);
  return matches ?? [];
}

export function checkNumbersInSource(
  draftText: string,
  citedNodeIds: string[],
  cwd: string = process.cwd(),
): LintResult[] {
  const numbers = extractNumbers(draftText);
  const results: LintResult[] = [];

  // Load all cited docs
  const docContents: string[] = [];
  for (const nodeId of citedNodeIds) {
    const docPath = path.join(cwd, ".prdcli", "cache", "docs", `${nodeId}.md`);
    if (fs.existsSync(docPath)) {
      docContents.push(fs.readFileSync(docPath, "utf-8"));
    }
  }

  for (const num of numbers) {
    const found = docContents.some((doc) => doc.includes(num));
    if (!found) {
      results.push({
        rule: "L1-NUMBER",
        passed: false,
        severity: "high",
        message: `Number "${num}" not found in any cited source document`,
      });
    }
  }

  return results;
}
