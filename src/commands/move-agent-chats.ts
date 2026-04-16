import { homedir } from "os";
import { join, basename, normalize } from "path";
import { pathToFileURL } from "url";
import { existsSync, readdirSync, mkdirSync, copyFileSync, rmSync, cpSync } from "fs";
import { listKnownWorkspaces, resolveWorkspace, getGlobalDbPath, normalizePath } from "@/utils/paths";
import { openDb, getItemTableValue, setItemTableValue, getDiskKVValue } from "@/utils/db";
import { ensureCursorQuit, offerRelaunch } from "@/utils/process";
import { error, green, dim, red, yellow, bold } from "@/utils/prompt";
import {
  GoBack,
  enterAltScreen,
  leaveAltScreen,
  buildHeader,
  closeHeader,
  selectOne,
  multiSelect,
  filterSelect,
  review,
  waitForKey,
  type StepLabels,
} from "@/utils/tui";
import { getFlag, hasFlag, type ParsedArgs } from "@/utils/args";

// ── Types ────────────────────────────────────────────────────────────────────

interface ComposerEntry {
  composerId: string;
  name?: string;
  unifiedMode?: string;
  [key: string]: unknown;
}

interface ComposerData {
  allComposers: ComposerEntry[];
  selectedComposerIds?: string[];
  lastFocusedComposerIds?: string[];
  hasMigratedComposerData?: boolean;
  hasMigratedMultipleComposers?: boolean;
}

interface ChatInfo extends ComposerEntry {
  hasTranscript: boolean;
}

// ── Step config ──────────────────────────────────────────────────────────────

const STEP_LABELS: StepLabels = {
  action: "Action",
  cursor_check: "Cursor",
  source: "Source",
  target: "Target",
  select: "Chats",
  confirm: "Confirm",
};

const STEP_ORDER_COPY_MOVE = ["action", "cursor_check", "source", "target", "select", "confirm"];
const STEP_ORDER_LIST = ["action", "source"];

// ── DB helpers ───────────────────────────────────────────────────────────────

const EMPTY_COMPOSER_DATA: ComposerData = {
  allComposers: [],
  selectedComposerIds: [],
  lastFocusedComposerIds: [],
  hasMigratedComposerData: true,
  hasMigratedMultipleComposers: true,
};

const getComposerData = (dbPath: string): ComposerData => {
  const db = openDb(dbPath);
  try {
    const data = getItemTableValue<Partial<ComposerData>>(db, "composer.composerData");
    if (!data) return { ...EMPTY_COMPOSER_DATA };
    return {
      ...EMPTY_COMPOSER_DATA,
      ...data,
      allComposers: data.allComposers ?? [],
    };
  } finally {
    db.close();
  }
};

const saveComposerData = (dbPath: string, data: ComposerData): void => {
  const db = openDb(dbPath);
  try {
    setItemTableValue(db, "composer.composerData", data);
  } finally {
    db.close();
  }
};

const getChatsFromGlobalDb = (transcriptsDir: string): ChatInfo[] => {
  if (!existsSync(transcriptsDir)) return [];

  const chatDirs = readdirSync(transcriptsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("task-"))
    .map((d) => d.name);

  if (!chatDirs.length) return [];

  const globalDb = openDb(getGlobalDbPath());
  try {
    const chats: ChatInfo[] = [];
    for (const cid of chatDirs) {
      const data = getDiskKVValue<ComposerEntry>(globalDb, `composerData:${cid}`);
      if (!data) continue;
      chats.push({
        ...data,
        composerId: cid,
        hasTranscript: existsSync(join(transcriptsDir, cid, `${cid}.jsonl`)),
      });
    }
    return chats;
  } finally {
    globalDb.close();
  }
};

const getChatList = (dbPath: string, transcriptsDir: string): ChatInfo[] => {
  // Try old format: allComposers in workspace DB
  const data = getComposerData(dbPath);
  if (data.allComposers.length > 0) {
    return data.allComposers
      .filter((c) => !c.composerId.startsWith("task-"))
      .map((c) => ({
        ...c,
        hasTranscript: existsSync(join(transcriptsDir, c.composerId, `${c.composerId}.jsonl`)),
      }));
  }

  // New format: scan transcript dirs, pull metadata from global cursorDiskKV
  return getChatsFromGlobalDb(transcriptsDir);
};

const formatChatLabel = (chat: ChatInfo, width = 65): string => {
  let name = chat.name || "(unnamed)";
  const mode = chat.unifiedMode || "?";
  const transcript = chat.hasTranscript ? "✓" : "✗";
  const nameW = width - 12;
  if (name.length > nameW) {
    name = name.slice(0, nameW - 3) + "...";
  }
  return `${name.padEnd(nameW)} ${mode.padEnd(7)} ${transcript}`;
};

// ── Global header helpers ────────────────────────────────────────────────────

interface ComposerHeader {
  type: string;
  composerId: string;
  workspaceIdentifier?: {
    id: string;
    uri: { $mid: number; fsPath: string; external: string; path: string; scheme: string };
  };
  [key: string]: unknown;
}

interface ComposerHeaders {
  allComposers: ComposerHeader[];
}

const buildWorkspaceIdentifier = (hash: string, folderPath: string) => ({
  id: hash,
  uri: {
    $mid: 1,
    fsPath: folderPath,
    external: pathToFileURL(folderPath).href,
    path: folderPath,
    scheme: "file",
  },
});

const updateGlobalHeaders = (
  targetHash: string,
  targetPath: string,
  selectedIds: Set<string>,
  mode: string,
): void => {
  const globalDb = openDb(getGlobalDbPath());
  try {
    const headers = getItemTableValue<ComposerHeaders>(globalDb, "composer.composerHeaders");
    if (!headers?.allComposers) return;

    const targetWsId = buildWorkspaceIdentifier(targetHash, targetPath);

    if (mode === "move") {
      for (const header of headers.allComposers) {
        if (!selectedIds.has(header.composerId)) continue;
        header.workspaceIdentifier = targetWsId;
      }
    } else {
      const dupes: ComposerHeader[] = [];
      for (const header of headers.allComposers) {
        if (!selectedIds.has(header.composerId)) continue;
        dupes.push({ ...header, workspaceIdentifier: targetWsId });
      }
      headers.allComposers.unshift(...dupes);
    }

    setItemTableValue(globalDb, "composer.composerHeaders", headers);
  } finally {
    globalDb.close();
  }
};

// ── Migration engine ─────────────────────────────────────────────────────────

const runMigration = (
  sourcePath: string,
  targetPath: string,
  mode: string,
  selected: ChatInfo[],
  dryRun: boolean,
): string[] => {
  const sourceWs = resolveWorkspace(sourcePath)!;
  const targetWs = resolveWorkspace(targetPath)!;

  const sourceData = getComposerData(sourceWs.dbPath);
  const targetData = getComposerData(targetWs.dbPath);
  const targetIds = new Set(targetData.allComposers.map((c) => c.composerId));

  const verb = mode === "copy" ? "Copy" : "Move";
  const output: string[] = [];

  if (!dryRun) {
    const globalBackup = getGlobalDbPath() + ".bak";
    cpSync(getGlobalDbPath(), globalBackup);
    output.push(`  ${dim(`Backed up global DB → ${basename(globalBackup)}`)}`);

    const targetBackup = targetWs.dbPath + ".bak";
    cpSync(targetWs.dbPath, targetBackup);
    output.push(`  ${dim(`Backed up target DB → ${basename(targetBackup)}`)}`);
  }

  let newCount = 0;
  let skipCount = 0;

  for (const chat of selected) {
    const cid = chat.composerId;
    const name = chat.name || "(unnamed)";
    const srcDir = join(sourceWs.transcriptsDir, cid);
    const dstDir = join(targetWs.transcriptsDir, cid);

    if (existsSync(srcDir)) {
      if (dryRun) {
        output.push(`  ${dim("[dry run]")} would ${verb.toLowerCase()}: ${name}`);
      } else {
        mkdirSync(dstDir, { recursive: true });
        for (const f of readdirSync(srcDir)) {
          copyFileSync(join(srcDir, f), join(dstDir, f));
        }
        if (mode === "move") {
          rmSync(srcDir, { recursive: true });
        }
        output.push(`  ${green("✓")} ${verb}: ${name}`);
      }
    } else {
      output.push(`  ${dim("─")} ${name} ${dim("(metadata only, no transcript files)")}`);
    }

    if (targetIds.has(cid)) {
      skipCount++;
    } else {
      const entry = sourceData.allComposers.find((c) => c.composerId === cid);
      if (entry) {
        if (!dryRun) {
          targetData.allComposers.unshift(entry);
          targetIds.add(cid);
        }
        newCount++;
      }
    }

    if (mode === "move" && !dryRun) {
      sourceData.allComposers = sourceData.allComposers.filter((c) => c.composerId !== cid);
    }
  }

  if (!dryRun && newCount > 0) {
    saveComposerData(targetWs.dbPath, targetData);
  }
  if (!dryRun && mode === "move") {
    saveComposerData(sourceWs.dbPath, sourceData);
  }

  // Update workspace association in global composer.composerHeaders (new format)
  if (!dryRun) {
    const selectedIds = new Set(selected.map((c) => c.composerId));
    updateGlobalHeaders(targetWs.hash, targetPath, selectedIds, mode);
  }

  const total = newCount + skipCount;
  output.push("");
  output.push(
    `  ${bold(dryRun ? "Would process" : "Processed")} ${total} chat(s) (${newCount} new, ${skipCount} already in target)`,
  );
  return output;
};

// ── Wizard ───────────────────────────────────────────────────────────────────

const short = (p: string): string => {
  return normalize(p).replace(normalize(homedir()), "~");
};

// ── Non-interactive CLI mode ─────────────────────────────────────────────────

const runNonInteractive = async (args: ParsedArgs): Promise<void> => {
  const action = getFlag(args.flags, "action");
  if (!action || !["list", "copy", "move"].includes(action)) {
    error("--action is required. Options: list, copy, move");
    process.exit(1);
  }

  const sourcePath = getFlag(args.flags, "source");
  if (!sourcePath) {
    error("--source <path> is required.");
    process.exit(1);
  }

  const sourceWs = resolveWorkspace(sourcePath);
  if (!sourceWs) {
    error(`Source workspace not found in Cursor: ${sourcePath}`);
    process.exit(1);
  }

  const chats = getChatList(sourceWs.dbPath, sourceWs.transcriptsDir);

  if (action === "list") {
    if (!chats.length) {
      console.log("No chats found in this workspace.");
      return;
    }
    console.log(`Chats in ${sourcePath}:\n`);
    chats.forEach((c, i) => {
      const name = c.name || "(unnamed)";
      const mode = c.unifiedMode || "?";
      const t = c.hasTranscript ? "✓" : "✗";
      console.log(`  ${String(i + 1).padStart(3)}  ${c.composerId}  ${name.padEnd(45)} ${mode.padEnd(7)} ${t}`);
    });
    console.log(`\n  ${chats.length} chat(s)`);
    return;
  }

  const targetPath = getFlag(args.flags, "target");
  if (!targetPath) {
    error("--target <path> is required for copy/move.");
    process.exit(1);
  }

  if (normalizePath(sourcePath) === normalizePath(targetPath)) {
    error("Source and target cannot be the same workspace.");
    process.exit(1);
  }

  const targetWs = resolveWorkspace(targetPath);
  if (!targetWs) {
    error(`Target workspace not found in Cursor: ${targetPath}`);
    process.exit(1);
  }

  const chatsFlag = getFlag(args.flags, "chats");
  if (!chatsFlag) {
    error("--chats <id,...|all> is required for copy/move.");
    process.exit(1);
  }

  let selected: ChatInfo[];
  if (chatsFlag === "all") {
    selected = chats;
  } else {
    const ids = new Set(chatsFlag.split(",").map((s) => s.trim()));
    selected = chats.filter((c) => ids.has(c.composerId));
    const found = new Set(selected.map((c) => c.composerId));
    const missing = [...ids].filter((id) => !found.has(id));
    if (missing.length) {
      error(`Chat IDs not found: ${missing.join(", ")}`);
      process.exit(1);
    }
  }

  if (!selected.length) {
    error("No chats matched the given IDs.");
    process.exit(1);
  }

  const dryRun = hasFlag(args.flags, "dry-run");
  const skipQuit = hasFlag(args.flags, "no-quit");
  const skipRelaunch = hasFlag(args.flags, "no-relaunch");

  if (!skipQuit && !dryRun) {
    await ensureCursorQuit();
  }

  const resultLines = runMigration(sourcePath, targetPath, action, selected, dryRun);
  for (const line of resultLines) {
    console.log(line);
  }

  if (dryRun) {
    console.log("\nNothing changed. Run again without --dry-run to apply.");
  } else if (!skipRelaunch) {
    await offerRelaunch();
  }
};

export const moveAgentChats = async (args: ParsedArgs): Promise<void> => {
  const hasCliFlags = hasFlag(args.flags, "action", "source", "target", "chats");
  if (hasCliFlags || !process.stdin.isTTY) {
    await runNonInteractive(args);
    return;
  }

  enterAltScreen();

  let exitCode = 0;
  try {
    await runWizard();
  } catch (e) {
    if (e instanceof Error && e.message !== "GoBack") {
      exitCode = 1;
    }
  } finally {
    leaveAltScreen();
  }
  process.exit(exitCode);
};

const runWizard = async (): Promise<void> => {
  const allWorkspaces = listKnownWorkspaces();
  if (!allWorkspaces.length) {
    console.log(`  ${red("No Cursor workspaces found.")}`);
    return;
  }

  const wsLabels = allWorkspaces.map(short);

  const completed = new Map<string, string>();
  let action: string | null = null;
  let dryRun = false;
  let sourcePath: string | null = null;
  let chats: ChatInfo[] | null = null;
  let selected: ChatInfo[] | null = null;
  let targetPath: string | null = null;
  let step = "action";
  let stepOrder = STEP_ORDER_COPY_MOVE;

  while (true) {
    try {
      if (step === "action") {
        completed.clear();
        stepOrder = STEP_ORDER_COPY_MOVE;
        const header = buildHeader(
          completed,
          step,
          stepOrder,
          STEP_LABELS,
          "Cursor Chat Migration",
        );

        const raw = await selectOne(
          header,
          [
            ["list", "List chats in a workspace"],
            ["copy", "Copy chats to another workspace"],
            ["move", "Move chats to another workspace"],
            ["dry-run", "Preview a copy/move (no changes)"],
          ],
          false,
        );

        dryRun = raw === "dry-run";
        if (dryRun) {
          const dryHeader = buildHeader(
            completed,
            step,
            stepOrder,
            STEP_LABELS,
            "Cursor Chat Migration",
          );
          const dryAction = await selectOne(dryHeader, [
            ["copy", "Preview copy"],
            ["move", "Preview move"],
          ]);
          action = dryAction;
        } else {
          action = raw;
        }

        const verbMap: Record<string, string> = {
          copy: "Copy",
          move: "Move",
          list: "List",
        };
        const label = `${verbMap[action] || action}${dryRun ? " (dry run)" : ""}`;
        completed.set("action", green(label));

        if (action === "list") {
          stepOrder = STEP_ORDER_LIST;
          step = "source";
        } else {
          stepOrder = STEP_ORDER_COPY_MOVE;
          step = "cursor_check";
        }
      } else if (step === "cursor_check") {
        await ensureCursorQuit({ dryRun });
        completed.set("cursor_check", green("✓ OK"));
        step = "source";
        continue;
      } else if (step === "source") {
        const header = buildHeader(
          completed,
          step,
          stepOrder,
          STEP_LABELS,
          "Cursor Chat Migration",
        );
        sourcePath = await filterSelect(header, wsLabels, allWorkspaces);
        const sourceWs = resolveWorkspace(sourcePath);

        if (!sourceWs) {
          completed.set("source", red("Not found in Cursor"));
          step = "source";
          continue;
        }

        chats = getChatList(sourceWs.dbPath, sourceWs.transcriptsDir);
        completed.set("source", green(short(sourcePath)));

        if (!chats.length) {
          completed.set("source", yellow(`${short(sourcePath)} (no chats)`));
          const noChatsHeader = buildHeader(
            completed,
            step,
            stepOrder,
            STEP_LABELS,
            "Cursor Chat Migration",
          );
          const noChatsLines = closeHeader(noChatsHeader);
          noChatsLines.push(`  ${yellow("⚠")} No chats found in this workspace.`, "");
          process.stdout.write("\x1b[H");
          for (const line of noChatsLines) {
            process.stdout.write(`\x1b[2K${line}\n`);
          }
          process.stdout.write("\x1b[J");
          await waitForKey("Press any key to pick another workspace");
          completed.delete("source");
          step = "source";
          continue;
        }

        if (action === "list") {
          const header = buildHeader(
            completed,
            "done",
            stepOrder,
            STEP_LABELS,
            "Cursor Chat Migration",
          );
          const lines = closeHeader(header);
          chats.forEach((c, i) => {
            const name = c.name || "(unnamed)";
            const mode = c.unifiedMode || "?";
            const t = c.hasTranscript ? green("✓") : dim("✗");
            lines.push(
              `  ${dim(String(i + 1).padStart(3))}  ${name.padEnd(50)} ${mode.padEnd(7)} ${t}`,
            );
          });
          lines.push(`\n  ${dim(`${chats.length} chat(s)`)}`);
          lines.push(`\n  ${green(bold("Done!"))}`);

          // Use low-level write since we're in alt screen
          process.stdout.write("\x1b[H");
          for (const line of lines) {
            process.stdout.write(`\x1b[2K${line}\n`);
          }
          process.stdout.write("\x1b[J");

          await waitForKey();
          return;
        }

        step = "target";
      } else if (step === "target") {
        const header = buildHeader(
          completed,
          step,
          stepOrder,
          STEP_LABELS,
          "Cursor Chat Migration",
        );
        targetPath = await filterSelect(header, wsLabels, allWorkspaces);

        if (normalizePath(targetPath) === normalizePath(sourcePath!)) {
          continue;
        }
        completed.set("target", green(short(targetPath)));
        step = "select";
      } else if (step === "select") {
        const header = buildHeader(
          completed,
          step,
          stepOrder,
          STEP_LABELS,
          "Cursor Chat Migration",
        );
        const labels = chats!.map((c) => formatChatLabel(c));
        const indices = await multiSelect(header, labels);

        if (!indices.length) continue;

        selected = indices.map((i) => chats![i]);
        completed.set("select", green(`${selected.length} selected`));
        step = "confirm";
      } else if (step === "confirm") {
        const header = buildHeader(
          completed,
          step,
          stepOrder,
          STEP_LABELS,
          "Cursor Chat Migration",
        );
        const reviewLabels = selected!.map((c) => c.name || "(unnamed)");
        await review(header, reviewLabels);

        const verb = action === "copy" ? "Copy" : "Move";
        completed.set("confirm", green(dryRun ? "Preview" : verb));

        const finalHeader = buildHeader(
          completed,
          "done",
          stepOrder,
          STEP_LABELS,
          "Cursor Chat Migration",
        );
        const resultLines = runMigration(sourcePath!, targetPath!, action!, selected!, dryRun);
        const final = [...closeHeader(finalHeader), ...resultLines];

        if (dryRun) {
          final.push(`\n  ${yellow("Nothing changed. Run again with copy/move to apply.")}`);
          final.push(`\n  ${green(bold("Done!"))}`);

          process.stdout.write("\x1b[H");
          for (const line of final) {
            process.stdout.write(`\x1b[2K${line}\n`);
          }
          process.stdout.write("\x1b[J");

          await waitForKey();
          return;
        }

        final.push("");
        process.stdout.write("\x1b[H");
        for (const line of final) {
          process.stdout.write(`\x1b[2K${line}\n`);
        }
        process.stdout.write("\x1b[J");

        // Leave alt screen for relaunch prompt
        leaveAltScreen();
        await offerRelaunch();
        return;
      }
    } catch (e) {
      if (e instanceof GoBack) {
        const autoSteps = new Set(["cursor_check"]);
        const idx = stepOrder.indexOf(step);
        let prevIdx = idx - 1;
        while (prevIdx >= 0 && autoSteps.has(stepOrder[prevIdx])) {
          prevIdx--;
        }
        if (prevIdx >= 0) {
          const prev = stepOrder[prevIdx];
          for (let i = prevIdx; i < stepOrder.length; i++) {
            completed.delete(stepOrder[i]);
          }
          step = prev;
        }
      } else {
        throw e;
      }
    }
  }
};
