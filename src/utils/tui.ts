const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const CLEAR_DOWN = "\x1b[J";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";

const MAX_VISIBLE = 10;
const RULE_W = 58;
const MAX_VAL_W = 38;

export class GoBack extends Error {
  constructor() {
    super("GoBack");
    this.name = "GoBack";
  }
}

// ── Raw key reading ──────────────────────────────────────────────────────────

export const readKey = (): Promise<string> => {
  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
      const s = data.toString("utf-8");

      if (s === "\x1b[A") {
        resolve("up");
        return;
      }
      if (s === "\x1b[B") {
        resolve("down");
        return;
      }
      if (s === "\x1b[C") {
        resolve("right");
        return;
      }
      if (s === "\x1b[D") {
        resolve("left");
        return;
      }
      if (s === "\x1b") {
        resolve("esc");
        return;
      }
      if (s === "\r" || s === "\n") {
        resolve("enter");
        return;
      }
      if (s === " ") {
        resolve("space");
        return;
      }
      if (s === "\x03") {
        resolve("ctrl-c");
        return;
      }
      if (s === "\x04") {
        resolve("ctrl-d");
        return;
      }
      if (s === "\x7f") {
        resolve("backspace");
        return;
      }
      if (s === "\t") {
        resolve("tab");
        return;
      }
      if (s.length === 1 && s >= " " && s <= "~") {
        resolve(s);
        return;
      }
      resolve("");
    });
  });
};

// ── Screen renderer ──────────────────────────────────────────────────────────

const redraw = (lines: string[]): void => {
  const buf = ["\x1b[H"];
  for (const line of lines) {
    buf.push(`\x1b[2K${line}`);
  }
  buf.push(CLEAR_DOWN);
  process.stdout.write(buf.join("\n"));
};

// ── Alt screen ───────────────────────────────────────────────────────────────

const WINDOW_ROWS = 33;
const WINDOW_COLS = 80;

export const enterAltScreen = (): void => {
  process.stdout.write(`\x1b[8;${WINDOW_ROWS};${WINDOW_COLS}t`);
  process.stdout.write(ALT_SCREEN_ON);
  process.stdout.write("\x1b[2J");
  process.stdout.write("\x1b[H");
  process.stdout.write(HIDE_CURSOR);
};

export const leaveAltScreen = (): void => {
  process.stdout.write(SHOW_CURSOR);
  process.stdout.write(ALT_SCREEN_OFF);
};

// ── ANSI helpers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

const stripAnsi = (s: string): string => {
  return s.replace(ANSI_RE, "");
};

const truncate = (text: string, width: number): string => {
  const visible = stripAnsi(text);
  if (visible.length <= width) return text;

  let count = 0;
  let cut = 0;
  let i = 0;
  while (i < text.length && count < width - 1) {
    if (text[i] === "\x1b") {
      const j = text.indexOf("m", i);
      if (j === -1) {
        i++;
        continue;
      }
      cut = j + 1;
      i = j + 1;
    } else {
      count++;
      cut = i + 1;
      i++;
    }
  }
  return text.slice(0, cut) + `…${RESET}`;
};

// ── Box rendering ────────────────────────────────────────────────────────────

const boxLine = (content: string, innerW: number): string => {
  const vis = stripAnsi(content).length;
  const pad = Math.max(0, innerW - vis);
  return `  ${DIM}│${RESET} ${content}${" ".repeat(pad)} ${DIM}│${RESET}`;
};

const divider = (): string => {
  return `  ${DIM}├${"─".repeat(RULE_W - 2)}┤${RESET}`;
};

const boxBottom = (): string => {
  return `  ${DIM}╰${"─".repeat(RULE_W - 2)}╯${RESET}`;
};

export const closeHeader = (header: string[]): string[] => {
  return [...header, boxBottom(), ""];
};

export interface StepLabels {
  [key: string]: string;
}

const dots = (stepOrder: string[], activeStep: string, completed: Map<string, string>): string => {
  const total = stepOrder.length;
  let filled = 0;
  for (const sid of stepOrder) {
    if (completed.has(sid)) {
      filled++;
    } else if (sid === activeStep) {
      filled++;
      break;
    } else {
      break;
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < total; i++) {
    parts.push(i < filled ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`);
  }
  return parts.join(" ");
};

export const buildHeader = (
  completed: Map<string, string>,
  activeStep: string,
  stepOrder: string[],
  stepLabels: StepLabels,
  title: string,
): string[] => {
  let activeNum = 0;
  for (let i = 0; i < stepOrder.length; i++) {
    if (stepOrder[i] === activeStep) {
      activeNum = i + 1;
      break;
    }
    if (completed.has(stepOrder[i])) {
      activeNum = i + 1;
    }
  }

  const iw = RULE_W - 4;
  const lines: string[] = [
    `  ${DIM}╭${"─".repeat(RULE_W - 2)}╮${RESET}`,
    boxLine(`${BOLD}${title}${RESET}`, iw),
    divider(),
    boxLine(
      `${dots(stepOrder, activeStep, completed)}  ${DIM}Step ${activeNum} of ${stepOrder.length}${RESET}`,
      iw,
    ),
    divider(),
  ];

  const labelW = Math.max(...stepOrder.map((s) => (stepLabels[s] || s).length));
  for (const stepId of stepOrder) {
    const label = (stepLabels[stepId] || stepId).padEnd(labelW);
    if (completed.has(stepId)) {
      const val = truncate(completed.get(stepId)!, MAX_VAL_W);
      lines.push(boxLine(`${GREEN}✓${RESET} ${DIM}${label}${RESET}  ${val}`, iw));
    } else if (stepId === activeStep) {
      lines.push(boxLine(`${CYAN}▸${RESET} ${BOLD}${label}${RESET}  ${DIM}…${RESET}`, iw));
    } else {
      lines.push(boxLine(`  ${DIM}${label}${RESET}`, iw));
    }
  }

  return lines;
};

const hintBlock = (keys: [string, string][]): string[] => {
  const parts = keys.map(([k, desc]) => `${BOLD}${k}${RESET} ${DIM}${desc}${RESET}`);
  const inner = parts.join("  ");
  const iw = RULE_W - 4;
  return [divider(), boxLine(inner, iw), boxBottom(), ""];
};

// ── Widgets ──────────────────────────────────────────────────────────────────

const handleExit = (header: string[]): never => {
  redraw([...header, "\n  Cancelled.\n"]);
  leaveAltScreen();
  process.exit(0);
};

export const selectOne = async (
  header: string[],
  options: [string, string][],
  allowBack = true,
): Promise<string> => {
  let cursor = 0;
  const num = options.length;

  const keys: [string, string][] = [
    ["↑↓", "move"],
    ["enter", "select"],
  ];
  if (allowBack) keys.push(["esc", "back"]);

  const render = (): void => {
    const lines = [...header, ...hintBlock(keys)];
    for (let i = 0; i < num; i++) {
      const [, label] = options[i];
      if (i === cursor) {
        lines.push(`  ${CYAN}❯${RESET} ${BOLD}${label}${RESET}`);
      } else {
        lines.push(`    ${DIM}${label}${RESET}`);
      }
    }
    redraw(lines);
  };

  process.stdout.write(HIDE_CURSOR);
  try {
    render();
    while (true) {
      const key = await readKey();
      if (key === "up") {
        cursor = (cursor - 1 + num) % num;
      } else if (key === "down") {
        cursor = (cursor + 1) % num;
      } else if (key === "enter") {
        break;
      } else if (key === "esc" && allowBack) {
        throw new GoBack();
      } else if (key === "ctrl-c" || key === "ctrl-d") {
        handleExit(header);
      } else {
        continue;
      }
      render();
    }
  } finally {
    process.stdout.write(SHOW_CURSOR);
  }

  return options[cursor][0];
};

export const tuiConfirm = async (header: string[], allowBack = true): Promise<boolean> => {
  const val = await selectOne(
    header,
    [
      ["yes", "Yes"],
      ["no", "No"],
    ],
    allowBack,
  );
  return val === "yes";
};

export const multiSelect = async (
  header: string[],
  items: string[],
  allowBack = true,
): Promise<number[]> => {
  let cursor = 0;
  const num = items.length;
  const checked = new Array(num).fill(false) as boolean[];
  const maxVis = Math.min(num, MAX_VISIBLE);
  let scroll = 0;

  const keys: [string, string][] = [
    ["↑↓", "move"],
    ["space", "toggle"],
    ["a", "all"],
    ["enter", "confirm"],
  ];
  if (allowBack) keys.push(["esc", "back"]);

  const ensureVisible = (): void => {
    if (cursor < scroll) scroll = cursor;
    else if (cursor >= scroll + maxVis) scroll = cursor - maxVis + 1;
  };

  const render = (): void => {
    const lines = [...header, ...hintBlock(keys)];
    const visEnd = Math.min(scroll + maxVis, num);
    for (let i = scroll; i < visEnd; i++) {
      const mark = checked[i] ? `${GREEN}✓${RESET}` : `${DIM}○${RESET}`;
      if (i === cursor) {
        lines.push(`  ${CYAN}❯${RESET} ${mark} ${BOLD}${items[i]}${RESET}`);
      } else {
        lines.push(`    ${mark} ${DIM}${items[i]}${RESET}`);
      }
    }
    const statusParts: string[] = [];
    if (scroll > 0) statusParts.push(`↑ ${scroll} more`);
    const remaining = num - visEnd;
    if (remaining > 0) statusParts.push(`↓ ${remaining} more`);
    statusParts.push(`${checked.filter(Boolean).length} selected`);
    lines.push(`  ${DIM}${statusParts.join("  │  ")}${RESET}`);
    redraw(lines);
  };

  process.stdout.write(HIDE_CURSOR);
  try {
    render();
    while (true) {
      const key = await readKey();
      if (key === "up") {
        cursor = (cursor - 1 + num) % num;
        ensureVisible();
      } else if (key === "down") {
        cursor = (cursor + 1) % num;
        ensureVisible();
      } else if (key === "space") {
        checked[cursor] = !checked[cursor];
      } else if (key === "a") {
        const toggle = !checked.every(Boolean);
        checked.fill(toggle);
      } else if (key === "enter") {
        break;
      } else if (key === "esc" && allowBack) {
        throw new GoBack();
      } else if (key === "ctrl-c" || key === "ctrl-d") {
        handleExit(header);
      } else {
        continue;
      }
      render();
    }
  } finally {
    process.stdout.write(SHOW_CURSOR);
  }

  return checked.reduce<number[]>((acc, c, i) => {
    if (c) acc.push(i);
    return acc;
  }, []);
};

export const filterSelect = async <T>(
  header: string[],
  labels: string[],
  values: T[],
  allowBack = true,
): Promise<T> => {
  let query = "";
  let cursor = 0;
  let scroll = 0;

  const keys: [string, string][] = [
    ["type", "filter"],
    ["↑↓", "move"],
    ["enter", "select"],
    ["tab", "fill"],
  ];
  if (allowBack) keys.push(["esc", "back"]);

  const filtered = (): number[] => {
    if (!query) return labels.map((_, i) => i);
    const q = query.toLowerCase();
    return labels.reduce<number[]>((acc, l, i) => {
      if (l.toLowerCase().includes(q)) acc.push(i);
      return acc;
    }, []);
  };

  const ensureVisible = (matches: number[]): void => {
    if (!matches.length) return;
    if (cursor < scroll) scroll = cursor;
    else if (cursor >= scroll + MAX_VISIBLE) scroll = cursor - MAX_VISIBLE + 1;
  };

  const render = (): void => {
    const matches = filtered();
    const lines = [...header, ...hintBlock(keys)];
    lines.push(`  ${CYAN}>${RESET} ${query}█`);

    const visEnd = Math.min(scroll + MAX_VISIBLE, matches.length);
    for (let vi = scroll; vi < visEnd; vi++) {
      const idx = matches[vi];
      if (vi === cursor) {
        lines.push(`  ${CYAN}❯${RESET} ${BOLD}${labels[idx]}${RESET}`);
      } else {
        lines.push(`    ${DIM}${labels[idx]}${RESET}`);
      }
    }
    const statusParts: string[] = [];
    if (scroll > 0) statusParts.push(`↑ ${scroll} more`);
    const remaining = matches.length - visEnd;
    if (remaining > 0) statusParts.push(`↓ ${remaining} more`);
    statusParts.push(`${matches.length} match${matches.length !== 1 ? "es" : ""}`);
    lines.push(`  ${DIM}${statusParts.join("  │  ")}${RESET}`);
    if (!matches.length) {
      lines.push(`    ${DIM}(no matches)${RESET}`);
    }
    redraw(lines);
  };

  process.stdout.write(HIDE_CURSOR);
  try {
    render();
    while (true) {
      const key = await readKey();
      const matches = filtered();

      if (key === "up") {
        if (matches.length) {
          cursor = (cursor - 1 + matches.length) % matches.length;
          ensureVisible(matches);
        }
      } else if (key === "down") {
        if (matches.length) {
          cursor = (cursor + 1) % matches.length;
          ensureVisible(matches);
        }
      } else if (key === "enter") {
        if (matches.length) break;
        continue;
      } else if (key === "backspace") {
        if (query) {
          query = query.slice(0, -1);
          cursor = 0;
          scroll = 0;
        }
      } else if (key === "tab") {
        if (matches.length) {
          query = labels[matches[cursor]];
        }
      } else if (key === "esc" && allowBack) {
        throw new GoBack();
      } else if (key === "ctrl-c" || key === "ctrl-d") {
        handleExit(header);
      } else if (key.length === 1 && key >= " " && key <= "~") {
        query += key;
        cursor = 0;
        scroll = 0;
      } else {
        continue;
      }
      render();
    }
  } finally {
    process.stdout.write(SHOW_CURSOR);
  }

  const matches = filtered();
  return values[matches[cursor]];
};

export const review = async (
  header: string[],
  items: string[],
  allowBack = true,
): Promise<void> => {
  const num = items.length;
  let cursor = 0;
  const maxVis = Math.min(num, MAX_VISIBLE);
  let scroll = 0;

  const keys: [string, string][] = [
    ["↑↓", "scroll"],
    ["enter", "confirm"],
  ];
  if (allowBack) keys.push(["esc", "back"]);

  const ensureVisible = (): void => {
    if (cursor < scroll) scroll = cursor;
    else if (cursor >= scroll + maxVis) scroll = cursor - maxVis + 1;
  };

  const render = (): void => {
    const lines = [...header, ...hintBlock(keys)];
    const visEnd = Math.min(scroll + maxVis, num);
    for (let i = scroll; i < visEnd; i++) {
      if (i === cursor) {
        lines.push(`  ${CYAN}▸${RESET} ${BOLD}${items[i]}${RESET}`);
      } else {
        lines.push(`    ${DIM}${items[i]}${RESET}`);
      }
    }
    const statusParts: string[] = [];
    if (scroll > 0) statusParts.push(`↑ ${scroll} more`);
    const remaining = num - visEnd;
    if (remaining > 0) statusParts.push(`↓ ${remaining} more`);
    statusParts.push(`${num} chat(s)`);
    lines.push(`  ${DIM}${statusParts.join("  │  ")}${RESET}`);
    redraw(lines);
  };

  process.stdout.write(HIDE_CURSOR);
  try {
    render();
    while (true) {
      const key = await readKey();
      if (key === "up") {
        cursor = (cursor - 1 + num) % num;
        ensureVisible();
      } else if (key === "down") {
        cursor = (cursor + 1) % num;
        ensureVisible();
      } else if (key === "enter") {
        break;
      } else if (key === "esc" && allowBack) {
        throw new GoBack();
      } else if (key === "ctrl-c" || key === "ctrl-d") {
        handleExit(header);
      } else {
        continue;
      }
      render();
    }
  } finally {
    process.stdout.write(SHOW_CURSOR);
  }
};

export const waitForKey = async (msg = "Press any key to exit"): Promise<void> => {
  process.stdout.write(`\n  ${DIM}${msg}${RESET}`);
  process.stdout.write(SHOW_CURSOR);
  await readKey();
};
