import { CachedDocMeta, getCachedDoc } from "./store.js";

export interface SyncDiffResult {
  toAdd: string[]; // node IDs not in cache
  toUpdate: string[]; // node IDs where remote updatedTime > cached syncedAt
  unchanged: string[]; // no changes needed
}

export interface RemoteNodeInfo {
  nodeId: string;
  updatedTime: string;
  type: "docx" | "sheet" | "bitable" | "wiki";
  path: string;
}

export function computeSyncDiff(
  remoteNodes: RemoteNodeInfo[],
  cwd: string = process.cwd(),
): SyncDiffResult {
  const toAdd: string[] = [];
  const toUpdate: string[] = [];
  const unchanged: string[] = [];

  for (const node of remoteNodes) {
    const cached = getCachedDoc(node.nodeId, cwd);

    if (!cached) {
      toAdd.push(node.nodeId);
      continue;
    }

    const remoteUpdated = new Date(node.updatedTime).getTime();
    const cachedSynced = new Date(cached.meta.syncedAt).getTime();

    if (remoteUpdated > cachedSynced) {
      toUpdate.push(node.nodeId);
    } else {
      unchanged.push(node.nodeId);
    }
  }

  return { toAdd, toUpdate, unchanged };
}
