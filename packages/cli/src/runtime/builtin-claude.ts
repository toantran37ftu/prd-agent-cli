import { AgentRuntime, AgentRunInput, AgentRunResult, ToolCall } from "./types.js";
import { MockLLMClient } from "./mock-llm.js";
import { loadPrompt, renderPrompt } from "./prompt-loader.js";

export interface BuiltinClaudeConfig {
  model?: string;
  maxTokens?: number;
  mode?: "mock" | "real";
  apiKey?: string;
}

/**
 * BuiltinClaudeRuntime — Channel "builtin"
 *
 * Supports two modes:
 * - mock: returns realistic JSON responses for development/testing
 * - real: uses Anthropic SDK (requires API key)
 */
export class BuiltinClaudeRuntime implements AgentRuntime {
  private config: BuiltinClaudeConfig;
  private mockClient: MockLLMClient;

  constructor(config?: BuiltinClaudeConfig) {
    this.config = {
      model: config?.model ?? "claude-sonnet-4-6",
      maxTokens: config?.maxTokens ?? 4096,
      mode: config?.mode ?? "mock",
      apiKey: config?.apiKey,
    };
    this.mockClient = new MockLLMClient();
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const toolCallsLog: ToolCall[] = [];
    const startTime = Date.now();

    console.log(`[BuiltinClaude] Running agent: ${input.agentName} (mode: ${this.config.mode})`);

    const vars = this.buildVars(input);
    let output: string;

    if (this.config.mode === "mock") {
      output = await this.mockClient.call(input.agentName, vars);
    } else {
      output = await this.callRealLLM(input.agentName, vars);
    }

    const duration = Date.now() - startTime;
    toolCallsLog.push({
      toolName: input.agentName,
      input: vars,
      output: output.slice(0, 200),
      durationMs: duration,
    });

    return {
      output,
      toolCallsLog,
      needsManualReview: false,
    };
  }

  /**
   * Low-level LLM call for a specific agent.
   * Used by orchestrators to call individual agents.
   */
  async callAgent(
    agentName: string,
    vars: Record<string, string>,
  ): Promise<string> {
    if (this.config.mode === "mock") {
      return this.mockClient.call(agentName, vars);
    }
    return this.callRealLLM(agentName, vars);
  }

  private buildVars(input: AgentRunInput): Record<string, string> {
    const vars: Record<string, string> = {};

    if (input.projectToken) vars["project_name"] = input.projectToken;
    if (input.targetDocToken) vars["target_doc"] = input.targetDocToken;
    if (input.freeTextGoal) vars["goal"] = input.freeTextGoal;

    if (input.extraArgs) {
      for (const [key, value] of Object.entries(input.extraArgs)) {
        if (typeof value === "string") {
          vars[key] = value;
        }
      }
    }

    // Inject run context
    const now = new Date();
    vars["today"] = now.toISOString().slice(0, 10);
    vars["timezone"] = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return vars;
  }

  private async callRealLLM(
    agentName: string,
    vars: Record<string, string>,
  ): Promise<string> {
    // Real implementation using Anthropic SDK
    // For now, falls back to mock
    console.warn("[BuiltinClaude] Real LLM not implemented, falling back to mock");
    return this.mockClient.call(agentName, vars);
  }
}
