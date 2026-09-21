import fs from "node:fs";
import path from "node:path";

export interface ProjectConfig {
  projectName: string;
  projectFolderToken: string;
  memoryFolderToken: string;
  lastSyncAt: string | null;
}

const PROJECT_CONFIG_FILE = ".prdcli/project.json";

export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, PROJECT_CONFIG_FILE);
}

export function loadProjectConfig(
  cwd: string = process.cwd(),
): ProjectConfig | null {
  const configPath = getProjectConfigPath(cwd);
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return null;
  }
}

export function saveProjectConfig(
  config: ProjectConfig,
  cwd: string = process.cwd(),
): void {
  const dir = path.dirname(getProjectConfigPath(cwd));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getProjectConfigPath(cwd), JSON.stringify(config, null, 2));
}

export function requireProjectConfig(
  cwd: string = process.cwd(),
): ProjectConfig {
  const config = loadProjectConfig(cwd);
  if (!config) {
    throw new Error(
      "No project configured. Run: prdcli project use <project-name>",
    );
  }
  return config;
}
