/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/costTracker.ts

import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { mainWarn } from '@process/utils/mainLogger';
import type { ChildTaskInfo } from './dispatchTypes';

/**
 * Per-session cost entry.
 */
export type SessionCostEntry = {
  sessionId: string;
  displayName: string;
  role: 'admin' | 'child';
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  modelName?: string;
  /** Estimated cost in USD (model-dependent pricing) */
  estimatedCost?: number;
};

/**
 * Aggregated cost summary for the entire group chat.
 */
export type GroupCostSummary = {
  totalTokens: number;
  totalEstimatedCost: number;
  sessions: SessionCostEntry[];
  updatedAt: number;
};

/** Pricing per 1K tokens (USD) for common models. Rough estimates. */
type ModelPricing = {
  inputPer1k: number;
  outputPer1k: number;
};

/**
 * Model-to-pricing lookup table. Returns USD per 1K tokens.
 * These are approximate prices; user can override via settings in the future.
 */
export function getModelPricing(modelName: string): ModelPricing {
  const lower = modelName.toLowerCase();

  // Claude models
  if (lower.includes('claude-3-5-sonnet') || lower.includes('claude-3.5-sonnet')) {
    return { inputPer1k: 0.003, outputPer1k: 0.015 };
  }
  if (lower.includes('claude-3-5-haiku') || lower.includes('claude-3.5-haiku')) {
    return { inputPer1k: 0.001, outputPer1k: 0.005 };
  }
  if (lower.includes('claude-3-opus') || lower.includes('claude-3.0-opus') || lower.includes('opus')) {
    return { inputPer1k: 0.015, outputPer1k: 0.075 };
  }
  if (lower.includes('claude')) {
    return { inputPer1k: 0.003, outputPer1k: 0.015 };
  }

  // Gemini models
  if (lower.includes('gemini-2.5-pro') || lower.includes('gemini-2.0-pro')) {
    return { inputPer1k: 0.00125, outputPer1k: 0.01 };
  }
  if (lower.includes('gemini-2.0-flash') || lower.includes('gemini-2.5-flash')) {
    return { inputPer1k: 0.0001, outputPer1k: 0.0004 };
  }
  if (lower.includes('gemini')) {
    return { inputPer1k: 0.0005, outputPer1k: 0.002 };
  }

  // GPT models
  if (lower.includes('gpt-4o')) {
    return { inputPer1k: 0.0025, outputPer1k: 0.01 };
  }
  if (lower.includes('gpt-4-turbo') || lower.includes('gpt-4')) {
    return { inputPer1k: 0.01, outputPer1k: 0.03 };
  }
  if (lower.includes('gpt-3.5')) {
    return { inputPer1k: 0.0005, outputPer1k: 0.0015 };
  }

  // Default fallback — generic mid-range pricing
  return { inputPer1k: 0.002, outputPer1k: 0.008 };
}

/**
 * Extract token usage from a conversation's extra field.
 * Different engines store tokens in different formats.
 */
function extractTokenUsage(extra: Record<string, unknown>): {
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
} {
  // Pattern 1: lastTokenUsage (unified format from BaseAgentManager)
  const lastUsage = extra.lastTokenUsage;
  if (typeof lastUsage === 'object' && lastUsage !== null) {
    const u = lastUsage as Record<string, unknown>;
    return {
      totalTokens: typeof u.totalTokens === 'number' ? u.totalTokens : 0,
      inputTokens: typeof u.inputTokens === 'number' ? u.inputTokens : undefined,
      outputTokens: typeof u.outputTokens === 'number' ? u.outputTokens : undefined,
    };
  }

  // Pattern 2: Gemini usageMetadata
  const usageMeta = extra.usageMetadata;
  if (typeof usageMeta === 'object' && usageMeta !== null) {
    const m = usageMeta as Record<string, unknown>;
    return {
      totalTokens: typeof m.totalTokenCount === 'number' ? m.totalTokenCount : 0,
      inputTokens: typeof m.promptTokenCount === 'number' ? m.promptTokenCount : undefined,
      outputTokens: typeof m.candidatesTokenCount === 'number' ? m.candidatesTokenCount : undefined,
    };
  }

  // Pattern 3: ACP context usage (less precise)
  const contextUsage = extra.acp_context_usage;
  if (typeof contextUsage === 'object' && contextUsage !== null) {
    const c = contextUsage as Record<string, unknown>;
    return {
      totalTokens: typeof c.used === 'number' ? c.used : 0,
    };
  }

  return { totalTokens: 0 };
}

/**
 * Aggregate cost data for a group chat by reading each session's
 * conversation.extra token usage from the database.
 */
export async function aggregateGroupCost(
  conversationRepo: IConversationRepository,
  parentConversationId: string,
  childInfos: ChildTaskInfo[],
): Promise<GroupCostSummary> {
  const sessions: SessionCostEntry[] = [];

  // Read parent conversation token usage
  try {
    const parentConv = await conversationRepo.getConversation(parentConversationId);
    if (parentConv) {
      const extra = (parentConv.extra ?? {}) as Record<string, unknown>;
      const usage = extractTokenUsage(extra);
      const convRecord = parentConv as unknown as Record<string, unknown>;
      const modelName = typeof extra.adminModelName === 'string'
        ? extra.adminModelName
        : (convRecord.model as Record<string, unknown> | undefined)?.useModel as string | undefined;
      const pricing = modelName ? getModelPricing(modelName) : undefined;

      let estimatedCost: number | undefined;
      if (pricing && usage.totalTokens > 0) {
        if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
          estimatedCost = (usage.inputTokens / 1000) * pricing.inputPer1k + (usage.outputTokens / 1000) * pricing.outputPer1k;
        } else {
          // Approximate: assume 50/50 input/output split
          const avgPer1k = (pricing.inputPer1k + pricing.outputPer1k) / 2;
          estimatedCost = (usage.totalTokens / 1000) * avgPer1k;
        }
      }

      sessions.push({
        sessionId: parentConversationId,
        displayName: 'Admin',
        role: 'admin',
        totalTokens: usage.totalTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        modelName,
        estimatedCost,
      });
    }
  } catch (err) {
    mainWarn('[CostTracker]', 'Failed to read parent conversation cost data', err);
  }

  // Read each child conversation's token usage
  for (const child of childInfos) {
    try {
      const childConv = await conversationRepo.getConversation(child.sessionId);
      if (!childConv) continue;

      const extra = (childConv.extra ?? {}) as Record<string, unknown>;
      const usage = extractTokenUsage(extra);
      const childRecord = childConv as unknown as Record<string, unknown>;
      const modelName = typeof extra.childModelName === 'string'
        ? extra.childModelName
        : (childRecord.model as Record<string, unknown> | undefined)?.useModel as string | undefined;
      const pricing = modelName ? getModelPricing(modelName) : undefined;

      let estimatedCost: number | undefined;
      if (pricing && usage.totalTokens > 0) {
        if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
          estimatedCost = (usage.inputTokens / 1000) * pricing.inputPer1k + (usage.outputTokens / 1000) * pricing.outputPer1k;
        } else {
          const avgPer1k = (pricing.inputPer1k + pricing.outputPer1k) / 2;
          estimatedCost = (usage.totalTokens / 1000) * avgPer1k;
        }
      }

      sessions.push({
        sessionId: child.sessionId,
        displayName: child.title,
        role: 'child',
        totalTokens: usage.totalTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        modelName,
        estimatedCost,
      });
    } catch (err) {
      mainWarn('[CostTracker]', `Failed to read child cost data: ${child.sessionId}`, err);
    }
  }

  const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalEstimatedCost = sessions.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);

  return {
    totalTokens,
    totalEstimatedCost,
    sessions,
    updatedAt: Date.now(),
  };
}
