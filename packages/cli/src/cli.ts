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
          type: n.type,
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

      // TODO: Implement actual orchestrator invocation
      // For now, read cached doc and show basic info
      const cached = getCachedDoc(doc);
      if (!cached) {
        console.error(`✗ Document "${doc}" not in cache. Run: prdcli sync`);
        process.exit(1);
      }

      console.log(`\nDocument: ${cached.meta.path}`);
      console.log(`Type: ${cached.meta.type}`);
      console.log(`Content length: ${cached.content.length} chars`);
      console.log("\n[ReviewOrchestrator will be invoked here]");

      const runLog = [
        `# Review Run`,
        `- Document: ${cached.meta.path}`,
        `- Time: ${new Date().toISOString()}`,
        ``,
        `## Output`,
        `[Pending implementation]`,
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

      console.log(`\nDocument: ${cached.meta.path}`);
      console.log("\n[AskOrchestrator will be invoked here]");

      const runLog = [
        `# Ask Run`,
        `- Document: ${cached.meta.path}`,
        `- Time: ${new Date().toISOString()}`,
        ``,
        `## Output`,
        `[Pending implementation]`,
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
      console.log("\n[DraftOrchestrator will be invoked here]");

      const runLog = [
        `# Draft Run`,
        `- Topic: ${opts.topic}`,
        `- Time: ${new Date().toISOString()}`,
        ``,
        `## Output`,
        `[Pending implementation]`,
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

      console.log(`\nProject: ${project.projectName}`);
      console.log("\n[Supervisor agent will be invoked here]");

      const runLog = [
        `# Agent Run (Supervisor)`,
        `- Goal: ${goal}`,
        `- Project: ${project.projectName}`,
        `- Time: ${new Date().toISOString()}`,
        ``,
        `## Decision Trace`,
        `[Pending implementation]`,
      ].join("\n");

      const logPath = saveRunLog("agent", runLog);
      console.log(`\nRun log: ${logPath}`);
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

    // TODO: Implement actual export
    console.log("[Export will be implemented here]");
  });

program.parse();
