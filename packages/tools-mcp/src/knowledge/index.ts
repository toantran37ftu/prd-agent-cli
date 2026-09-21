/**
 * Knowledge sync module — §4.12
 * pull/push/merge/lock for shared knowledge via Lark _agent_memory/.
 * Ensures message pool, graph, runs sync across team members.
 */
import fs from "node:fs";
import path from "node:path";

export interface KnowledgeSyncResult {
  pulled: string[];
  pushed: string[];
  merged: string[];
  errors: string[];
}

/**
 * Pull knowledge from _agent_memory/ on Lark to local .prdcli/.
 * Only downloads files whose hash has changed.
 * 
 * In real implementation, this uses lark-mcp to list/download files.
 * For now, provides the framework and local-only operations.
 */
export async function pullKnowledge(
  projectFolderToken: string,
  cwd: string = process.cwd(),
): Promise<KnowledgeSyncResult> {
  const result: KnowledgeSyncResult = {
    pulled: [],
    pushed: [],
    merged: [],
    errors: [],
  };

  // Ensure local directories exist
  const dirs = [
    ".prdcli/messages",
    ".prdcli/memory",
    ".prdcli/runs",
  ];
  for (const dir of dirs) {
    const fullPath = path.join(cwd, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // TODO: In real implementation:
  // 1. List _agent_memory/ on Lark
  // 2. Compare hashes with local
  // 3. Download changed files
  // 4. Merge project_memory by section (append + dedupe)
  // 5. Load message pool + graph

  return result;
}

/**
 * Push knowledge from local .prdcli/ to _agent_memory/ on Lark.
 * Acquires lock, pulls again, merges, then pushes.
 * 
 * In real implementation, this uses lark-mcp with lock files.
 */
export async function pushKnowledge(
  projectFolderToken: string,
  memoryFolderToken: string,
  cwd: string = process.cwd(),
): Promise<KnowledgeSyncResult> {
  const result: KnowledgeSyncResult = {
    pulled: [],
    pushed: [],
    merged: [],
    errors: [],
  };

  // TODO: In real implementation:
  // 1. Acquire lock (locks/<file>.lock with TTL)
  // 2. Pull latest from Lark
  // 3. Merge local changes with remote
  // 4. Push merged result
  // 5. Release lock

  return result;
}

/**
 * Merge project memory by section (append + dedupe).
 * Never overwrite entire file.
 */
export function mergeMemorySections(
  local: string,
  remote: string,
): string {
  if (!remote.trim()) return local;
  if (!local.trim()) return remote;

  // Parse sections from both
  const localSections = parseSections(local);
  const remoteSections = parseSections(remote);

  // Merge: keep all entries from both, dedupe by content
  const merged: Record<string, string[]> = {};

  for (const [section, entries] of Object.entries(localSections)) {
    merged[section] = [...entries];
  }

  for (const [section, entries] of Object.entries(remoteSections)) {
    if (!merged[section]) {
      merged[section] = [];
    }
    // Add entries not already present (simple content match)
    for (const entry of entries) {
      const normalized = entry.trim().toLowerCase();
      const exists = merged[section].some(
        (e) => e.trim().toLowerCase() === normalized,
      );
      if (!exists) {
        merged[section].push(entry);
      }
    }
  }

  // Reconstruct markdown
  const lines: string[] = [];
  for (const [section, entries] of Object.entries(merged)) {
    lines.push(`## ${section}`);
    lines.push(...entries);
    lines.push("");
  }

  return lines.join("\n");
}

function parseSections(md: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection = "";
  let currentEntries: string[] = [];

  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) {
      if (currentSection) {
        sections[currentSection] = currentEntries;
      }
      currentSection = line.replace("## ", "").trim();
      currentEntries = [];
    } else if (currentSection && line.trim()) {
      currentEntries.push(line);
    }
  }

  if (currentSection) {
    sections[currentSection] = currentEntries;
  }

  return sections;
}

/**
 * Acquire a lock file with TTL for concurrent write safety.
 */
export function acquireLock(
  lockName: string,
  ttlMinutes: number = 5,
  cwd: string = process.cwd(),
): boolean {
  const lockDir = path.join(cwd, ".prdcli", "locks");
  if (!fs.existsSync(lockDir)) fs.mkdirSync(lockDir, { recursive: true });

  const lockPath = path.join(lockDir, `${lockName}.lock`);

  // Check if lock exists and is still valid
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
      const lockTime = new Date(lock.created_at).getTime();
      const now = Date.now();
      if (now - lockTime < ttlMinutes * 60 * 1000) {
        return false; // Lock still held
      }
    } catch {
      // Corrupt lock, overwrite
    }
  }

  fs.writeFileSync(
    lockPath,
    JSON.stringify({ created_at: new Date().toISOString(), pid: process.pid }),
  );
  return true;
}

/**
 * Release a lock file.
 */
export function releaseLock(lockName: string, cwd: string = process.cwd()): void {
  const lockPath = path.join(cwd, ".prdcli", "locks", `${lockName}.lock`);
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}
