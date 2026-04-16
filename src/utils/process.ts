import { execSync, spawn } from "child_process";
import { platform } from "os";
import { confirm as promptConfirm, error, info, success, warn } from "@/utils/prompt";

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const isCursorRunning = (): boolean => {
  try {
    switch (platform()) {
      case "darwin":
      case "linux": {
        const name = platform() === "darwin" ? "Cursor" : "cursor";
        execSync(`pgrep -x ${name}`, { stdio: "ignore" });
        return true;
      }
      case "win32": {
        const out = execSync('tasklist /FI "IMAGENAME eq Cursor.exe" /NH', {
          encoding: "utf-8",
        });
        return out.includes("Cursor.exe");
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
};

export const quitCursor = (): void => {
  switch (platform()) {
    case "darwin":
      execSync("osascript -e 'tell application \"Cursor\" to quit'", {
        stdio: "ignore",
      });
      break;
    case "linux":
      execSync("pkill -x cursor", { stdio: "ignore" });
      break;
    case "win32":
      execSync("taskkill /IM Cursor.exe", { stdio: "ignore" });
      break;
  }
};

export const launchCursor = (): void => {
  switch (platform()) {
    case "darwin":
      spawn("open", ["-a", "Cursor"], {
        detached: true,
        stdio: "ignore",
      }).unref();
      break;
    case "linux":
      spawn("cursor", [], { detached: true, stdio: "ignore" }).unref();
      break;
    case "win32":
      spawn("cmd", ["/c", "start", "Cursor"], {
        detached: true,
        stdio: "ignore",
      }).unref();
      break;
  }
};

export interface EnsureCursorQuitOptions {
  dryRun?: boolean;
}

export const ensureCursorQuit = async (opts: EnsureCursorQuitOptions = {}): Promise<void> => {
  if (!isCursorRunning()) return;

  if (opts.dryRun) {
    warn("Cursor is running (dry run — skipping quit).");
    return;
  }

  warn("Cursor must be quit for changes to persist (in-memory state overwrites the DB).");
  const shouldQuit = await promptConfirm("Quit Cursor now?");
  if (!shouldQuit) {
    error("Aborted. Quit Cursor manually, then re-run.");
    process.exit(1);
  }

  quitCursor();
  process.stdout.write("Waiting for Cursor to quit");

  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    if (!isCursorRunning()) {
      process.stdout.write("\n");
      success("Cursor quit.");
      return;
    }
    process.stdout.write(".");
  }

  process.stdout.write("\n");
  error("Cursor is still running. Please quit it manually and re-run.");
  process.exit(1);
};

export const offerRelaunch = async (): Promise<void> => {
  const shouldLaunch = await promptConfirm("Launch Cursor?");
  if (shouldLaunch) {
    launchCursor();
    success("Cursor launched.");
  } else {
    info("Done. Launch Cursor manually when ready.");
  }
};
