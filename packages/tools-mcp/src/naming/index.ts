/**
 * Naming module — §4.13
 * File name generation + version bump. Code-driven, not agent-driven.
 */

import path from "node:path";

export type DocKind = "PRD" | "REVIEW" | "QUESTIONS" | "BRIEF" | "AMENDMENT" | "SUMMARY";

export interface NameParams {
  kind: DocKind;
  topic: string;
  version?: { major: number; minor: number };
  today?: string;         // DDMMYYYY or YYYYMMDD from run_context
  suffix?: "draft" | "needs-review";
  useIsoDate?: boolean;   // YYYYMMDD vs DDMMYYYY
}

/**
 * Slugify a topic: remove Vietnamese diacritics, lowercase, join with hyphens.
 */
export function slugify(text: string): string {
  const vietnamese: Record<string, string> = {
    à: "a", á: "a", ả: "a", ã: "a", ạ: "a",
    ă: "a", ằ: "a", ắ: "a", ẳ: "a", ẵ: "a", ặ: "a",
    â: "a", ầ: "a", ấ: "a", ẩ: "a", ẫ: "a", ậ: "a",
    đ: "d",
    è: "e", é: "e", ẻ: "e", ẽ: "e", ẹ: "e",
    ê: "e", ề: "e", ế: "e", ể: "e", ễ: "e", ệ: "e",
    ì: "i", í: "i", ỉ: "i", ĩ: "i", ị: "i",
    ò: "o", ó: "o", ỏ: "o", õ: "o", ọ: "o",
    ô: "o", ồ: "o", ố: "o", ổ: "o", ỗ: "o", ộ: "o",
    ơ: "o", ờ: "o", ớ: "o", ở: "o", ỡ: "o", ợ: "o",
    ù: "u", ú: "u", ủ: "u", ũ: "u", ụ: "u",
    ư: "u", ừ: "u", ứ: "u", ử: "u", ữ: "u", ự: "u",
    ỳ: "y", ý: "y", ỷ: "y", ỹ: "y", ỵ: "y",
  };

  return text
    .split("")
    .map((c) => vietnamese[c.toLowerCase()] || c)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Format date for filename.
 * @param today - "2026-09-21" (ISO from run_context)
 * @param useIso - true = YYYYMMDD, false = DDMMYYYY
 */
export function formatDate(today: string, useIso: boolean = false): string {
  const [y, m, d] = today.split("-");
  return useIso ? `${y}${m}${d}` : `${d}${m}${y}`;
}

/**
 * Generate a filename per §4.13 rules.
 * Code-driven: agent never sets filename.
 */
export function generateFileName(params: NameParams): string {
  const {
    kind,
    topic,
    version = { major: 0, minor: 1 },
    today = new Date().toISOString().slice(0, 10),
    suffix,
    useIsoDate = false,
  } = params;

  const parts: string[] = [
    kind,
    slugify(topic),
    `v${version.major}.${version.minor}`,
    formatDate(today, useIsoDate),
  ];

  if (suffix) parts.push(suffix);

  const name = parts.join("-");

  // Enforce max 120 chars for relative path
  if (name.length > 120) {
    return name.slice(0, 117) + "...";
  }

  return name;
}

/**
 * Bump version per §4.13 rules:
 * - Draft: v0.x (minor increments)
 * - First approve: v1.0
 * - Amendment after approve: v1.1 (minor increments)
 * - Re-approve after amendment: major +1
 */
export function bumpVersion(
  current: { major: number; minor: number },
  event: "draft" | "approve" | "amendment" | "re-approve",
): { major: number; minor: number } {
  switch (event) {
    case "draft":
      return { major: 0, minor: current.minor + 1 };
    case "approve":
      return { major: 1, minor: 0 };
    case "amendment":
      return { major: current.major, minor: current.minor + 1 };
    case "re-approve":
      return { major: current.major + 1, minor: 0 };
  }
}

/**
 * Validate filename: only [a-z0-9._-] and /, no Vietnamese, ≤120 chars.
 */
export function isValidFileName(name: string): boolean {
  if (name.length > 120) return false;
  if (/[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i.test(name))
    return false;
  if (/[^a-z0-9._\-/]/i.test(name)) return false;
  if (name.includes("../") || path.isAbsolute(name)) return false;
  return true;
}
