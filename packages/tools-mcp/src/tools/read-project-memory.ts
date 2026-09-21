import fs from "node:fs";
import path from "node:path";
import { ScopeGuard } from "../scope-guard.js";

export interface ReadProjectMemoryInput {
  projectDir?: string;
}

export interface ProjectMemory {
  decisions: string[];
  openQuestions: string[];
  glossary: string[];
  risks: string[];
  raw: string;
}

export interface ReadProjectMemoryOutput {
  memory: ProjectMemory | null;
  error?: string;
}

/**
 * Read project memory from .prdcli/memory/project_memory.md
 */
export async function readProjectMemory(
  input: ReadProjectMemoryInput,
  _scopeGuard: ScopeGuard,
): Promise<ReadProjectMemoryOutput> {
  const memoryDir = input.projectDir ?? ".prdcli/memory";
  const memoryPath = path.join(memoryDir, "project_memory.md");

  if (!fs.existsSync(memoryPath)) {
    return {
      memory: null,
      error: "Project memory not found",
    };
  }

  try {
    const raw = fs.readFileSync(memoryPath, "utf-8");

    return {
      memory: {
        decisions: extractSection(raw, "Decisions"),
        openQuestions: extractSection(raw, "Open Questions"),
        glossary: extractSection(raw, "Glossary"),
        risks: extractSection(raw, "Risks"),
        raw,
      },
    };
  } catch (err) {
    return {
      memory: null,
      error: `Failed to read project memory: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

function extractSection(content: string, sectionName: string): string[] {
  const regex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  if (!match?.[1]) return [];

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || line.startsWith("- [ ]"))
    .map((line) => line.replace(/^- (\[ \] )?/, ""));
}
