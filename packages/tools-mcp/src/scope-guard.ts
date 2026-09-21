/**
 * Scope Guard — PRD Section 1
 *
 * Validates that any node operation targets a node within the root folder tree.
 * This is a security measure against prompt injection and incorrect Supervisor decisions.
 */

export const ROOT_FOLDER_TOKEN = "Xd7GfvPW7l0y5fdH1MEjPrbmpwh";

export interface ScopeGuardConfig {
  rootFolderToken: string;
  allowedProjectTokens: Set<string>;
  currentProjectToken?: string;
}

export class ScopeGuard {
  private config: ScopeGuardConfig;

  constructor(config?: Partial<ScopeGuardConfig>) {
    this.config = {
      rootFolderToken: ROOT_FOLDER_TOKEN,
      allowedProjectTokens: new Set(),
      ...config,
    };
  }

  /**
   * Register a project folder token as allowed scope.
   */
  addProject(projectFolderToken: string): void {
    this.config.allowedProjectTokens.add(projectFolderToken);
  }

  /**
   * Set the current active project for write operations.
   */
  setCurrentProject(projectFolderToken: string): void {
    this.config.currentProjectToken = projectFolderToken;
  }

  /**
   * Assert that a node token is within the allowed scope for reading.
   * Throws if the node is not within the root folder tree.
   */
  assertCanRead(nodeToken: string): void {
    if (!this.isWithinScope(nodeToken)) {
      throw new ScopeGuardError(
        `READ_DENIED: Node ${nodeToken} is not within root folder scope (${this.config.rootFolderToken}). ` +
          `Operation rejected to prevent potential prompt injection or scope violation.`,
        nodeToken,
        "read",
      );
    }
  }

  /**
   * Assert that a node token is within the CURRENT project for writing.
   * Write operations are more restrictive than read operations.
   * Throws if the node is not within the current project.
   */
  assertCanWrite(nodeToken: string): void {
    if (!this.config.currentProjectToken) {
      throw new ScopeGuardError(
        `WRITE_DENIED: No active project set. Cannot write to node ${nodeToken}.`,
        nodeToken,
        "write",
      );
    }

    if (!this.isWithinCurrentProject(nodeToken)) {
      throw new ScopeGuardError(
        `WRITE_DENIED: Node ${nodeToken} is not within current project scope (${this.config.currentProjectToken}). ` +
          `Write operations are restricted to the active project to prevent cross-project writes.`,
        nodeToken,
        "write",
      );
    }
  }

  /**
   * Check if a node is within the root folder scope (for reads).
   */
  private isWithinScope(nodeToken: string): boolean {
    // The root folder itself is always in scope
    if (nodeToken === this.config.rootFolderToken) return true;

    // Check against all known project tokens
    // In a real implementation, this would verify the node's ancestry
    // For now, we check if it matches any allowed project or is a child
    for (const projectToken of this.config.allowedProjectTokens) {
      if (nodeToken === projectToken || nodeToken.startsWith(projectToken)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a node is within the current project (for writes).
   */
  private isWithinCurrentProject(nodeToken: string): boolean {
    if (!this.config.currentProjectToken) return false;

    return (
      nodeToken === this.config.currentProjectToken ||
      nodeToken.startsWith(this.config.currentProjectToken)
    );
  }

  /**
   * Get current scope info for logging/debugging.
   */
  getScopeInfo(): {
    rootFolder: string;
    allowedProjects: string[];
    currentProject: string | undefined;
  } {
    return {
      rootFolder: this.config.rootFolderToken,
      allowedProjects: Array.from(this.config.allowedProjectTokens),
      currentProject: this.config.currentProjectToken,
    };
  }
}

export class ScopeGuardError extends Error {
  constructor(
    message: string,
    public readonly nodeToken: string,
    public readonly operation: "read" | "write",
  ) {
    super(message);
    this.name = "ScopeGuardError";
  }
}

// Singleton instance for global use
let globalGuard: ScopeGuard | null = null;

export function getGlobalScopeGuard(): ScopeGuard {
  if (!globalGuard) {
    globalGuard = new ScopeGuard();
  }
  return globalGuard;
}

export function resetGlobalScopeGuard(): void {
  globalGuard = null;
}
