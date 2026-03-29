/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentManagerFactory } from '@process/task/orchestrator/SubTaskSession';
import type { AionCliConfig, AgentConfig } from '../config/types';
import { SpawnCliAgentManager } from './SpawnCliAgentManager';
import { CliAgentManager } from './CliAgentManager';
import { OpenAIAgentManager } from './OpenAIAgentManager';
import { GeminiAgentManager } from './GeminiAgentManager';

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
  /** Override the default agent key — used by solo mode when user selects a specific agent */
  defaultAgentOverride?: string,
  /** Resume the most recent claude session on first turn (--continue/-c flag) */
  continueSession?: boolean,
  /** Never use -c even for subsequent turns — use for coordinator sessions */
  noAutoResume?: boolean,
): AgentManagerFactory {
  return (conversationId, presetContext, emitter) => {
    const agentKey = resolveAgentKey(conversationId, config, agentPerTask, defaultAgentOverride);
    const agentConfig = resolveAgentConfig(config, agentKey);
    return buildManager(conversationId, agentConfig, emitter, continueSession, presetContext || undefined, noAutoResume);
  };
}

function buildManager(
  conversationId: string,
  config: AgentConfig,
  emitter: Parameters<AgentManagerFactory>[2],
  continueSession?: boolean,
  systemPrompt?: string,
  noAutoResume?: boolean,
) {
  if (config.provider === 'claude-cli') {
    return new SpawnCliAgentManager(
      conversationId,
      { bin: config.bin!, flavor: 'claude', extraArgs: config.extraArgs, continueSession, noAutoResume, systemPrompt },
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

  if (config.provider === 'openai') {
    return new OpenAIAgentManager(conversationId, config, emitter, undefined, systemPrompt);
  }

  if (config.provider === 'gemini') {
    return new GeminiAgentManager(conversationId, config, emitter, undefined, systemPrompt);
  }

  // Direct Anthropic SDK fallback
  return new CliAgentManager(conversationId, config, emitter, undefined, systemPrompt);
}

function resolveAgentKey(
  conversationId: string,
  config: AionCliConfig,
  agentPerTask?: Record<string, string>,
  defaultAgentOverride?: string,
): string {
  if (agentPerTask) {
    const parts = conversationId.split('_');
    const subTaskId = parts[parts.length - 1];
    if (subTaskId && agentPerTask[subTaskId]) return agentPerTask[subTaskId];
  }
  return defaultAgentOverride ?? config.defaultAgent;
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
