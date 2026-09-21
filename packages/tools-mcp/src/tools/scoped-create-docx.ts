import { ScopeGuard, ScopeGuardError } from "../scope-guard.js";

export interface ScopedCreateDocxInput {
  title: string;
  folderToken: string;
}

export interface ScopedCreateDocxOutput {
  documentId: string | null;
  success: boolean;
  error?: string;
}

/**
 * Create a new document in the current project.
 * Scope-guarded to prevent cross-project writes.
 */
export async function scopedCreateDocx(
  input: ScopedCreateDocxInput,
  scopeGuard: ScopeGuard,
): Promise<ScopedCreateDocxOutput> {
  try {
    // Verify write scope
    scopeGuard.assertCanWrite(input.folderToken);
  } catch (err) {
    if (err instanceof ScopeGuardError) {
      return {
        documentId: null,
        success: false,
        error: err.message,
      };
    }
    throw err;
  }

  // In production, calls Lark API to create document
  console.log(
    `Creating document "${input.title}" in folder ${input.folderToken}`,
  );

  // Placeholder
  return {
    documentId: null,
    success: false,
    error: "Not connected to Lark API",
  };
}
