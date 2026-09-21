import { Command } from "commander";
import { loadProjectConfig } from "../config/project.js";
import { saveRunLog } from "../cache/store.js";

export function createDraftCommand(): Command {
  return new Command("draft")
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
}
