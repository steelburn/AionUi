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
  done: '✓',
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
  return char.repeat(Math.min(process.stdout.columns ?? 80, 120));
}

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private label: string;
  private active = false;

  constructor(label = '思考中') {
    this.label = label;
  }

  start(): void {
    if (!process.stdout.isTTY || this.active) return;
    this.active = true;
    this.frame = 0;
    this.timer = setInterval(() => {
      const f = SPIN_FRAMES[this.frame % SPIN_FRAMES.length]!;
      process.stdout.write(`\r${fmt.cyan(f)} ${fmt.dim(this.label)}   `);
      this.frame++;
    }, 80);
    this.timer.unref(); // don't prevent process exit when all other work is done
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K'); // 清除整行
  }
}
