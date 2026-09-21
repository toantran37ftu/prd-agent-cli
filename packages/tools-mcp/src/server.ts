import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ScopeGuard, ScopeGuardError, ROOT_FOLDER_TOKEN } from "./scope-guard.js";
import {
  queryMessages,
  listProjectMessages,
} from "./message-pool/index.js";

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
  async ({ node_id }) => {
    try {
      scopeGuard.assertCanRead(node_id);

      // In real implementation, this reads from .prdcli/cache/docs/<node_id>.md
      // For MCP server, we return a placeholder indicating the tool is available
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "tool_available",
              node_id,
              message:
                "This tool reads from local cache. Implementation reads .prdcli/cache/docs/<node_id>.md",
            }),
          },
        ],
      };
    } catch (err) {
      if (err instanceof ScopeGuardError) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "SCOPE_DENIED",
                message: err.message,
                node_id,
              }),
            },
          ],
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
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "tool_available",
            message:
              "Reads all summaries from .prdcli/memory/summaries/*.md",
          }),
        },
      ],
    };
  },
);

// ── read_project_memory ────────────────────────────────────────────────────
server.tool(
  "read_project_memory",
  "Read the project memory file containing decisions, questions, glossary, and risks.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "tool_available",
            message: "Reads .prdcli/memory/project_memory.md",
          }),
        },
      ],
    };
  },
);

// ── write_project_memory ───────────────────────────────────────────────────
server.tool(
  "write_project_memory",
  "Write entries to a specific section of project memory.",
  {
    section: z
      .enum(["Decisions", "Open Questions", "Glossary", "Risks"])
      .describe("Which section to append to"),
    entries: z.array(z.string()).describe("Entries to append"),
  },
  async ({ section, entries }) => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "tool_available",
            section,
            entries,
            message:
              "Appends entries to .prdcli/memory/project_memory.md section",
          }),
        },
      ],
    };
  },
);

// ── list_projects ──────────────────────────────────────────────────────────
server.tool(
  "list_projects",
  "List all available projects (sub-folders in root).",
  {},
  async () => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "tool_available",
            root_folder_token: ROOT_FOLDER_TOKEN,
            message:
              "Lists sub-folders under root_folder_token via Lark API",
          }),
        },
      ],
    };
  },
);

// ── scoped_create_docx ─────────────────────────────────────────────────────
server.tool(
  "scoped_create_docx",
  "Create a new document in the current project. Scope-guarded to prevent cross-project writes.",
  {
    title: z.string().describe("Document title"),
    folder_token: z
      .string()
      .optional()
      .describe("Target folder token (must be within current project)"),
  },
  async ({ title, folder_token }) => {
    const target = folder_token ?? "current_project_folder";

    try {
      if (folder_token) {
        scopeGuard.assertCanWrite(folder_token);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "tool_available",
              title,
              target_folder: target,
              message:
                "Creates a new docx in the specified folder via Lark API",
            }),
          },
        ],
      };
    } catch (err) {
      if (err instanceof ScopeGuardError) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "SCOPE_DENIED",
                message: err.message,
              }),
            },
          ],
          isError: true,
        };
      }
      throw err;
    }
  },
);

// ── scoped_update_docx ─────────────────────────────────────────────────────
server.tool(
  "scoped_update_docx",
  "Update/append content to an existing document. Scope-guarded.",
  {
    node_id: z.string().describe("Document node ID"),
    content: z.string().describe("Content to append (markdown)"),
  },
  async ({ node_id, content }) => {
    try {
      scopeGuard.assertCanWrite(node_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "tool_available",
              node_id,
              message: "Appends content to document via Lark API",
            }),
          },
        ],
      };
    } catch (err) {
      if (err instanceof ScopeGuardError) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "SCOPE_DENIED",
                message: err.message,
              }),
            },
          ],
          isError: true,
        };
      }
      throw err;
    }
  },
);

// ── run_sync ───────────────────────────────────────────────────────────────
server.tool(
  "run_sync",
  "Sync project documents from Lark to local cache.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "tool_available",
            message:
              "Triggers sync via CLI: lists docs, compares hashes, downloads new/changed, runs Summarizer",
          }),
        },
      ],
    };
  },
);

// ── run_review ─────────────────────────────────────────────────────────────
server.tool(
  "run_review",
  "Run the ReviewOrchestrator on a document. Uses Reviewer + Verifier agents.",
  {
    doc: z.string().describe("Document node ID or name to review"),
  },
  async ({ doc }) => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "tool_available",
            doc,
            message:
              "Invokes ReviewOrchestrator: Reviewer generates claims, Verifier checks important ones",
          }),
        },
      ],
    };
  },
);

// ── run_ask ────────────────────────────────────────────────────────────────
server.tool(
  "run_ask",
  "Run the AskOrchestrator on a document. Uses Review output + Question Generator.",
  {
    doc: z.string().describe("Document node ID or name"),
  },
  async ({ doc }) => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "tool_available",
            doc,
            message:
              "Invokes AskOrchestrator: reuses review output, generates questions",
          }),
        },
      ],
    };
  },
);

// ── run_draft ──────────────────────────────────────────────────────────────
server.tool(
  "run_draft",
  "Run the DraftOrchestrator. Uses Writer + Critic agents with feedback loop.",
  {
    topic: z.string().describe("Topic for the PRD draft"),
  },
  async ({ topic }) => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "tool_available",
            topic,
            message:
              "Invokes DraftOrchestrator: Writer drafts PRD, Critic reviews, loops up to 2 times",
          }),
        },
      ],
    };
  },
);

// ── query_message_pool ────────────────────────────────────────────────────
server.tool(
  "query_message_pool",
  "Query the message pool for agent outputs. Returns structured messages matching the query.",
  {
    project: z.string().describe("Project name"),
    type: z
      .enum([
        "doc_summary",
        "review_result",
        "question_list",
        "draft_prd",
        "critic_feedback",
      ])
      .optional()
      .describe("Filter by message type"),
    target_doc_node_id: z
      .string()
      .optional()
      .describe("Filter by target document node ID"),
    fresh_only: z
      .boolean()
      .optional()
      .describe("Only return messages where all based_on hashes match current"),
  },
  async ({ project, type, target_doc_node_id, fresh_only }) => {
    try {
      const messages = queryMessages({
        project,
        type,
        target_doc_node_id,
        freshOnly: fresh_only,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: messages.length, messages }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "QUERY_FAILED",
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
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
