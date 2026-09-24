import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ScopeGuard } from "../scope-guard.js";
import { listProjectMessages, type PoolMessage } from "../message-pool/index.js";
import type { LLMCaller } from "./review-orchestrator.js";

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
  llmCaller?: LLMCaller;
  executeAction?: (action: SupervisorAction) => Promise<string>;
}

const DEFAULT_CONFIG: SupervisorConfig = {
  maxToolCalls: 5,
  scopeGuard: new ScopeGuard(),
};

const RUNS_DIR = ".prdcli/runs";

export class Supervisor {
  private config: SupervisorConfig;
  private toolCallCount = 0;
  private actions: SupervisorAction[] = [];
  private outputs: string[] = [];
  private traceLog: string[] = [];
  private project?: string;

  constructor(config?: Partial<SupervisorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

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
    tasks: Array<{ tool: string; args: Record<string, unknown>; order: number }>;
    needsClarification: boolean;
    clarificationQuestion?: string;
  }> {
    this.project = currentProject;
    this.trace(`Planning for goal: "${goal}"`);
    this.trace(`Current project: ${currentProject ?? "none"}`);

    if (currentProject) {
      const status = this.getProjectStatus(currentProject);
      this.trace(`Project status: reviews=${status.hasReviews}, questions=${status.hasQuestions}, drafts=${status.hasDrafts}`);
    }

    const intent = this.parseIntent(goal);
    this.trace(`Parsed intent: ${JSON.stringify(intent)}`);

    if (!currentProject && intent.needsProject) {
      return {
        tasks: [],
        needsClarification: true,
        clarificationQuestion: "No project is currently active. Run `prdcli project use <name>`.",
      };
    }

    const tasks: Array<{ tool: string; args: Record<string, unknown>; order: number }> = [];
    let order = 1;

    if (intent.needsSync) tasks.push({ tool: "run_sync", args: {}, order: order++ });
    if (intent.reviewDoc) tasks.push({ tool: "run_review", args: { doc: intent.reviewDoc }, order: order++ });
    if (intent.askDoc) tasks.push({ tool: "run_ask", args: { doc: intent.askDoc }, order: order++ });
    if (intent.draftTopic) tasks.push({ tool: "run_draft", args: { topic: intent.draftTopic }, order: order++ });
    if (intent.updateDoc) tasks.push({ tool: "run_update", args: { doc: intent.updateDoc, request: intent.updateRequest }, order: order++ });

    if (tasks.length > this.config.maxToolCalls) {
      tasks.length = this.config.maxToolCalls;
    }

    this.trace(`Planned ${tasks.length} tasks`);
    return { tasks, needsClarification: false };
  }

  async run(
    goal: string,
    currentProject: string,
  ): Promise<SupervisorResult> {
    this.project = currentProject;

    const planResult = await this.plan(goal, currentProject);
    if (planResult.needsClarification) {
      return {
        actions: [],
        outputs: [planResult.clarificationQuestion ?? "Need clarification"],
        traceLog: this.getTraceLog(),
        summary: planResult.clarificationQuestion ?? "Need clarification",
      };
    }

    for (const task of planResult.tasks) {
      if (this.toolCallCount >= this.config.maxToolCalls) break;

      const action: SupervisorAction = {
        tool: task.tool,
        args: task.args,
        reason: `Step ${task.order}: ${task.tool}`,
      };

      this.toolCallCount++;
      this.actions.push(action);
      this.trace(`Executing: ${task.tool} (${this.toolCallCount}/${this.config.maxToolCalls})`);

      if (this.config.executeAction) {
        try {
          const output = await this.config.executeAction(action);
          this.outputs.push(output);
        } catch (err) {
          this.outputs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        this.outputs.push(`[Result of ${task.tool}]`);
      }
    }

    const summary = this.getSummary();
    this.saveTraceLog();
    return { actions: this.actions, outputs: this.outputs, traceLog: this.getTraceLog(), summary };
  }

  saveTraceLog(cwd: string = process.cwd()): string {
    const runsDir = path.join(cwd, RUNS_DIR);
    if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${timestamp}_agent-trace.md`;
    const filepath = path.join(runsDir, filename);

    const content = [
      `# Supervisor Decision Trace`,
      `- Project: ${this.project ?? "unknown"}`,
      `- Time: ${new Date().toISOString()}`,
      `- Tool calls: ${this.toolCallCount}/${this.config.maxToolCalls}`,
      ``,
      `## Actions`,
      ...this.actions.map((a, i) => `${i + 1}. \`${a.tool}\` — ${a.reason}`),
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

  getTraceLog(): string { return this.traceLog.join("\n"); }
  getSummary(): string {
    return `Supervisor executed ${this.actions.length} actions:\n${this.actions.map((a) => `- ${a.tool}: ${a.reason}`).join("\n")}`;
  }

  private parseIntent(goal: string): {
    needsProject: boolean;
    needsSync: boolean;
    reviewDoc?: string;
    askDoc?: string;
    draftTopic?: string;
    updateDoc?: string;
    updateRequest?: string;
  } {
    const lower = goal.toLowerCase();
    return {
      needsProject: true,
      needsSync: /sync|update|refresh/i.test(lower),
      reviewDoc: this.extractDoc(lower, /review\s+(\w+)/i),
      askDoc: this.extractDoc(lower, /(?:ask|question)\w*\s+(?:about\s+)?(\w+)/i),
      draftTopic: this.extractTopic(lower),
      updateDoc: this.extractDoc(lower, /update\s+(\w+)/i),
      updateRequest: this.extractUpdateRequest(lower),
    };
  }

  private extractDoc(text: string, regex: RegExp): string | undefined {
    return text.match(regex)?.[1];
  }

  private extractTopic(text: string): string | undefined {
    return text.match(/draft\s+(?:about\s+)?(.+?)(?:\.|$)/i)?.[1]?.trim();
  }

  private extractUpdateRequest(text: string): string | undefined {
    return text.match(/(?:request|change)[:\s]+(.+?)(?:\.|$)/i)?.[1]?.trim();
  }

  private trace(message: string): void {
    this.traceLog.push(`[${new Date().toISOString()}] ${message}`);
  }
}

export class SupervisorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorError";
  }
}
