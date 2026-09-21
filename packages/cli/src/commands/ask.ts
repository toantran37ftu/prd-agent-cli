import { Command } from "commander";
import { loadProjectConfig } from "../config/project.js";
import { getCachedDoc, saveRunLog } from "../cache/store.js";

export function createAskCommand(): Command {
  return new Command("ask")
    .description("Generate questions for a document (run AskOrchestrator)")
    .argument("<doc>", "Document node ID or name")
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
          console.error(
            `✗ Document "${doc}" not in cache. Run: prdcli sync`,
          );
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
}
