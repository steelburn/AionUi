/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Terminal escape code formatting — no external dependencies */

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const BLUE = `${ESC}[34m`;
const CYAN = `${ESC}[36m`;
const RED = `${ESC}[31m`;
const MAGENTA = `${ESC}[35m`;

export const fmt = {
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  blue: (s: string) => `${BLUE}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  magenta: (s: string) => `${MAGENTA}${s}${RESET}`,
};

export const STATUS_ICONS = {
  pending: '○',
  running: '◐',
  done: '●',
  failed: '✗',
  cancelled: '⊘',
} as const;

/** Erase N lines upward in the terminal */
export function clearLines(n: number): void {
  for (let i = 0; i < n; i++) {
    process.stdout.write(`${ESC}[1A${ESC}[2K`);
  }
}

/** Horizontal rule sized to terminal width */
export function hr(char = '─'): string {
  return char.repeat(Math.min(process.stdout.columns ?? 80, 80));
}

/** Render a bordered banner box. Lines are centered within the box. */
export function banner(lines: string[], width = 44): string {
  const top = '╭' + '─'.repeat(width - 2) + '╮';
  const bot = '╰' + '─'.repeat(width - 2) + '╯';
  const mid = lines
    .map((line) => {
      // Strip ANSI escape codes to measure visible length (control char is intentional)
      // eslint-disable-next-line no-control-regex
      const visible = line.replace(/\u001b\[[0-9;]*m/g, '');
      const pad = Math.max(0, width - 2 - visible.length);
      const left = Math.floor(pad / 2);
      const right = pad - left;
      return '│' + ' '.repeat(left) + line + ' '.repeat(right) + '│';
    })
    .join('\n');
  return `${top}\n${mid}\n${bot}`;
}
