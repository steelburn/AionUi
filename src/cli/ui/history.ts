/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const AION_DIR = join(homedir(), '.aion');
const HISTORY_PATH = join(AION_DIR, 'history.tsv');
const ONBOARDED_PATH = join(AION_DIR, 'onboarded');
const MAX_HISTORY = 1000;
const COMPRESS_THRESHOLD = 500;
const COMPRESS_TRIGGER = 100;
let appendCount = 0;

export function getHistoryPath(): string {
  return HISTORY_PATH;
}

export function loadHistory(): string[] {
  try {
    const raw = readFileSync(HISTORY_PATH, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    // TSV format: timestamp\tcommand — extract the command column
    const commands = lines
      .map((l) => l.split('\t')[1] ?? '')
      .filter(Boolean);
    // readline history is newest-first; reverse and truncate to MAX_HISTORY
    return commands.slice(-MAX_HISTORY).reverse();
  } catch {
    return [];
  }
}

export function appendHistory(command: string): void {
  if (!command.trim()) return;
  try {
    mkdirSync(dirname(HISTORY_PATH), { recursive: true });
    const line = `${new Date().toISOString()}\t${command.replace(/\n/g, '\\n')}\n`;
    appendFileSync(HISTORY_PATH, line, 'utf8');
    appendCount++;
    if (appendCount % COMPRESS_TRIGGER === 0) {
      compressHistory();
    }
  } catch {
    // silent — never crash main flow on history write failure
  }
}

export function compressHistory(): void {
  try {
    const raw = readFileSync(HISTORY_PATH, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length <= COMPRESS_THRESHOLD) return;
    const kept = lines.slice(-COMPRESS_THRESHOLD);
    const tmpPath = `${HISTORY_PATH}.tmp`;
    writeFileSync(tmpPath, kept.join('\n') + '\n', 'utf8');
    renameSync(tmpPath, HISTORY_PATH);
  } catch {
    // silent
  }
}

/** Returns true the very first time aion runs, then permanently false. */
export function isFirstLaunch(): boolean {
  if (existsSync(ONBOARDED_PATH)) return false;
  try {
    mkdirSync(AION_DIR, { recursive: true });
    writeFileSync(ONBOARDED_PATH, new Date().toISOString() + '\n', 'utf8');
  } catch {
    // ignore — treat as not first launch if we can't write
    return false;
  }
  return true;
}
