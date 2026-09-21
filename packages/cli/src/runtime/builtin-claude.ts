import { AgentRuntime, AgentRunInput, AgentRunResult, ToolCall } from "./types.js";

export interface BuiltinClaudeConfig {
  model?: string;
  maxTokens?: number;
}

/**
 * BuiltinClaudeRuntime — Channel "builtin"
 *
 * Uses @anthropic-ai/claude-agent-sdk to run agents locally.
 * This is the default runtime that provides full functionality including Supervisor.
 */
export class BuiltinClaudeRuntime implements AgentRuntime {
  private config: BuiltinClaudeConfig;

  constructor(config?: BuiltinClaudeConfig) {
    this.config = {
      model: config?.model ?? "claude-sonnet-4-6",
      maxTokens: config?.maxTokens ?? 4096,
    };
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const toolCallsLog: ToolCall[] = [];
    const startTime = Date.now();

    console.log(`[BuiltinClaude] Running agent: ${input.agentName}`);
    console.log(`[BuiltinClaude] Model: ${this.config.model}`);

    // In production, this uses @anthropic-ai/claude-agent-sdk
    // to run the agent with MCP tools

    // Build the appropriate prompt based on agentName
    const systemPrompt = this.getSystemPrompt(input.agentName);
    const userMessage = this.buildUserMessage(input);

    console.log(`[BuiltinClaude] System prompt length: ${systemPrompt.length} chars`);
    console.log(`[BuiltinClaude] User message length: ${userMessage.length} chars`);

    // Placeholder: In real implementation, this calls Claude Agent SDK
    // const agent = new ClaudeAgent({
    //   model: this.config.model,
    //   maxTokens: this.config.maxTokens,
    //   systemPrompt,
    //   tools: this.getToolsForAgent(input.agentName),
    // });
    // const result = await agent.run(userMessage);

    const duration = Date.now() - startTime;

    return {
      output: `[BuiltinClaude] Agent ${input.agentName} would run here with model ${this.config.model}`,
      toolCallsLog,
      needsManualReview: false,
    };
  }

  private getSystemPrompt(agentName: string): string {
    // In production, loads from agents/prompts/*.md
    const prompts: Record<string, string> = {
      supervisor: "You are a Supervisor agent for PRD management.",
      "review-orchestrator":
        "You are a Review Orchestrator. Call Reviewer and Verifier agents.",
      "ask-orchestrator":
        "You are an Ask Orchestrator. Call Question Generator with review context.",
      "draft-orchestrator":
        "You are a Draft Orchestrator. Call Writer and Critic agents in a loop.",
    };

    return prompts[agentName] ?? "You are a helpful assistant.";
  }

  private buildUserMessage(input: AgentRunInput): string {
    const parts: string[] = [];

    if (input.projectToken) {
      parts.push(`Project token: ${input.projectToken}`);
    }

    if (input.targetDocToken) {
      parts.push(`Target document: ${input.targetDocToken}`);
    }

    if (input.freeTextGoal) {
      parts.push(`Goal: ${input.freeTextGoal}`);
    }

    if (input.extraArgs) {
      parts.push(`Additional context: ${JSON.stringify(input.extraArgs)}`);
    }

    return parts.join("\n");
  }
}
