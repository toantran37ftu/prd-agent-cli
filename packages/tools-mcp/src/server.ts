import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ScopeGuard, ScopeGuardError, ROOT_FOLDER_TOKEN } from "./scope-guard.js";
import {
  queryMessages,
  listProjectMessages,
} from "./message-pool/index.js";
import { readCachedDoc } from "./tools/read-cached-doc.js";
import { readSummaries } from "./tools/read-summaries.js";
import { readProjectMemory } from "./tools/read-project-memory.js";
import { writeProjectMemory } from "./tools/write-project-memory.js";
import { ensureWorkspaceFile } from "./tools/ensure-workspace-file.js";
import { appendWorkspaceFile } from "./tools/append-workspace-file.js";
import { scopedCreateFile } from "./tools/scoped-create-file.js";

const scopeGuard = new ScopeGuard();

const server = new McpServer({
  name: "prdcli-tools",
  version: "0.1.0",
});

// ── read_cached_doc ────────────────────────────────────────────────────────
server.tool(
  "read_cached_doc",
  "Read a document from the local cache. Verifies scope before reading.",
  { node_id: z.string().describe("The node ID of the document to read") },
  async ({ node_id }: { node_id: string }) => {
    try {
      const result = await readCachedDoc({ node_id }, scopeGuard);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !!result.error,
      };
    } catch (err) {
      if (err instanceof ScopeGuardError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "SCOPE_DENIED", message: err.message }) }],
          isError: true,
        };
      }
      throw err;
    }
  },
);

// ── read_summaries ─────────────────────────────────────────────────────────
server.tool(
  "read_summaries",
  "Read all document summaries for the current project.",
  {},
  async () => {
    const result = await readSummaries({}, scopeGuard);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
);

// ── read_project_memory ────────────────────────────────────────────────────
server.tool(
  "read_project_memory",
  "Read the project memory file containing decisions, questions, glossary, and risks.",
  {},
  async () => {
    const result = await readProjectMemory({}, scopeGuard);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !!result.error,
    };
  },
);

// ── write_project_memory ───────────────────────────────────────────────────
server.tool(
  "write_project_memory",
  "Write entries to a specific section of project memory.",
  {
    section: z.enum(["Decisions", "Open Questions", "Glossary", "Risks"]).describe("Which section to append to"),
    entries: z.array(z.string()).describe("Entries to append"),
  },
  async ({ section, entries }: { section: string; entries: string[] }) => {
    const result = await writeProjectMemory({ section: section as "Decisions" | "Open Questions" | "Glossary" | "Risks", entries }, scopeGuard);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !result.success,
    };
  },
);

// ── list_projects ──────────────────────────────────────────────────────────
server.tool(
  "list_projects",
  "List all available projects. In local-only mode, scans .prdcli/ directory.",
  {},
  async () => {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const cacheDir = path.join(process.cwd(), ".prdcli", "cache", "docs");
      const projects: string[] = [];

      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir);
        projects.push(...files.filter((f: string) => f.endsWith(".meta.json")).map((f: string) => f.replace(".meta.json", "")));
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            projects,
            root_folder_token: ROOT_FOLDER_TOKEN,
            mode: "local-only",
          }),
        }],
      };
    } catch {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ projects: [], error: "Failed to list projects" }) }],
      };
    }
  },
);

// ── scoped_create_docx ─────────────────────────────────────────────────────
server.tool(
  "scoped_create_docx",
  "Create a new document. In local-only mode, writes to project folder.",
  {
    title: z.string().describe("Document title"),
    folder_token: z.string().optional().describe("Target folder token"),
  },
  async ({ title, folder_token }: { title: string; folder_token?: string }) => {
    try {
      if (folder_token) scopeGuard.assertCanWrite(folder_token);
      const fs = await import("node:fs");
      const path = await import("node:path");
      const filePath = path.join(process.cwd(), `${title}.md`);
      fs.writeFileSync(filePath, `# ${title}\n\n[Created by prdcli]`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, path: filePath, title }) }],
      };
    } catch (err) {
      if (err instanceof ScopeGuardError) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "SCOPE_DENIED", message: err.message }) }], isError: true };
      }
      throw err;
    }
  },
);

// ── scoped_update_docx ─────────────────────────────────────────────────────
server.tool(
  "scoped_update_docx",
  "Append content to an existing document.",
  {
    node_id: z.string().describe("Document node ID"),
    content: z.string().describe("Content to append"),
  },
  async ({ node_id, content }: { node_id: string; content: string }) => {
    try {
      scopeGuard.assertCanWrite(node_id);
      const fs = await import("node:fs");
      const path = await import("node:path");
      const filePath = path.join(process.cwd(), ".prdcli", "cache", "docs", `${node_id}.md`);
      if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, "\n" + content);
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, node_id }) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "NOT_FOUND", message: `Document ${node_id} not found` }) }], isError: true };
    } catch (err) {
      if (err instanceof ScopeGuardError) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "SCOPE_DENIED", message: err.message }) }], isError: true };
      }
      throw err;
    }
  },
);

// ── ensure_workspace_file ──────────────────────────────────────────────────
server.tool(
  "ensure_workspace_file",
  "Create a file in workspace (Zone A) if it doesn't exist. Whitelist-enforced.",
  {
    relPath: z.string().describe("Relative path within workspace whitelist"),
    initialContent: z.string().optional().describe("Initial file content"),
  },
  async ({ relPath, initialContent }: { relPath: string; initialContent?: string }) => {
    const result = ensureWorkspaceFile(relPath, initialContent);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !!result.error,
    };
  },
);

// ── append_workspace_file ──────────────────────────────────────────────────
server.tool(
  "append_workspace_file",
  "Append content to a section in a workspace file. Never overwrites.",
  {
    relPath: z.string().describe("Relative path within workspace whitelist"),
    section: z.string().describe("Section name to append to"),
    content: z.string().describe("Content to append"),
  },
  async ({ relPath, section, content }: { relPath: string; section: string; content: string }) => {
    const result = appendWorkspaceFile(relPath, section, content);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  },
);

// ── scoped_create_file ─────────────────────────────────────────────────────
server.tool(
  "scoped_create_file",
  "Create a file in project folder (Zone B). Returns pending_write_id.",
  {
    relPath: z.string().describe("Relative path in project"),
    content: z.string().describe("File content"),
    kind: z.enum(["md", "csv", "json"]).describe("File type"),
  },
  async ({ relPath, content, kind }: { relPath: string; content: string; kind: "md" | "csv" | "json" }) => {
    const result = scopedCreateFile(relPath, content, kind, scopeGuard, ROOT_FOLDER_TOKEN);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !!result.error,
    };
  },
);

// ── run_sync ───────────────────────────────────────────────────────────────
server.tool(
  "run_sync",
  "Sync project documents from Lark to local cache.",
  {},
  async () => {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "available",
          message: "Use `prdcli sync` CLI command. MCP tool delegates to CLI.",
        }),
      }],
    };
  },
);

// ── run_review ─────────────────────────────────────────────────────────────
server.tool(
  "run_review",
  "Run the ReviewOrchestrator on a document.",
  {
    doc: z.string().describe("Document node ID to review"),
  },
  async ({ doc }: { doc: string }) => {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "available",
          doc,
          message: "Use `prdcli review <doc>` CLI command. MCP tool delegates to CLI.",
        }),
      }],
    };
  },
);

// ── run_ask ────────────────────────────────────────────────────────────────
server.tool(
  "run_ask",
  "Run the AskOrchestrator on a document.",
  {
    doc: z.string().describe("Document node ID"),
  },
  async ({ doc }: { doc: string }) => {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "available",
          doc,
          message: "Use `prdcli ask <doc>` CLI command.",
        }),
      }],
    };
  },
);

// ── run_draft ──────────────────────────────────────────────────────────────
server.tool(
  "run_draft",
  "Run the DraftOrchestrator.",
  {
    topic: z.string().describe("Topic for the PRD draft"),
  },
  async ({ topic }: { topic: string }) => {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "available",
          topic,
          message: "Use `prdcli draft --topic <topic>` CLI command.",
        }),
      }],
    };
  },
);

// ── run_update ─────────────────────────────────────────────────────────────
server.tool(
  "run_update",
  "Run the UpdateOrchestrator on a document.",
  {
    doc: z.string().describe("Document node ID"),
    request: z.string().describe("Change request"),
  },
  async ({ doc, request }: { doc: string; request: string }) => {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "available",
          doc,
          request,
          message: "Use `prdcli update <doc> --request <request>` CLI command.",
        }),
      }],
    };
  },
);

// ── query_message_pool ────────────────────────────────────────────────────
server.tool(
  "query_message_pool",
  "Query the message pool for agent outputs.",
  {
    project: z.string().describe("Project name"),
    type: z.enum(["doc_summary", "review_result", "question_list", "draft_prd", "critic_feedback", "change_request", "change_set", "lint_report", "prd_brief"]).optional(),
    target_doc_node_id: z.string().optional(),
    fresh_only: z.boolean().optional(),
  },
  async ({ project, type, target_doc_node_id, fresh_only }: { project: string; type?: string; target_doc_node_id?: string; fresh_only?: boolean }) => {
    try {
      const messages = queryMessages({
        project,
        type: type as import("./message-pool/types.js").MessageType | undefined,
        target_doc_node_id,
        freshOnly: fresh_only,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ count: messages.length, messages }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "QUERY_FAILED", message: err instanceof Error ? err.message : String(err) }) }],
        isError: true,
      };
    }
  },
);

// ── start server ───────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("prdcli-tools MCP server running on stdio");
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
