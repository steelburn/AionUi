/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Solo command — interactive multi-turn chat.
 *
 * Design (per UX Lead spec):
 *   - ≤2 lines of chrome before prompt on repeat runs
 *   - Passive agent list — no readline before REPL, no Warp stdin freeze
 *   - Warn loudly on silent agent fallbacks
 *   - Kill old manager before switching agents
 *   - ↑/↓ history via readline historySize (in repl.ts)
 */
import { loadConfig } from '../config/loader';
import { createCliAgentFactory } from '../agents/factory';
import { startRepl } from '../ui/repl';
import { fmt } from '../ui/format';
import type { AionCliConfig } from '../config/types';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter, AgentMessageEvent } from '@process/task/IAgentEventEmitter';

// Single source of truth pulled from package.json at build time via esbuild define,
// with a fallback so it still works in ts-node / tests.
const VERSION: string =
  typeof __AION_VERSION__ !== 'undefined' ? __AION_VERSION__ : '1.9.2';

declare const __AION_VERSION__: string | undefined;

const LOGO_LINES = [
  '    _   ___ ___  _  _ ',
  '   /_\\  |_ _/ _ \\| \\| |',
  '  / _ \\  | | (_) | .` |',
  ' /_/ \\_\\|___\\___/|_|\\_|',
];

// ── Emitter ───────────────────────────────────────────────────────────────────

function makeStdoutEmitter(): IAgentEventEmitter {
  return {
    emitConfirmationAdd: () => {},
    emitConfirmationUpdate: () => {},
    emitConfirmationRemove: () => {},
    emitMessage(_cid: string, event: AgentMessageEvent) {
      if (event.type === 'text') {
        process.stdout.write((event.data as { content?: string })?.content ?? '');
      } else if (event.type === 'status') {
        if ((event.data as { status?: string })?.status === 'done') {
          process.stdout.write('\n\n');
        }
      }
    },
  };
}

// ── Display ───────────────────────────────────────────────────────────────────

function printOnboarding(): void {
  process.stdout.write('\n');
  for (const line of LOGO_LINES) process.stdout.write(fmt.cyan(line) + '\n');
  process.stdout.write(fmt.dim('  Multi-Model Agent Platform\n\n'));
  process.stdout.write(fmt.bold('No agents detected.\n\n'));
  process.stdout.write(
    `  ${fmt.cyan('brew install anthropics/tap/claude-code')}   ${fmt.dim('# Claude Code CLI')}\n` +
      `  ${fmt.cyan('npm install -g @openai/codex')}              ${fmt.dim('# Codex CLI')}\n\n` +
      `  ${fmt.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}       ${fmt.dim('# Anthropic API')}\n` +
      `  ${fmt.cyan('export GEMINI_API_KEY=...')}                 ${fmt.dim('# Gemini API')}\n\n` +
      `Run ${fmt.cyan('aion doctor')} to verify.\n\n`,
  );
}

/**
 * Compact header: 2 lines max.
 * Shows all agent names inline — active one bold+cyan, others dim.
 */
function printHeader(config: AionCliConfig, activeKey: string): void {
  const keys = Object.keys(config.agents);
  const agentList = keys
    .map((k) => (k === activeKey ? fmt.bold(fmt.cyan(k)) : fmt.dim(k)))
    .join(fmt.dim('  ·  '));

  process.stdout.write(
    `\n${fmt.dim(`Aion v${VERSION}`)}  ${fmt.dim('·')}  ${agentList}  ${fmt.dim('·  /help for commands')}\n\n`,
  );
}

// ── Slash commands ────────────────────────────────────────────────────────────

const SLASH_HELP = `
${fmt.bold('Commands:')}
  ${fmt.cyan('/model <name|n>')}  Switch agent  ${fmt.dim('(e.g. /model codex  or  /model 2)')}
  ${fmt.cyan('/agents')}          List configured agents
  ${fmt.cyan('/team [goal]')}     Launch a multi-agent team
  ${fmt.cyan('/help')}            Show this
  ${fmt.cyan('/exit')}            Exit
`.trim();

async function handleSlashCommand(
  input: string,
  config: AionCliConfig,
  agentKeyRef: { current: string },
  managerRef: { current: IAgentManager },
): Promise<{ handled: boolean; exit?: boolean }> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (cmd?.toLowerCase()) {
    case 'help':
      process.stdout.write('\n' + SLASH_HELP + '\n\n');
      return { handled: true };

    case 'agents': {
      const keys = Object.keys(config.agents);
      process.stdout.write('\n');
      for (const [i, key] of keys.entries()) {
        const agent = config.agents[key]!;
        const isActive = key === agentKeyRef.current;
        const provider =
          agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
            ? agent.provider
            : `${agent.provider}/${agent.model ?? '?'}`;
        process.stdout.write(
          `  ${isActive ? fmt.green('●') : fmt.dim('○')} ${fmt.dim(`${i + 1}.`)} ${fmt.cyan(key)}  ${fmt.dim(provider)}${isActive ? fmt.dim('  ← active') : ''}\n`,
        );
      }
      process.stdout.write(fmt.dim('\n  /model <name> or /model <number> to switch\n\n'));
      return { handled: true };
    }

    case 'model': {
      if (!arg) {
        process.stdout.write(fmt.yellow('Usage: /model <name>  e.g. /model codex\n'));
        return { handled: true };
      }
      const keys = Object.keys(config.agents);
      const byNum = parseInt(arg, 10);
      const resolvedKey =
        config.agents[arg]
          ? arg
          : !isNaN(byNum) && keys[byNum - 1]
            ? keys[byNum - 1]!
            : null;

      if (!resolvedKey) {
        const available = keys.join(', ');
        process.stdout.write(fmt.red(`✗ "${arg}" not found — available: ${available}\n\n`));
        return { handled: true };
      }

      // Kill old manager before switching to avoid orphaned processes
      await managerRef.current.stop();
      agentKeyRef.current = resolvedKey;
      const factory = createCliAgentFactory(config, undefined, resolvedKey);
      managerRef.current = factory(`solo-${Date.now()}`, '', makeStdoutEmitter());
      process.stdout.write(`→ ${fmt.bold(fmt.cyan(resolvedKey))}  ${fmt.dim('(new conversation)')}\n\n`);
      return { handled: true };
    }

    case 'team': {
      const { runTeam } = await import('./team');
      await runTeam({ goal: arg || undefined });
      return { handled: true };
    }

    case 'exit':
    case 'quit':
      process.stdout.write(fmt.dim('Goodbye.\n'));
      return { handled: true, exit: true };

    default:
      return { handled: false };
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

type SoloOptions = { agent?: string; workspace?: string };

export async function runSolo(options: SoloOptions = {}): Promise<void> {
  const config = loadConfig();

  if (Object.keys(config.agents).length === 0) {
    printOnboarding();
    process.exit(1);
  }

  // Resolve active agent — warn loudly if requested agent not found
  let activeKey: string;
  if (options.agent) {
    if (config.agents[options.agent]) {
      activeKey = options.agent;
    } else {
      process.stderr.write(
        fmt.yellow(`⚠ Agent "${options.agent}" not configured — using ${config.defaultAgent}\n`),
      );
      activeKey = config.defaultAgent;
    }
  } else {
    activeKey = config.defaultAgent;
  }

  printHeader(config, activeKey);

  const agentKeyRef = { current: activeKey };
  const managerRef: { current: IAgentManager } = {
    current: createCliAgentFactory(config, undefined, activeKey)(`solo-${Date.now()}`, '', makeStdoutEmitter()),
  };

  // Single readline lifecycle — owns stdin from here to EOF
  // Pass agent keys so Tab expands /model <Tab> to agent names
  await startRepl(
    () => `${agentKeyRef.current} >`,
    async (input) => {
      if (input.startsWith('/')) {
        const result = await handleSlashCommand(input, config, agentKeyRef, managerRef);
        if (result.exit) process.exit(0);
        if (result.handled) return;
      }
      await managerRef.current.sendMessage({ content: input });
    },
    Object.keys(config.agents),
  );
}
