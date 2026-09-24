/**
 * append_workspace_file — §4.11
 * Zone A: Append content to a section in a workspace file.
 * Never overwrites entire file. Section-based append.
 */
import fs from "node:fs";
import path from "node:path";

const ALLOWED_PREFIXES = [
  "_agent_memory/project_memory.md",
  "_agent_memory/glossary.md",
  "_agent_memory/decisions.md",
  "_agent_memory/open-questions.md",
  "_agent_memory/doc-index.json",
  "_agent_memory/summaries/",
  "_agent_memory/messages/",
  "_agent_memory/graph.json",
  "_agent_memory/runs/",
];

function isWhitelisted(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..") || path.isAbsolute(normalized)) return false;
  return ALLOWED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix),
  );
}

export interface AppendWorkspaceFileResult {
  ok: boolean;
  error?: string;
}

export function appendWorkspaceFile(
  relPath: string,
  section: string,
  content: string,
  cwd: string = process.cwd(),
): AppendWorkspaceFileResult {
  if (!isWhitelisted(relPath)) {
    return { ok: false, error: `Path "${relPath}" is not in workspace whitelist` };
  }

  const fullPath = path.join(cwd, relPath);

  if (!fs.existsSync(fullPath)) {
    return { ok: false, error: `File "${relPath}" does not exist. Use ensure_workspace_file first.` };
  }

  try {
    let fileContent = fs.readFileSync(fullPath, "utf-8");

    // Find section header
    const sectionRegex = new RegExp(`(## ${section}\\s*\\n)`);
    const match = fileContent.match(sectionRegex);

    if (match) {
      // Append after section header
      const insertPoint = fileContent.indexOf(match[0]) + match[0].length;
      fileContent =
        fileContent.slice(0, insertPoint) +
        content + "\n" +
        fileContent.slice(insertPoint);
    } else {
      // Section doesn't exist, append at end with header
      fileContent += `\n## ${section}\n${content}\n`;
    }

    fs.writeFileSync(fullPath, fileContent, "utf-8");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to append: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
