import { LarkApiClient } from "./mcp-client.js";

export interface DocContent {
  nodeId: string;
  title: string;
  content: string; // markdown
  type: "docx" | "sheet" | "bitable" | "wiki";
  updatedTime: string;
}

export async function getDocContent(
  client: LarkApiClient,
  nodeId: string,
  type: "docx" | "sheet" | "bitable" | "wiki",
): Promise<DocContent> {
  switch (type) {
    case "docx":
      return getDocxContent(client, nodeId);
    case "sheet":
      return getSheetContent(client, nodeId);
    case "wiki":
      return getWikiContent(client, nodeId);
    case "bitable":
      return getBitableContent(client, nodeId);
    default:
      throw new Error(`Unsupported document type: ${type}`);
  }
}

async function getDocxContent(
  client: LarkApiClient,
  documentId: string,
): Promise<DocContent> {
  const res = await client.request<{
    data?: {
      document?: { document_id?: string; title?: string; revision_id?: number };
      content?: Array<{
        block_type: number;
        text?: { elements?: Array<{ text_run?: { content?: string } }> };
      }>;
    };
  }>("GET", `/docx/v1/documents/${documentId}/blocks`);

  const blocks = res.data?.content ?? [];
  const markdown = blocksToMarkdown(blocks);

  return {
    nodeId: documentId,
    title: res.data?.document?.title ?? "Untitled",
    content: markdown,
    type: "docx",
    updatedTime: new Date().toISOString(),
  };
}

function blocksToMarkdown(
  blocks: Array<{
    block_type: number;
    text?: { elements?: Array<{ text_run?: { content?: string } }> };
  }>,
): string {
  return blocks
    .map((block) => {
      const elements = block.text?.elements ?? [];
      const text = elements
        .map((el) => el.text_run?.content ?? "")
        .join("");

      // Block types: 2=text, 3=heading1, 4=heading2, 5=heading3, etc.
      switch (block.block_type) {
        case 3:
          return `# ${text}`;
        case 4:
          return `## ${text}`;
        case 5:
          return `### ${text}`;
        default:
          return text;
      }
    })
    .filter((t) => t.length > 0)
    .join("\n\n");
}

async function getSheetContent(
  client: LarkApiClient,
  sheetToken: string,
): Promise<DocContent> {
  const metaRes = await client.request<{
    data?: {
      sheets?: Array<{
        sheet_id: string;
        title: string;
        row_count: number;
        column_count: number;
      }>;
    };
  }>("GET", `/sheets/v3/spreadsheets/${sheetToken}/sheets/query`);

  const sheets = metaRes.data?.sheets ?? [];
  let content = "";

  for (const sheet of sheets.slice(0, 3)) {
    const range = `${sheet.sheet_id}!A1:Z100`;
    const dataRes = await client.request<{
      data?: {
        valueRange?: { values?: Array<Array<unknown>> };
      };
    }>(
      "GET",
      `/sheets/v2/spreadsheets/${sheetToken}/values/${encodeURIComponent(range)}`,
    );

    const rows = dataRes.data?.valueRange?.values ?? [];
    if (rows.length > 0) {
      content += `## Sheet: ${sheet.title}\n\n`;
      content += rowsToMarkdown(rows);
      content += "\n\n";
    }
  }

  return {
    nodeId: sheetToken,
    title: `Sheet ${sheetToken}`,
    content,
    type: "sheet",
    updatedTime: new Date().toISOString(),
  };
}

function rowsToMarkdown(rows: Array<Array<unknown>>): string {
  if (rows.length === 0) return "";

  const header = rows[0].map((v) => String(v ?? ""));
  const separator = header.map(() => "---");
  const body = rows.slice(1).map((row) =>
    header.map((_, i) => String(row[i] ?? "")),
  );

  const table = [header, separator, ...body]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

  return table;
}

async function getWikiContent(
  client: LarkApiClient,
  wikiToken: string,
): Promise<DocContent> {
  const res = await client.request<{
    data?: {
      node?: {
        obj_token: string;
        obj_type: string;
        title: string;
      };
    };
  }>("GET", `/wiki/v2/spaces/get_node?token=${wikiToken}`);

  const node = res.data?.node;
  if (!node) throw new Error(`Wiki node ${wikiToken} not found`);

  // Wiki wraps underlying document, fetch the actual content
  return getDocContent(client, node.obj_token, node.obj_type as "docx");
}

async function getBitableContent(
  client: LarkApiClient,
  bitableToken: string,
): Promise<DocContent> {
  const metaRes = await client.request<{
    data?: {
      app?: { name?: string };
    };
  }>("GET", `/bitable/v1/apps/${bitableToken}`);

  const tablesRes = await client.request<{
    data?: {
      items?: Array<{ table_id: string; name: string }>;
    };
  }>("GET", `/bitable/v1/apps/${bitableToken}/tables`);

  let content = `# ${metaRes.data?.app?.name ?? "Bitable"}\n\n`;

  for (const table of (tablesRes.data?.items ?? []).slice(0, 3)) {
    const recordsRes = await client.request<{
      data?: {
        items?: Array<{ fields: Record<string, unknown> }>;
      };
    }>("GET", `/bitable/v1/apps/${bitableToken}/tables/${table.table_id}/records?page_size=50`);

    content += `## Table: ${table.name}\n\n`;
    const records = recordsRes.data?.items ?? [];
    if (records.length > 0) {
      const keys = Object.keys(records[0].fields);
      content += `| ${keys.join(" | ")} |\n`;
      content += `| ${keys.map(() => "---").join(" | ")} |\n`;
      for (const rec of records) {
        content += `| ${keys.map((k) => String(rec.fields[k] ?? "")).join(" | ")} |\n`;
      }
    }
    content += "\n";
  }

  return {
    nodeId: bitableToken,
    title: metaRes.data?.app?.name ?? "Bitable",
    content,
    type: "bitable",
    updatedTime: new Date().toISOString(),
  };
}

export async function createDocx(
  client: LarkApiClient,
  folderToken: string,
  title: string,
): Promise<string> {
  const res = await client.request<{
    data?: { document?: { document_id?: string } };
  }>("POST", "/docx/v1/documents", {
    folder_token: folderToken,
    title,
  });

  if (!res.data?.document?.document_id) {
    throw new Error("Failed to create document");
  }

  return res.data.document.document_id;
}

export async function appendDocxContent(
  client: LarkApiClient,
  documentId: string,
  markdown: string,
): Promise<void> {
  // Convert markdown to blocks and append
  const blocks = markdownToBlocks(markdown);

  for (const block of blocks) {
    await client.request(
      "POST",
      `/docx/v1/documents/${documentId}/blocks/batch_update`,
      {
        requests: [
          {
            block_id: documentId,
            replace_text: {
              text: block,
            },
          },
        ],
      },
    );
  }
}

function markdownToBlocks(markdown: string): string[] {
  return markdown
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
