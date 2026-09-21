import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AppConfig {
  appId: string;
  appSecret: string;
  region: "larksuite" | "lark";
  model: string;
  redirectPort: number;
  channel: "builtin" | "claude-code" | "codex" | "generic-mcp-export";
  maxCriticLoops?: number;
  maxVerifierCallsPerReview?: number;
  maxSupervisorToolCalls?: number;
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "prdcli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  return CONFIG_DIR;
}

export function loadConfig(): AppConfig {
  getConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      appId: "",
      appSecret: "",
      region: "larksuite",
      model: "claude-sonnet-4-6",
      redirectPort: 3005,
      channel: "builtin",
    };
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as AppConfig;
}

export function saveConfig(cfg: AppConfig): void {
  getConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), {
    mode: 0o600,
  });
}

export function setConfigValue<K extends keyof AppConfig>(
  key: K,
  value: AppConfig[K],
): AppConfig {
  const cfg = loadConfig();
  cfg[key] = value;
  saveConfig(cfg);
  return cfg;
}
