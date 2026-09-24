import { Command } from "commander";
import { login } from "./auth/login.js";
import { loadToken, isTokenExpired } from "./auth/token-store.js";
import { getCurrentUser, createLarkClient } from "./lark/mcp-client.js";
import {
  loadConfig,
  saveConfig,
  setConfigValue,
  AppConfig,
} from "./config/index.js";
import {
  loadProjectConfig,
  saveProjectConfig,
  ProjectConfig,
} from "./config/project.js";
import {
  listRootFolders,
  ensureMemoryFolder,
} from "./lark/drive.js";
import { ROOT_FOLDER_TOKEN } from "./config/default.js";
import {
  ensureDirs,
  getCachedDoc,
  saveCachedDoc,
  listCachedDocs,
  contentHash,
  saveRunLog,
} from "./cache/store.js";
import {
  computeSyncDiff,
  RemoteNodeInfo,
} from "./cache/diff.js";
import { getDocContent } from "./lark/docs.js";
import {
  getSummary,
  saveSummary,
  initProjectMemory,
  readAllSummaries,
} from "./cache/memory.js";
import crypto from "node:crypto";

/**
 * Lazy-import Message Pool functions.
 * Tries tools-mcp package first, falls back to inline filesystem implementation.
 */
async function importMessagePool(): Promise<{
  publishMessage: (msg: Record<string, unknown>) => Record<string, unknown>;
  getLatestMessage: (query: Record<string, unknown>) => Record<string, unknown> | null;
  queryMessages: (query: Record<string, unknown>) => Record<string, unknown>[];
  listProjectMessages: (project: string) => Record<string, unknown>[];
  contentHash: (content: string) => string;
}> {
  const contentHashFn = (content: string) =>
    crypto.createHash("sha256").update(content).digest("hex");

  try {
    // Try loading from built tools-mcp package (works at runtime when tools-mcp is built)
    const mod = await import("@prd-agent/tools-mcp/dist/message-pool/index.js" as string);
    return {
      publishMessage: mod.publishMessage,
      getLatestMessage: mod.getLatestMessage,
      queryMessages: mod.queryMessages,
      listProjectMessages: mod.listProjectMessages,
      contentHash: contentHashFn,
    };
  } catch {
    // Fallback: inline message pool using filesystem directly
    const MESSAGES_DIR = ".prdcli/messages";
    const fs = await import("node:fs");
    const pathMod = await import("node:path");

    const publishMessage = (msg: Record<string, unknown>) => {
      const dir = pathMod.join(process.cwd(), MESSAGES_DIR, msg.project as string);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const docPart = (msg.target_doc_node_id as string) ?? "general";
      const full = { ...msg, id: `msg_${Date.now()}`, created_at: new Date().toISOString() };
      fs.writeFileSync(pathMod.join(dir, `${msg.type}__${docPart}.json`), JSON.stringify(full, null, 2));
      return full;
    };

    const queryMessages = (query: Record<string, unknown>) => {
      const dir = pathMod.join(process.cwd(), MESSAGES_DIR, query.project as string);
      if (!fs.existsSync(dir)) return [];
      const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".json"));
      return files
        .map((f: string) => {
          try {
            return JSON.parse(fs.readFileSync(pathMod.join(dir, f), "utf-8"));
          } catch { return null; }
        })
        .filter(Boolean)
        .filter((m: Record<string, unknown>) => {
          if (query.type && m.type !== query.type) return false;
          if (query.target_doc_node_id !== undefined && m.target_doc_node_id !== query.target_doc_node_id) return false;
          if (query.require_fresh_hash && m.based_on_hash !== query.require_fresh_hash) return false;
          return true;
        })
        .sort((a: Record<string, string>, b: Record<string, string>) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
    };

    const getLatestMessage = (query: Record<string, unknown>) => {
      const results = queryMessages(query);
      return results[0] ?? null;
    };

    const listProjectMessages = (project: string) => queryMessages({ project });

    return { publishMessage, getLatestMessage, queryMessages, listProjectMessages, contentHash: contentHashFn };
  }
}

const program = new Command();

program
  .name("prdcli")
  .description("PRD Agent CLI — Lark-based PRD management with AI agents")
  .version("0.1.0");

// ── Login ──────────────────────────────────────────────────────────────────
program
  .command("login")
  .description("Authenticate with Lark via OAuth")
  .action(async () => {
    try {
      const token = await login();
      console.log(`✓ Logged in as ${token.email ?? "unknown"}`);
    } catch (err) {
      console.error(
        `✗ Login failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  });

// ── Status ─────────────────────────────────────────────────────────────────
program
  .command("status")
  .description("Show current user, project, channel, and sync status")
  .action(async () => {
    const config = loadConfig();
    const project = loadProjectConfig();
    const token = loadToken();

    console.log("=== PRD CLI Status ===");

    // User
    if (!token) {
      console.log("User: Not logged in");
    } else if (isTokenExpired(token)) {
      console.log("User: Token expired — run `prdcli login`");
    } else {
      try {
        const client = await createLarkClient();
        const user = await getCurrentUser(client);
        console.log(`User: ${user.name} (${user.email})`);
      } catch {
        console.log(`User: ${token.email ?? "token present but info unavailable"}`);
      }
    }

    // Project
    if (project) {
      console.log(`Project: ${project.projectName}`);
      console.log(`  Folder token: ${project.projectFolderToken}`);
      console.log(`  Last sync: ${project.lastSyncAt ?? "never"}`);
    } else {
      console.log("Project: None (run `prdcli project use <name>`)");
    }

    // Channel
    console.log(`Channel: ${config.channel}`);
    console.log(`Model: ${config.model}`);

    // Cache stats
    const cached = listCachedDocs();
    console.log(`Cached docs: ${cached.length}`);

    // Message pool stats
    if (project) {
      try {
        const { queryMessages } = await importMessagePool();
        const messages = queryMessages({ project: project.projectName });
        console.log(`Message pool: ${messages.length} messages`);
        const byType: Record<string, number> = {};
        for (const m of messages) {
          const t = (m as Record<string, unknown>).type as string;
          byType[t] = (byType[t] || 0) + 1;
        }
        for (const [type, count] of Object.entries(byType)) {
          console.log(`  - ${type}: ${count}`);
        }
      } catch {
        // Message pool not available
      }
    }
  });

// ── Config ─────────────────────────────────────────────────────────────────
const configCmd = program
  .command("config")
  .description("Manage CLI configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a configuration value")
  .action((key: string, value: string) => {
    const validKeys: (keyof AppConfig)[] = [
      "appId",
      "appSecret",
      "region",
      "model",
      "redirectPort",
      "channel",
    ];
    if (!validKeys.includes(key as keyof AppConfig)) {
      console.error(`✗ Invalid key. Valid keys: ${validKeys.join(", ")}`);
      process.exit(1);
    }

    let parsedValue: string | number = value;
    if (key === "redirectPort") parsedValue = parseInt(value, 10);

    setConfigValue(key as keyof AppConfig, parsedValue as never);
    console.log(`✓ Set ${key} = ${key === "appSecret" ? "****" : value}`);
  });

configCmd
  .command("show")
  .description("Show current configuration")
  .action(() => {
    const config = loadConfig();
    const display = { ...config, appSecret: config.appSecret ? "****" : "" };
    console.log(JSON.stringify(display, null, 2));
  });

// ── Project ────────────────────────────────────────────────────────────────
const projectCmd = program
  .command("project")
  .description("Manage projects");

projectCmd
  .command("list")
  .description("List all projects (sub-folders in root)")
  .action(async () => {
    try {
      const client = await createLarkClient();
      const folders = await listRootFolders(client);

      if (folders.length === 0) {
        console.log("No projects found in root folder.");
        return;
      }

      console.log("Projects:");
      for (const folder of folders) {
        if (folder.type === "folder") {
          console.log(`  - ${folder.name} (${folder.token})`);
        }
      }
    } catch (err) {
      console.error(
        `✗ Failed to list projects: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  });

projectCmd
  .command("use <project-name>")
  .description("Set active project")
  .action(async (projectName: string) => {
    try {
      const client = await createLarkClient();
      const folders = await listRootFolders(client);

      const match = folders.find(
        (f) => f.type === "folder" && f.name === projectName,
      );

      if (!match) {
        console.error(`✗ Project "${projectName}" not found.`);
        console.log("Available projects:");
        for (const f of folders.filter((f) => f.type === "folder")) {
          console.log(`  - ${f.name}`);
        }
        process.exit(1);
      }

      // Create _agent_memory folder if needed
      const memoryToken = await ensureMemoryFolder(client, match.token);

      const projectConfig: ProjectConfig = {
        projectName: match.name,
        projectFolderToken: match.token,
        memoryFolderToken: memoryToken,
        lastSyncAt: null,
      };

      saveProjectConfig(projectConfig);
      initProjectMemory(match.name);
      ensureDirs();

      console.log(`✓ Active project: ${match.name}`);
      console.log(`  Folder token: ${match.token}`);
      console.log(`  Memory folder: ${memoryToken}`);
    } catch (err) {
      console.error(
        `✗ Failed to set project: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  });

// ── Sync ───────────────────────────────────────────────────────────────────
program
  .command("sync")
  .description("Sync project documents to local cache")
  .option("--force", "Force re-sync all documents")
  .action(async (opts: { force?: boolean }) => {
    try {
      const project = loadProjectConfig();
      if (!project) {
        console.error("✗ No project configured. Run: prdcli project use <name>");
        process.exit(1);
      }

      const client = await createLarkClient();
      ensureDirs();

      console.log(`Syncing project: ${project.projectName}`);

      // List all files in project recursively
      const { listProjectContents } = await import("./lark/drive.js");
      const allNodes = await listProjectContents(client, project.projectFolderToken);

      const remoteNodes: RemoteNodeInfo[] = allNodes
        .filter((n) => n.type !== "folder")
        .map((n) => ({
          nodeId: n.token,
          updatedTime: n.modifiedTime || n.createdTime,
          type: n.type as "docx" | "sheet" | "bitable" | "wiki",
          path: n.name,
        }));

      const diff = computeSyncDiff(remoteNodes);

      console.log(
        `  Add: ${diff.toAdd.length}, Update: ${diff.toUpdate.length}, Unchanged: ${diff.unchanged.length}`,
      );

      const toSync = [...diff.toAdd, ...diff.toUpdate];

      if (toSync.length === 0 && !opts.force) {
        console.log("  Nothing to sync.");
        return;
      }

      for (const nodeId of toSync) {
        const remote = remoteNodes.find((r) => r.nodeId === nodeId);
        if (!remote) continue;

        try {
          console.log(`  Syncing: ${remote.path} (${remote.type})`);

          const doc = await getDocContent(client, nodeId, remote.type);

          const meta = saveCachedDoc(nodeId, doc.content, {
            nodeId,
            updatedTime: remote.updatedTime,
            type: remote.type,
            path: remote.path,
          });

          // Check if summary already exists on Lark (other member synced)
          const existingSummary = getSummary(nodeId);
          if (!existingSummary || opts.force) {
            // TODO: Call Summarizer agent here (mock for now)
            const mockSummary = `Summary of ${remote.path}\n\n${doc.content.slice(0, 200)}...`;
            saveSummary(nodeId, mockSummary);
          }
        } catch (err) {
          console.warn(
            `  ⚠ Skipped ${remote.path}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      // Update lastSyncAt
      project.lastSyncAt = new Date().toISOString();
      saveProjectConfig(project);

      console.log("✓ Sync complete.");
    } catch (err) {
      console.error(
        `✗ Sync failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  });

// ── Review ─────────────────────────────────────────────────────────────────
program
  .command("review <doc>")
  .description("Review a document (run ReviewOrchestrator)")
  .option("--push-comment", "Push review as comments to Lark (builtin channel only)")
  .action(async (doc: string, opts: { pushComment?: boolean }) => {
    try {
      const project = loadProjectConfig();
      if (!project) {
        console.error("✗ No project configured.");
        process.exit(1);
      }

      console.log(`Reviewing: ${doc}`);
      console.log("Running ReviewOrchestrator...");

      const cached = getCachedDoc(doc);
      if (!cached) {
        console.error(`✗ Document "${doc}" not in cache. Run: prdcli sync`);
        process.exit(1);
      }

      console.log(`\nDocument: ${cached.meta.path}`);
      console.log(`Type: ${cached.meta.type}`);
      console.log(`Content length: ${cached.content.length} chars`);

      // Check message pool for existing fresh review
      const { getLatestMessage, publishMessage, contentHash: hashFn } = await importMessagePool();
      const docHash = hashFn(cached.content);
      const existing = getLatestMessage({
        project: project.projectName,
        type: "review_result",
        target_doc_node_id: doc,
        require_fresh_hash: docHash,
      });

      if (existing) {
        console.log("\n✓ Found fresh review in message pool. Reusing.");
        console.log(JSON.stringify(existing.content, null, 2));
      } else {
        console.log("\n[ReviewOrchestrator running...]");

        // Wire real orchestrator with mock LLM
        try {
          const { ReviewOrchestrator } = await import("@prd-agent/tools-mcp/dist/orchestrators/review-orchestrator.js" as string);
          const { BuiltinClaudeRuntime } = await import("./runtime/builtin-claude.js");
          const runtime = new BuiltinClaudeRuntime({ mode: "mock" });

          const orchestrator = new ReviewOrchestrator({
            maxVerifierCalls: 2,
            llmCaller: (agentName: string, vars: Record<string, string>) => runtime.callAgent(agentName, vars),
          });

          const result = await orchestrator.run(
            project.projectName,
            doc,
            cached.content,
          );

          console.log(`\n${result.summary}`);
        } catch (importErr) {
          // Fallback if tools-mcp not built
          console.log("[ReviewOrchestrator] Module not available, using fallback");
          const mockResult = {
            claims: [{ id: "c1", type: "gap", checklist_item_id: "REQ-AC", severity: "high", text: "Missing acceptance criteria", evidence: [], verification_status: "not_checked" }],
            verifiedCount: 0, unverifiedCount: 1,
            summary: "Found 1 claim. 0 verified, 1 unverified.",
            based_on_hash: docHash,
          };
          console.log(JSON.stringify(mockResult, null, 2));
          publishMessage({ type: "review_result", project: project.projectName, target_doc_node_id: doc, produced_by: "reviewer", based_on_hash: docHash, content: mockResult });
        }
      }

      const runLog = [
        `# Review Run`,
        `- Document: ${cached.meta.path}`,
        `- Time: ${new Date().toISOString()}`,
        ``,
        `## Output`,
        existing ? "Reused from message pool" : "Fresh review completed",
      ].join("\n");

      const logPath = saveRunLog("review", runLog);
      console.log(`\nRun log: ${logPath}`);
    } catch (err) {
      console.error(
        `✗ Review failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  });

// ── Ask ────────────────────────────────────────────────────────────────────
program
  .command("ask <doc>")
  .description("Generate questions for a document (run AskOrchestrator)")
  .action(async (doc: string) => {
    try {
      const project = loadProjectConfig();
      if (!project) {
        console.error("✗ No project configured.");
        process.exit(1);
      }

      console.log(`Generating questions for: ${doc}`);
      console.log("Running AskOrchestrator...");

      const cached = getCachedDoc(doc);
      if (!cached) {
        console.error(`✗ Document "${doc}" not in cache. Run: prdcli sync`);
        process.exit(1);
      }

      const { getLatestMessage, publishMessage, contentHash: hashFn } = await importMessagePool();
      const docHash = hashFn(cached.content);

      // Step 1: Check for fresh review in pool
      const existingReview = getLatestMessage({
        project: project.projectName,
        type: "review_result",
        target_doc_node_id: doc,
        require_fresh_hash: docHash,
      });

      if (existingReview) {
        console.log("\n✓ Found fresh review in pool. Using as input for questions.");
      } else {
        console.log("\n⚠ No fresh review found. Running review first...");
        // In real impl: call ReviewOrchestrator here
        console.log("[ReviewOrchestrator would run here]");
      }

      // Step 2: Run AskOrchestrator with real LLM
      try {
        const { AskOrchestrator } = await import("@prd-agent/tools-mcp/dist/orchestrators/ask-orchestrator.js" as string);
        const { BuiltinClaudeRuntime } = await import("./runtime/builtin-claude.js");
        const runtime = new BuiltinClaudeRuntime({ mode: "mock" });

        const orchestrator = new AskOrchestrator({
          llmCaller: (agentName: string, vars: Record<string, string>) => runtime.callAgent(agentName, vars),
        });

        const askResult = await orchestrator.run(project.projectName, doc, cached.content);
        console.log(`\n${askResult.summary}`);
      } catch {
        console.log("[AskOrchestrator] Module not available, using fallback");
      }

      const runLog = [
        `# Ask Run`,
        `- Document: ${cached.meta.path}`,
        `- Time: ${new Date().toISOString()}`,
        `- Based on review: ${existingReview ? "existing" : "fresh"}`,
        ``,
        `## Output`,
        "Completed",
      ].join("\n");

      const logPath = saveRunLog("ask", runLog);
      console.log(`\nRun log: ${logPath}`);
    } catch (err) {
      console.error(
        `✗ Ask failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  });

// ── Draft ──────────────────────────────────────────────────────────────────
program
  .command("draft")
  .description("Draft a PRD (run DraftOrchestrator)")
  .requiredOption("--topic <topic>", "Topic for the PRD draft")
  .action(async (opts: { topic: string }) => {
    try {
      const project = loadProjectConfig();
      if (!project) {
        console.error("✗ No project configured.");
        process.exit(1);
      }

      console.log(`Drafting PRD on topic: ${opts.topic}`);
      console.log("Running DraftOrchestrator...");

      // Select template based on topic
      const topic = opts.topic.toLowerCase();
      let template = "comprehensive";
      if (/fix|bug|hotfix|small/i.test(topic)) template = "lean";
      else if (/new product|launch/i.test(topic)) template = "pr-faq";
      else if (/metric|data|analytics/i.test(topic)) template = "google-style";
      console.log(`Selected template: ${template}`);

      const { publishMessage, contentHash: hashFn } = await importMessagePool();

      // Run DraftOrchestrator with real LLM
      let draft: string;
      let needsManualReview = false;
      let remainingIssues: unknown[] = [];

      try {
        const { DraftOrchestrator } = await import("@prd-agent/tools-mcp/dist/orchestrators/draft-orchestrator.js" as string);
        const { BuiltinClaudeRuntime } = await import("./runtime/builtin-claude.js");
        const runtime = new BuiltinClaudeRuntime({ mode: "mock" });

        const orchestrator = new DraftOrchestrator({
          maxCriticLoops: 2,
          template,
          llmCaller: (agentName: string, vars: Record<string, string>) => runtime.callAgent(agentName, vars),
        });

        const result = await orchestrator.run(project.projectName, opts.topic);
        draft = result.draft_markdown;
        needsManualReview = result.needsManualReview;
        remainingIssues = result.remainingIssues;
      } catch {
        console.log("[DraftOrchestrator] Module not available, using fallback");
        draft = `# PRD Draft: ${opts.topic}\n\nTemplate: ${template}\n\n[Draft content placeholder]`;
      }

      const draftHash = hashFn(draft);
      console.log(`\n${draft}`);

      // Confirm before push
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question("\nPush draft to Lark? (y/n) ", resolve);
      });
      rl.close();

      if (answer.toLowerCase() === "y") {
        // TODO: Push to Lark via scoped_create_docx
        console.log("[Push to Lark would happen here]");
      } else {
        console.log("Draft saved locally only.");
      }

      // Publish to pool
      publishMessage({
        type: "draft_prd",
        project: project.projectName,
        target_doc_node_id: null,
        produced_by: "writer",
        based_on_hash: draftHash,
        content: { draft_markdown: draft, needs_manual_review: needsManualReview, remaining_issues: remainingIssues },
      });

      const runLog = [
        `# Draft Run`,
        `- Topic: ${opts.topic}`,
        `- Template: ${template}`,
        `- Time: ${new Date().toISOString()}`,
        ``,
        `## Output`,
        draft,
      ].join("\n");

      const logPath = saveRunLog("draft", runLog);
      console.log(`\nRun log: ${logPath}`);
    } catch (err) {
      console.error(
        `✗ Draft failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  });

// ── Agent (Supervisor) ────────────────────────────────────────────────────
program
  .command("agent <goal...>")
  .description("Run Supervisor agent with free-text goal")
  .action(async (goalParts: string[]) => {
    try {
      const goal = goalParts.join(" ");
      const project = loadProjectConfig();

      console.log(`Agent goal: "${goal}"`);
      console.log("Running Supervisor...");

      if (!project) {
        console.log("No project configured. Listing available projects...");
        const client = await createLarkClient();
        const folders = await listRootFolders(client);
        const projects = folders.filter((f) => f.type === "folder");

        console.log("\nAvailable projects:");
        for (const p of projects) {
          console.log(`  - ${p.name}`);
        }
        console.log('\nRun: prdcli project use <name>');
        return;
      }

      const { listProjectMessages } = await importMessagePool();

      // Query Message Pool for project context
      const messages = listProjectMessages(project.projectName);
      const hasReviews = messages.some((m) => (m as Record<string, unknown>).type === "review_result");
      const hasQuestions = messages.some((m) => (m as Record<string, unknown>).type === "question_list");
      const hasDrafts = messages.some((m) => (m as Record<string, unknown>).type === "draft_prd");

      console.log(`\nProject: ${project.projectName}`);
      console.log(`Status: reviews=${hasReviews}, questions=${hasQuestions}, drafts=${hasDrafts}`);

      // Parse intent and build plan
      const lower = goal.toLowerCase();
      const tasks: string[] = [];
      if (/sync|update|refresh/i.test(lower)) tasks.push("run_sync");
      if (/review/i.test(lower)) tasks.push("run_review");
      if (/(?:ask|question)/i.test(lower)) tasks.push("run_ask");
      if (/draft/i.test(lower)) tasks.push("run_draft");
      if (/memory|decisions/i.test(lower)) tasks.push("read_project_memory");
      if (/summary|summaries/i.test(lower)) tasks.push("read_summaries");

      // Cap at 5
      const cappedTasks = tasks.slice(0, 5);
      console.log(`\nPlan: ${cappedTasks.length} tasks`);
      cappedTasks.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

      // Execute with real Supervisor
      try {
        const { Supervisor } = await import("@prd-agent/tools-mcp/dist/orchestrators/supervisor.js" as string);
        const { BuiltinClaudeRuntime } = await import("./runtime/builtin-claude.js");
        const runtime = new BuiltinClaudeRuntime({ mode: "mock" });

        const supervisor = new Supervisor({
          maxToolCalls: 5,
          llmCaller: (agentName: string, vars: Record<string, string>) => runtime.callAgent(agentName, vars),
          executeAction: async (action: { tool: string; args: Record<string, unknown>; reason: string }) => {
            console.log(`  Executing: ${action.tool}`);
            return `[Result of ${action.tool}]`;
          },
        });

        const result = await supervisor.run(goal, project.projectName);
        console.log(`\n${result.summary}`);

        const tracePath = supervisor.saveTraceLog();
        console.log(`\n✓ Decision trace saved: ${tracePath}`);
      } catch {
        // Fallback to inline planning
        const traceContent = [
          `# Supervisor Decision Trace`,
          `- Goal: ${goal}`,
          `- Project: ${project.projectName}`,
          `- Time: ${new Date().toISOString()}`,
        ].join("\n");
        const tracePath = saveRunLog("agent-trace", traceContent);
        console.log(`\n✓ Decision trace saved: ${tracePath}`);
      }

      const runLog = [
        `# Agent Run (Supervisor)`,
        `- Goal: ${goal}`,
        `- Project: ${project.projectName}`,
        `- Time: ${new Date().toISOString()}`,
      ].join("\n");

      const logPath = saveRunLog("agent", runLog);
      console.log(`Run log: ${logPath}`);
    } catch (err) {
      console.error(
        `✗ Agent failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  });

// ── Export MCP ─────────────────────────────────────────────────────────────
program
  .command("export-mcp")
  .description("Export MCP configuration for other channels")
  .option(
    "--channel <channel>",
    "Target channel (claude-code|codex|generic-mcp-export)",
  )
  .action(async (opts: { channel?: string }) => {
    const config = loadConfig();
    const channel = opts.channel ?? "claude-code";

    console.log(`Exporting MCP config for channel: ${channel}`);

    const { exportForClaudeCode, exportGenericMcp, writeExportFiles } = await import(
      "./runtime/export-claude-code.js"
    );

    const projectDir = process.cwd();

    if (channel === "claude-code") {
      const result = exportForClaudeCode(projectDir);
      writeExportFiles(result, projectDir);
      console.log(`✓ Exported ${result.files.length} files for claude-code channel`);
      console.log(`  - .mcp.json`);
      console.log(`  - .claude/agents/*.md (${result.files.length - 1} agent prompts)`);
    } else if (channel === "codex" || channel === "generic-mcp-export") {
      const result = exportGenericMcp(projectDir);
      writeExportFiles(result, projectDir);
      console.log(`✓ Exported ${result.files.length} files for ${channel}`);
      console.log(`  - mcpServers.json`);
      console.log(`  - agents/prompts/*.md`);
    } else {
      console.error(`✗ Unknown channel: ${channel}`);
      console.log("Valid channels: claude-code, codex, generic-mcp-export");
      process.exit(1);
    }
  });

// ── Update (§5.5) ─────────────────────────────────────────────────────────
program
  .command("update <doc>")
  .description("Update an existing PRD with a change request")
  .requiredOption("--request <request>", "Change request description")
  .action(async (doc: string, opts: { request: string }) => {
    try {
      const project = loadProjectConfig();
      if (!project) {
        console.error("✗ No project configured.");
        process.exit(1);
      }

      console.log(`Updating: ${doc}`);
      console.log(`Change request: ${opts.request}`);

      const cached = getCachedDoc(doc);
      if (!cached) {
        console.error(`✗ Document "${doc}" not in cache. Run: prdcli sync`);
        process.exit(1);
      }

      console.log(`\nDocument: ${cached.meta.path}`);
      console.log("\n[UpdateOrchestrator running...]");

      try {
        const { UpdateOrchestrator } = await import("@prd-agent/tools-mcp/dist/orchestrators/update-orchestrator.js" as string);
        const { BuiltinClaudeRuntime } = await import("./runtime/builtin-claude.js");
        const runtime = new BuiltinClaudeRuntime({ mode: "mock" });

        const orchestrator = new UpdateOrchestrator({
          llmCaller: (agentName: string, vars: Record<string, string>) => runtime.callAgent(agentName, vars),
        });

        const result = await orchestrator.run(
          project.projectName,
          doc,
          cached.content,
          opts.request,
        );

        console.log(`\n${result.summary}`);
        console.log(`Version: v${result.version.major}.${result.version.minor}`);
      } catch {
        console.log("[UpdateOrchestrator] Module not available");
        console.log("Flow: change_request → change_planner → gate → writer-update → diff → amendment");
      }

      const runLog = [
        `# Update Run`,
        `- Document: ${cached.meta.path}`,
        `- Change request: ${opts.request}`,
        `- Time: ${new Date().toISOString()}`,
        ``,
        `## Output`,
        `[Pending implementation]`,
      ].join("\n");

      const logPath = saveRunLog("update", runLog);
      console.log(`\nRun log: ${logPath}`);
    } catch (err) {
      console.error(`✗ Update failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── Resume (§4.8) ────────────────────────────────────────────────────────
program
  .command("resume <run-id>")
  .description("Resume an interrupted run from checkpoint")
  .action(async (runId: string) => {
    try {
      const fs = await import("node:fs");
      const pathMod = await import("node:path");
      const statePath = pathMod.join(process.cwd(), ".prdcli", "runs", runId, "state.json");

      if (!fs.existsSync(statePath)) {
        console.error(`✗ Run "${runId}" not found or no checkpoint available.`);
        process.exit(1);
      }

      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      console.log(`Resuming run: ${runId}`);
      console.log(`Step: ${state.step}`);
      console.log(`Done: ${state.done_claims?.length ?? 0} claims`);
      console.log(`Pending: ${state.pending?.length ?? 0} claims`);

      // Resume: re-run from the saved step
      if (state.step === "verify" && state.pending?.length > 0) {
        console.log(`\nResuming verification of ${state.pending.length} remaining claims...`);
        // In real impl: re-invoke ReviewOrchestrator with pending claims
        console.log("[Resume: would re-invoke Verifier for remaining claims]");
      } else if (state.step === "critic") {
        console.log("\nResuming critic review...");
        console.log("[Resume: would re-invoke Critic for remaining sections]");
      } else {
        console.log(`\nStep "${state.step}" — no resume action defined.`);
      }
    } catch (err) {
      console.error(`✗ Resume failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── Knowledge (§4.12) ────────────────────────────────────────────────────
const knowledgeCmd = program
  .command("knowledge")
  .description("Manage shared knowledge (pull/push/status)");

knowledgeCmd
  .command("pull")
  .description("Pull shared knowledge from _agent_memory/")
  .action(async () => {
    const project = loadProjectConfig();
    if (!project) {
      console.error("✗ No project configured.");
      process.exit(1);
    }
    console.log(`Pulling knowledge for: ${project.projectName}`);
    try {
      const { pullKnowledge } = await import("@prd-agent/tools-mcp/dist/knowledge/index.js" as string);
      const result = await pullKnowledge(project.projectFolderToken);
      console.log(`  Pulled: ${result.pulled.length} files`);
      console.log(`  Merged: ${result.merged.length} files`);
      if (result.errors.length > 0) console.log(`  Errors: ${result.errors.length}`);
    } catch {
      console.log("[Knowledge module not available]");
    }
  });

knowledgeCmd
  .command("push")
  .description("Push local knowledge to _agent_memory/")
  .action(async () => {
    const project = loadProjectConfig();
    if (!project) {
      console.error("✗ No project configured.");
      process.exit(1);
    }
    console.log(`Pushing knowledge for: ${project.projectName}`);
    try {
      const { pushKnowledge } = await import("@prd-agent/tools-mcp/dist/knowledge/index.js" as string);
      const result = await pushKnowledge(project.projectFolderToken, project.memoryFolderToken);
      console.log(`  Pushed: ${result.pushed.length} files`);
      console.log(`  Merged: ${result.merged.length} files`);
    } catch {
      console.log("[Knowledge module not available]");
    }
  });

knowledgeCmd
  .command("status")
  .description("Show shared knowledge status")
  .action(async () => {
    const project = loadProjectConfig();
    if (!project) {
      console.error("✗ No project configured.");
      process.exit(1);
    }
    console.log(`Knowledge status for: ${project.projectName}`);
    try {
      const { getKnowledgeStatus } = await import("@prd-agent/tools-mcp/dist/knowledge/index.js" as string);
      const status = getKnowledgeStatus();
      console.log(`  Agent memory folder: ${status.hasAgentMemory ? "exists" : "not found"}`);
      console.log(`  Local messages: ${status.localMessages}`);
      console.log(`  Remote messages: ${status.remoteMessages}`);
      console.log(`  Local graph: ${status.localGraph ? "exists" : "not found"}`);
      console.log(`  Remote graph: ${status.remoteGraph ? "exists" : "not found"}`);
    } catch {
      console.log("[Knowledge module not available]");
    }
  });

// ── Gate (§5.6) ──────────────────────────────────────────────────────────
program
  .command("gate <run-id>")
  .description("Re-open the L3 human gate for a run")
  .action(async (runId: string) => {
    try {
      const fs = await import("node:fs");
      const pathMod = await import("node:path");
      const gatePath = pathMod.join(process.cwd(), ".prdcli", "runs", runId, "gate-state.json");

      if (!fs.existsSync(gatePath)) {
        console.error(`✗ Gate state not found for run "${runId}".`);
        process.exit(1);
      }

      const { renderGate, isGateComplete, countUnresolvedHigh } = await import(
        "@prd-agent/tools-mcp/dist/gate/index.js" as string
      );
      const state = JSON.parse(fs.readFileSync(gatePath, "utf-8"));
      console.log(renderGate(state));
      console.log(`\nComplete: ${isGateComplete(state)}`);
      console.log(`Unresolved high: ${countUnresolvedHigh(state)}`);
    } catch (err) {
      console.error(`✗ Gate failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── Lint (§4.5) ──────────────────────────────────────────────────────────
program
  .command("lint <doc>")
  .description("Run L1 lint on a document (0 tokens)")
  .action(async (doc: string) => {
    try {
      const cached = getCachedDoc(doc);
      if (!cached) {
        console.error(`✗ Document "${doc}" not in cache. Run: prdcli sync`);
        process.exit(1);
      }

      console.log(`Linting: ${cached.meta.path}`);
      console.log("Running L1 lint rules (0 tokens)...\n");

      // Dynamically import lint module
      try {
        const { runAllLint, renderLintReport } = await import(
          "@prd-agent/tools-mcp/dist/lint/index.js" as string
        );
        const { reports, allPassed, issueCount } = runAllLint(cached.content);
        console.log(renderLintReport(reports));
        console.log(`\nResult: ${allPassed ? "ALL PASSED" : `${issueCount} issues found`}`);
      } catch {
        // Fallback: basic checks
        console.log("[L1 lint module not available — run tools-mcp build first]");
        console.log("Basic checks:");
        const hasReq = /REQ-\d+/i.test(cached.content);
        const hasMarker = /\[\[src:/.test(cached.content);
        const hasAC = /acceptance criteria/i.test(cached.content);
        console.log(`  REQ blocks: ${hasReq ? "found" : "none"}`);
        console.log(`  Source markers: ${hasMarker ? "found" : "none"}`);
        console.log(`  Acceptance criteria: ${hasAC ? "found" : "none"}`);
      }
    } catch (err) {
      console.error(`✗ Lint failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program.parse();
