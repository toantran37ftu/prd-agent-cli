import { Command } from "commander";
import { createLarkClient } from "../lark/mcp-client.js";
import { loadProjectConfig, saveProjectConfig } from "../config/project.js";
import { ensureDirs, saveCachedDoc, getCachedDoc } from "../cache/store.js";
import { computeSyncDiff, RemoteNodeInfo } from "../cache/diff.js";
import { getDocContent } from "../lark/docs.js";
import { listProjectContents } from "../lark/drive.js";
import { getSummary, saveSummary } from "../cache/memory.js";

export function createSyncCommand(): Command {
  return new Command("sync")
    .description("Sync project documents to local cache")
    .option("--force", "Force re-sync all documents")
    .action(async (opts: { force?: boolean }) => {
      try {
        const project = loadProjectConfig();
        if (!project) {
          console.error(
            "✗ No project configured. Run: prdcli project use <name>",
          );
          process.exit(1);
        }

        const client = await createLarkClient();
        ensureDirs();

        console.log(`Syncing project: ${project.projectName}`);

        const allNodes = await listProjectContents(
          client,
          project.projectFolderToken,
        );

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

            saveCachedDoc(nodeId, doc.content, {
              nodeId,
              updatedTime: remote.updatedTime,
              type: remote.type,
              path: remote.path,
            });

            const existingSummary = getSummary(nodeId);
            if (!existingSummary || opts.force) {
              const mockSummary = `Summary of ${remote.path}\n\n${doc.content.slice(0, 200)}...`;
              saveSummary(nodeId, mockSummary);
            }
          } catch (err) {
            console.warn(
              `  ⚠ Skipped ${remote.path}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }

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
}
