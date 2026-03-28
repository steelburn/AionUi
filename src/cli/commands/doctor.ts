/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { loadConfig } from '../config/loader';
import { fmt, hr } from '../ui/format';

function checkBin(bin: string): { ok: boolean; version: string } {
  try {
    const v = execSync(`${bin} --version 2>&1`, { encoding: 'utf-8' }).trim().split('\n')[0];
    return { ok: true, version: v ?? '' };
  } catch {
    return { ok: false, version: '' };
  }
}

/** Known installable CLI agents in the Aion ecosystem */
const KNOWN_CLI_AGENTS: Array<{
  key: string;
  bin: string;
  install: string;
  description: string;
}> = [
  {
    key: 'claude',
    bin: 'claude',
    install: 'brew install anthropics/tap/claude-code',
    description: 'Claude Code (Anthropic)',
  },
  {
    key: 'codex',
    bin: 'codex',
    install: 'npm install -g @openai/codex',
    description: 'Codex CLI (OpenAI)',
  },
];

/** Known API-key-based providers */
const KNOWN_API_AGENTS: Array<{
  key: string;
  envVars: string[];
  description: string;
  models: string;
}> = [
  {
    key: 'claude (API)',
    envVars: ['ANTHROPIC_API_KEY'],
    description: 'Direct Anthropic SDK',
    models: 'claude-opus-4-6, claude-sonnet-4-6, ...',
  },
  {
    key: 'gemini',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    description: 'Direct Gemini SDK',
    models: 'gemini-2.0-flash, gemini-1.5-pro, ...',
  },
];

export async function runDoctor(): Promise<void> {
  process.stdout.write(`\n${fmt.bold('Aion Doctor')} — checking your setup\n\n`);

  const config = loadConfig();

  // ── Active agents ─────────────────────────────────────────────────────────
  process.stdout.write(fmt.bold('Active agents:\n'));

  if (Object.keys(config.agents).length === 0) {
    process.stdout.write(fmt.yellow('  (none configured)\n'));
  } else {
    for (const [name, agent] of Object.entries(config.agents)) {
      const isDefault = name === config.defaultAgent ? fmt.green(' [default]') : '';

      if (agent.provider === 'claude-cli' || agent.provider === 'codex-cli') {
        const check = checkBin(agent.bin!);
        const status = check.ok
          ? fmt.green(`✓ ${check.version}`)
          : fmt.red('✗ not found at ' + agent.bin);
        process.stdout.write(
          `  ${fmt.green('●')} ${fmt.cyan(name)}${isDefault}  ${fmt.dim(agent.bin!)}  ${status}\n`,
        );
      } else {
        const hasKey = !!agent.apiKey;
        const keyStatus = hasKey ? fmt.green('✓ key set') : fmt.yellow('⚠ no key');
        process.stdout.write(
          `  ${hasKey ? fmt.green('●') : fmt.yellow('◐')} ${fmt.cyan(name)}${isDefault}  ${fmt.dim(`${agent.provider}/${agent.model ?? '?'}`)}  ${keyStatus}\n`,
        );
      }
    }
  }

  // ── Installable CLI agents not yet set up ─────────────────────────────────
  const missingCli = KNOWN_CLI_AGENTS.filter(({ key }) => !config.agents[key]);

  if (missingCli.length > 0) {
    process.stdout.write('\n' + fmt.bold('Available CLI agents (not installed):\n'));
    for (const { key, bin, install, description } of missingCli) {
      const found = checkBin(bin);
      if (found.ok) {
        // Binary exists but not in config — auto-detect would pick it up on restart
        process.stdout.write(
          `  ${fmt.yellow('○')} ${fmt.cyan(key)}  ${fmt.dim(description)}  ${fmt.dim('(found, restart aion to activate)')}\n`,
        );
      } else {
        process.stdout.write(
          `  ${fmt.dim('○')} ${fmt.dim(key)}  ${fmt.dim(description)}\n` +
            `     Install: ${fmt.cyan(install)}\n`,
        );
      }
    }
  }

  // ── API key agents not yet set up ─────────────────────────────────────────
  const missingApi = KNOWN_API_AGENTS.filter(({ key, envVars }) => {
    const baseKey = key.replace(' (API)', '');
    return !config.agents[baseKey] && !envVars.some((v) => !!process.env[v]);
  });

  if (missingApi.length > 0) {
    process.stdout.write('\n' + fmt.bold('Available API agents (env var not set):\n'));
    for (const { envVars, description, models } of missingApi) {
      process.stdout.write(
        `  ${fmt.dim('○')} ${fmt.dim(description)}  ${fmt.dim(`(${models})`)}\n` +
          `     Set: ${fmt.cyan(`export ${envVars[0]}=...`)}\n`,
      );
    }
  }

  // ── Multi-model team potential ────────────────────────────────────────────
  const agentCount = Object.keys(config.agents).length;
  process.stdout.write('\n' + fmt.bold('Multi-model team status:\n'));
  if (agentCount >= 2) {
    process.stdout.write(
      `  ${fmt.green('✓')} ${agentCount} agents configured — multi-model teams enabled\n`,
    );
    process.stdout.write(
      `  ${fmt.dim(`aion team --goal "..." --with ${Object.keys(config.agents).slice(0, 3).join(',')}`)}\n`,
    );
  } else if (agentCount === 1) {
    process.stdout.write(
      `  ${fmt.yellow('⚠')} Only 1 agent — teams will use the same model for all roles\n`,
    );
    process.stdout.write(
      `  ${fmt.dim('Add a second agent to unlock mixed-model collaboration')}\n`,
    );
  } else {
    process.stdout.write(`  ${fmt.red('✗')} No agents — teams cannot run\n`);
  }

  // ── Quick usage ───────────────────────────────────────────────────────────
  process.stdout.write('\n' + fmt.bold('Quick usage:\n'));
  process.stdout.write(
    `  ${fmt.cyan('aion')}                                 ${fmt.dim('Interactive chat')}\n`,
  );
  process.stdout.write(
    `  ${fmt.cyan('aion team --goal "..."')}              ${fmt.dim('3-agent team (roles auto-inferred)')}\n`,
  );
  process.stdout.write(
    `  ${fmt.cyan('aion team --goal "..." --with a,b,c')}  ${fmt.dim('Mixed-model team')}\n`,
  );
  process.stdout.write(
    `  ${fmt.cyan('aion -a codex')}                       ${fmt.dim('Solo chat with specific agent')}\n`,
  );
  process.stdout.write(
    '\n' + fmt.dim(hr()) + '\n',
  );
  process.stdout.write(
    fmt.dim(`Config: ~/.aion/config.json  ·  Run \`aion config\` to inspect\n\n`),
  );
}
