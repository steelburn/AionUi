/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentManagerFactory } from '@process/task/orchestrator/SubTaskSession';
import type { AionCliConfig, AgentConfig } from '../config/types';
import { SpawnCliAgentManager } from './SpawnCliAgentManager';
import { CliAgentManager } from './CliAgentManager';

/**
 * Create an AgentManagerFactory for the Orchestrator.
 *
 * Routes to the right implementation based on the agent's provider:
 *   claude-cli / codex-cli  → SpawnCliAgentManager (spawn local binary)
 *   anthropic               → CliAgentManager (direct Anthropic SDK)
 *
 * Multi-model teams: pass agentPerTask to map subTaskId → agentKey.
 * The Orchestrator uses conversationIds of the form `orch_{runId}_{subTaskId}`.
 */
export function createCliAgentFactory(
  config: AionCliConfig,
  agentPerTask?: Record<string, string>,
): AgentManagerFactory {
  return (conversationId, _presetContext, emitter) => {
    const agentKey = resolveAgentKey(conversationId, config, agentPerTask);
    const agentConfig = resolveAgentConfig(config, agentKey);
    return buildManager(conversationId, agentConfig, emitter);
  };
}

function buildManager(
  conversationId: string,
  config: AgentConfig,
  emitter: Parameters<AgentManagerFactory>[2],
) {
  if (config.provider === 'claude-cli') {
    return new SpawnCliAgentManager(
      conversationId,
      { bin: config.bin!, flavor: 'claude', extraArgs: config.extraArgs },
      emitter,
    );
  }

  if (config.provider === 'codex-cli') {
    return new SpawnCliAgentManager(
      conversationId,
      { bin: config.bin!, flavor: 'codex', extraArgs: config.extraArgs },
      emitter,
    );
  }

  // Direct Anthropic SDK fallback
  return new CliAgentManager(conversationId, config, emitter);
}

function resolveAgentKey(
  conversationId: string,
  config: AionCliConfig,
  agentPerTask?: Record<string, string>,
): string {
  if (agentPerTask) {
    const parts = conversationId.split('_');
    const subTaskId = parts[parts.length - 1];
    if (subTaskId && agentPerTask[subTaskId]) return agentPerTask[subTaskId];
  }
  return config.defaultAgent;
}

function resolveAgentConfig(config: AionCliConfig, key: string): AgentConfig {
  if (config.agents[key]) return config.agents[key];

  const first = Object.values(config.agents)[0];
  if (first) return first;

  throw new Error(
    `No agent found. Install claude or codex CLI, or set ANTHROPIC_API_KEY.\n` +
      `  brew install anthropics/tap/claude-code\n` +
      `  Run: aion doctor`,
  );
}
