/**
 * Dependency graph — §4.7
 * Tracks which messages depend on which nodes.
 * A message is stale when ANY based_on node changes hash.
 */
import fs from "node:fs";
import path from "node:path";

export interface GraphNode {
  hash: string;
  type: string;
}

export interface GraphEdge {
  from: string;          // message id or node id
  depends_on: string[];  // node_ids
}

export interface DependencyGraph {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
}

const GRAPH_PATH = ".prdcli/graph.json";

export function loadGraph(cwd: string = process.cwd()): DependencyGraph {
  const filePath = path.join(cwd, GRAPH_PATH);
  if (!fs.existsSync(filePath)) {
    return { nodes: {}, edges: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return { nodes: {}, edges: [] };
  }
}

export function saveGraph(graph: DependencyGraph, cwd: string = process.cwd()): void {
  const filePath = path.join(cwd, GRAPH_PATH);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(graph, null, 2));
}

/**
 * Update a node's hash (called after sync).
 * Returns list of message IDs that become stale.
 */
export function updateNodeHash(
  graph: DependencyGraph,
  nodeId: string,
  newHash: string,
  nodeType: string,
): string[] {
  const oldHash = graph.nodes[nodeId]?.hash;
  graph.nodes[nodeId] = { hash: newHash, type: nodeType };

  if (oldHash && oldHash !== newHash) {
    // Find all messages that depend on this node
    const staleMessages = graph.edges
      .filter((e) => e.depends_on.includes(nodeId))
      .map((e) => e.from);
    return staleMessages;
  }

  return [];
}

/**
 * Add a dependency edge (called when publishing a message).
 */
export function addDependency(
  graph: DependencyGraph,
  messageId: string,
  dependsOn: string[],
): void {
  // Remove existing edge for this message
  graph.edges = graph.edges.filter((e) => e.from !== messageId);
  graph.edges.push({ from: messageId, depends_on: dependsOn });
}

/**
 * Get all nodes a message depends on.
 */
export function getDependencies(
  graph: DependencyGraph,
  messageId: string,
): string[] {
  const edge = graph.edges.find((e) => e.from === messageId);
  return edge?.depends_on ?? [];
}

/**
 * Check if a message is stale (any dependency hash changed).
 */
export function isMessageStale(
  graph: DependencyGraph,
  messageId: string,
  currentHashes: Record<string, string>,
): boolean {
  const deps = getDependencies(graph, messageId);
  if (deps.length === 0) return false;

  return deps.some((nodeId) => {
    const graphNode = graph.nodes[nodeId];
    if (!graphNode) return true; // node removed = stale
    return graphNode.hash !== currentHashes[nodeId];
  });
}
