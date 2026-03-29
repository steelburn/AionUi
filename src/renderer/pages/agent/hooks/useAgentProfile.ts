/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useAgentRegistry } from '@/renderer/hooks/useAgentRegistry';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { resolveAgentId } from '@/renderer/utils/model/agentIdentity';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import type { AgentProfileData } from '../types';

/**
 * Hook to resolve agent profile data (identity + filtered conversations + workspaces).
 * Returns null if the agent is not found in the registry.
 */
export function useAgentProfile(agentId: string): AgentProfileData | null {
  const registry = useAgentRegistry();
  const { conversations } = useConversationHistoryContext();

  return useMemo(() => {
    const identity = registry.get(agentId);
    if (!identity) return null;

    const agentConversations = conversations
      .filter((c) => resolveAgentId(c) === agentId)
      .toSorted((a, b) => {
        const bTime = (b as { updatedAt?: number }).updatedAt ?? b.modifyTime ?? 0;
        const aTime = (a as { updatedAt?: number }).updatedAt ?? a.modifyTime ?? 0;
        return bTime - aTime;
      });

    const workspaces = [
      ...new Set(
        agentConversations
          .map((c) => (c.extra as Record<string, unknown> | undefined)?.workspace)
          .filter((w): w is string => typeof w === 'string')
      ),
    ];

    return {
      identity,
      conversations: agentConversations,
      agentLogo: getAgentLogo(identity.backendType ?? identity.id),
      workspaces,
    };
  }, [agentId, registry, conversations]);
}
