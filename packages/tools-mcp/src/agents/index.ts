export interface AgentCall {
  agentName: string;
  input: Record<string, unknown>;
  output?: string;
}

export abstract class BaseAgent {
  protected name: string;
  protected prompt: string;

  constructor(name: string, prompt: string) {
    this.name = name;
    this.prompt = prompt;
  }

  /**
   * Execute the agent with given input.
   * In production, this calls the model via MCP or Claude Agent SDK.
   */
  abstract execute(input: Record<string, unknown>): Promise<string>;

  getName(): string {
    return this.name;
  }

  getPrompt(): string {
    return this.prompt;
  }
}

export class SummarizerAgent extends BaseAgent {
  constructor() {
    super(
      "summarizer",
      "You are a document summarizer. Create a concise, structured summary.",
    );
  }

  async execute(input: { content: string; nodeId: string }): Promise<string> {
    // In production, calls model with summarizer prompt + input content
    return `[Summary of ${input.nodeId}]`;
  }
}

export class ReviewerAgent extends BaseAgent {
  constructor() {
    super(
      "reviewer",
      "You are a PRD reviewer. Identify gaps, risks, and recommendations.",
    );
  }

  async execute(input: { content: string; nodeId: string }): Promise<string> {
    // In production, calls model with reviewer prompt + input content
    return `[Review claims for ${input.nodeId}]`;
  }
}

export class VerifierAgent extends BaseAgent {
  constructor() {
    super(
      "verifier",
      "You are a claim verifier. Verify claims against source documents.",
    );
  }

  async execute(input: {
    claim: string;
    sourceContent: string;
  }): Promise<string> {
    // In production, calls model with verifier prompt + claim + source
    return `[Verification result: confirmed/not_found]`;
  }
}

export class QuestionGeneratorAgent extends BaseAgent {
  constructor() {
    super(
      "question-gen",
      "You are a question generator. Generate insightful questions for PRD development.",
    );
  }

  async execute(input: {
    reviewOutput: string;
    summaries: string[];
    projectMemory: string;
  }): Promise<string> {
    // In production, calls model with question-gen prompt
    return `[Generated questions]`;
  }
}

export class WriterAgent extends BaseAgent {
  constructor() {
    super(
      "writer",
      "You are a PRD writer. Draft PRDs following the template structure.",
    );
  }

  async execute(input: {
    topic: string;
    summaries: string[];
    projectMemory: string;
    feedback?: string;
  }): Promise<string> {
    // In production, calls model with writer prompt
    return `[PRD draft: ${input.topic}]`;
  }
}

export class CriticAgent extends BaseAgent {
  constructor() {
    super(
      "critic",
      "You are a PRD critic. Review drafts against sources and checklist.",
    );
  }

  async execute(input: {
    draft: string;
    sources: string[];
  }): Promise<{
    approved: boolean;
    severity: string;
    feedback: string;
  }> {
    // In production, calls model with critic prompt
    return {
      approved: false,
      severity: "must-fix",
      feedback: "[Critic feedback]",
    };
  }
}
