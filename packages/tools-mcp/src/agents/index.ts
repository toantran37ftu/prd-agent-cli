export interface AgentCall {
  agentName: string;
  input: Record<string, unknown>;
  output?: string;
}

export abstract class BaseAgent {
  protected name: string;
  protected prompt: string;
  protected roleCard: {
    profile: string;
    goal: string;
    watch: string[];
    publish: string | null;
  };

  constructor(
    name: string,
    prompt: string,
    roleCard: { profile: string; goal: string; watch: string[]; publish: string | null },
  ) {
    this.name = name;
    this.roleCard = roleCard;
    this.prompt = prompt;
  }

  abstract execute(input: Record<string, unknown>): Promise<string>;

  getName(): string {
    return this.name;
  }

  getPrompt(): string {
    return this.prompt;
  }

  getRoleCard() {
    return this.roleCard;
  }
}

export class SummarizerAgent extends BaseAgent {
  constructor() {
    super("summarizer", "Summarizer: tóm tắt 1 tài liệu, tối đa 200 từ. Output JSON: node_id, doc_type, summary, key_points, open_items.", {
      profile: "Summarizer — tóm tắt 1 tài liệu để agent khác đọc nhanh",
      goal: "Nén 1 tài liệu thành bản tóm tắt trung thực, không phân tích/đánh giá",
      watch: [],
      publish: "doc_summary",
    });
  }

  async execute(input: { content: string; nodeId: string }): Promise<string> {
    return `[Summary of ${input.nodeId}]`;
  }
}

export class ReviewerAgent extends BaseAgent {
  constructor() {
    super("reviewer", "Reviewer: review PRD theo 9 tiêu chí checklist. Output JSON: claims[], summary.", {
      profile: "Reviewer — review 1 bản PRD dựa trên toàn bộ context project",
      goal: "Tìm gap/risk/mâu thuẫn thật, mỗi cái gắn nguồn cụ thể",
      watch: ["doc_summary"],
      publish: "review_result",
    });
  }

  async execute(input: { content: string; nodeId: string }): Promise<string> {
    return `[Review claims for ${input.nodeId}]`;
  }
}

export class VerifierAgent extends BaseAgent {
  constructor() {
    super("verifier", "Verifier: xác thực 1 claim với tài liệu nguồn. Output JSON: claim_id, status, evidence, note.", {
      profile: "Verifier — xác thực 1 claim có thật khớp tài liệu nguồn không",
      goal: "Chặn hallucination của Reviewer trước khi user thấy kết quả",
      watch: ["review_result"],
      publish: null,
    });
  }

  async execute(input: {
    claim: string;
    sourceContent: string;
  }): Promise<string> {
    return `[Verification result: confirmed/not_found]`;
  }
}

export class QuestionGeneratorAgent extends BaseAgent {
  constructor() {
    super("question-gen", "QuestionGen: sinh câu hỏi cho đối tác từ review_result. Output JSON: questions[].", {
      profile: "Question Generator — sinh câu hỏi cần hỏi đối tác/stakeholder",
      goal: "Biến gap/risk chưa chắc chắn thành câu hỏi cụ thể, tránh hỏi trùng",
      watch: ["review_result"],
      publish: "question_list",
    });
  }

  async execute(input: {
    reviewOutput: string;
    summaries: string[];
    projectMemory: string;
  }): Promise<string> {
    return `[Generated questions]`;
  }
}

export class WriterAgent extends BaseAgent {
  constructor() {
    super("writer", "Writer: soạn PRD theo template. Marker [[src:node_id]] cho mọi claim. Output: PRD markdown.", {
      profile: "Writer — soạn PRD draft từ tài liệu/meeting note/record",
      goal: "PRD đầy đủ, đúng template phù hợp, mọi claim có nguồn",
      watch: ["doc_summary", "review_result"],
      publish: "draft_prd",
    });
  }

  async execute(input: {
    topic: string;
    summaries: string[];
    projectMemory: string;
    feedback?: string;
  }): Promise<string> {
    return `[PRD draft: ${input.topic}]`;
  }
}

export class CriticAgent extends BaseAgent {
  constructor() {
    super("critic", "Critic: kiểm tra draft theo 3 nhóm (nguồn, cấu trúc, mâu thuẫn). approved=true khi không có issue severity=high.", {
      profile: "Critic — kiểm tra chất lượng draft trước khi publish",
      goal: "Bắt hallucination + thiếu section trước khi user thấy",
      watch: ["draft_prd"],
      publish: "critic_feedback",
    });
  }

  async execute(input: {
    draft: string;
    sources: string[];
  }): Promise<string> {
    return JSON.stringify({
      approved: false,
      severity: "must-fix",
      feedback: "[Critic feedback]",
    });
  }
}
