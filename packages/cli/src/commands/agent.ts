import { Command } from "commander";
import { createLarkClient } from "../lark/mcp-client.js";
import { listRootFolders } from "../lark/drive.js";
import { loadProjectConfig } from "../config/project.js";
import { saveRunLog } from "../cache/store.js";

export function createAgentCommand(): Command {
  return new Command("agent")
    .description("Run Supervisor agent with free-text goal")
    .argument("<goal...>", "Natural language goal for the agent")
    .action(async (goalParts: string[]) => {
      try {
        const goal = goalParts.join(" ");
        const project = loadProjectConfig();

        console.log(`Agent goal: "${goal}"`);
        console.log("Running Supervisor...");

        if (!project) {
          console.log(
            "No project configured. Listing available projects...",
          );
          const client = await createLarkClient();
          const folders = await listRootFolders(client);
          const projects = folders.filter((f) => f.type === "folder");

          console.log("\nAvailable projects:");
          for (const p of projects) {
            console.log(`  - ${p.name}`);
          }
          console.log("\nRun: prdcli project use <name>");
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
}
