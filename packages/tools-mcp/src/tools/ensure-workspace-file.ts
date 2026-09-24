/**
 * ensure_workspace_file — §4.11
 * Zone A: Create file in internal workspace if not exists.
 * Whitelist-enforced: only paths in ALLOWED_PATHS can be created.
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
  // Reject path traversal
  if (normalized.includes("..") || path.isAbsolute(normalized)) return false;
  return ALLOWED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix),
  );
}

export interface EnsureWorkspaceFileResult {
  created: boolean;
  path: string;
  error?: string;
}

export function ensureWorkspaceFile(
  relPath: string,
  initialContent?: string,
  cwd: string = process.cwd(),
): EnsureWorkspaceFileResult {
  if (!isWhitelisted(relPath)) {
    return {
      created: false,
      path: relPath,
      error: `Path "${relPath}" is not in workspace whitelist`,
    };
  }

  const fullPath = path.join(cwd, relPath);

  if (fs.existsSync(fullPath)) {
    return { created: false, path: fullPath };
  }

  // Create parent directories
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, initialContent ?? "", "utf-8");
  return { created: true, path: fullPath };
}
