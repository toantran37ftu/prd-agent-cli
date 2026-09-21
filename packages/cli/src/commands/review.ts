import { Command } from "commander";
import { loadProjectConfig } from "../config/project.js";
import { getCachedDoc, saveRunLog } from "../cache/store.js";

export function createReviewCommand(): Command {
  return new Command("review")
    .description("Review a document (run ReviewOrchestrator)")
    .argument("<doc>", "Document node ID or name to review")
    .option(
      "--push-comment",
      "Push review as comments to Lark (builtin channel only)",
    )
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
          console.error(
            `✗ Document "${doc}" not in cache. Run: prdcli sync`,
          );
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
}
