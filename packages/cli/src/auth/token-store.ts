import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface TokenData {
  userAccessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  email?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "prdcli");
const TOKEN_FILE = path.join(CONFIG_DIR, "token.json");

export function loadToken(): TokenData | null {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}

export function saveToken(data: TokenData): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
}

export function clearToken(): void {
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE);
  }
}

export function isTokenExpired(data: TokenData): boolean {
  // Returns true if token expires within 5 minutes
  return Date.now() > data.expiresAt - 5 * 60 * 1000;
}
