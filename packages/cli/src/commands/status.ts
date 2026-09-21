import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { loadToken, isTokenExpired } from "../auth/token-store.js";
import { getCurrentUser, createLarkClient } from "../lark/mcp-client.js";
import { loadProjectConfig } from "../config/project.js";
import { listCachedDocs } from "../cache/store.js";
import { readAllSummaries } from "../cache/memory.js";

export function createStatusCommand(): Command {
  return new Command("status")
    .description(
      "Show current user, project, channel, and sync status",
    )
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
          console.log(
            `User: ${token.email ?? "token present but info unavailable"}`,
          );
        }
      }

      // Project
      if (project) {
        console.log(`Project: ${project.projectName}`);
        console.log(`  Folder token: ${project.projectFolderToken}`);
        console.log(`  Last sync: ${project.lastSyncAt ?? "never"}`);
      } else {
        console.log(
          "Project: None (run `prdcli project use <name>`)",
        );
      }

      // Channel
      console.log(`Channel: ${config.channel}`);
      console.log(`Model: ${config.model}`);

      // Cache stats
      const cached = listCachedDocs();
      console.log(`Cached docs: ${cached.length}`);

      // Memory stats
      const summaries = readAllSummaries();
      console.log(`Summaries: ${summaries.length}`);
    });
}
