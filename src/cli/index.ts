/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * aion — Aion CLI entry point
 *
 * Command tree:
 *   aion                              Interactive single-agent mode (default)
 *   aion team [--goal <goal>]         Multi-agent team mode (Orchestrator)
 *   aion team --agents claude,gemini  Multi-MODEL team (Aion differentiator)
 *   aion run <task>                   One-shot task
 *   aion config                       Show config and setup guide
 *   aion doctor                       Check agent availability and connectivity
 *
 * Env vars (auto-detected, no config file needed):
 *   ANTHROPIC_API_KEY   → enables Claude agents
 *   GEMINI_API_KEY      → enables Gemini agents
 */
import { parseArgs } from 'node:util';
import { fmt } from './ui/format';

const VERSION = '1.9.2';

const HELP = `
${fmt.bold('aion')} — Multi-Model Agent Platform  ${fmt.dim(`v${VERSION}`)}

${fmt.bold('Usage:')}
  aion                                   Interactive chat (all slash commands available)
  aion team [--goal <text>]              Multi-agent team  ${fmt.dim('(3 parallel agents)')}
  aion run <task>                        One-shot task  ${fmt.dim('(single agent, no REPL)')}
  aion doctor                            Check installed agents & connectivity
  aion config                            Show config and file location

${fmt.bold('Solo mode options:')}
  ${fmt.cyan('-a, --agent <name>')}        Agent to use  ${fmt.dim('(default: from config)')}
  ${fmt.cyan('-w, --workspace <dir>')}     Working directory

${fmt.bold('Team mode options:')}
  ${fmt.cyan('-g, --goal <text>')}         Goal for the team
  ${fmt.cyan('    --with <k1,k2,k3>')}     Agent per role  ${fmt.dim('(default: auto-distributed)')}
  ${fmt.cyan('-c, --concurrency <n>')}     Number of parallel agents  ${fmt.dim('(default: 3)')}

${fmt.bold('Other:')}
  ${fmt.cyan('-v, --version')}             Print version
  ${fmt.cyan('-h, --help')}               Show this help

${fmt.bold('Slash commands (in solo mode):')}
  ${fmt.cyan('/team [goal]')}              Launch a multi-agent team
  ${fmt.cyan('/model <name>')}             Switch active agent mid-session
  ${fmt.cyan('/agents')}                  List configured agents
  ${fmt.cyan('/help')}                    Show all slash commands

${fmt.bold('Multi-model teams (Aion differentiator):')}
  When multiple agents are configured, Aion distributes them automatically:
  ${fmt.cyan('aion team --goal "Design a feature"')}
  ${fmt.dim('#  UX Designer[claude] · Architect[gemini] · Critic[claude]  — run in parallel')}

  Override manually:
  ${fmt.cyan('aion team --goal "Build an API" --with claude,gemini,claude')}

${fmt.bold('Setup:')}
  ${fmt.cyan('brew install anthropics/tap/claude-code')}  ${fmt.dim('# Claude Code CLI')}
  ${fmt.cyan('npm install -g @openai/codex')}             ${fmt.dim('# Codex CLI')}
  ${fmt.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}      ${fmt.dim('# Direct Anthropic API')}
  ${fmt.cyan('export GEMINI_API_KEY=...')}                ${fmt.dim('# Direct Gemini API')}
`.trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      agent: { type: 'string', short: 'a' },
      goal: { type: 'string', short: 'g' },
      agents: { type: 'string' },     // legacy alias
      with: { type: 'string' },       // preferred: --with claude,gemini,claude
      concurrency: { type: 'string', short: 'c' },
      workspace: { type: 'string', short: 'w' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.version) {
    process.stdout.write(`aion v${VERSION}\n`);
    process.exit(0);
  }

  if (values.help) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  const command = positionals[0];

  switch (command) {
    case 'team': {
      const { runTeam } = await import('./commands/team');
      await runTeam({
        goal: values.goal,
        // --with takes precedence; --agents kept for backwards compat
        agents: values.with ?? values.agents,
        concurrency: values.concurrency ? parseInt(values.concurrency, 10) : undefined,
      });
      break;
    }

    case 'run': {
      const task = positionals.slice(1).join(' ') || values.goal;
      if (!task) {
        process.stderr.write(fmt.red('Usage: aion run <task>\n'));
        process.exit(1);
      }
      const { runTeam } = await import('./commands/team');
      await runTeam({ goal: task, concurrency: 1 });
      break;
    }

    case 'config': {
      const { showConfig } = await import('./commands/config');
      await showConfig();
      break;
    }

    case 'doctor': {
      const { runDoctor } = await import('./commands/doctor');
      await runDoctor();
      break;
    }

    case undefined:
    default: {
      const { runSolo } = await import('./commands/solo');
      await runSolo({
        agent: values.agent,
        workspace: values.workspace,
      });
      break;
    }
  }
}

main().catch((err) => {
  process.stderr.write(fmt.red(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
