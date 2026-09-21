import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface CachedDocMeta {
  nodeId: string;
  hash: string;
  updatedTime: string;
  type: "docx" | "sheet" | "bitable" | "wiki";
  path: string; // display path in Lark folder tree
  syncedAt: string;
}

export interface CachedDoc {
  meta: CachedDocMeta;
  content: string; // markdown content
}

const CACHE_DIR = ".prdcli/cache/docs";
const RUNS_DIR = ".prdcli/runs";
const MEMORY_DIR = ".prdcli/memory";

export function getCacheDir(cwd: string = process.cwd()): string {
  return path.join(cwd, CACHE_DIR);
}

export function getRunsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, RUNS_DIR);
}

export function getMemoryDir(cwd: string = process.cwd()): string {
  return path.join(cwd, MEMORY_DIR);
}

export function ensureDirs(cwd: string = process.cwd()): void {
  for (const dir of [getCacheDir(cwd), getRunsDir(cwd), getMemoryDir(cwd)]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function getCachedDoc(
  nodeId: string,
  cwd: string = process.cwd(),
): CachedDoc | null {
  const metaPath = path.join(getCacheDir(cwd), `${nodeId}.meta.json`);
  const contentPath = path.join(getCacheDir(cwd), `${nodeId}.md`);

  if (!fs.existsSync(metaPath) || !fs.existsSync(contentPath)) return null;

  try {
    const meta = JSON.parse(
      fs.readFileSync(metaPath, "utf-8"),
    ) as CachedDocMeta;
    const content = fs.readFileSync(contentPath, "utf-8");
    return { meta, content };
  } catch {
    return null;
  }
}

export function saveCachedDoc(
  nodeId: string,
  content: string,
  meta: Omit<CachedDocMeta, "hash" | "syncedAt">,
  cwd: string = process.cwd(),
): CachedDocMeta {
  ensureDirs(cwd);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const fullMeta: CachedDocMeta = {
    ...meta,
    hash,
    syncedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(getCacheDir(cwd), `${nodeId}.meta.json`),
    JSON.stringify(fullMeta, null, 2),
  );
  fs.writeFileSync(
    path.join(getCacheDir(cwd), `${nodeId}.md`),
    content,
  );

  return fullMeta;
}

export function listCachedDocs(cwd: string = process.cwd()): CachedDocMeta[] {
  const cacheDir = getCacheDir(cwd);
  if (!fs.existsSync(cacheDir)) return [];

  const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".meta.json"));
  return files
    .map((f) => {
      try {
        const raw = fs.readFileSync(path.join(cacheDir, f), "utf-8");
        return JSON.parse(raw) as CachedDocMeta;
      } catch {
        return null;
      }
    })
    .filter((m): m is CachedDocMeta => m !== null);
}

export function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// Run logs
export function saveRunLog(
  command: string,
  content: string,
  cwd: string = process.cwd(),
): string {
  const runsDir = getRunsDir(cwd);
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const filename = `${timestamp}_${command}.md`;
  const filepath = path.join(runsDir, filename);
  fs.writeFileSync(filepath, content);
  return filepath;
}
