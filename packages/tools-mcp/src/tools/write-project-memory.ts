import fs from "node:fs";
import path from "node:path";
import { ScopeGuard } from "../scope-guard.js";

export interface WriteProjectMemoryInput {
  section: "Decisions" | "Open Questions" | "Glossary" | "Risks";
  entries: string[];
  projectDir?: string;
}

export interface WriteProjectMemoryOutput {
  success: boolean;
  addedCount: number;
  error?: string;
}

/**
 * Write entries to a specific section of project memory.
 * Uses append + dedupe strategy to avoid overwriting.
 */
export async function writeProjectMemory(
  input: WriteProjectMemoryInput,
  _scopeGuard: ScopeGuard,
): Promise<WriteProjectMemoryOutput> {
  const memoryDir = input.projectDir ?? ".prdcli/memory";
  const memoryPath = path.join(memoryDir, "project_memory.md");

  if (!fs.existsSync(memoryPath)) {
    return {
      success: false,
      addedCount: 0,
      error: "Project memory file not found",
    };
  }

  try {
    let content = fs.readFileSync(memoryPath, "utf-8");

    // Find the section
    const sectionRegex = new RegExp(`(## ${input.section}\\s*\\n)`);
    const match = content.match(sectionRegex);

    if (!match) {
      return {
        success: false,
        addedCount: 0,
        error: `Section "${input.section}" not found in project memory`,
      };
    }

    // Parse existing entries to deduplicate
    const existingEntries = extractEntries(content, input.section);
    const newEntries = input.entries.filter(
      (entry) => !existingEntries.includes(entry),
    );

    if (newEntries.length === 0) {
      return {
        success: true,
        addedCount: 0,
      };
    }

    // Insert new entries after section header
    const insertPoint = content.indexOf(match[0]) + match[0].length;
    const formattedEntries =
      newEntries.map((e) => `- ${e}`).join("\n") + "\n";

    content =
      content.slice(0, insertPoint) +
      formattedEntries +
      content.slice(insertPoint);

    fs.writeFileSync(memoryPath, content);

    return {
      success: true,
      addedCount: newEntries.length,
    };
  } catch (err) {
    return {
      success: false,
      addedCount: 0,
      error: `Failed to write project memory: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

function extractEntries(content: string, sectionName: string): string[] {
  const regex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  if (!match?.[1]) return [];

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || line.startsWith("- [ ]"))
    .map((line) => line.replace(/^- (\[ \] )?/, ""));
}
