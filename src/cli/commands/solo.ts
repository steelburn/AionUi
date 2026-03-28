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
import { InlineCommandPicker } from '../ui/InlineCommandPicker';
import { fmt, hr, Spinner } from '../ui/format';
import type { Interface } from 'node:readline';
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

function makeStdoutEmitter(
  getRl: () => Interface | null = () => null,
): IAgentEventEmitter {
  const spinner = new Spinner('思考中');
  let textStarted = false;

  return {
    emitConfirmationAdd: () => {},
    emitConfirmationUpdate: () => {},
    emitConfirmationRemove: () => {},
    emitMessage(_cid: string, event: AgentMessageEvent) {
      if (event.type === 'status') {
        const status = (event.data as { status?: string })?.status;
        if (status === 'running') {
          textStarted = false;
          process.stdout.write(`\n${fmt.dim(hr())}\n`);
          spinner.start();
        } else if (status === 'done') {
          spinner.stop();
          textStarted = false;
          process.stdout.write(`\n${fmt.dim(hr())}\n\n`);
          const rl = getRl();
          if (rl) {
            rl.resume();
            rl.prompt(true);
          }
        }
      } else if (event.type === 'text') {
        if (!textStarted) {
          spinner.stop();
          textStarted = true;
        }
        process.stdout.write((event.data as { content?: string })?.content ?? '');
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

function printTips(): void {
  process.stdout.write(
    fmt.dim('  输入消息开始对话  ·  / 打开命令菜单  ·  Tab 键补全命令\n') +
      fmt.dim('  /team [目标]  多 Agent 协作  ·  /model 切换模型  ·  /help 查看所有命令\n') +
      '\n',
  );
}

// ── Slash commands ────────────────────────────────────────────────────────────

const SLASH_HELP = `
${fmt.bold('斜杠命令：')}
  ${fmt.cyan('/model <名称|序号>')}  切换 Agent  ${fmt.dim('(例: /model codex  或  /model 2)')}
  ${fmt.cyan('/agents')}             列出已配置的 Agent
  ${fmt.cyan('/team [目标]')}        启动多 Agent 协作
  ${fmt.cyan('/clear')}              清屏（保留会话上下文）
  ${fmt.cyan('/help')}               显示此帮助
  ${fmt.cyan('/exit')}               退出
`.trim();

async function handleSlashCommand(
  input: string,
  config: AionCliConfig,
  agentKeyRef: { current: string },
  managerRef: { current: IAgentManager },
  picker: InlineCommandPicker,
  getRl: () => Interface | null,
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
      process.stdout.write(fmt.dim('\n  使用 /model <名称> 或 /model <序号> 切换\n\n'));
      return { handled: true };
    }

    case 'model': {
      if (!arg) {
        if (process.stdout.isTTY) {
          // 交互式选择器（TTY 环境）
          const agents = Object.keys(config.agents).map((k) => ({
            key: k,
            provider: config.agents[k]!.provider,
            isActive: k === agentKeyRef.current,
          }));
          await new Promise<void>((resolve) => {
            picker.showAgentSelector(agents, async (selectedKey) => {
              if (selectedKey && selectedKey !== agentKeyRef.current) {
                await managerRef.current.stop();
                agentKeyRef.current = selectedKey;
                const factory = createCliAgentFactory(config, undefined, selectedKey);
                managerRef.current = factory(`solo-${Date.now()}`, '', makeStdoutEmitter(getRl));
                process.stdout.write(`\n→ ${fmt.bold(fmt.cyan(selectedKey))}  ${fmt.dim('(新会话已开始)')}\n\n`);
              }
              resolve();
            });
          });
        } else {
          // 非 TTY 降级：静态列表
          const keys = Object.keys(config.agents);
          process.stdout.write('\n');
          for (const [i, k] of keys.entries()) {
            const agent = config.agents[k]!;
            const isActive = k === agentKeyRef.current;
            process.stdout.write(
              `  ${isActive ? fmt.green('●') : fmt.dim('○')}  ${fmt.dim(`${i + 1}.`)} ${fmt.cyan(k)}  ${fmt.dim(agent.provider)}${isActive ? fmt.green('  ← 当前') : ''}\n`,
            );
          }
          process.stdout.write(fmt.dim('\n  输入 /model <名称> 或 /model <序号> 切换\n\n'));
        }
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
        process.stdout.write(fmt.red(`✗ "${arg}" 未找到 — 可用: ${available}\n\n`));
        return { handled: true };
      }

      // Kill old manager before switching to avoid orphaned processes
      await managerRef.current.stop();
      agentKeyRef.current = resolvedKey;
      const factory = createCliAgentFactory(config, undefined, resolvedKey);
      managerRef.current = factory(`solo-${Date.now()}`, '', makeStdoutEmitter(getRl));
      process.stdout.write(`→ ${fmt.bold(fmt.cyan(resolvedKey))}  ${fmt.dim('(新会话已开始)')}\n\n`);
      return { handled: true };
    }

    case 'clear':
      process.stdout.write('\x1b[2J\x1b[H'); // erase screen + move cursor home
      printHeader(config, agentKeyRef.current);
      return { handled: true };

    case 'team': {
      const { runTeam } = await import('./team');
      await runTeam({ goal: arg || undefined });
      return { handled: true };
    }

    case 'exit':
    case 'quit':
      process.stdout.write(fmt.dim('再见。\n'));
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
  printTips();

  const agentKeyRef = { current: activeKey };
  const rlRef: { current: Interface | null } = { current: null };
  const getRl = (): Interface | null => rlRef.current;

  const managerRef: { current: IAgentManager } = {
    current: createCliAgentFactory(config, undefined, activeKey)(`solo-${Date.now()}`, '', makeStdoutEmitter(getRl)),
  };

  const agentKeys = Object.keys(config.agents);
  const picker = new InlineCommandPicker(agentKeys);

  // Graceful Ctrl+C: stop agent then force-exit.
  // We do NOT rely on startRepl resolving because stop() racing with rl.close()
  // can leave the event loop hanging. Direct process.exit is the safest path.
  const sigintHandler = (): void => {
    process.stdout.write('\n' + fmt.dim('再见。\n'));
    managerRef.current
      .stop()
      .catch(() => {})
      .finally(() => process.exit(0));
    // Force-exit after 3s max in case stop() hangs (e.g. SIGKILL timeout path)
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once('SIGINT', sigintHandler);

  // Single readline lifecycle — owns stdin from here to EOF
  // Pass agent keys so Tab expands /model <Tab> to agent names
  await startRepl(
    () => `${agentKeyRef.current} >`,
    async (input) => {
      if (input.startsWith('/')) {
        const result = await handleSlashCommand(input, config, agentKeyRef, managerRef, picker, getRl);
        if (result.exit) process.exit(0);
        if (result.handled) return;
      }
      await managerRef.current.sendMessage({ content: input });
    },
    agentKeys,
    picker,
    () => managerRef.current.stop().catch(() => {}),
    (rl) => { rlRef.current = rl; },
  );

  // Clean EOF path (Ctrl+D): remove SIGINT handler, stop agent, exit
  process.off('SIGINT', sigintHandler);
  await Promise.race([
    managerRef.current.stop(),
    new Promise<void>((r) => setTimeout(r, 1500).unref()),
  ]);
  process.exit(0);
}
