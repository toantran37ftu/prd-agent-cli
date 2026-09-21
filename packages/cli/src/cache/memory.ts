import fs from "node:fs";
import path from "node:path";
import { getMemoryDir, ensureDirs } from "./store.js";

const SUMMARIES_DIR_NAME = "summaries";
const PROJECT_MEMORY_FILE = "project_memory.md";

export function getSummariesDir(cwd: string = process.cwd()): string {
  return path.join(getMemoryDir(cwd), SUMMARIES_DIR_NAME);
}

export function getProjectMemoryPath(cwd: string = process.cwd()): string {
  return path.join(getMemoryDir(cwd), PROJECT_MEMORY_FILE);
}

export interface SummaryEntry {
  nodeId: string;
  content: string;
  hash: string;
}

export function getSummary(
  nodeId: string,
  cwd: string = process.cwd(),
): string | null {
  const filePath = path.join(getSummariesDir(cwd), `${nodeId}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

export function saveSummary(
  nodeId: string,
  content: string,
  cwd: string = process.cwd(),
): void {
  ensureDirs(cwd);
  const dir = getSummariesDir(cwd);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, `${nodeId}.md`), content);
}

export function initProjectMemory(
  projectName: string,
  cwd: string = process.cwd(),
): void {
  ensureDirs(cwd);
  const memPath = getProjectMemoryPath(cwd);
  if (fs.existsSync(memPath)) return;

  const template = `# Project Memory — ${projectName}

## Decisions

## Open Questions

## Glossary

## Risks
`;
  fs.writeFileSync(memPath, template);
}

export interface ProjectMemory {
  decisions: string[];
  openQuestions: string[];
  glossary: string[];
  risks: string[];
}

export function parseProjectMemory(cwd: string = process.cwd()): ProjectMemory {
  const memPath = getProjectMemoryPath(cwd);
  if (!fs.existsSync(memPath)) {
    return { decisions: [], openQuestions: [], glossary: [], risks: [] };
  }

  const content = fs.readFileSync(memPath, "utf-8");
  return {
    decisions: extractSection(content, "Decisions"),
    openQuestions: extractSection(content, "Open Questions"),
    glossary: extractSection(content, "Glossary"),
    risks: extractSection(content, "Risks"),
  };
}

function extractSection(content: string, sectionName: string): string[] {
  const regex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  if (!match?.[1]) return [];

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || line.startsWith("- [ ]"))
    .map((line) => line.replace(/^- (\[ \] )?/, ""));
}

export function appendToSection(
  sectionName: string,
  entries: string[],
  cwd: string = process.cwd(),
): void {
  const memPath = getProjectMemoryPath(cwd);
  if (!fs.existsSync(memPath)) return;

  let content = fs.readFileSync(memPath, "utf-8");
  const regex = new RegExp(`(## ${sectionName}\\s*\\n)`);
  const match = content.match(regex);

  if (!match) return;

  const insertPoint = content.indexOf(match[0]) + match[0].length;
  const newEntries = entries.map((e) => `- ${e}`).join("\n") + "\n";
  content =
    content.slice(0, insertPoint) + newEntries + content.slice(insertPoint);

  fs.writeFileSync(memPath, content);
}

export function readAllSummaries(cwd: string = process.cwd()): SummaryEntry[] {
  const dir = getSummariesDir(cwd);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files.map((f) => {
    const nodeId = f.replace(".md", "");
    const content = fs.readFileSync(path.join(dir, f), "utf-8");
    return { nodeId, content, hash: "" };
  });
}
