import { homedir, platform } from "os";
import { join, normalize, sep } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";

export const getCursorDataDir = (): string => {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Cursor");
    case "linux":
      return join(home, ".config", "Cursor");
    case "win32":
      return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Cursor");
    default:
      throw new Error(`Unsupported platform: ${platform()}`);
  }
};

export const getGlobalDbPath = (): string => {
  const dbPath = join(getCursorDataDir(), "User", "globalStorage", "state.vscdb");
  if (!existsSync(dbPath)) {
    throw new Error(`Cursor global DB not found at: ${dbPath}`);
  }
  return dbPath;
};

export const getWorkspaceStorageDir = (): string => {
  return join(getCursorDataDir(), "User", "workspaceStorage");
};

export const getProjectsDir = (): string => {
  return join(homedir(), ".cursor", "projects");
};

export const normalizePath = (p: string): string => {
  return normalize(p).replace(/[/\\]+$/, "");
};

export const workspacePathToSlug = (workspacePath: string): string => {
  return workspacePath.replace(/^[/\\]/, "").replace(/[/\\]/g, "-");
};

export interface ResolvedWorkspace {
  hash: string;
  dbPath: string;
  transcriptsDir: string;
}

const parseWorkspaceJson = (wjPath: string): string | null => {
  try {
    const data = JSON.parse(readFileSync(wjPath, "utf-8"));
    const folderUri: string = data.folder || "";
    let folderPath = decodeURIComponent(new URL(folderUri).pathname);
    if (platform() === "win32" && /^\/[A-Za-z]:/.test(folderPath)) {
      folderPath = folderPath.slice(1);
    }
    return folderPath ? normalizePath(folderPath) : null;
  } catch {
    return null;
  }
};

export const listKnownWorkspaces = (): string[] => {
  const storageDir = getWorkspaceStorageDir();
  if (!existsSync(storageDir)) return [];

  const workspaces = new Set<string>();
  for (const entry of readdirSync(storageDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const wjPath = join(storageDir, entry.name, "workspace.json");
    if (!existsSync(wjPath)) continue;
    const folderPath = parseWorkspaceJson(wjPath);
    if (folderPath) workspaces.add(folderPath);
  }
  return [...workspaces].sort();
};

export const resolveWorkspace = (workspacePath: string): ResolvedWorkspace | null => {
  const storageDir = getWorkspaceStorageDir();
  if (!existsSync(storageDir)) return null;

  const normalized = normalizePath(workspacePath);
  for (const entry of readdirSync(storageDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const wjPath = join(storageDir, entry.name, "workspace.json");
    if (!existsSync(wjPath)) continue;
    const folderPath = parseWorkspaceJson(wjPath);
    if (folderPath === normalized) {
      const slug = workspacePathToSlug(normalized);
      return {
        hash: entry.name,
        dbPath: join(storageDir, entry.name, "state.vscdb"),
        transcriptsDir: join(getProjectsDir(), slug, "agent-transcripts"),
      };
    }
  }
  return null;
};
