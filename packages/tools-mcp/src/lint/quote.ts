/**
 * L1-QUOTE — §4.5
 * Verify that every evidence.quote appears literally in the cached doc.
 * Normalizes whitespace before comparison.
 */
import fs from "node:fs";
import path from "node:path";

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function quoteExistsInSource(
  quote: string,
  nodeId: string,
  cwd: string = process.cwd(),
): { found: boolean; error?: string } {
  if (!quote.trim()) return { found: false, error: "Empty quote" };

  const docPath = path.join(cwd, ".prdcli", "cache", "docs", `${nodeId}.md`);
  if (!fs.existsSync(docPath)) {
    return { found: false, error: `Document ${nodeId} not in cache` };
  }

  const doc = fs.readFileSync(docPath, "utf-8");
  const normalizedDoc = normalizeWhitespace(doc);
  const normalizedQuote = normalizeWhitespace(quote);

  const found = normalizedDoc.includes(normalizedQuote);
  return { found };
}

export interface LintResult {
  rule: string;
  passed: boolean;
  severity: "high" | "medium" | "low";
  message: string;
  location?: string;
}
