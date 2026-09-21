import { ScopeGuard, ScopeGuardError } from "../scope-guard.js";

export interface ScopedUpdateDocxInput {
  nodeId: string;
  content: string; // markdown content to append
}

export interface ScopedUpdateDocxOutput {
  success: boolean;
  error?: string;
}

/**
 * Update/append content to an existing document.
 * Scope-guarded to prevent cross-project writes.
 */
export async function scopedUpdateDocx(
  input: ScopedUpdateDocxInput,
  scopeGuard: ScopeGuard,
): Promise<ScopedUpdateDocxOutput> {
  try {
    // Verify write scope
    scopeGuard.assertCanWrite(input.nodeId);
  } catch (err) {
    if (err instanceof ScopeGuardError) {
      return {
        success: false,
        error: err.message,
      };
    }
    throw err;
  }

  // In production, calls Lark API to update document
  console.log(
    `Updating document ${input.nodeId} with ${input.content.length} chars`,
  );

  // Placeholder
  return {
    success: false,
    error: "Not connected to Lark API",
  };
}
