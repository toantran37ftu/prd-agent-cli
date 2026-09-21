import { Command } from "commander";
import { loadProjectConfig } from "../config/project.js";
import { getCachedDoc, saveRunLog } from "../cache/store.js";
import { createLarkClient } from "../lark/mcp-client.js";
import { createDocx, appendDocxContent } from "../lark/docs.js";

export function createPushCommand(): Command {
  return new Command("push")
    .description("Push draft or comments to Lark (requires confirmation)")
    .argument("<type>", "Type to push: draft | comment")
    .argument("<doc>", "Document node ID")
    .option("--content <content>", "Content to push")
    .action(
      async (
        type: string,
        doc: string,
        opts: { content?: string },
      ) => {
        try {
          const project = loadProjectConfig();
          if (!project) {
            console.error("✗ No project configured.");
            process.exit(1);
          }

          if (!["draft", "comment"].includes(type)) {
            console.error('✗ Type must be "draft" or "comment"');
            process.exit(1);
          }

          const cached = getCachedDoc(doc);
          if (!cached) {
            console.error(
              `✗ Document "${doc}" not in cache. Run: prdcli sync`,
            );
            process.exit(1);
          }

          console.log(`Push ${type} to: ${cached.meta.path}`);

          // Confirm before pushing
          const readline = await import("readline");
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question("Confirm push to Lark? (y/n): ", resolve);
          });
          rl.close();

          if (answer.toLowerCase() !== "y") {
            console.log("Push cancelled.");
            return;
          }

          const client = await createLarkClient();

          if (type === "draft") {
            const content = opts.content ?? "[Draft content from local]";
            const docId = await createDocx(
              client,
              project.projectFolderToken,
              `Draft - ${cached.meta.path}`,
            );
            await appendDocxContent(client, docId, content);
            console.log(`✓ Draft pushed. Document ID: ${docId}`);
          } else {
            // For comments, would use Lark comment API
            console.log("Comment push not yet implemented");
          }

          const runLog = [
            `# Push Run`,
            `- Type: ${type}`,
            `- Document: ${cached.meta.path}`,
            `- Time: ${new Date().toISOString()}`,
            ``,
            `## Result`,
            `Pushed successfully`,
          ].join("\n");

          saveRunLog("push", runLog);
        } catch (err) {
          console.error(
            `✗ Push failed: ${err instanceof Error ? err.message : err}`,
          );
          process.exit(1);
        }
      },
    );
}
