/**
 * Message Pool store — v4 (§4.1, §4.7, §4.12)
 *
 * Non-overwrite: new messages use supersedes, never overwrite existing.
 * Freshness: based_on[] all hashes must match current (§4.7).
 * Filenames: <type>__<target>__<msg_id>.json (no overwrite).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  PoolMessage,
  PoolQuery,
  MessageType,
  BasedOnEntry,
  ProducedBy,
} from "./types.js";

const MESSAGES_DIR = ".prdcli/messages";

function getMessagesDir(project: string, cwd: string = process.cwd()): string {
  return path.join(cwd, MESSAGES_DIR, project);
}

function messageFilePath(msg: PoolMessage, cwd: string): string {
  const dir = getMessagesDir(msg.project, cwd);
  const docPart = msg.target_doc_node_id ?? "general";
  return path.join(dir, `${msg.type}__${docPart}__${msg.id}.json`);
}

function generateId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `msg_${ts}${rand}`;
}

/**
 * Create a message with code-assigned envelope fields.
 * LLM only provides content + instruct_content.
 */
export function createMessage(params: {
  type: MessageType;
  project: string;
  target_doc_node_id: string | null;
  produced_by: ProducedBy;
  based_on: BasedOnEntry[];
  run_id: string;
  content: string;
  instruct_content: unknown;
  supersedes?: string;
  runtime?: { channel: string; model: string };
}): PoolMessage {
  return {
    id: generateId(),
    type: params.type,
    project: params.project,
    target_doc_node_id: params.target_doc_node_id,
    produced_by: params.produced_by,
    runtime: params.runtime ?? { channel: "builtin", model: "unknown" },
    based_on: params.based_on,
    created_at: new Date().toISOString(),
    supersedes: params.supersedes ?? null,
    run_id: params.run_id,
    schema_version: 1,
    content: params.content,
    instruct_content: params.instruct_content,
  };
}

/**
 * Publish a message to the pool. Never overwrites — always creates new file.
 */
export function publishMessage(
  msg: PoolMessage,
  cwd: string = process.cwd(),
): PoolMessage {
  const dir = getMessagesDir(msg.project, cwd);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = messageFilePath(msg, cwd);
  fs.writeFileSync(filePath, JSON.stringify(msg, null, 2), "utf-8");
  return msg;
}

/**
 * Check if all based_on entries are fresh (hashes match current).
 */
function isFresh(
  msg: PoolMessage,
  currentHashes: Record<string, string>,
): boolean {
  if (msg.based_on.length === 0) return true;
  return msg.based_on.every(
    (dep) => currentHashes[dep.node_id] === dep.hash,
  );
}

/**
 * Query messages from the pool.
 */
export function queryMessages(
  query: PoolQuery,
  cwd: string = process.cwd(),
): PoolMessage[] {
  const dir = getMessagesDir(query.project, cwd);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const results: PoolMessage[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const msg = JSON.parse(raw) as PoolMessage;

      if (query.type && msg.type !== query.type) continue;
      if (
        query.target_doc_node_id !== undefined &&
        msg.target_doc_node_id !== query.target_doc_node_id
      )
        continue;
      if (
        query.schema_version !== undefined &&
        msg.schema_version !== query.schema_version
      )
        continue;

      // Freshness check (§4.7)
      if (query.freshOnly && query.currentHashes) {
        if (!isFresh(msg, query.currentHashes)) continue;
      }

      results.push(msg);
    } catch {
      // Skip malformed files
    }
  }

  return results.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/**
 * Get the latest fresh message matching a query.
 */
export function getLatestMessage(
  query: PoolQuery,
  cwd: string = process.cwd(),
): PoolMessage | null {
  const results = queryMessages(query, cwd);
  return results[0] ?? null;
}

/**
 * Check if a fresh message exists for a given type + doc.
 */
export function checkFreshMessage(
  project: string,
  type: MessageType,
  targetDocNodeId: string,
  currentHashes: Record<string, string>,
  cwd: string = process.cwd(),
): PoolMessage | null {
  return getLatestMessage(
    {
      project,
      type,
      target_doc_node_id: targetDocNodeId,
      freshOnly: true,
      currentHashes,
    },
    cwd,
  );
}

/**
 * List all messages for a project.
 */
export function listProjectMessages(
  project: string,
  cwd: string = process.cwd(),
): PoolMessage[] {
  return queryMessages({ project }, cwd);
}

/**
 * Count stale messages (where based_on hashes don't match current).
 */
export function countStaleMessages(
  project: string,
  currentHashes: Record<string, string>,
  cwd: string = process.cwd(),
): number {
  const all = listProjectMessages(project, cwd);
  return all.filter((msg) => !isFresh(msg, currentHashes)).length;
}
