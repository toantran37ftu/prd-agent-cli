import http from "node:http";
import { loadConfig } from "../config/index.js";
import { saveToken, TokenData } from "./token-store.js";

function buildAuthorizeUrl(config: ReturnType<typeof loadConfig>): string {
  const base =
    config.region === "larksuite"
      ? "https://open.larksuite.com/open-apis/authen/v1/authorize"
      : "https://open.feishu.cn/open-apis/authen/v1/authorize";
  const redirectUri = `http://localhost:${config.redirectPort}/callback`;
  const params = new URLSearchParams({
    app_id: config.appId,
    redirect_uri: redirectUri,
    response_type: "code",
    state: "prdcli",
  });
  return `${base}?${params.toString()}`;
}

async function exchangeCode(
  code: string,
  config: ReturnType<typeof loadConfig>,
): Promise<TokenData> {
  const base =
    config.region === "larksuite"
      ? "https://open.larksuite.com/open-apis"
      : "https://open.feishu.cn/open-apis";

  const res = await fetch(`${base}/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getAppAccessToken(config)}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
    }),
  });

  const data = (await res.json()) as {
    data?: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      name?: string;
      email?: string;
    };
    code?: number;
    msg?: string;
  };

  if (!res.ok || !data.data) {
    throw new Error(`Token exchange failed: ${data.msg ?? res.statusText}`);
  }

  return {
    userAccessToken: data.data.access_token,
    refreshToken: data.data.refresh_token,
    expiresAt: Date.now() + data.data.expires_in * 1000,
    email: data.data.email,
  };
}

async function getAppAccessToken(
  config: ReturnType<typeof loadConfig>,
): Promise<string> {
  const base =
    config.region === "larksuite"
      ? "https://open.larksuite.com/open-apis"
      : "https://open.feishu.cn/open-apis";

  const res = await fetch(`${base}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret,
    }),
  });

  const data = (await res.json()) as {
    app_access_token?: string;
    code?: number;
    msg?: string;
  };

  if (!res.ok || !data.app_access_token) {
    throw new Error(
      `App access token failed: ${data.msg ?? res.statusText}`,
    );
  }
  return data.app_access_token;
}

export async function login(): Promise<TokenData> {
  const config = loadConfig();

  if (!config.appId || !config.appSecret) {
    throw new Error(
      "App ID and App Secret not configured. Run: prdcli config set appId <value> && prdcli config set appSecret <value>",
    );
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${config.redirectPort}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400);
        res.end("Missing authorization code");
        return;
      }

      try {
        const tokenData = await exchangeCode(code, config);
        saveToken(tokenData);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html><body>
            <h1>Login successful!</h1>
            <p>You can close this tab and return to the terminal.</p>
            <script>setTimeout(() => window.close(), 2000);</script>
          </body></html>
        `);

        server.close();
        resolve(tokenData);
      } catch (err) {
        res.writeHead(500);
        res.end(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
        server.close();
        reject(err);
      }
    });

    server.listen(config.redirectPort, () => {
      const authUrl = buildAuthorizeUrl(config);
      console.log(`Opening browser for authentication...`);
      console.log(`If browser doesn't open, visit: ${authUrl}`);

      import("open").then((open) => {
        open.default(authUrl);
      });
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}

export async function refreshAccessToken(): Promise<TokenData | null> {
  const { loadToken } = await import("./token-store.js");
  const existing = loadToken();
  if (!existing) return null;

  const config = loadConfig();
  const base =
    config.region === "larksuite"
      ? "https://open.larksuite.com/open-apis"
      : "https://open.feishu.cn/open-apis";

  const res = await fetch(`${base}/authen/v1/oidc/refresh_access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getAppAccessToken(config)}`,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: existing.refreshToken,
    }),
  });

  const data = (await res.json()) as {
    data?: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  };

  if (!res.ok || !data.data) {
    return null;
  }

  const tokenData: TokenData = {
    userAccessToken: data.data.access_token,
    refreshToken: data.data.refresh_token,
    expiresAt: Date.now() + data.data.expires_in * 1000,
    email: existing.email,
  };

  saveToken(tokenData);
  return tokenData;
}
