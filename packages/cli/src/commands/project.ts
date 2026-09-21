import { Command } from "commander";
import { createLarkClient } from "../lark/mcp-client.js";
import { listRootFolders, ensureMemoryFolder } from "../lark/drive.js";
import {
  loadProjectConfig,
  saveProjectConfig,
  ProjectConfig,
} from "../config/project.js";
import { initProjectMemory } from "../cache/memory.js";
import { ensureDirs } from "../cache/store.js";

export function createProjectCommand(): Command {
  const cmd = new Command("project").description("Manage projects");

  cmd
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

  cmd
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

  return cmd;
}
