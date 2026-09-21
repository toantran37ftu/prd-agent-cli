import { LarkApiClient } from "./mcp-client.js";
import { ROOT_FOLDER_TOKEN } from "../config/default.js";

export interface FolderNode {
  token: string;
  name: string;
  type: "folder" | "docx" | "sheet" | "bitable" | "wiki";
  parentToken: string;
  createdTime: string;
  modifiedTime: string;
  ownerEmail?: string;
}

export interface FolderListResult {
  items: FolderNode[];
  pageToken?: string;
  hasMore: boolean;
}

/**
 * Guard: verify a node is within the root folder tree.
 * This is the scope-guard from PRD section 1.
 */
export function assertWithinRoot(
  nodeToken: string,
  allowedTokens: Set<string>,
): void {
  if (!allowedTokens.has(nodeToken)) {
    throw new Error(
      `Scope guard: node ${nodeToken} is not within allowed project scope. Operation rejected.`,
    );
  }
}

export async function listFolder(
  client: LarkApiClient,
  folderToken: string,
  pageToken?: string,
): Promise<FolderListResult> {
  const params = new URLSearchParams({ folder_token: folderToken });
  if (pageToken) params.set("page_token", pageToken);
  params.set("page_size", "200");

  const res = await client.request<{
    data?: {
      files?: Array<{
        token: string;
        name: string;
        type: string;
        parent_token: string;
        created_time?: string;
        modified_time?: string;
        owner_email?: string;
      }>;
      next_page_token?: string;
      has_more?: boolean;
    };
  }>("GET", `/drive/v1/files?${params.toString()}`);

  const items = (res.data?.files ?? []).map((f) => ({
    token: f.token,
    name: f.name,
    type: f.type as FolderNode["type"],
    parentToken: f.parent_token,
    createdTime: f.created_time ?? "",
    modifiedTime: f.modified_time ?? "",
    ownerEmail: f.owner_email,
  }));

  return {
    items,
    pageToken: res.data?.next_page_token,
    hasMore: res.data?.has_more ?? false,
  };
}

export async function listRootFolders(
  client: LarkApiClient,
): Promise<FolderNode[]> {
  return listAll(client, ROOT_FOLDER_TOKEN);
}

async function listAll(
  client: LarkApiClient,
  folderToken: string,
): Promise<FolderNode[]> {
  const allItems: FolderNode[] = [];
  let pageToken: string | undefined;

  do {
    const result = await listFolder(client, folderToken, pageToken);
    allItems.push(...result.items);
    pageToken = result.pageToken;
  } while (pageToken);

  return allItems;
}

export async function listProjectContents(
  client: LarkApiClient,
  projectFolderToken: string,
): Promise<FolderNode[]> {
  return listAll(client, projectFolderToken);
}

export async function createMemoryFolder(
  client: LarkApiClient,
  projectFolderToken: string,
): Promise<string> {
  const res = await client.request<{
    data?: { token?: string };
  }>("POST", "/drive/v1/files/create_folder", {
    name: "_agent_memory",
    folder_token: projectFolderToken,
  });

  if (!res.data?.token) {
    throw new Error("Failed to create memory folder");
  }

  return res.data.token;
}

export async function ensureMemoryFolder(
  client: LarkApiClient,
  projectFolderToken: string,
): Promise<string> {
  const children = await listAll(client, projectFolderToken);
  const existing = children.find(
    (c) => c.type === "folder" && c.name === "_agent_memory",
  );

  if (existing) return existing.token;
  return createMemoryFolder(client, projectFolderToken);
}
