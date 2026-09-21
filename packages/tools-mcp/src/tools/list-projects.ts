import { ScopeGuard, ROOT_FOLDER_TOKEN } from "../scope-guard.js";

export interface ListProjectsInput {
  // No input needed - uses root folder token
}

export interface ProjectInfo {
  name: string;
  token: string;
  type: string;
}

export interface ListProjectsOutput {
  projects: ProjectInfo[];
  count: number;
  error?: string;
}

/**
 * List all projects (sub-folders in root).
 * This tool is scope-guarded to only list within root folder.
 */
export async function listProjects(
  _input: ListProjectsInput,
  _scopeGuard: ScopeGuard,
): Promise<ListProjectsOutput> {
  // In production, this would call Lark API to list sub-folders
  // under ROOT_FOLDER_TOKEN
  console.log(`Listing projects under root folder: ${ROOT_FOLDER_TOKEN}`);

  // Placeholder - in real implementation, calls Lark Drive API
  return {
    projects: [],
    count: 0,
    error: "Not connected to Lark API",
  };
}
