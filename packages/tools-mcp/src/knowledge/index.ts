/**
 * Knowledge sync module — §4.12
 * pull/push/merge/lock for shared knowledge.
 * Local-only mode: reads/writes from _agent_memory/ in project folder.
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
 * Pull knowledge from _agent_memory/ to local .prdcli/.
 * Local-only mode: copies from project's _agent_memory/ to .prdcli/.
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
  const dirs = [".prdcli/messages", ".prdcli/memory", ".prdcli/runs"];
  for (const dir of dirs) {
    const fullPath = path.join(cwd, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Local-only: check if _agent_memory exists in project
  const agentMemoryDir = path.join(cwd, "_agent_memory");
  if (!fs.existsSync(agentMemoryDir)) {
    return result;
  }

  // Copy messages
  const remoteMessagesDir = path.join(agentMemoryDir, "messages");
  const localMessagesDir = path.join(cwd, ".prdcli", "messages", "default");
  if (fs.existsSync(remoteMessagesDir)) {
    copyDir(remoteMessagesDir, localMessagesDir, result.pulled);
  }

  // Copy graph
  const remoteGraph = path.join(agentMemoryDir, "graph.json");
  const localGraph = path.join(cwd, ".prdcli", "graph.json");
  if (fs.existsSync(remoteGraph)) {
    fs.copyFileSync(remoteGraph, localGraph);
    result.pulled.push("graph.json");
  }

  // Merge project_memory
  const remoteMemory = path.join(agentMemoryDir, "project_memory.md");
  const localMemory = path.join(cwd, ".prdcli", "memory", "project_memory.md");
  if (fs.existsSync(remoteMemory)) {
    const remoteContent = fs.readFileSync(remoteMemory, "utf-8");
    if (fs.existsSync(localMemory)) {
      const localContent = fs.readFileSync(localMemory, "utf-8");
      const merged = mergeMemorySections(localContent, remoteContent);
      fs.writeFileSync(localMemory, merged);
      result.merged.push("project_memory.md");
    } else {
      fs.copyFileSync(remoteMemory, localMemory);
      result.pulled.push("project_memory.md");
    }
  }

  return result;
}

/**
 * Push knowledge from local .prdcli/ to _agent_memory/.
 * Local-only mode: copies from .prdcli/ to project's _agent_memory/.
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

  const agentMemoryDir = path.join(cwd, "_agent_memory");
  if (!fs.existsSync(agentMemoryDir)) {
    fs.mkdirSync(agentMemoryDir, { recursive: true });
  }

  // Push messages
  const localMessagesDir = path.join(cwd, ".prdcli", "messages", "default");
  const remoteMessagesDir = path.join(agentMemoryDir, "messages");
  if (fs.existsSync(localMessagesDir)) {
    copyDir(localMessagesDir, remoteMessagesDir, result.pushed);
  }

  // Push graph
  const localGraph = path.join(cwd, ".prdcli", "graph.json");
  const remoteGraph = path.join(agentMemoryDir, "graph.json");
  if (fs.existsSync(localGraph)) {
    fs.copyFileSync(localGraph, remoteGraph);
    result.pushed.push("graph.json");
  }

  // Merge project_memory
  const localMemory = path.join(cwd, ".prdcli", "memory", "project_memory.md");
  const remoteMemory = path.join(agentMemoryDir, "project_memory.md");
  if (fs.existsSync(localMemory)) {
    const localContent = fs.readFileSync(localMemory, "utf-8");
    if (fs.existsSync(remoteMemory)) {
      const remoteContent = fs.readFileSync(remoteMemory, "utf-8");
      const merged = mergeMemorySections(remoteContent, localContent);
      fs.writeFileSync(remoteMemory, merged);
      result.merged.push("project_memory.md");
    } else {
      fs.copyFileSync(localMemory, remoteMemory);
      result.pushed.push("project_memory.md");
    }
  }

  return result;
}

/**
 * Get knowledge sync status.
 */
export function getKnowledgeStatus(cwd: string = process.cwd()): {
  hasAgentMemory: boolean;
  localMessages: number;
  remoteMessages: number;
  localGraph: boolean;
  remoteGraph: boolean;
} {
  const agentMemoryDir = path.join(cwd, "_agent_memory");
  const localMessagesDir = path.join(cwd, ".prdcli", "messages", "default");

  return {
    hasAgentMemory: fs.existsSync(agentMemoryDir),
    localMessages: countFiles(localMessagesDir),
    remoteMessages: countFiles(path.join(agentMemoryDir, "messages")),
    localGraph: fs.existsSync(path.join(cwd, ".prdcli", "graph.json")),
    remoteGraph: fs.existsSync(path.join(agentMemoryDir, "graph.json")),
  };
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

function copyDir(src: string, dest: string, copied: string[]): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const files = fs.readdirSync(src);
  for (const file of files) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, destPath);
      copied.push(file);
    }
  }
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

  const localSections = parseSections(local);
  const remoteSections = parseSections(remote);

  const merged: Record<string, string[]> = {};
  for (const [section, entries] of Object.entries(localSections)) {
    merged[section] = [...entries];
  }
  for (const [section, entries] of Object.entries(remoteSections)) {
    if (!merged[section]) merged[section] = [];
    for (const entry of entries) {
      const normalized = entry.trim().toLowerCase();
      const exists = merged[section].some(
        (e) => e.trim().toLowerCase() === normalized,
      );
      if (!exists) merged[section].push(entry);
    }
  }

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
      if (currentSection) sections[currentSection] = currentEntries;
      currentSection = line.replace("## ", "").trim();
      currentEntries = [];
    } else if (currentSection && line.trim()) {
      currentEntries.push(line);
    }
  }
  if (currentSection) sections[currentSection] = currentEntries;
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

  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
      const lockTime = new Date(lock.created_at).getTime();
      if (Date.now() - lockTime < ttlMinutes * 60 * 1000) return false;
    } catch { /* corrupt lock */ }
  }

  fs.writeFileSync(lockPath, JSON.stringify({ created_at: new Date().toISOString(), pid: process.pid }));
  return true;
}

export function releaseLock(lockName: string, cwd: string = process.cwd()): void {
  const lockPath = path.join(cwd, ".prdcli", "locks", `${lockName}.lock`);
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
}
