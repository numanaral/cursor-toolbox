export interface ParsedArgs {
  command: string | null;
  flags: Record<string, string | true>;
}

export const parseArgs = (argv: string[]): ParsedArgs => {
  const args = argv.slice(2);
  const command = args[0] && !args[0].startsWith("-") ? args[0] : null;
  const flagArgs = command ? args.slice(1) : args;

  const flags: Record<string, string | true> = {};
  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (!arg.startsWith("-")) continue;

    const key = arg.replace(/^-+/, "");
    const next = flagArgs[i + 1];
    if (next && !next.startsWith("-")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }

  return { command, flags };
};

export const getFlag = (flags: Record<string, string | true>, key: string): string | null => {
  const val = flags[key];
  if (val === undefined || val === true) return null;
  return val;
};

export const hasFlag = (flags: Record<string, string | true>, ...keys: string[]): boolean => {
  return keys.some((k) => flags[k] !== undefined);
};
