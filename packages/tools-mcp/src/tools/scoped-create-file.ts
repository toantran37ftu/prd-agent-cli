/**
 * scoped_create_file — §4.11
 * Zone B: Create a file in project folder (md/csv/json).
 * Returns pending_write_id; only executes after L3 gate approval.
 * In local-only mode, writes directly but logs pending.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ScopeGuard, ScopeGuardError } from "../scope-guard.js";

export interface ScopedCreateFileResult {
  pending_write_id: string;
  approved: boolean;
  path: string;
  error?: string;
}

export function scopedCreateFile(
  relPathInProject: string,
  content: string,
  kind: "md" | "csv" | "json",
  scopeGuard: ScopeGuard,
  projectFolderToken: string,
  cwd: string = process.cwd(),
): ScopedCreateFileResult {
  const pendingId = `pw_${crypto.randomBytes(4).toString("hex")}`;

  try {
    scopeGuard.assertCanWrite(projectFolderToken);
  } catch (err) {
    if (err instanceof ScopeGuardError) {
      return {
        pending_write_id: pendingId,
        approved: false,
        path: relPathInProject,
        error: err.message,
      };
    }
    throw err;
  }

  // Validate extension
  const ext = path.extname(relPathInProject);
  if (ext && !`.${kind}`.includes(ext)) {
    return {
      pending_write_id: pendingId,
      approved: false,
      path: relPathInProject,
      error: `File extension mismatch: expected .${kind}, got ${ext}`,
    };
  }

  // In local-only mode, write directly
  const fullPath = path.join(cwd, relPathInProject);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, content, "utf-8");

  return {
    pending_write_id: pendingId,
    approved: true,
    path: fullPath,
  };
}
