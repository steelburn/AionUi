/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for team.ts observable behavior.
 *
 * `inferRoles` and `autoDistributeAgents` are private, so we drive them
 * indirectly via `runTeam`, capturing the SubTask array that the mocked
 * Orchestrator receives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SubTask, SubTaskResult } from '@process/task/orchestrator/types';

// ── Hoist shared mock state so vi.mock factories can reference it ──────────

const mocks = vi.hoisted(() => {
  // The run spy is shared across all Orchestrator instances created in tests
  const orchestratorRunSpy = vi.fn<[string, SubTask[]], Promise<SubTaskResult[]>>();
  return { orchestratorRunSpy };
});

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock('@process/task/orchestrator/Orchestrator', () => {
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  class MockOrchestrator extends EventEmitter {
    run(...args: [string, SubTask[]]): Promise<SubTaskResult[]> {
      return mocks.orchestratorRunSpy(...args);
    }
  }
  return { Orchestrator: MockOrchestrator };
});

vi.mock('@/cli/config/loader', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('@/cli/agents/factory', () => ({
  createCliAgentFactory: vi.fn(function () {
    return vi.fn();
  }),
}));

vi.mock('@/cli/ui/teamPanel', () => {
  class MockTeamPanel {
    setGoal = vi.fn();
    setLabel = vi.fn();
    setDependsOn = vi.fn();
    setCoordinatorPhase = vi.fn();
    update = vi.fn();
    start = vi.fn();
    clear = vi.fn();
  }
  return { TeamPanel: MockTeamPanel };
});

vi.mock('@/cli/ui/format', () => ({
  fmt: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
  },
  hr: () => '---',
  Spinner: class {
    start() {}
    stop() {}
  },
}));

vi.mock('@/cli/agents/coordinator', () => {
  class MockCoordinatorSession {
    plan = vi.fn().mockResolvedValue(null);
    synthesize = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
  }
  return { CoordinatorSession: MockCoordinatorSession };
});

vi.mock('@/cli/ui/markdown', () => ({
  renderMarkdown: (s: string) => s,
}));

vi.mock('@/cli/ui/stdinDedup', () => ({
  createDedupStdin: vi.fn(() => process.stdin),
}));

// ── Import subject under test (after mocks) ────────────────────────────────

import { runTeam, parseTeamSizeFromGoal } from '@/cli/commands/team';
import { loadConfig } from '@/cli/config/loader';
import type { AionCliConfig } from '@/cli/config/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<AionCliConfig>): AionCliConfig {
  return {
    defaultAgent: 'claude',
    agents: { claude: { provider: 'claude-cli', bin: '/usr/bin/claude' } },
    ...overrides,
  };
}

function makeResults(tasks: SubTask[]): SubTaskResult[] {
  return tasks.map((t) => ({
    subTaskId: t.id,
    conversationId: `conv-${t.id}`,
    outputText: 'result',
    completedAt: Date.now(),
  }));
}

function suppressStdout(): () => void {
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = vi.fn() as unknown as typeof process.stdout.write;
  return () => {
    process.stdout.write = orig;
  };
}

// ── Test setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  mocks.orchestratorRunSpy.mockReset();
  mocks.orchestratorRunSpy.mockImplementation((_goal, subTasks) =>
    Promise.resolve(makeResults(subTasks)),
  );
  vi.mocked(loadConfig).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── inferRoles: keyword matching ───────────────────────────────────────────

describe('inferRoles — keyword matching (observed via subTask labels)', () => {
  it('"design" goal → UX Designer / Architect / Critic roles', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'design a new landing page', concurrency: 3 });
    restore();

    expect(capturedTasks.map((t) => t.label)).toEqual(['UX Designer', 'Architect', 'Critic']);
  });

  it('"build" goal → Architect / Developer / Reviewer roles', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'build a REST API', concurrency: 3 });
    restore();

    expect(capturedTasks.map((t) => t.label)).toEqual(['Architect', 'Developer', 'Reviewer']);
  });

  it('"implement" keyword → build roles', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'implement the authentication module', concurrency: 3 });
    restore();

    expect(capturedTasks.map((t) => t.label)).toEqual(['Architect', 'Developer', 'Reviewer']);
  });

  it('"analyze" goal → Investigator / Analyst / Synthesizer roles', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'analyze the codebase for performance issues', concurrency: 3 });
    restore();

    expect(capturedTasks.map((t) => t.label)).toEqual([
      'Investigator',
      'Analyst',
      'Synthesizer',
    ]);
  });

  it('"fix" goal → Debugger / Engineer / Verifier roles', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'fix the login bug', concurrency: 3 });
    restore();

    expect(capturedTasks.map((t) => t.label)).toEqual(['Debugger', 'Engineer', 'Verifier']);
  });

  it('"bug" keyword → fix/debug roles', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'squash this nasty bug in production', concurrency: 3 });
    restore();

    expect(capturedTasks.map((t) => t.label)).toEqual(['Debugger', 'Engineer', 'Verifier']);
  });

  it('"研究" (Chinese research) → Researcher / Evaluator / Advisor roles', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: '研究竞品方案', concurrency: 3 });
    restore();

    expect(capturedTasks.map((t) => t.label)).toEqual(['Researcher', 'Evaluator', 'Advisor']);
  });

  it('"设计" (Chinese design) → UX Designer / Architect / Critic roles', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: '设计新版本的交互原型', concurrency: 3 });
    restore();

    expect(capturedTasks.map((t) => t.label)).toEqual(['UX Designer', 'Architect', 'Critic']);
  });

  it('no keyword match → default Researcher / Analyst / Implementer roles', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'make the product better somehow', concurrency: 3 });
    restore();

    expect(capturedTasks.map((t) => t.label)).toEqual([
      'Researcher',
      'Analyst',
      'Implementer',
    ]);
  });
});

// ── inferRoles: cyclic wrapping with concurrency > role set size ───────────

describe('inferRoles — concurrency larger than role template set', () => {
  it('concurrency=5 uses distinct roles without cycling', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'analyze the codebase', concurrency: 5 });
    restore();

    // analyze set now has 7 roles; 5 agents get 5 distinct labels
    const labels = capturedTasks.map((t) => t.label);
    expect(labels).toHaveLength(5);
    expect(labels[0]).toBe('Investigator');
    expect(labels[1]).toBe('Analyst');
    expect(labels[2]).toBe('Synthesizer');
    // indices 3 and 4 are now distinct expanded roles, not cycled duplicates
    expect(new Set(labels).size).toBe(5);
  });

  it('concurrency=1 produces a single role', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'build a CLI tool', concurrency: 1 });
    restore();

    expect(capturedTasks).toHaveLength(1);
    expect(capturedTasks[0]!.label).toBe('Architect');
  });
});

// ── autoDistributeAgents ───────────────────────────────────────────────────

describe('autoDistributeAgents — agent distribution', () => {
  it('single agent config → Orchestrator is still called (no multi-model mapping)', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig()); // only 'claude'
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'build something', concurrency: 3 });
    restore();

    // Single agent → autoDistributeAgents returns [] → 3 sub-tasks from concurrency
    expect(capturedTasks).toHaveLength(3);
  });

  it('multiple agents → round-robin assignment across sub-tasks', async () => {
    const multiConfig = makeConfig({
      defaultAgent: 'claude',
      agents: {
        claude: { provider: 'claude-cli', bin: '/usr/bin/claude' },
        gemini: { provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'key' },
      },
    });
    vi.mocked(loadConfig).mockReturnValue(multiConfig);

    const { createCliAgentFactory } = await import('@/cli/agents/factory');
    let capturedAgentPerTask: Record<string, string> | undefined;
    vi.mocked(createCliAgentFactory).mockImplementation((_config, agentPerTask) => {
      capturedAgentPerTask = agentPerTask;
      return vi.fn();
    });

    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'build something', concurrency: 4 });
    restore();

    // 4 tasks, 2 agents → round-robin: claude, gemini, claude, gemini
    expect(capturedTasks).toHaveLength(4);
    expect(capturedAgentPerTask).toBeDefined();
    const assignments = capturedTasks.map((t) => capturedAgentPerTask![t.id]);
    expect(assignments).toEqual(['claude', 'gemini', 'claude', 'gemini']);
  });
});

// ── runTeam: input validation ─────────────────────────────────────────────

describe('runTeam — input validation', () => {
  it('throws when goal is empty and stdin is not a TTY', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());

    const origIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
      writable: true,
    });

    await expect(runTeam({ goal: '' })).rejects.toThrow(
      'Goal required. Use: aion team --goal "your goal"',
    );

    if (origIsTTY) {
      Object.defineProperty(process.stdin, 'isTTY', origIsTTY);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (process.stdin as unknown as Record<string, unknown>).isTTY;
    }
  });

  it('throws when an unknown agent key is provided in options.agents', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig()); // only 'claude' configured

    await expect(
      runTeam({ goal: 'build something', agents: 'claude,unknownAgent' }),
    ).rejects.toThrow('Unknown agents: unknownAgent');
  });

  it('throws for multiple unknown agent keys at once', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());

    await expect(
      runTeam({ goal: 'build something', agents: 'ghost,phantom' }),
    ).rejects.toThrow('Unknown agents: ghost, phantom');
  });

  it('accepts a single valid agent key and creates exactly one sub-task', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'build something', agents: 'claude' });
    restore();

    // Single agent key → roleCount=1 → one sub-task
    expect(capturedTasks).toHaveLength(1);
  });

  it('uses exactly agentKeys.length roles when --with is provided (ignores concurrency)', async () => {
    vi.mocked(loadConfig).mockReturnValue(
      makeConfig({
        agents: {
          claude: { provider: 'claude-cli', bin: '/usr/bin/claude' },
          gemini: { provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'key' },
        },
      }),
    );
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    // concurrency=5 but agents=2 → should produce 2 sub-tasks
    await runTeam({ goal: 'build a feature', agents: 'claude,gemini', concurrency: 5 });
    restore();

    expect(capturedTasks).toHaveLength(2);
  });

  it('uses config.team.concurrency as default when options.concurrency is not provided', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig({ team: { concurrency: 2 } }));
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'research options' });
    restore();

    expect(capturedTasks).toHaveLength(2);
  });

  it('falls back to concurrency=3 when options.concurrency is NaN', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runTeam({ goal: 'research something', concurrency: NaN });
    restore();
    stderrSpy.mockRestore();

    expect(capturedTasks).toHaveLength(3);
  });
});

// ── runTeam: sub-task prompt content ─────────────────────────────────────

describe('runTeam — sub-task prompt construction', () => {
  it('each sub-task prompt contains the goal text', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    const goal = 'build a payment gateway';
    await runTeam({ goal, concurrency: 3 });
    restore();

    for (const task of capturedTasks) {
      expect(task.prompt).toContain(goal);
    }
  });

  it('each sub-task has a unique 8-character id', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: 'build something', concurrency: 3 });
    restore();

    const ids = capturedTasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toHaveLength(8);
    }
  });
});

// ── runTeam: AbortSignal interrupt ────────────────────────────────────────

describe('runTeam — AbortSignal interrupt', () => {
  it('resolves without throwing when AbortSignal fires before orchestration completes', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();

    const controller = new AbortController();

    mocks.orchestratorRunSpy.mockImplementation(
      () =>
        new Promise<SubTaskResult[]>((resolve) => {
          setTimeout(() => resolve([]), 200);
        }),
    );

    // Abort immediately before run resolves
    controller.abort();

    await expect(
      runTeam({ goal: 'build something', concurrency: 3 }, undefined, controller.signal),
    ).resolves.toBeUndefined();
    restore();
  });
});

// ── duplicate agent warning (#17) ────────────────────────────────────────

describe('runTeam — duplicate agent warning', () => {
  it('writes warning to stderr when the same agent key appears more than once', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runTeam({ goal: 'build something', agents: 'claude,claude,claude' });

    restore();
    const allStderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allStderr).toContain('Duplicate agents');
    expect(allStderr).toContain('claude');
    stderrSpy.mockRestore();
  });

  it('does NOT write duplicate warning when all agent keys are distinct', async () => {
    vi.mocked(loadConfig).mockReturnValue(
      makeConfig({
        agents: {
          claude: { provider: 'claude-cli', bin: '/usr/bin/claude' },
          gemini: { provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'key' },
        },
      }),
    );
    const restore = suppressStdout();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runTeam({ goal: 'build something', agents: 'claude,gemini' });

    restore();
    const allStderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allStderr).not.toContain('Duplicate agents');
    stderrSpy.mockRestore();
  });
});

// ── parseTeamSizeFromGoal ─────────────────────────────────────────────────

describe('parseTeamSizeFromGoal', () => {
  it('returns upper bound for Chinese range "5到7人"', () => {
    expect(parseTeamSizeFromGoal('帮我创建一个5到7人的团队')).toBe(7);
  });

  it('returns upper bound for Chinese range "3至5名"', () => {
    expect(parseTeamSizeFromGoal('需要3至5名专家分析这个问题')).toBe(5);
  });

  it('returns the number for "5人团队"', () => {
    expect(parseTeamSizeFromGoal('组建一个5人团队')).toBe(5);
  });

  it('returns the number for "6个agent"', () => {
    expect(parseTeamSizeFromGoal('用6个agent分析代码')).toBe(6);
  });

  it('returns upper bound for English range "5-7 people"', () => {
    expect(parseTeamSizeFromGoal('build a feature with 5-7 people')).toBe(7);
  });

  it('returns upper bound for English range "3 to 5 agents"', () => {
    expect(parseTeamSizeFromGoal('research this with 3 to 5 agents')).toBe(5);
  });

  it('returns the number for "team of 5"', () => {
    expect(parseTeamSizeFromGoal('create a team of 5 to analyze this')).toBe(5);
  });

  it('returns null when no size hint is present', () => {
    expect(parseTeamSizeFromGoal('analyze the codebase for bugs')).toBeNull();
  });

  it('returns null for out-of-range number (1)', () => {
    expect(parseTeamSizeFromGoal('only 1 person needed')).toBeNull();
  });

  it('returns null for out-of-range number (21)', () => {
    expect(parseTeamSizeFromGoal('need 21 people')).toBeNull();
  });

  it('runTeam uses goal size when --concurrency not set', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    await runTeam({ goal: '帮我创建一个5到7人团队分析这个bug' });
    restore();

    // Should create 7 agents (upper bound of "5到7")
    expect(capturedTasks).toHaveLength(7);
  });

  it('runTeam uses --concurrency flag over goal size when both present', async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig());
    const restore = suppressStdout();
    let capturedTasks: SubTask[] = [];
    mocks.orchestratorRunSpy.mockImplementation((_g, tasks) => {
      capturedTasks = tasks;
      return Promise.resolve(makeResults(tasks));
    });

    // Explicit --concurrency 3 should win over "5到7人" in goal
    await runTeam({ goal: '需要5到7人来分析代码', concurrency: 3 });
    restore();

    expect(capturedTasks).toHaveLength(3);
  });
});
