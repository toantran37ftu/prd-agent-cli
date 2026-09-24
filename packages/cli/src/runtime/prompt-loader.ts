/**
 * Prompt Loader — loads agent prompts from .md files and renders with variables.
 */
import fs from "node:fs";
import path from "node:path";

const PROMPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
  "../agents/prompts",
);

let cachedPreamble: string | null = null;

export function loadSharedPreamble(): string {
  if (cachedPreamble) return cachedPreamble;
  const preamblePath = path.join(PROMPTS_DIR, "_shared-preamble.md");
  if (!fs.existsSync(preamblePath)) {
    throw new Error(`Shared preamble not found at ${preamblePath}`);
  }
  cachedPreamble = fs.readFileSync(preamblePath, "utf-8");
  return cachedPreamble;
}

export function loadPrompt(agentName: string): string {
  const promptPath = path.join(PROMPTS_DIR, `${agentName}.md`);
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file not found: ${promptPath}`);
  }
  return fs.readFileSync(promptPath, "utf-8");
}

export function loadTemplate(templateName: string): string {
  const templatePath = path.join(PROMPTS_DIR, "prd-templates", `${templateName}.md`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  return fs.readFileSync(templatePath, "utf-8");
}

export function renderPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;

  // Replace {{SHARED_PREAMBLE}} first
  if (!vars["SHARED_PREAMBLE"]) {
    result = result.replace(/\{\{SHARED_PREAMBLE\}\}/g, loadSharedPreamble());
  }

  // Replace all {{variable}} placeholders
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * Get the list of prompt files available.
 */
export function listAvailablePrompts(): string[] {
  if (!fs.existsSync(PROMPTS_DIR)) return [];
  return fs
    .readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith(".md") && f !== "_shared-preamble.md")
    .map((f) => f.replace(".md", ""));
}
