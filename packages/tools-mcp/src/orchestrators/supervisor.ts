import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ScopeGuard } from "../scope-guard.js";
import { listProjectMessages, type PoolMessage } from "../message-pool/index.js";

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

const RUNS_DIR = ".prdcli/runs";

/**
 * Supervisor Agent — PRD Section 3 + Section 3.5 (Message Pool)
 *
 * 1. Parse natural language goal
 * 2. Query Message Pool for project status
 * 3. Build execution plan
 * 4. Execute with cap=5 tool calls
 * 5. Write decision trace to .prdcli/runs/<timestamp>_agent-trace.md
 */
export class Supervisor {
  private config: SupervisorConfig;
  private toolCallCount = 0;
  private actions: SupervisorAction[] = [];
  private traceLog: string[] = [];
  private project?: string;

  constructor(config?: Partial<SupervisorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get project status from Message Pool.
   * Used by Supervisor to understand context before planning.
   */
  getProjectStatus(project: string): {
    hasReviews: boolean;
    hasQuestions: boolean;
    hasDrafts: boolean;
    messages: PoolMessage[];
  } {
    const messages = listProjectMessages(project);
    return {
      hasReviews: messages.some((m) => m.type === "review_result"),
      hasQuestions: messages.some((m) => m.type === "question_list"),
      hasDrafts: messages.some((m) => m.type === "draft_prd"),
      messages,
    };
  }

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
    this.project = currentProject;
    this.trace(`Planning for goal: "${goal}"`);
    this.trace(`Current project: ${currentProject ?? "none"}`);

    // Query Message Pool for project context
    if (currentProject) {
      const status = this.getProjectStatus(currentProject);
      this.trace(
        `Project status: ${status.hasReviews ? "has reviews" : "no reviews"}, ${status.hasQuestions ? "has questions" : "no questions"}, ${status.hasDrafts ? "has drafts" : "no drafts"}`,
      );
    }

    const intent = this.parseIntent(goal);
    this.trace(`Parsed intent: ${JSON.stringify(intent)}`);

    if (!currentProject && intent.needsProject) {
      return {
        tasks: [],
        needsClarification: true,
        clarificationQuestion:
          "No project is currently active. Which project should I work with? Run `prdcli project list` to see options.",
      };
    }

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

    // Enforce cap
    if (tasks.length > this.config.maxToolCalls) {
      this.trace(
        `Plan exceeds cap (${tasks.length} > ${this.config.maxToolCalls}). Truncating.`,
      );
      tasks.length = this.config.maxToolCalls;
    }

    this.trace(`Planned ${tasks.length} tasks`);
    return { tasks, needsClarification: false };
  }

  async executeAction(
    action: SupervisorAction,
    confirmWrite: (action: SupervisorAction) => Promise<boolean>,
  ): Promise<string> {
    if (this.toolCallCount >= this.config.maxToolCalls) {
      throw new SupervisorError(
        `Tool call cap reached (${this.config.maxToolCalls}).`,
      );
    }

    if (this.isWriteAction(action.tool)) {
      this.trace(`Write action: ${action.tool}. Requesting confirmation...`);
      const confirmed = await confirmWrite(action);
      if (!confirmed) {
        this.trace(`User declined: ${action.tool}`);
        return "Action declined by user.";
      }
    }

    this.toolCallCount++;
    this.actions.push(action);
    this.trace(
      `Executing: ${action.tool} (${this.toolCallCount}/${this.config.maxToolCalls})`,
    );

    return `[Result of ${action.tool}]`;
  }

  /**
   * Write the decision trace to .prdcli/runs/<timestamp>_agent-trace.md
   */
  saveTraceLog(cwd: string = process.cwd()): string {
    const runsDir = path.join(cwd, RUNS_DIR);
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const filename = `${timestamp}_agent-trace.md`;
    const filepath = path.join(runsDir, filename);

    const content = [
      `# Supervisor Decision Trace`,
      `- Project: ${this.project ?? "unknown"}`,
      `- Time: ${new Date().toISOString()}`,
      `- Tool calls: ${this.toolCallCount}/${this.config.maxToolCalls}`,
      ``,
      `## Actions`,
      ...this.actions.map(
        (a, i) => `${i + 1}. \`${a.tool}\` — ${a.reason}`,
      ),
      ``,
      `## Trace Log`,
      ...this.traceLog.map((t) => `- ${t}`),
      ``,
      `## Summary`,
      this.getSummary(),
    ].join("\n");

    fs.writeFileSync(filepath, content);
    return filepath;
  }

  getTraceLog(): string {
    return this.traceLog.join("\n");
  }

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
      askDoc: this.extractDoc(
        lower,
        /(?:ask|question)\w*\s+(?:about\s+)?(\w+)/i,
      ),
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
