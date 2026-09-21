import fs from "node:fs";
import path from "node:path";
import { ROOT_FOLDER_TOKEN } from "../config/default.js";

export interface ExportResult {
  files: Array<{ path: string; content: string }>;
  channel: string;
}

/**
 * Export configuration for Claude Code channel.
 * Generates .mcp.json + .claude/agents/*.md files.
 */
export function exportForClaudeCode(projectDir: string): ExportResult {
  const files: Array<{ path: string; content: string }> = [];

  // .mcp.json
  const mcpConfig = {
    mcpServers: {
      "prdcli-tools": {
        command: "node",
        args: [path.join(projectDir, "packages/tools-mcp/dist/server.js")],
        env: {},
      },
      lark: {
        command: "npx",
        args: ["@larksuiteoapi/lark-mcp"],
        env: {
          LARK_APP_ID: "${LARK_APP_ID}",
          LARK_APP_SECRET: "${LARK_APP_SECRET}",
        },
      },
    },
  };

  files.push({
    path: ".mcp.json",
    content: JSON.stringify(mcpConfig, null, 2),
  });

  // Agent prompts as subagents
  const agents = [
    { name: "review-orchestrator", file: "review-orchestrator.md" },
    { name: "ask-orchestrator", file: "ask-orchestrator.md" },
    { name: "draft-orchestrator", file: "draft-orchestrator.md" },
    { name: "supervisor", file: "supervisor.md" },
    { name: "reviewer", file: "reviewer.md" },
    { name: "verifier", file: "verifier.md" },
    { name: "question-gen", file: "question-gen.md" },
    { name: "writer", file: "writer.md" },
    { name: "critic", file: "critic.md" },
    { name: "summarizer", file: "summarizer.md" },
  ];

  for (const agent of agents) {
    const promptPath = path.join(
      projectDir,
      "packages/cli/src/agents/prompts",
      agent.file,
    );
    if (fs.existsSync(promptPath)) {
      const content = fs.readFileSync(promptPath, "utf-8");
      files.push({
        path: `.claude/agents/${agent.file}`,
        content: `# ${agent.name}\n\n${content}`,
      });
    }
  }

  return { files, channel: "claude-code" };
}

/**
 * Export raw MCP server configuration for generic use.
 */
export function exportGenericMcp(projectDir: string): ExportResult {
  const files: Array<{ path: string; content: string }> = [];

  // mcpServers JSON
  const mcpConfig = {
    mcpServers: {
      "prdcli-tools": {
        command: "node",
        args: [path.join(projectDir, "packages/tools-mcp/dist/server.js")],
        env: {},
      },
      lark: {
        command: "npx",
        args: ["@larksuiteoapi/lark-mcp"],
        env: {
          LARK_APP_ID: "${LARK_APP_ID}",
          LARK_APP_SECRET: "${LARK_APP_SECRET}",
        },
      },
    },
  };

  files.push({
    path: "mcpServers.json",
    content: JSON.stringify(mcpConfig, null, 2),
  });

  // Copy all prompts
  const promptsDir = path.join(
    projectDir,
    "packages/cli/src/agents/prompts",
  );
  if (fs.existsSync(promptsDir)) {
    const promptFiles = fs.readdirSync(promptsDir).filter((f) => f.endsWith(".md"));
    for (const file of promptFiles) {
      const content = fs.readFileSync(path.join(promptsDir, file), "utf-8");
      files.push({
        path: `agents/prompts/${file}`,
        content,
      });
    }
  }

  return { files, channel: "generic-mcp-export" };
}

/**
 * Write exported files to disk.
 */
export function writeExportFiles(
  result: ExportResult,
  outputDir: string,
): void {
  for (const file of result.files) {
    const fullPath = path.join(outputDir, file.path);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, file.content);
  }
}
