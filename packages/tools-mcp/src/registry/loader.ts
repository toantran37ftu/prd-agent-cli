/**
 * Checklist Registry — §8
 * Loads checklist items from YAML and filters by verifiability/template.
 */
import fs from "node:fs";
import path from "node:path";

export interface ChecklistItem {
  id: string;
  text: string;
  group: string;
  verifiability: "lint" | "cross_doc" | "doc_presence" | "human_only";
  detector: string | null;
  on_fail: string[];
  severity_default: "high" | "medium" | "low" | null;
  templates: string[];
  gate?: string;
}

const REGISTRY_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
  "checklist.yaml",
);

let cachedRegistry: ChecklistItem[] | null = null;

/**
 * Load the checklist registry from YAML.
 */
export function loadRegistry(yamlPath?: string): ChecklistItem[] {
  if (cachedRegistry) return cachedRegistry;

  const filePath = yamlPath || REGISTRY_PATH;
  if (!fs.existsSync(filePath)) {
    console.warn(`Checklist registry not found at ${filePath}`);
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  // Simple YAML-ish parser for our flat checklist format
  cachedRegistry = parseSimpleYaml(raw);
  return cachedRegistry ?? [];
}

/**
 * Minimal parser for our checklist YAML (flat list of objects).
 * Handles the specific format in checklist.yaml without external deps.
 */
function parseSimpleYaml(raw: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const blocks = raw.split(/^- /m).filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.split("\n");
    const item: Record<string, unknown> = {};

    for (const line of lines) {
      const match = line.match(/^\s*(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        // Parse arrays in brackets
        if (value.startsWith("[") && value.endsWith("]")) {
          (item as Record<string, unknown>)[key] = value
            .slice(1, -1)
            .split(",")
            .map((v) => v.trim());
        } else if (value === "null") {
          (item as Record<string, unknown>)[key] = null;
        } else {
          (item as Record<string, unknown>)[key] = value;
        }
      }
    }

    if (item.id && item.text) {
      items.push(item as unknown as ChecklistItem);
    }
  }

  return items;
}

/**
 * Filter items applicable to a given template.
 */
export function getItemsForTemplate(
  template: string,
  registry?: ChecklistItem[],
): ChecklistItem[] {
  const items = registry ?? loadRegistry();
  return items.filter((item) => item.templates.includes(template));
}

/**
 * Get only items that go into the Reviewer prompt (exclude human_only).
 */
export function getReviewerItems(
  template: string,
  registry?: ChecklistItem[],
): ChecklistItem[] {
  return getItemsForTemplate(template, registry).filter(
    (item) => item.verifiability !== "human_only",
  );
}

/**
 * Get only L3 human gate items for a template.
 */
export function getHumanGateItems(
  template: string,
  registry?: ChecklistItem[],
): ChecklistItem[] {
  return getItemsForTemplate(template, registry).filter(
    (item) => item.verifiability === "human_only",
  );
}

/**
 * Get items by verifiability type.
 */
export function getItemsByVerifiability(
  verifiability: ChecklistItem["verifiability"],
  template?: string,
  registry?: ChecklistItem[],
): ChecklistItem[] {
  const items = registry ?? loadRegistry();
  return items.filter(
    (item) =>
      item.verifiability === verifiability &&
      (!template || item.templates.includes(template)),
  );
}

/**
 * Verify that no human_only items appear in a prompt string.
 * Used for REQ-030 test.
 */
export function verifyNoHumanOnlyInPrompt(promptText: string): boolean {
  const registry = loadRegistry();
  const humanOnlyItems = registry.filter(
    (item) => item.verifiability === "human_only",
  );
  return !humanOnlyItems.some((item) => promptText.includes(item.id));
}
