/**
 * Mock LLM Client — returns realistic JSON responses for each agent type.
 * Used for development/testing without real API calls.
 */
import { loadPrompt, renderPrompt } from "./prompt-loader.js";

export interface MockLLMConfig {
  cwd?: string;
}

export class MockLLMClient {
  private config: MockLLMConfig;

  constructor(config?: MockLLMConfig) {
    this.config = config ?? {};
  }

  /**
   * Call mock LLM for a given agent with input variables.
   * Loads the real prompt, replaces variables, then returns a mock response.
   */
  async call(
    agentName: string,
    vars: Record<string, string>,
  ): Promise<string> {
    // Load and render the actual prompt (for logging/debugging)
    try {
      const promptTemplate = loadPrompt(agentName);
      const _rendered = renderPrompt(promptTemplate, vars);
      // In mock mode, we don't actually send to LLM
    } catch {
      // Prompt not found, use agent name directly
    }

    return this.getMockResponse(agentName, vars);
  }

  private getMockResponse(
    agentName: string,
    vars: Record<string, string>,
  ): string {
    switch (agentName) {
      case "summarizer":
        return this.mockSummarizer(vars);
      case "reviewer":
        return this.mockReviewer(vars);
      case "verifier":
        return this.mockVerifier(vars);
      case "question-gen":
        return this.mockQuestionGen(vars);
      case "brief-writer":
        return this.mockBriefWriter(vars);
      case "writer":
        return this.mockWriter(vars);
      case "writer-update":
        return this.mockWriterUpdate(vars);
      case "critic":
        return this.mockCritic(vars);
      case "change-planner":
        return this.mockChangePlanner(vars);
      default:
        return `{"status": "mock_response", "agent": "${agentName}"}`;
    }
  }

  private mockSummarizer(vars: Record<string, string>): string {
    const nodeId = vars["node_id"] ?? "unknown";
    return JSON.stringify({
      doc_type: "prd",
      summary: "This document describes a feature implementation plan with requirements, timelines, and success metrics. The proposed solution addresses user needs through a phased approach.",
      key_points: [
        "Feature targets guest checkout flow",
        "Implementation split into 3 phases",
        "Success measured by conversion rate improvement",
      ],
      open_items: [
        "NFR requirements not yet defined",
        "Security review pending",
      ],
      dates_mentioned: ["2026-09-15", "2026-10-01"],
      readable: true,
    });
  }

  private mockReviewer(vars: Record<string, string>): string {
    return JSON.stringify({
      claims: [
        {
          type: "gap",
          checklist_item_id: "REQ-AC",
          text: "Yêu cầu REQ-001 thiếu acceptance criteria cụ thể cho trường hợp edge case",
          evidence: [
            {
              node_id: vars["target_doc"] ?? "doc_001",
              quote: "REQ-001: Hệ thống xử lý thanh toán guest checkout",
              evidence_level: "full_doc",
            },
          ],
          severity: "high",
        },
        {
          type: "not_documented",
          checklist_item_id: "NFR-PERF",
          text: "Tài liệu không ghi nhận yêu cầu về hiệu năng (performance) cho hệ thống thanh toán",
          evidence: [],
          severity: "low",
        },
        {
          type: "risk",
          checklist_item_id: "DEPENDENCY-TECH",
          text: "Phụ thuộc vào cổng thanh toán bên thứ ba nhưng không có phương án fallback khi cổng gặp sự cố",
          evidence: [
            {
              node_id: vars["target_doc"] ?? "doc_001",
              quote: "Tích hợp với VNPay và MoMo",
              evidence_level: "full_doc",
            },
          ],
          severity: "medium",
        },
        {
          type: "recommendation",
          checklist_item_id: "MONITORING-PLAN",
          text: "Nên bổ sung kế hoạch monitoring cho luồng thanh toán (ngoài checklist chuẩn)",
          evidence: [],
          severity: "low",
        },
      ],
      overall: "PRD có cấu trúc tốt nhưng thiếu acceptance criteria cho một số yêu cầu và chưa đề cập đến yêu cầu phi chức năng.",
    });
  }

  private mockVerifier(vars: Record<string, string>): string {
    // Simulate different verification results
    const claimText = vars["claim_text"] ?? "";
    if (claimText.includes("không ghi nhận") || claimText.includes("không đề cập")) {
      return JSON.stringify({
        status: "confirmed",
        evidence_quote: "",
        note: "Xác nhận: đọc hết tài liệu và không tìm thấy nội dung này.",
      });
    }
    return JSON.stringify({
      status: "confirmed",
      evidence_quote: "Đoạn văn bản liên quan được tìm thấy trong tài liệu nguồn.",
      note: "",
    });
  }

  private mockQuestionGen(vars: Record<string, string>): string {
    return JSON.stringify({
      questions: [
        {
          question: "Team đã review tính khả thi của tích hợp VNPay chưa? Nếu có, kết quả ở đâu?",
          context: "PRD đề cập tích hợp VNPay nhưng không ghi nhận kết quả review kỹ thuật",
          options: [],
          source_claim_id: "c2",
          priority: "high",
        },
        {
          question: "Thời gian phản hồi kỳ vọng cho luồng thanh toán guest checkout là bao nhiêu?",
          context: "NFR về hiệu năng chưa được ghi nhận trong PRD",
          options: [],
          source_claim_id: "c3",
          priority: "medium",
        },
      ],
    });
  }

  private mockBriefWriter(vars: Record<string, string>): string {
    return JSON.stringify({
      direction: "Viết PRD theo hướng data-driven, tập trung vào bằng chứng từ meeting note và tài liệu đối tác. Ưu tiên phần Evidence và Success Metrics vì có dữ liệu sẵn.",
      sections_planned: [
        {
          section: "Problem Statement",
          intent: "Mô tả vấn đề guest checkout dự trên dữ liệu từ meeting note",
          claims_planned: [
            { statement: "Tỷ lệ bỏ giỏ hàng tăng 15% khi bắt buộc đăng ký", intended_source_node_id: "meeting_001" },
          ],
          status: "has_source",
        },
        {
          section: "Success Metrics",
          intent: "Đặt mục tiêu conversion rate dựa trên baseline hiện tại",
          claims_planned: [],
          status: "missing_data",
        },
        {
          section: "Requirements",
          intent: "Liệt kê REQ từ meeting note và quyết định đã chốt",
          claims_planned: [
            { statement: "REQ-001: Guest checkout không cần đăng ký", intended_source_node_id: "meeting_001" },
          ],
          status: "has_source",
        },
        {
          section: "Out of Scope",
          intent: "Xác định ranh phạm vi",
          claims_planned: [],
          status: "needs_decision",
        },
      ],
      missing_inputs: [
        {
          what: "Baseline conversion rate hiện tại",
          needed_for_section: "Success Metrics",
          who_can_provide: "PM",
        },
        {
          what: "Quyết định scope: có bao gồm mobile app không?",
          needed_for_section: "Out of Scope",
          who_can_provide: "PM",
        },
      ],
    });
  }

  private mockWriter(vars: Record<string, string>): string {
    const topic = vars["topic"] ?? "Feature";
    return `# ${topic} — PRD

| Status | Owner | Approver | Ngày | Version |
|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD |
<!-- Agent KHÔNG điền bảng này. Chỉ người điền. -->

## Executive Summary
PRD này mô tả giải pháp cho ${topic.toLowerCase()}, dựa trên yêu cầu từ meeting note và tài liệu đối tác.

## 1. Problem Statement
**[CHƯA ĐỦ THÔNG TIN — thiếu: baseline data]**

Người dùng gặp khó khăn trong quy trình hiện tại. Cần cải thiện trải nghiệm và tăng conversion.

## 2. Goals & Non-goals
- **Goal**: Cải thiện trải nghiệm người dùng [[src:meeting_001|type=meeting_note|date=2026-09-15]]
- **Non-goal**: **[CHƯA XÁC ĐỊNH — cần PM chốt]**

## 3. Success Metrics
| Metric | Loại | Baseline | Target | Thời điểm | Nguồn |
|---|---|---|---|---|---|
| Conversion rate | leading | **[CHƯA ĐỦ THÔNG TIN]** | **[CHƯA ĐỦ THÔNG TIN]** | Launch +30d | — |

## 4. Evidence
**[CHƯA ĐỦ THÔNG TIN — thiếu: research data]**

## 5. Proposed Solution
Triển khai theo 3 giai đoạn [[src:meeting_001|type=meeting_note|date=2026-09-15]]:
1. Phase 1: Core functionality
2. Phase 2: Integration
3. Phase 3: Optimization

## 6. Requirements
### REQ-001: Core feature
- Mô tả: Implement tính năng chính cho ${topic.toLowerCase()}
- Acceptance criteria: **[GIẢ ĐỊNH — cần validate]**
  - User có thể hoàn thành tác vụ trong < 3 bước
  - Error rate < 1%
- Priority: **[CHƯA XÁC ĐỊNH — cần PM chốt]**

### REQ-002: Error handling
- Mô tả: Xử lý lỗi gracefully
- Acceptance criteria: **[GIẢ ĐỊNH — cần validate]**
  - Hiển thị thông báo lỗi rõ ràng
  - Log lỗi để debug
- Priority: **[CHƯA XÁC ĐỊNH — cần PM chốt]**

## 7. Non-functional Requirements
- Performance: **[CHƯA ĐỦ THÔNG TIN — thiếu: NFR specs]**
- Security: **[CHƯA ĐỦ THÔNG TIN — thiếu: security review]**

## 8. Out of Scope
**[CHƯA XÁC ĐỊNH — cần PM chốt]**

## 9. Dependencies & Risks
- Phụ thuộc vào hệ thống thanh toán bên thứ ba [[src:meeting_001|type=meeting_note|date=2026-09-15]]
- Rủi ro: **[GIẢ ĐỊNH — cần validate]**

## 10. Launch Plan
**[CHƯA XÁC ĐỊNH — cần PM chốt]**

## 11. Open Questions
| Câu hỏi | Owner | Due | Status |
|---|---|---|---|
| Baseline conversion rate? | unassigned | unassigned | open |
| Scope: mobile app included? | unassigned | unassigned | open |

## 12. Change Log
| Ngày | Thay đổi | Nguồn |
|---|---|---|
| TBD | Initial draft | — |
`;
  }

  private mockWriterUpdate(vars: Record<string, string>): string {
    const currentPrd = vars["current_prd"] ?? "";
    return currentPrd + "\n\n## Updated Section\n**Nội dung mới được thêm theo yêu cầu** [[src:user_request|type=user_provided|date=unknown]]\n\n## Change Log\n| Ngày | Section | Kind | Tóm tắt | Nguồn |\n|---|---|---|---|---|\n| TBD | Updated Section | add | Thêm section mới | user request |\n";
  }

  private mockCritic(vars: Record<string, string>): string {
    const sectionName = vars["section_name"] ?? "Unknown";
    return JSON.stringify({
      section: sectionName,
      issues: [
        {
          quote_from_draft: "Tỷ lệ bỏ giỏ hàng tăng 15%",
          issue: "Số liệu '15%' không có marker nguồn và không tìm thấy trong tài liệu được cite",
          severity: "high",
          suggestion: "Thêm marker [[src:node_id]] hoặc đánh nhãn [CHƯA ĐỦ THÔNG TIN]",
        },
      ],
      section_ok: false,
    });
  }

  private mockChangePlanner(vars: Record<string, string>): string {
    return JSON.stringify({
      items: [
        {
          kind: "add",
          target_section: "Non-functional Requirements",
          what_changes: "Thêm section NFR với các yêu cầu về performance, security, và scalability",
          rationale_source: "user request",
          impact_sections: ["Requirements", "Dependencies & Risks", "Launch Plan"],
        },
      ],
      conflicts_with_decisions: [],
      needs_clarification: [],
    });
  }
}
