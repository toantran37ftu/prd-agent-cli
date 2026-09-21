import fs from "node:fs";
import path from "node:path";
import { ScopeGuard } from "../scope-guard.js";

export interface ReadSummariesInput {
  projectDir?: string;
}

export interface SummaryEntry {
  nodeId: string;
  content: string;
}

export interface ReadSummariesOutput {
  summaries: SummaryEntry[];
  count: number;
  error?: string;
}

/**
 * Read all document summaries from .prdcli/memory/summaries/
 */
export async function readSummaries(
  input: ReadSummariesInput,
  _scopeGuard: ScopeGuard,
): Promise<ReadSummariesOutput> {
  const memoryDir = input.projectDir ?? ".prdcli/memory";
  const summariesDir = path.join(memoryDir, "summaries");

  if (!fs.existsSync(summariesDir)) {
    return {
      summaries: [],
      count: 0,
    };
  }

  try {
    const files = fs.readdirSync(summariesDir).filter((f) => f.endsWith(".md"));

    const summaries: SummaryEntry[] = files.map((f) => {
      const nodeId = f.replace(".md", "");
      const content = fs.readFileSync(path.join(summariesDir, f), "utf-8");
      return { nodeId, content };
    });

    return {
      summaries,
      count: summaries.length,
    };
  } catch (err) {
    return {
      summaries: [],
      count: 0,
      error: `Failed to read summaries: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
