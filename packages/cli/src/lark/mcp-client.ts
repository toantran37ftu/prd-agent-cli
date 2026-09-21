import { loadConfig } from "../config/index.js";
import { loadToken, isTokenExpired, refreshAccessToken } from "../auth/token-store.js";

export interface LarkApiClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export async function createLarkClient(): Promise<LarkApiClient> {
  let tokenData = loadToken();
  if (!tokenData) {
    throw new Error("Not logged in. Run: prdcli login");
  }

  if (isTokenExpired(tokenData)) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      throw new Error("Token expired and refresh failed. Run: prdcli login");
    }
    tokenData = refreshed;
  }

  const config = loadConfig();
  const baseUrl =
    config.region === "larksuite"
      ? "https://open.larksuite.com/open-apis"
      : "https://open.feishu.cn/open-apis";

  return {
    async request<T>(
      method: string,
      apiPath: string,
      body?: unknown,
    ): Promise<T> {
      const url = `${baseUrl}${apiPath}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${tokenData!.userAccessToken}`,
        "Content-Type": "application/json",
      };

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429) {
        // Rate limit: simple backoff retry once
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        const retryRes = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!retryRes.ok) {
          throw new Error(`Lark API error ${retryRes.status}: ${await retryRes.text()}`);
        }
        return (await retryRes.json()) as T;
      }

      if (!res.ok) {
        throw new Error(`Lark API error ${res.status}: ${await res.text()}`);
      }

      return (await res.json()) as T;
    },
  };
}

export async function getCurrentUser(
  client: LarkApiClient,
): Promise<{ name: string; email: string }> {
  const res = await client.request<{
    data?: { user?: { name?: string; email?: string } };
  }>("GET", "/authen/v1/user_info");

  if (!res.data?.user) {
    throw new Error("Failed to get user info");
  }

  return {
    name: res.data.user.name ?? "Unknown",
    email: res.data.user.email ?? "Unknown",
  };
}
