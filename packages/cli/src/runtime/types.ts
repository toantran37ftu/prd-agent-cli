export interface ToolCall {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
}

export interface AgentRunInput {
  agentName:
    | "supervisor"
    | "review-orchestrator"
    | "ask-orchestrator"
    | "draft-orchestrator"
    | "update-orchestrator"
    | "summarizer"
    | "reviewer"
    | "verifier"
    | "question-gen"
    | "brief-writer"
    | "writer"
    | "writer-update"
    | "critic"
    | "change-planner";
  projectToken: string;
  targetDocToken?: string;
  freeTextGoal?: string;
  extraArgs?: Record<string, unknown>;
}

export interface AgentRunResult {
  output: string;
  toolCallsLog: ToolCall[];
  needsManualReview?: boolean;
}

export interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

/**
 * LLM caller function type used by orchestrators.
 * Takes agent name + variables, returns LLM response string.
 */
export type LLMCaller = (
  agentName: string,
  vars: Record<string, string>,
) => Promise<string>;

export interface ConfigExporter {
  export(channel: "claude-code" | "codex" | "generic-mcp-export"): string;
}
