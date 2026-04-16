import { createInterface } from "readline";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

export const info = (msg: string): void => {
  console.log(`${CYAN}ℹ${RESET} ${msg}`);
};

export const warn = (msg: string): void => {
  console.log(`${YELLOW}⚠${RESET} ${msg}`);
};

export const error = (msg: string): void => {
  console.log(`${RED}✖${RESET} ${msg}`);
};

export const success = (msg: string): void => {
  console.log(`${GREEN}✔${RESET} ${msg}`);
};

export const bold = (msg: string): string => `${BOLD}${msg}${RESET}`;
export const dim = (msg: string): string => `${DIM}${msg}${RESET}`;
export const red = (msg: string): string => `${RED}${msg}${RESET}`;
export const green = (msg: string): string => `${GREEN}${msg}${RESET}`;
export const yellow = (msg: string): string => `${YELLOW}${msg}${RESET}`;
export const cyan = (msg: string): string => `${CYAN}${msg}${RESET}`;

export const confirm = async (message: string): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [Y/n] `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "" || normalized === "y" || normalized === "yes");
    });
  });
};
