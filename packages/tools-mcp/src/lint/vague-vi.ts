/**
 * L1-VAGUE — §8.3
 * Vietnamese vague term dictionary.
 * Flags vague words in REQ/metric contexts without accompanying numbers.
 */
import type { LintResult } from "./quote.js";

export const VAGUE_TERMS: string[] = [
  // tốc độ / hiệu năng
  "nhanh", "chậm", "mượt", "tức thì", "real-time", "gần như ngay lập tức",
  // số lượng
  "nhiều", "ít", "một số", "đa số", "hầu hết", "phần lớn", "đáng kể", "kha khá",
  // chất lượng
  "dễ dùng", "thân thiện", "trực quan", "ổn định", "tối ưu", "hiệu quả", "tốt hơn",
  // thời gian
  "gần đây", "sắp tới", "sớm", "trong thời gian tới", "định kỳ", "thường xuyên",
  // mức độ
  "cơ bản", "đầy đủ", "phù hợp", "hợp lý", "linh hoạt", "an toàn",
];

/** Vague → concrete suggestions for Writer few-shot */
export const VAGUE_REPLACEMENTS: Record<string, string> = {
  "nhanh": 'thời gian phản hồi < `<N>` giây (p95)',
  "nhiều người dùng": '`<N>`% người dùng hoạt động hàng ngày',
  "gần đây": 'trong `<N>` ngày qua tính từ {{today}}',
  "dễ dùng": 'người dùng mới hoàn thành tác vụ chính trong < `<N>` phút, không cần hỗ trợ',
};

/**
 * Check for vague terms in REQ/metric contexts.
 * Only flags when the term appears in a requirement or metric
 * AND the same sentence has no number/unit.
 */
export function checkVagueTerms(text: string): LintResult[] {
  const results: LintResult[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    const isReqOrMetric =
      line.includes("req-") ||
      line.includes("acceptance criteria") ||
      line.includes("success metric") ||
      line.includes("baseline") ||
      line.includes("target");

    if (!isReqOrMetric) continue;

    for (const term of VAGUE_TERMS) {
      if (line.includes(term)) {
        // Check if the same line has a number
        const hasNumber = /\d[\d.,]*\s*%?|\$[\d.,]+/.test(lines[i]);
        if (!hasNumber) {
          results.push({
            rule: "L1-VAGUE",
            passed: false,
            severity: "medium",
            message: `Vague term "${term}" in requirement/metric without specific number`,
            location: `line ${i + 1}`,
          });
        }
      }
    }
  }

  return results;
}
