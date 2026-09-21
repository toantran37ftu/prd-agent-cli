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
    | "draft-orchestrator";
  projectToken: string;
  targetDocToken?: string;
  freeTextGoal?: string; // used when agentName = "supervisor"
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

export interface ConfigExporter {
  export(channel: "claude-code" | "codex" | "generic-mcp-export"): string;
}
