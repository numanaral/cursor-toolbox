import { readFileSync } from "fs";
import { join } from "path";
import { resetDontAsk } from "@/commands/reset-dont-ask";
import { moveAgentChats } from "@/commands/move-agent-chats";
import { error } from "@/utils/prompt";
import { selectOne } from "@/utils/tui";
import { parseArgs, type ParsedArgs } from "@/utils/args";

const { version: VERSION } = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

interface Command {
  description: string;
  run: (args: ParsedArgs) => Promise<void>;
}

const COMMANDS: Record<string, Command> = {
  "reset-dont-ask": {
    description: 'Reset "Don\'t Ask Again" preferences',
    run: resetDontAsk,
  },
  "move-agent-chats": {
    description: "List, copy, or move agent chat history between workspaces",
    run: moveAgentChats,
  },
};

const showHelp = (): void => {
  console.log(`
cursor-toolbox v${VERSION}
Cross-platform CLI utilities for Cursor IDE maintenance

Usage: cursor-toolbox <command> [options]

Commands:
  reset-dont-ask         Reset "Don't Ask Again" preferences
  move-agent-chats       List, copy, or move agent chat history between workspaces

reset-dont-ask options:
  --id <id|all>          Preference to reset (mode-transitions, all)
  --no-quit              Skip the "quit Cursor?" prompt
  --no-relaunch          Skip the "relaunch Cursor?" prompt

move-agent-chats options:
  --action <action>      Action to perform (list, copy, move)
  --source <path>        Source workspace path
  --target <path>        Target workspace path (required for copy/move)
  --chats <ids|all>      Comma-separated composer IDs, or "all"
  --dry-run              Preview changes without applying them
  --no-quit              Skip the "quit Cursor?" prompt
  --no-relaunch          Skip the "relaunch Cursor?" prompt

Global options:
  --help, -h             Show this help message
  --version, -v          Show version

Examples:
  npx cursor-toolbox reset-dont-ask --id all --no-quit --no-relaunch
  npx cursor-toolbox move-agent-chats --action list --source ~/code/my-project
  npx cursor-toolbox move-agent-chats --action copy --source ~/src --target ~/dst --chats all
  npx cursor-toolbox move-agent-chats --action move --source ~/src --target ~/dst --chats id1,id2
`);
};

const promptCommand = async (args: ParsedArgs): Promise<void> => {
  console.log(`\ncursor-toolbox v${VERSION}\n`);

  const options: [string, string][] = Object.entries(COMMANDS).map(([name, cmd]) => [
    name,
    `${name}  ${cmd.description}`,
  ]);

  const selected = await selectOne(["  Select a command:\n"], options, false);
  await COMMANDS[selected].run(args);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv);

  if (args.flags["version"] || args.flags["v"]) {
    console.log(VERSION);
    return;
  }

  if (args.flags["help"] || args.flags["h"]) {
    showHelp();
    return;
  }

  if (!args.command) {
    if (!process.stdin.isTTY) {
      showHelp();
      error("Interactive mode requires a terminal. Use CLI flags for non-interactive usage.");
      process.exit(1);
    }
    await promptCommand(args);
    return;
  }

  const command = COMMANDS[args.command];
  if (!command) {
    error(`Unknown command: ${args.command}`);
    showHelp();
    process.exit(1);
  }

  await command.run(args);
};

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
