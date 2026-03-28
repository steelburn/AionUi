/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { fmt } from './format';
import type { InlineCommandPicker } from './InlineCommandPicker';

export type ReplHandler = (input: string) => Promise<void>;

/** Slash command names — used for tab completion */
const SLASH_COMMANDS = ['/model', '/agents', '/team', '/clear', '/help', '/exit'];

/**
 * Start an interactive readline REPL loop.
 * Resolves when the user sends EOF (Ctrl+D) or SIGINT (Ctrl+C).
 *
 * @param prompt      - static string OR function called each tick (for dynamic active-agent prompt)
 * @param handler     - called for every non-empty line
 * @param agentKeys   - optional list of configured agent names for /model <tab> completion
 * @param picker      - optional inline command picker
 * @param onEsc       - optional callback invoked when ESC is pressed during handler execution
 * @param onRlCreated - optional callback invoked with the readline Interface after creation
 */
export function startRepl(
  prompt: string | (() => string),
  handler: ReplHandler,
  agentKeys?: string[],
  picker?: InlineCommandPicker,
  onEsc?: () => void,
  onRlCreated?: (rl: Interface) => void,
): Promise<void> {
  // Resume stdin in case a prior readline left it paused (critical for Warp)
  process.stdin.resume();

  // Build the completer — extend /model completions if agent names are provided
  const allSlashCommands = agentKeys?.length
    ? [...SLASH_COMMANDS, ...agentKeys.map((k) => `/model ${k}`)]
    : SLASH_COMMANDS;

  function dynamicCompleter(line: string): [string[], string] {
    if (line.startsWith('/')) {
      const hits = allSlashCommands.filter((c) => c.startsWith(line));
      return [hits.length ? hits : allSlashCommands, line];
    }
    return [[], line];
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdout.isTTY ?? false,
    historySize: 200,
    completer: dynamicCompleter,
  });

  const getPrompt = typeof prompt === 'function' ? prompt : () => prompt;

  const ask = (): void => {
    if ((rl as unknown as { closed?: boolean }).closed) return;
    rl.question(fmt.bold(fmt.cyan(`${getPrompt()} `)), async (line) => {
      const input = line.trim();
      if (input) {
        // Register ESC listener during handler execution
        const escListener = (_str: string, key: { name?: string }): void => {
          if (key?.name === 'escape') onEsc?.();
        };
        if (onEsc) process.stdin.on('keypress', escListener);

        try {
          await handler(input);
        } catch (err) {
          process.stderr.write(
            fmt.red(`Error: ${err instanceof Error ? err.message : String(err)}\n`),
          );
        } finally {
          if (onEsc) process.stdin.off('keypress', escListener);
        }
      }
      ask();
    });
  };

  if (picker) {
    picker.attach(rl);
  }

  if (onRlCreated) onRlCreated(rl);

  return new Promise<void>((resolve) => {
    rl.once('close', () => {
      if (picker) picker.detach();
      process.stdout.write('\n');
      resolve();
    });

    // Suppress ERR_USE_AFTER_CLOSE from readline internal writes after close
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ERR_USE_AFTER_CLOSE' && err.code !== 'EPIPE') throw err;
    });

    ask();
  });
}
