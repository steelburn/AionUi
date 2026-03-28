/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Team command — multi-agent parallel collaboration.
 *
 * Core Aion differentiator: each agent in the team can use a DIFFERENT model.
 * Claude Code only supports one model. Aion supports mixing any configured models.
 *
 * Role assignment:
 *   By default, roles are inferred from the goal using keyword matching.
 *   If multiple models are configured, they are distributed across roles automatically.
 *
 * Examples:
 *   aion team --goal "Analyze codebase"
 *     → Investigator + Analyst + Synthesizer, distributed across configured models
 *
 *   aion team --goal "Build a feature" --with claude,gemini,claude
 *     → Architect(claude) + Developer(gemini) + Reviewer(claude) in parallel
 *
 *   aion team --goal "Design an API" -c 5
 *     → 5 parallel agents (roles inferred from "design" keyword)
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Orchestrator } from '@process/task/orchestrator/Orchestrator';
import type { SubTask } from '@process/task/orchestrator/types';
import { createCliAgentFactory } from '../agents/factory';
import { loadConfig } from '../config/loader';
import type { AionCliConfig } from '../config/types';
import { TeamPanel } from '../ui/teamPanel';
import { fmt, hr } from '../ui/format';

export type TeamOptions = {
  goal?: string;
  /**
   * Comma-separated agent keys, one per sub-task.
   * E.g. "claude,gemini,claude" or from --with flag.
   */
  agents?: string;
  concurrency?: number;
};

// ── Role templates ─────────────────────────────────────────────────────────────

type RoleTemplate = { label: string; focus: string };

const ROLE_SETS: Record<string, RoleTemplate[]> = {
  design: [
    { label: 'UX Designer', focus: 'Design the user experience and interface for' },
    { label: 'Architect', focus: 'Design the technical architecture and data model for' },
    { label: 'Critic', focus: 'Identify gaps, risks, and improvements in the design of' },
  ],
  build: [
    { label: 'Architect', focus: 'Define the high-level architecture and component breakdown for' },
    { label: 'Developer', focus: 'Write concrete, production-ready implementation for' },
    { label: 'Reviewer', focus: 'Review the implementation for correctness, security, and quality of' },
  ],
  analyze: [
    { label: 'Investigator', focus: 'Investigate and gather all relevant facts about' },
    { label: 'Analyst', focus: 'Analyze patterns, root causes, and implications of' },
    { label: 'Synthesizer', focus: 'Synthesize findings into clear, actionable recommendations for' },
  ],
  research: [
    { label: 'Researcher', focus: 'Research background, prior art, and available options for' },
    { label: 'Evaluator', focus: 'Evaluate trade-offs and rank approaches for' },
    { label: 'Advisor', focus: 'Provide a concrete recommendation with rationale for' },
  ],
  fix: [
    { label: 'Debugger', focus: 'Identify the root cause and reproduce the issue in' },
    { label: 'Engineer', focus: 'Write the fix with tests and edge cases for' },
    { label: 'Verifier', focus: 'Verify the fix is complete and check for regressions in' },
  ],
  plan: [
    { label: 'PM', focus: 'Define requirements, success metrics, and scope for' },
    { label: 'Architect', focus: 'Break down the technical plan and identify risks for' },
    { label: 'Estimator', focus: 'Estimate effort, dependencies, and delivery timeline for' },
  ],
};

const DEFAULT_ROLES: RoleTemplate[] = [
  { label: 'Researcher', focus: 'Research and gather relevant information for' },
  { label: 'Analyst', focus: 'Analyze requirements, constraints, and trade-offs for' },
  { label: 'Implementer', focus: 'Provide a concrete, actionable implementation plan for' },
];

/** Pick role template based on keywords in the goal */
function inferRoles(goal: string, concurrency: number): RoleTemplate[] {
  const lower = goal.toLowerCase();

  let roles: RoleTemplate[] = DEFAULT_ROLES;
  if (/\b(design|ux|ui|interface|wireframe|layout)\b/.test(lower)) roles = ROLE_SETS.design!;
  else if (/\b(build|implement|create|develop|code|write)\b/.test(lower)) roles = ROLE_SETS.build!;
  else if (/\b(analyze|audit|review|assess|evaluate|profile)\b/.test(lower)) roles = ROLE_SETS.analyze!;
  else if (/\b(research|investigate|explore|survey|compare)\b/.test(lower)) roles = ROLE_SETS.research!;
  else if (/\b(fix|bug|debug|error|issue|crash|fail)\b/.test(lower)) roles = ROLE_SETS.fix!;
  else if (/\b(plan|roadmap|milestone|sprint|estimate|scope)\b/.test(lower)) roles = ROLE_SETS.plan!;

  // Extend or trim to match concurrency
  const result: RoleTemplate[] = [];
  for (let i = 0; i < concurrency; i++) {
    result.push(roles[i % roles.length]!);
  }
  return result;
}

// ── Auto-distribute models ─────────────────────────────────────────────────────

/**
 * If --with is not specified and multiple agents are configured,
 * distribute them round-robin across sub-tasks so the team naturally uses
 * multiple models — Aion's core value prop made visible.
 */
function autoDistributeAgents(config: AionCliConfig, count: number): string[] {
  const keys = Object.keys(config.agents);
  if (keys.length <= 1) return [];
  return Array.from({ length: count }, (_, i) => keys[i % keys.length]!);
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runTeam(options: TeamOptions = {}): Promise<void> {
  const config = loadConfig();
  const concurrency = options.concurrency ?? config.team?.concurrency ?? 3;
  const timeoutMs = config.team?.timeoutMs ?? 5 * 60 * 1000;

  const goal = options.goal ?? (await promptGoal());

  // Resolve per-task agent keys
  let agentKeys: string[];
  if (options.agents) {
    agentKeys = options.agents.split(',').map((s) => s.trim());
  } else {
    agentKeys = autoDistributeAgents(config, concurrency);
  }

  const roles = inferRoles(goal, Math.max(concurrency, agentKeys.length || concurrency));
  const subTasks: SubTask[] = roles.map((role) => ({
    id: randomUUID().slice(0, 8),
    label: role.label,
    prompt: `${role.focus}: ${goal}\n\nBe thorough and specific. Provide a well-structured response.`,
    agentType: 'acp',
  }));

  // Map subTaskId → agentKey for multi-model teams
  const agentPerTask: Record<string, string> | undefined =
    agentKeys.length > 0
      ? Object.fromEntries(subTasks.map((t, i) => [t.id, agentKeys[i] ?? config.defaultAgent]))
      : undefined;

  // Header: show which model drives each role
  const agentSummary = subTasks
    .map((t) => {
      const key = agentPerTask?.[t.id] ?? config.defaultAgent;
      return `${fmt.bold(t.label)}${fmt.dim(`[${key}]`)}`;
    })
    .join(fmt.dim('  '));

  process.stdout.write(`\n${fmt.bold('Aion Team')}  ${fmt.dim('·')}  ${agentSummary}\n`);
  process.stdout.write(fmt.dim(hr()) + '\n\n');

  const factory = createCliAgentFactory(config, agentPerTask);
  const orch = new Orchestrator(factory, { concurrency, subTaskTimeoutMs: timeoutMs });
  const panel = new TeamPanel();

  orch.on('*', (event) => panel.update(event));

  panel.setGoal(goal);
  for (const task of subTasks) {
    panel.setLabel(task.id, task.label);
  }

  try {
    const results = await orch.run(goal, subTasks);
    panel.clear();

    process.stdout.write(
      `${fmt.green(fmt.bold('✓ Team complete'))}  ${fmt.dim(`(${results.length} agents · ${roles.map((r) => r.label).join(', ')})`
      )}\n`,
    );
    process.stdout.write(fmt.dim(hr()) + '\n\n');

    for (const result of results) {
      const task = subTasks.find((t) => t.id === result.subTaskId);
      const key = agentPerTask?.[result.subTaskId] ?? config.defaultAgent;
      const label = task?.label ?? result.subTaskId;

      process.stdout.write(`${fmt.bold(fmt.cyan(`▸ ${label}`))}  ${fmt.dim(`[${key}]`)}\n`);
      process.stdout.write(result.outputText.trim() + '\n\n');
    }
  } catch (err) {
    panel.clear();
    process.stderr.write(
      fmt.red(`\n✗ Team failed: ${err instanceof Error ? err.message : String(err)}\n`),
    );
    process.exit(1);
  }
}

async function promptGoal(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(fmt.bold('Goal: '), (answer) => {
      rl.close();
      const goal = answer.trim();
      if (!goal) {
        process.stderr.write(fmt.red('Goal cannot be empty.\n'));
        process.exit(1);
      }
      resolve(goal);
    });
  });
}
