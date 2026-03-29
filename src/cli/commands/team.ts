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
import { createInterface, type Interface } from 'node:readline';
import { Orchestrator } from '@process/task/orchestrator/Orchestrator';
import type { SubTask } from '@process/task/orchestrator/types';
import { createCliAgentFactory } from '../agents/factory';
import { loadConfig } from '../config/loader';
import type { AionCliConfig } from '../config/types';
import { TeamPanel } from '../ui/teamPanel';
import { fmt, hr, Spinner } from '../ui/format';
import { renderMarkdown } from '../ui/markdown';
import { createDedupStdin } from '../ui/stdinDedup';
import { CoordinatorSession } from '../agents/coordinator';
import { PersistentCoordinatorLoop } from '../agents/PersistentCoordinatorLoop';

/**
 * Codex CLI outputs a clean copy of the response after "tokens used\n<count>\n".
 * Everything before that is startup info, echoed prompt, mcp errors, and streaming noise.
 * Extract only the clean final response.
 */
function cleanCodexOutput(text: string): string {
  // Strip ANSI escape sequences first — codex wraps startup info in dim codes,
  // which also wraps the "tokens used" marker making \d+ fail to match "6,061".
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');

  // Primary: extract text that appears after "tokens used\n<count>\n"
  // Count may include commas (e.g. "6,061") so use [\d,]+ not \d+
  const afterTokens = /\ntokens used\n[\d,]+\n([\s\S]+)/i.exec(stripped);
  if (afterTokens?.[1]?.trim()) return afterTokens[1].trim();

  // Fallback: find the "codex\n" marker (start of AI response)
  const codexIdx = stripped.search(/\ncodex\n/);
  if (codexIdx >= 0) {
    return stripped
      .slice(codexIdx + '\ncodex\n'.length)
      .replace(/\ntokens used\n[\s\S]*$/, '')
      .trim();
  }

  return stripped.trim();
}

export type TeamOptions = {
  goal?: string;
  /**
   * Comma-separated agent keys, one per sub-task.
   * E.g. "claude,gemini,claude" or from --with flag.
   */
  agents?: string;
  concurrency?: number;
  /**
   * The currently active agent in solo mode.
   * When set and --with is not specified, all team tasks use this agent
   * instead of auto-distributing across all configured agents.
   */
  activeAgent?: string;
};

// ── Task kind classification ───────────────────────────────────────────────────

const EXECUTION_KEYWORDS = [
  'developer',
  'engineer',
  'implementer',
  'builder',
  'coder',
  'programmer',
  'devops',
  'frontend',
  'backend',
  'fullstack',
];

/**
 * Classify a role label as 'execution' (produces files/code) or 'analysis'.
 * Execution roles receive an extra directive authorizing file creation.
 */
function classifyTaskKind(label: string): 'analysis' | 'execution' {
  const lower = label.toLowerCase();
  return EXECUTION_KEYWORDS.some((k) => lower.includes(k)) ? 'execution' : 'analysis';
}

// ── Role templates ─────────────────────────────────────────────────────────────

type RoleTemplate = { label: string; focus: string };

const ROLE_SETS: Record<string, RoleTemplate[]> = {
  design: [
    { label: 'UX Designer', focus: 'Design the user experience and interface for' },
    { label: 'Architect', focus: 'Design the technical architecture and data model for' },
    { label: 'Critic', focus: 'Identify gaps, risks, and improvements in the design of' },
    { label: 'Visual Designer', focus: 'Define visual language, colors, and typography for' },
    { label: 'Product Manager', focus: 'Define user needs, scope, and success metrics for' },
    { label: 'UX Researcher', focus: 'Research user behavior and validate assumptions for' },
    { label: 'Accessibility Lead', focus: 'Ensure inclusive and accessible design for' },
  ],
  build: [
    { label: 'Architect', focus: 'Define the high-level architecture and component breakdown for' },
    { label: 'Developer', focus: 'Write concrete, production-ready implementation for' },
    { label: 'Reviewer', focus: 'Review the implementation for correctness, security, and quality of' },
    { label: 'Frontend Developer', focus: 'Implement the client-side UI and interactions for' },
    { label: 'Backend Developer', focus: 'Implement server-side logic and APIs for' },
    { label: 'DevOps Engineer', focus: 'Define deployment, CI/CD, and infrastructure for' },
    { label: 'Security Engineer', focus: 'Identify and mitigate security vulnerabilities in' },
  ],
  analyze: [
    { label: 'Investigator', focus: 'Investigate and gather all relevant facts about' },
    { label: 'Analyst', focus: 'Analyze patterns, root causes, and implications of' },
    { label: 'Synthesizer', focus: 'Synthesize findings into clear, actionable recommendations for' },
    { label: 'Data Scientist', focus: 'Apply quantitative methods and metrics to analyze' },
    { label: 'Risk Assessor', focus: 'Identify risks, failure modes, and mitigations for' },
    { label: 'Performance Expert', focus: 'Profile and optimize performance characteristics of' },
    { label: 'Domain Expert', focus: 'Provide deep domain knowledge and context for' },
  ],
  research: [
    { label: 'Researcher', focus: 'Research background, prior art, and available options for' },
    { label: 'Evaluator', focus: 'Evaluate trade-offs and rank approaches for' },
    { label: 'Advisor', focus: 'Provide a concrete recommendation with rationale for' },
    { label: 'Fact-Checker', focus: 'Verify accuracy and challenge assumptions about' },
    { label: 'Strategist', focus: 'Define long-term strategy and positioning for' },
    { label: 'Comparator', focus: 'Benchmark and compare alternatives for' },
    { label: 'Forecaster', focus: 'Project future trends and outcomes for' },
  ],
  fix: [
    { label: 'Debugger', focus: 'Identify the root cause and reproduce the issue in' },
    { label: 'Engineer', focus: 'Write the fix with tests and edge cases for' },
    { label: 'Verifier', focus: 'Verify the fix is complete and check for regressions in' },
    { label: 'Code Reviewer', focus: 'Review fix quality, readability, and side effects in' },
    { label: 'Integration Tester', focus: 'Test end-to-end integration and compatibility of' },
    { label: 'Root Cause Analyst', focus: 'Trace the full causal chain and prevent recurrence of' },
    { label: 'Documentation Writer', focus: 'Document the fix, rationale, and upgrade path for' },
  ],
  plan: [
    { label: 'PM', focus: 'Define requirements, success metrics, and scope for' },
    { label: 'Architect', focus: 'Break down the technical plan and identify risks for' },
    { label: 'Estimator', focus: 'Estimate effort, dependencies, and delivery timeline for' },
    { label: 'Stakeholder', focus: 'Represent business and user priorities for' },
    { label: 'Risk Manager', focus: 'Identify blockers, risks, and contingency plans for' },
    { label: 'QA Lead', focus: 'Define quality gates and testing strategy for' },
    { label: 'Tech Lead', focus: 'Ensure technical coherence and team readiness for' },
  ],
};

const DEFAULT_ROLES: RoleTemplate[] = [
  { label: 'Researcher', focus: 'Research and gather relevant information for' },
  { label: 'Analyst', focus: 'Analyze requirements, constraints, and trade-offs for' },
  { label: 'Implementer', focus: 'Provide a concrete, actionable implementation plan for' },
  { label: 'Critic', focus: 'Challenge assumptions and identify gaps in' },
  { label: 'Advisor', focus: 'Provide strategic recommendations and rationale for' },
  { label: 'Specialist', focus: 'Provide deep domain expertise and detailed insights for' },
  { label: 'Coordinator', focus: 'Integrate and reconcile findings from all perspectives on' },
];

/** Parse explicit team size from natural language goal text.
 *  Handles: "5到7人" → 7, "5人团队" → 5, "a team of 5" → 5 */
export function parseTeamSizeFromGoal(goal: string): number | null {
  const lower = goal.toLowerCase();
  // Range: "5到7人", "5-7 people", "5~7名", "5 to 7 agents"
  const rangeMatch = /(\d+)\s*(?:到|至|[-~]|to)\s*(\d+)\s*(?:人|名|个|people|agents?|members?)?/.exec(lower);
  if (rangeMatch) {
    const hi = parseInt(rangeMatch[2]!, 10);
    if (hi >= 2 && hi <= 20) return hi; // upper bound
  }
  // "team of 5" (no unit word required after number)
  const teamOfMatch = /team\s+of\s+(\d+)/.exec(lower);
  if (teamOfMatch) {
    const n = parseInt(teamOfMatch[1]!, 10);
    if (n >= 2 && n <= 20) return n;
  }
  // Single number with unit: "5人", "5个agent", "5 people", "共5名"
  const singleMatch = /(\d+)\s*(?:人|名|个|people|agents?|members?)/.exec(lower);
  if (singleMatch) {
    const n = parseInt(singleMatch[1]!, 10);
    if (n >= 2 && n <= 20) return n;
  }
  return null;
}

function matchesRole(lower: string, enPattern: RegExp, zhKeywords: string[]): boolean {
  return enPattern.test(lower) || zhKeywords.some((kw) => lower.includes(kw));
}

/** Pick role template based on keywords in the goal */
function inferRoles(goal: string, concurrency: number): RoleTemplate[] {
  const lower = goal.toLowerCase();

  let roles: RoleTemplate[] = DEFAULT_ROLES;
  if (matchesRole(lower, /\b(design|ux|ui|interface|wireframe|layout)\b/, ['设计', '界面', '布局', '交互', '原型']))
    roles = ROLE_SETS.design!;
  else if (matchesRole(lower, /\b(build|implement|create|develop|code|write)\b/, ['实现', '开发', '编写', '构建', '创建']))
    roles = ROLE_SETS.build!;
  else if (matchesRole(lower, /\b(analyze|audit|review|assess|evaluate|profile)\b/, ['分析', '审查', '评估', '检查', '诊断']))
    roles = ROLE_SETS.analyze!;
  else if (matchesRole(lower, /\b(research|investigate|explore|survey|compare)\b/, ['研究', '调研', '探索', '调查', '对比']))
    roles = ROLE_SETS.research!;
  else if (matchesRole(lower, /\b(fix|bug|debug|error|issue|crash|fail)\b/, ['修复', '调试', '报错', '崩溃', '问题', '故障']))
    roles = ROLE_SETS.fix!;
  else if (matchesRole(lower, /\b(plan|roadmap|milestone|sprint|estimate|scope)\b/, ['规划', '计划', '路线图', '里程碑', '排期', '方案']))
    roles = ROLE_SETS.plan!;

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

export async function runTeam(options: TeamOptions = {}, rl?: Interface, signal?: AbortSignal): Promise<void> {
  const config = loadConfig();

  // Guard: NaN concurrency from bad --concurrency flag
  const rawConcurrency = options.concurrency;
  const baseConcurrency =
    rawConcurrency != null && (!Number.isFinite(rawConcurrency) || rawConcurrency < 1)
      ? (process.stderr.write(
          fmt.yellow(`⚠ Invalid concurrency "${rawConcurrency}", using 3`) + '\n',
        ),
        3)
      : (rawConcurrency ?? config.team?.concurrency ?? 3);

  const timeoutMs = config.team?.timeoutMs ?? 5 * 60 * 1000;

  // Set up abort promise BEFORE promptGoal so ESC during the prompt also aborts
  const abortPromise = new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('Team interrupted')), { once: true });
  });

  // Guard: blank goal — resolve goal before concurrency so we can parse size from it
  const goalRaw = options.goal?.trim();
  const goal = goalRaw || (await Promise.race([promptGoal(rl), abortPromise]));

  // Parse team size from goal text if --concurrency not explicitly set
  const goalSize = options.agents ? null : (rawConcurrency == null ? parseTeamSizeFromGoal(goal) : null);
  const concurrency = goalSize ?? baseConcurrency;

  // Resolve per-task agent keys
  let agentKeys: string[];
  if (options.agents) {
    agentKeys = options.agents.split(',').map((s) => s.trim()).filter(Boolean);
    // Validate all explicitly provided agent keys, report all invalid at once
    const invalid = agentKeys.filter((k) => !config.agents[k]);
    if (invalid.length > 0) {
      throw new Error(`Unknown agents: ${invalid.join(', ')}. Run aion doctor to see configured agents.`);
    }
    // Warn about duplicate agent keys (#17)
    const keyCount = new Map<string, number>();
    for (const k of agentKeys) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
    const duplicates = [...keyCount.entries()].filter(([, c]) => c > 1).map(([k]) => k);
    if (duplicates.length > 0) {
      process.stderr.write(`⚠ Duplicate agents in --with: ${duplicates.join(', ')}. Each runs as separate instance.\n`);
    }
  } else if (options.activeAgent && config.agents[options.activeAgent]) {
    // Solo mode: use the currently selected agent for all tasks — don't auto-distribute
    agentKeys = [];
  } else {
    agentKeys = autoDistributeAgents(config, concurrency);
  }

  // The effective default agent key: activeAgent override > config default
  const effectiveDefault = (options.activeAgent && config.agents[options.activeAgent])
    ? options.activeAgent
    : config.defaultAgent;

  // When --with is explicitly provided, use exactly that many roles (don't inflate with concurrency).
  // When auto-distributed, use the configured concurrency (possibly from goal text).
  const roleCount = options.agents ? agentKeys.length : concurrency;

  // ── Phase 1: Coordinator plans the team ─────────────────────────────────────
  // One persistent CoordinatorSession spans Phase 1 + Phase 3 so the coordinator
  // remembers its own planning intent when synthesizing (Claude Operon session continuity).
  const coordinatorSession = new CoordinatorSession(
    // noAutoResume=true: coordinator prompts are self-contained; never use -c which
    // would accidentally continue a specialist's session instead of the coordinator's.
    createCliAgentFactory(config, undefined, effectiveDefault, undefined, true),
  );

  process.stdout.write(`\n${fmt.bold('Aion Team')}  ${fmt.dim('·')}  ${fmt.dim(`[coordinator: ${effectiveDefault}]`)}\n`);
  process.stdout.write(fmt.dim(hr()) + '\n\n');

  const planSpinner = new Spinner('Planning');
  planSpinner.start();

  // specPlanMap: role label → specialist plan metadata (phase, dependsOn) from coordinator
  const specPlanMap = new Map<string, { phase: number; dependsOn: string[] }>();

  let roles: RoleTemplate[];

  try {
    // 30s hard timeout on plan — prevents hanging if coordinator LLM never responds
    const planTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000));
    const plan = await Promise.race([
      coordinatorSession.plan(goal, roleCount, signal),
      planTimeout,
      abortPromise.catch(() => null as null),
    ]).catch(() => null as null);

    planSpinner.stop();

    if (plan) {
      roles = plan.specialists.map((s) => ({ label: s.role, focus: s.focus }));

      // Cache phase + dependsOn metadata for SubTask wiring
      for (const s of plan.specialists) {
        specPlanMap.set(s.role, {
          phase: s.phase ?? 1,
          dependsOn: s.dependsOn ?? [],
        });
      }

      // ── Plan display + user approval gate ────────────────────────────────
      // Show the coordinator's plan before executing — user can ESC to cancel.
      // (Claude Operon: generate_plan shows plan for user approval before dispatch.)
      const execLabel = plan.execution_mode === 'sequential'
        ? fmt.yellow('Sequential')
        : fmt.cyan('Parallel');
      process.stdout.write(`${fmt.dim(plan.goal_analysis)}\n\n`);
      process.stdout.write(`${fmt.dim('Execution mode')}  ${execLabel}\n\n`);

      // Group specialists by phase for display
      const phaseGroups = new Map<number, typeof plan.specialists>();
      for (const s of plan.specialists) {
        const ph = s.phase ?? 1;
        if (!phaseGroups.has(ph)) phaseGroups.set(ph, []);
        phaseGroups.get(ph)!.push(s);
      }
      const sortedPhaseGroups = [...phaseGroups.entries()].sort(([a], [b]) => a - b);
      for (const [phaseNum, specs] of sortedPhaseGroups) {
        if (sortedPhaseGroups.length > 1) {
          process.stdout.write(`  ${fmt.dim(`Phase ${phaseNum}`)}\n`);
        }
        for (const [i, s] of specs.entries()) {
          const deps = s.dependsOn?.length ? fmt.dim(` ← ${s.dependsOn.join(', ')}`) : '';
          process.stdout.write(`  ${fmt.dim(`${i + 1}.`)} ${fmt.bold(s.role)}  ${fmt.dim(s.focus)}${deps}\n`);
        }
      }
      process.stdout.write('\n');

      if (signal?.aborted) {
        await coordinatorSession.stop().catch(() => {});
        process.stdout.write(fmt.yellow('⊘ Cancelled.') + '\n\n');
        return;
      }
    } else {
      roles = inferRoles(goal, roleCount);
    }
  } catch {
    planSpinner.stop();
    roles = inferRoles(goal, roleCount);
  }

  // Assign IDs upfront so we can resolve dependsOn role names → task IDs
  const subTaskIds = new Map<string, string>(); // label → id
  for (const role of roles) {
    subTaskIds.set(role.label, randomUUID().slice(0, 8));
  }

  const subTasks: SubTask[] = roles.map((role) => {
    const id = subTaskIds.get(role.label)!;
    const meta = specPlanMap.get(role.label);
    // Resolve dependsOn role names → task IDs
    const dependsOn = meta?.dependsOn
      .map((depRole) => subTaskIds.get(depRole))
      .filter((depId): depId is string => depId !== undefined);
    // Classify task kind and inject execution directive for builder roles (#10)
    const taskKind = classifyTaskKind(role.label);
    const executionDirective =
      taskKind === 'execution'
        ? '\n\n**EXECUTION DIRECTIVE**: You are authorized to create and modify files. Produce working, runnable output — not descriptions or plans.'
        : '';
    return {
      id,
      label: role.label,
      // CLI providers (claude-cli/codex-cli) ignore presetContext — role focus goes in the prompt
      prompt: `${role.focus}: ${goal}\n\nBe thorough and specific. Provide a well-structured response.${executionDirective}`,
      // Direct-API providers (anthropic/openai/gemini) use presetContext as system prompt
      presetContext: `You are a ${role.label}. ${role.focus} the goal assigned to you. Be thorough and specific. You have access to a bash tool — use it to read files, inspect the codebase, and gather evidence before responding.`,
      agentType: 'acp',
      phase: meta?.phase,
      dependsOn: dependsOn?.length ? dependsOn : undefined,
      taskKind,
    };
  });

  // Map subTaskId → agentKey for multi-model teams
  const agentPerTask: Record<string, string> | undefined =
    agentKeys.length > 0
      ? Object.fromEntries(subTasks.map((t, i) => [t.id, agentKeys[i] ?? config.defaultAgent]))
      : undefined;

  // Print team roster
  const agentSummary = subTasks
    .map((t) => {
      const key = agentPerTask?.[t.id] ?? effectiveDefault;
      return `${fmt.bold(t.label)} ${fmt.dim(`[${key}]`)}`;
    })
    .join(fmt.dim('  '));

  process.stdout.write(`${fmt.dim('Team')}  ${agentSummary}\n`);
  process.stdout.write(fmt.dim(hr()) + '\n');

  const factory = createCliAgentFactory(config, agentPerTask, options.activeAgent);
  const orch = new Orchestrator(factory, { concurrency, subTaskTimeoutMs: timeoutMs });
  const panel = new TeamPanel();

  orch.on('*', (event) => panel.update(event));

  panel.setGoal(goal);
  panel.setCoordinatorPhase('executing');
  // Build id→label map for resolving dependsOn IDs back to role names
  const idToLabel = new Map(subTasks.map((t) => [t.id, t.label]));
  for (const task of subTasks) {
    panel.setLabel(task.id, task.label);
    if (task.dependsOn?.length) {
      const depLabels = task.dependsOn.map((id) => idToLabel.get(id) ?? id);
      panel.setDependsOn(task.id, depLabels);
    }
  }
  panel.start(); // immediately render pending state — user sees agents before they start

  const loop = new PersistentCoordinatorLoop(coordinatorSession, orch, {
    maxIterations: config.team?.maxIterations ?? 3,
    qualityThreshold: config.team?.qualityThreshold ?? 0.85,
    marginalGainThreshold: 0.10,
    maxRetriesPerRole: 2,
  });

  // Track all specialist results across rounds for final display count
  let totalResultsDisplayed = 0;

  // Synthesis display state
  let synthStarted = false;

  try {
    await Promise.race([
      loop.run(goal, subTasks, (event) => {
        switch (event.type) {
          case 'phase_changed': {
            // 'verifying' is a new phase from ICoordinatorLoop not yet in CoordinatorPhase;
            // map it to 'reviewing' until Group B adds 'verifying' to TeamPanel.
            type PanelPhase = Parameters<typeof panel.setCoordinatorPhase>[0];
            const knownPhases: string[] = [
              'planning', 'executing', 'reviewing', 'refining', 'synthesizing', 'done',
            ];
            const phase = knownPhases.includes(event.phase)
              ? (event.phase as PanelPhase)
              : ('reviewing' as PanelPhase);
            panel.setCoordinatorPhase(phase);
            break;
          }

          case 'round_started':
            // Round number available if needed for future display
            break;

          case 'round_display': {
            // New panel API — set round indicator if available (#11)
            const panelAny = panel as unknown as Record<string, unknown>;
            if (typeof panelAny['setRound'] === 'function') {
              (panelAny['setRound'] as (r: number, max: number) => void)(
                event.round,
                event.maxRounds,
              );
            }
            break;
          }

          case 'quality_score_updated': {
            // New panel API — show quality score if available (#12)
            const panelAny = panel as unknown as Record<string, unknown>;
            if (typeof panelAny['setQualityScore'] === 'function') {
              (panelAny['setQualityScore'] as (s: number) => void)(event.score);
            }
            break;
          }

          case 'verification_started':
            // New panel API — coordinator is verifying (#13)
            // 'verifying' will be added to CoordinatorPhase by Group B; cast for now
            panel.setCoordinatorPhase('reviewing');
            break;

          case 'verification_done':
            // New panel API — set phase based on pass/fail (#13)
            panel.setCoordinatorPhase(event.passed ? 'synthesizing' : 'refining');
            break;

          case 'agent_progress':
            // Forward agent streaming progress to the panel (#7)
            panel.update({
              type: 'subtask:progress',
              subTaskId: event.subTaskId,
              text: event.progressLine,
            });
            break;

          case 'round_assessed':
            // Quality score and refinement count available for future display
            break;

          case 'round_results': {
            // Display agent outputs for this round
            const { results, tasks } = event;

            if (totalResultsDisplayed === 0) {
              // First round: show completion header
              panel.clear();
              process.stdout.write(
                `${fmt.green(fmt.bold('✓ Team complete'))}  ${fmt.dim(`(${results.length} agents · ${roles.map((r) => r.label).join(', ')})`
                )}\n\n`,
              );
            }

            for (const result of results) {
              const task = tasks.find((t) => t.id === result.subTaskId);
              const key = agentPerTask?.[result.subTaskId] ?? effectiveDefault;
              const label = task?.label ?? result.subTaskId;
              const isCodex = config.agents[key]?.provider === 'codex-cli';
              const outputText = isCodex
                ? cleanCodexOutput(result.outputText).trim()
                : result.outputText.trim();

              // For refinement rounds, indicate it's a revision
              const isRefinement = task?.refinementOf !== undefined;
              const labelDisplay = isRefinement
                ? `${label}  ${fmt.dim('(revised)')}`
                : label;

              process.stdout.write(fmt.dim(hr()) + '\n');
              process.stdout.write(`${fmt.bold(`▸ ${labelDisplay}`)}  ${fmt.dim(`[${key}]`)}\n\n`);
              process.stdout.write(renderMarkdown(outputText) + '\n\n');
              totalResultsDisplayed++;
            }
            break;
          }

          case 'synthesis_chunk':
            if (!synthStarted) {
              process.stdout.write(fmt.dim(hr()) + '\n');
              process.stdout.write(`${fmt.bold(fmt.cyan('◈ Synthesis'))}  ${fmt.dim(`[coordinator: ${effectiveDefault}]`)}\n\n`);
              synthStarted = true;
            }
            process.stdout.write(event.text);
            break;

          case 'done':
            break;
        }
      }, signal),
      abortPromise,
    ]);
  } catch (err) {
    panel.clear();
    await coordinatorSession.stop().catch(() => {});
    if (err instanceof Error && err.message === 'Team interrupted') {
      process.stdout.write('\n' + fmt.yellow('⊘ Interrupted.') + '\n\n');
      return;
    }
    // All agents failed (timeout cascade, codex hung, etc.)
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(fmt.red('✗ Team failed') + '  ' + fmt.dim(msg) + '\n\n');
    return;
  }

  if (totalResultsDisplayed === 0) {
    panel.clear();
    process.stdout.write(
      fmt.yellow('⚠ Team complete') + '  ' + fmt.dim(`(0 of ${roles.length} agents produced output — check agent connectivity with aion doctor)`) + '\n\n',
    );
  } else if (synthStarted) {
    process.stdout.write('\n\n');
  }

  await coordinatorSession.stop().catch(() => {});
}


async function promptGoal(existingRl?: Interface): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Goal required. Use: aion team --goal "your goal"');
  }
  const promptStr = '\x1b[2m❯\x1b[0m \x1b[1m\x1b[36mGoal\x1b[0m ';
  if (existingRl) {
    return new Promise<string>((resolve, reject) => {
      existingRl.question(promptStr, (answer) => {
        const goal = answer.trim();
        if (!goal) {
          reject(new Error('Goal cannot be empty.'));
          return;
        }
        resolve(goal);
      });
    });
  }
  const rl = createInterface({ input: createDedupStdin(), output: process.stdout });
  return new Promise<string>((resolve, reject) => {
    rl.question(promptStr, (answer) => {
      rl.close();
      process.stdin.resume();
      const goal = answer.trim();
      if (!goal) {
        reject(new Error('Goal cannot be empty.'));
        return;
      }
      resolve(goal);
    });
  });
}
