import { getGlobalDbPath } from "@/utils/paths";
import { openDb, getItemTableValue, setItemTableValue } from "@/utils/db";
import { ensureCursorQuit, offerRelaunch } from "@/utils/process";
import { info, warn, error, success } from "@/utils/prompt";
import { selectOne } from "@/utils/tui";
import { getFlag, hasFlag, type ParsedArgs } from "@/utils/args";

const STORAGE_KEY =
  "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";

interface ReactiveStorage {
  composerState?: {
    autoRejectedModeTransitions?: string[];
    autoApprovedModeTransitions?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const resetModeTransitions = async (skipQuit: boolean, skipRelaunch: boolean): Promise<void> => {
  const dbPath = getGlobalDbPath();

  if (!skipQuit) {
    await ensureCursorQuit();
  }

  const db = openDb(dbPath);
  let failed = false;
  try {
    const data = getItemTableValue<ReactiveStorage>(db, STORAGE_KEY);
    if (!data) {
      warn("Reactive storage key not found — nothing to reset.");
      return;
    }

    const state = data.composerState ?? {};
    const rejected = state.autoRejectedModeTransitions ?? [];
    const approved = state.autoApprovedModeTransitions ?? [];

    if (!rejected.length && !approved.length) {
      info("No mode-switch preferences found. Nothing to reset.");
      return;
    }

    if (rejected.length) {
      info(`Auto-rejected transitions: ${JSON.stringify(rejected)}`);
    }
    if (approved.length) {
      info(`Auto-approved transitions: ${JSON.stringify(approved)}`);
    }

    state.autoRejectedModeTransitions = [];
    state.autoApprovedModeTransitions = [];
    data.composerState = state;

    setItemTableValue(db, STORAGE_KEY, data);

    const verify = getItemTableValue<ReactiveStorage>(db, STORAGE_KEY);
    const vs = verify?.composerState ?? {};
    if (!vs.autoRejectedModeTransitions?.length && !vs.autoApprovedModeTransitions?.length) {
      success("Cleared successfully.");
    } else {
      error("Failed to clear. Try again with Cursor fully quit.");
      failed = true;
    }
  } finally {
    db.close();
  }

  if (failed) {
    process.exit(1);
  }

  if (!skipRelaunch) {
    await offerRelaunch();
  }
};

interface ResetOption {
  id: string;
  label: string;
  run: (skipQuit: boolean, skipRelaunch: boolean) => Promise<void>;
}

const RESET_OPTIONS: ResetOption[] = [
  {
    id: "mode-transitions",
    label: "Mode switch dialogs (agent↔plan auto-switch countdown)",
    run: resetModeTransitions,
  },
];

export const resetDontAsk = async (args: ParsedArgs): Promise<void> => {
  const skipQuit = hasFlag(args.flags, "no-quit");
  const skipRelaunch = hasFlag(args.flags, "no-relaunch");
  const idFlag = getFlag(args.flags, "id");

  let selectedId: string;

  if (idFlag) {
    const validIds = [...RESET_OPTIONS.map((o) => o.id), "all"];
    if (!validIds.includes(idFlag)) {
      error(`Unknown --id value: ${idFlag}. Valid options: ${validIds.join(", ")}`);
      process.exit(1);
    }
    selectedId = idFlag;
  } else {
    if (!process.stdin.isTTY) {
      error("--id flag is required in non-interactive mode. Options: mode-transitions, all");
      process.exit(1);
    }

    const options: [string, string][] = [
      ...RESET_OPTIONS.map((opt): [string, string] => [opt.id, opt.label]),
      ["all", "All of the above"],
    ];

    const header = ['  Which "Don\'t Ask Again" preference would you like to reset?\n'];
    selectedId = await selectOne(header, options, false);
  }

  const toRun =
    selectedId === "all" ? RESET_OPTIONS : RESET_OPTIONS.filter((o) => o.id === selectedId);
  for (const opt of toRun) {
    info(`Resetting: ${opt.label}`);
    await opt.run(skipQuit, skipRelaunch);
  }
};
