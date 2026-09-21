import fs from "node:fs";
import path from "node:path";
import { ScopeGuard, ScopeGuardError } from "../scope-guard.js";

export interface ReadCachedDocInput {
  node_id: string;
  cacheDir?: string;
}

export interface ReadCachedDocOutput {
  node_id: string;
  content: string | null;
  meta: {
    hash: string;
    updatedTime: string;
    type: string;
    path: string;
    syncedAt: string;
  } | null;
  error?: string;
}

/**
 * Read a document from local cache.
 * Validates scope before reading.
 */
export async function readCachedDoc(
  input: ReadCachedDocInput,
  scopeGuard: ScopeGuard,
): Promise<ReadCachedDocOutput> {
  try {
    // Scope check
    scopeGuard.assertCanRead(input.node_id);
  } catch (err) {
    if (err instanceof ScopeGuardError) {
      return {
        node_id: input.node_id,
        content: null,
        meta: null,
        error: err.message,
      };
    }
    throw err;
  }

  const cacheDir = input.cacheDir ?? ".prdcli/cache/docs";
  const metaPath = path.join(cacheDir, `${input.node_id}.meta.json`);
  const contentPath = path.join(cacheDir, `${input.node_id}.md`);

  if (!fs.existsSync(metaPath) || !fs.existsSync(contentPath)) {
    return {
      node_id: input.node_id,
      content: null,
      meta: null,
      error: `Document ${input.node_id} not found in cache`,
    };
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    const content = fs.readFileSync(contentPath, "utf-8");

    return {
      node_id: input.node_id,
      content,
      meta,
    };
  } catch (err) {
    return {
      node_id: input.node_id,
      content: null,
      meta: null,
      error: `Failed to read cached doc: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
