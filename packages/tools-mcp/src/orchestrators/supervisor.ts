import { ScopeGuard } from "../scope-guard.js";

export interface SupervisorAction {
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export interface SupervisorResult {
  actions: SupervisorAction[];
  outputs: string[];
  traceLog: string;
  summary: string;
}

export interface SupervisorConfig {
  maxToolCalls: number;
  scopeGuard: ScopeGuard;
}

const DEFAULT_CONFIG: SupervisorConfig = {
  maxToolCalls: 5,
  scopeGuard: new ScopeGuard(),
};

/**
 * Supervisor Agent — PRD Section 3
 *
 * Interprets natural language requests and orchestrates task orchestrators.
 * Does NOT implement review/draft logic itself — delegates to existing orchestrators.
 *
 * Constraints:
 * - Max 5 tool calls per session
 * - All write actions require user confirmation
 * - Cannot write outside current project scope
 * - Must log decision trace for debugging
 */
export class Supervisor {
  private config: SupervisorConfig;
  private toolCallCount = 0;
  private actions: SupervisorAction[] = [];
  private traceLog: string[] = [];

  constructor(config?: Partial<SupervisorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Parse a natural language goal and determine which tasks to run.
   * Returns an execution plan, does not execute.
   */
  async plan(
    goal: string,
    currentProject?: string,
  ): Promise<{
    tasks: Array<{
      tool: string;
      args: Record<string, unknown>;
      order: number;
    }>;
    needsClarification: boolean;
    clarificationQuestion?: string;
  }> {
    this.trace(`Planning for goal: "${goal}"`);
    this.trace(`Current project: ${currentProject ?? "none"}`);

    // Parse intent from goal
    const intent = this.parseIntent(goal);
    this.trace(`Parsed intent: ${JSON.stringify(intent)}`);

    // If project not determined, ask
    if (!currentProject && intent.needsProject) {
      return {
        tasks: [],
        needsClarification: true,
        clarificationQuestion:
          "No project is currently active. Which project should I work with? Run `prdcli project list` to see options.",
      };
    }

    // Build task sequence
    const tasks: Array<{
      tool: string;
      args: Record<string, unknown>;
      order: number;
    }> = [];

    let order = 1;

    if (intent.needsSync) {
      tasks.push({ tool: "run_sync", args: {}, order: order++ });
    }

    if (intent.reviewDoc) {
      tasks.push({
        tool: "run_review",
        args: { doc: intent.reviewDoc },
        order: order++,
      });
    }

    if (intent.askDoc) {
      tasks.push({
        tool: "run_ask",
        args: { doc: intent.askDoc },
        order: order++,
      });
    }

    if (intent.draftTopic) {
      tasks.push({
        tool: "run_draft",
        args: { topic: intent.draftTopic },
        order: order++,
      });
    }

    if (intent.readMemory) {
      tasks.push({ tool: "read_project_memory", args: {}, order: order++ });
    }

    if (intent.readSummaries) {
      tasks.push({ tool: "read_summaries", args: {}, order: order++ });
    }

    this.trace(`Planned ${tasks.length} tasks`);

    return { tasks, needsClarification: false };
  }

  /**
   * Execute a planned action. Validates constraints before execution.
   */
  async executeAction(
    action: SupervisorAction,
    confirmWrite: (action: SupervisorAction) => Promise<boolean>,
  ): Promise<string> {
    // Check tool call cap
    if (this.toolCallCount >= this.config.maxToolCalls) {
      throw new SupervisorError(
        `Tool call cap reached (${this.config.maxToolCalls}). Cannot execute more actions.`,
      );
    }

    // Check if write action needs confirmation
    if (this.isWriteAction(action.tool)) {
      this.trace(`Write action detected: ${action.tool}. Requesting confirmation...`);
      const confirmed = await confirmWrite(action);
      if (!confirmed) {
        this.trace(`User declined write action: ${action.tool}`);
        return "Action declined by user.";
      }
    }

    this.toolCallCount++;
    this.actions.push(action);
    this.trace(`Executing: ${action.tool} (${this.toolCallCount}/${this.config.maxToolCalls})`);

    // In real implementation, this calls the actual tool via MCP
    return `[Result of ${action.tool}]`;
  }

  /**
   * Get the complete trace log for debugging.
   */
  getTraceLog(): string {
    return this.traceLog.join("\n");
  }

  /**
   * Get summary of actions taken.
   */
  getSummary(): string {
    return `Supervisor executed ${this.actions.length} actions:\n${this.actions.map((a) => `- ${a.tool}: ${a.reason}`).join("\n")}`;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private parseIntent(goal: string): {
    needsProject: boolean;
    needsSync: boolean;
    reviewDoc?: string;
    askDoc?: string;
    draftTopic?: string;
    readMemory: boolean;
    readSummaries: boolean;
  } {
    const lower = goal.toLowerCase();

    return {
      needsProject: true,
      needsSync: /sync|update|refresh/i.test(lower),
      reviewDoc: this.extractDoc(lower, /review\s+(\w+)/i),
      askDoc: this.extractDoc(lower, /(?:ask|question)\w*\s+(?:about\s+)?(\w+)/i),
      draftTopic: this.extractTopic(lower),
      readMemory: /memory|decisions|history/i.test(lower),
      readSummaries: /summary|summaries|overview/i.test(lower),
    };
  }

  private extractDoc(text: string, regex: RegExp): string | undefined {
    const match = text.match(regex);
    return match?.[1];
  }

  private extractTopic(text: string): string | undefined {
    const match = text.match(/draft\s+(?:about\s+)?(.+?)(?:\.|$)/i);
    return match?.[1]?.trim();
  }

  private isWriteAction(tool: string): boolean {
    return [
      "run_draft",
      "scoped_create_docx",
      "scoped_update_docx",
      "write_project_memory",
      "run_sync",
    ].includes(tool);
  }

  private trace(message: string): void {
    const timestamp = new Date().toISOString();
    this.traceLog.push(`[${timestamp}] ${message}`);
  }
}

export class SupervisorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorError";
  }
}
