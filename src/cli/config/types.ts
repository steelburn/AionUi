/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** How to call this agent */
export type AgentProvider =
  | 'anthropic'   // direct Anthropic SDK (needs ANTHROPIC_API_KEY)
  | 'openai'      // direct OpenAI SDK (needs OPENAI_API_KEY)
  | 'gemini'      // direct Gemini SDK (needs GEMINI_API_KEY)
  | 'claude-cli'  // spawn local `claude` CLI (uses its own stored auth)
  | 'codex-cli';  // spawn local `codex` CLI (uses its own stored auth)

export type AgentConfig = {
  provider: AgentProvider;
  /** Model to pass to the CLI (e.g. 'sonnet', 'opus', 'o3') */
  model?: string;
  /** API key — only needed for direct SDK providers */
  apiKey?: string;
  /** Absolute path to the CLI binary — auto-detected if not set */
  bin?: string;
  /** Extra CLI args always appended */
  extraArgs?: string[];
};

export type AionCliConfig = {
  defaultAgent: string;
  agents: Record<string, AgentConfig>;
  team?: {
    concurrency?: number;
    timeoutMs?: number;
  };
};
