/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Solo command — interactive multi-turn chat with slash-command extensions.
 *
 * Key design decisions:
 *   1. Banner shows ALL configured agents upfront — Aion is a platform, not a wrapper.
 *   2. Slash commands (/team, /model, /agents, /help) are handled locally, not sent to the agent.
 *   3. Routes through the same factory as team mode — CLI agents use SpawnCliAgentManager.
 *   4. First-run onboarding when no agents are configured.
 */
import { loadConfig } from '../config/loader';
import { createCliAgentFactory } from '../agents/factory';
import { startRepl } from '../ui/repl';
import { fmt, hr, banner } from '../ui/format';
import type { AionCliConfig } from '../config/types';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter, AgentMessageEvent } from '@process/task/IAgentEventEmitter';

const VERSION = '1.9.2';

type SoloOptions = {
  agent?: string;
  workspace?: string;
};

// ── Stdout emitter ────────────────────────────────────────────────────────────

/** Passthrough emitter that writes streaming text directly to stdout */
function makeStdoutEmitter(): IAgentEventEmitter {
  return {
    emitConfirmationAdd: () => {},
    emitConfirmationUpdate: () => {},
    emitConfirmationRemove: () => {},
    emitMessage(_cid: string, event: AgentMessageEvent) {
      if (event.type === 'text') {
        const text = (event.data as { content?: string })?.content ?? '';
        process.stdout.write(text);
      } else if (event.type === 'status') {
        const status = (event.data as { status?: string })?.status;
        if (status === 'done') {
          process.stdout.write('\n\n');
        }
      }
    },
  };
}

// ── Platform welcome banner ───────────────────────────────────────────────────

function printPlatformBanner(config: AionCliConfig, activeKey: string): void {
  const agentCount = Object.keys(config.agents).length;
  const tagline = agentCount > 1 ? `${agentCount} agents ready` : '1 agent ready';

  process.stdout.write(
    '\n' +
      banner([
        `${fmt.bold('Aion')}  ${fmt.dim('·')}  Multi-Model Agent Platform`,
        fmt.dim(`v${VERSION}  ·  ${tagline}`),
      ]) +
      '\n\n',
  );

  // List all configured agents
  for (const [key, agent] of Object.entries(config.agents)) {
    const isActive = key === activeKey;
    const marker = isActive ? fmt.green('●') : fmt.dim('○');
    const name = isActive ? fmt.bold(fmt.cyan(key)) : fmt.cyan(key);
    const provider =
      agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
        ? fmt.dim(agent.provider)
        : fmt.dim(`${agent.provider}/${agent.model ?? '?'}`);
    const activeTag = isActive ? fmt.dim(' (active)') : '';
    process.stdout.write(`  ${marker} ${name}  ${provider}${activeTag}\n`);
  }

  // Hint to add more agents if only one configured
  if (agentCount === 1) {
    process.stdout.write(
      '\n' +
        fmt.dim(
          '  + Add more agents: brew install anthropics/tap/claude-code  |  npm i -g @openai/codex\n',
        ) +
        fmt.dim('  + Or set: GEMINI_API_KEY / OPENAI_API_KEY\n'),
    );
  }

  process.stdout.write(
    '\n' +
      fmt.dim('  /team [goal]') +
      '  run multi-agent team  ' +
      fmt.dim('/model <name>') +
      '  switch model  ' +
      fmt.dim('/help') +
      '  all commands\n',
  );
  process.stdout.write(fmt.dim(hr()) + '\n\n');
}

function printOnboarding(): void {
  process.stdout.write(
    '\n' +
      banner([
        `${fmt.bold('Welcome to Aion')}`,
        fmt.dim('Multi-Model Agent Platform'),
      ]) +
      '\n\n',
  );

  process.stdout.write(fmt.bold('No agents detected.\n\n'));
  process.stdout.write('Get started by installing an agent:\n\n');
  process.stdout.write(
    `  ${fmt.cyan('brew install anthropics/tap/claude-code')}   ${fmt.dim('# Claude Code CLI')}\n`,
  );
  process.stdout.write(
    `  ${fmt.cyan('npm install -g @openai/codex')}              ${fmt.dim('# OpenAI Codex CLI')}\n`,
  );
  process.stdout.write(`\nOr use an API key directly:\n\n`);
  process.stdout.write(
    `  ${fmt.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}       ${fmt.dim('# Anthropic (Claude)')}\n`,
  );
  process.stdout.write(
    `  ${fmt.cyan('export GEMINI_API_KEY=...')}                 ${fmt.dim('# Google (Gemini)')}\n`,
  );
  process.stdout.write(`\nThen run ${fmt.cyan('aion doctor')} to verify your setup.\n\n`);
}

// ── Slash command handler ─────────────────────────────────────────────────────

const SLASH_HELP = `
${fmt.bold('Slash commands:')}
  ${fmt.cyan('/team [goal]')}      Launch a multi-agent team for this goal
  ${fmt.cyan('/team')}             Prompt for goal, then launch team
  ${fmt.cyan('/model <name>')}     Switch the active agent (e.g. /model gemini)
  ${fmt.cyan('/agents')}           List all configured agents
  ${fmt.cyan('/help')}             Show this help
  ${fmt.cyan('/exit')}             Exit Aion
`.trim();

/**
 * Handle a /command input.
 * Returns { handled: true } if fully handled, or { handled: false } if it should pass through.
 */
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
      process.stdout.write('\n' + fmt.bold('Configured agents:\n'));
      for (const [key, agent] of Object.entries(config.agents)) {
        const marker = key === agentKeyRef.current ? fmt.green('●') : fmt.dim('○');
        const provider =
          agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
            ? agent.provider
            : `${agent.provider}/${agent.model ?? '?'}`;
        process.stdout.write(`  ${marker} ${fmt.cyan(key)}  ${fmt.dim(provider)}\n`);
      }
      process.stdout.write('\n');
      return { handled: true };
    }

    case 'model': {
      if (!arg) {
        process.stdout.write(fmt.yellow('Usage: /model <agent-name>\n'));
        return { handled: true };
      }
      if (!config.agents[arg]) {
        process.stdout.write(
          fmt.red(`Agent "${arg}" not found. Run /agents to see available agents.\n`),
        );
        return { handled: true };
      }
      agentKeyRef.current = arg;
      // Rebuild manager for new agent
      const emitter = makeStdoutEmitter();
      const factory = createCliAgentFactory(config);
      managerRef.current = factory(`solo-${Date.now()}`, '', emitter);
      process.stdout.write(
        fmt.green(`Switched to ${fmt.bold(arg)}\n`) + fmt.dim('(new conversation started)\n\n'),
      );
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
      // Unknown slash command — pass through to agent as literal text
      return { handled: false };
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runSolo(options: SoloOptions = {}): Promise<void> {
  const config = loadConfig();
  const agentKeyRef = { current: options.agent ?? config.defaultAgent };

  if (!config.agents[agentKeyRef.current] && Object.keys(config.agents).length === 0) {
    printOnboarding();
    process.exit(1);
  }

  // Fall back to first available agent if specified key not found
  if (!config.agents[agentKeyRef.current]) {
    agentKeyRef.current = Object.keys(config.agents)[0] ?? 'claude';
  }

  printPlatformBanner(config, agentKeyRef.current);

  const emitter = makeStdoutEmitter();
  const factory = createCliAgentFactory(config);
  const managerRef: { current: IAgentManager } = {
    current: factory(`solo-${Date.now()}`, '', emitter),
  };

  let shouldExit = false;

  await startRepl('>', async (input) => {
    if (shouldExit) return;

    if (input.startsWith('/')) {
      const result = await handleSlashCommand(input, config, agentKeyRef, managerRef);
      if (result.exit) {
        shouldExit = true;
        process.exit(0);
      }
      if (result.handled) return;
    }

    await managerRef.current.sendMessage({ content: input });
  });
}
