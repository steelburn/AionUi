/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createInterface } from 'node:readline';
import { fmt } from './format';

export type ReplHandler = (input: string) => Promise<void>;

/** Slash command names — used for tab completion */
const SLASH_COMMANDS = ['/model', '/agents', '/team', '/help', '/exit'];

/**
 * Start an interactive readline REPL loop.
 * Resolves when the user sends EOF (Ctrl+D) or SIGINT (Ctrl+C).
 *
 * @param prompt    - static string OR function called each tick (for dynamic active-agent prompt)
 * @param handler   - called for every non-empty line
 * @param agentKeys - optional list of configured agent names for /model <tab> completion
 */
export function startRepl(
  prompt: string | (() => string),
  handler: ReplHandler,
  agentKeys?: string[],
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
    rl.question(fmt.bold(fmt.cyan(`${getPrompt()} `)), async (line) => {
      const input = line.trim();
      if (input) {
        try {
          await handler(input);
        } catch (err) {
          process.stderr.write(
            fmt.red(`Error: ${err instanceof Error ? err.message : String(err)}\n`),
          );
        }
      }
      ask();
    });
  };

  return new Promise<void>((resolve) => {
    rl.once('close', () => {
      process.stdout.write('\n');
      resolve();
    });
    ask();
  });
}
