/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for useAgentProfile hook (S4: Agent Profile + DM Chat Entry)
 *
 * Written SPEC-FIRST against tech-design.md Acceptance Criteria.
 * Hook lives at:
 *   src/renderer/pages/agent/hooks/useAgentProfile.ts
 *
 * Covered ACs:
 *   AC-2  — Returns null when agent is not found in registry
 *   AC-13 — Filters conversations to only those matching the agentId
 *   AC-14 — Conversations are sorted by updatedAt descending (most recent first)
 *   Data  — Collects unique workspaces from filtered conversations
 *   Data  — Includes identity from registry in returned data
 *   Data  — Calls getAgentLogo with the resolved identity
 */

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentIdentity } from '@/renderer/utils/model/agentIdentity';
import type { TChatConversation } from '@/common/config/storage';

// --- Mocks ----------------------------------------------------------------- //

const mockRegistry = new Map<string, AgentIdentity>();
const mockConversations: TChatConversation[] = [];

vi.mock('@/renderer/hooks/useAgentRegistry', () => ({
  useAgentRegistry: () => mockRegistry,
}));

vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    conversations: mockConversations,
    groupedHistory: { pinnedConversations: [], timelineSections: [] },
    isConversationGenerating: () => false,
    hasCompletionUnread: () => false,
    clearCompletionUnread: () => {},
    setActiveConversation: () => {},
  }),
}));

const mockGetAgentLogo = vi.fn(() => null);
vi.mock('@/renderer/utils/model/agentLogo', () => ({
  // getAgentLogo takes a string (backendType or id), not AgentIdentity
  getAgentLogo: (agentKey: string) => mockGetAgentLogo(agentKey),
}));

// resolveAgentId is used internally by the hook — use real implementation
// (no mock needed; it's pure logic tested separately in agentIdentity.test.ts)

import { useAgentProfile } from '@/renderer/pages/agent/hooks/useAgentProfile';

// --- Fixtures -------------------------------------------------------------- //

const makeIdentity = (id: string, overrides: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id,
  name: `Agent ${id}`,
  avatar: '🤖',
  employeeType: 'permanent',
  source: 'preset',
  ...overrides,
});

const makeConversation = (id: string, agentId: string, updatedAt: number, workspace?: string): TChatConversation =>
  ({
    id,
    name: `Conversation ${id}`,
    type: 'gemini',
    createTime: updatedAt - 500,
    modifyTime: updatedAt,
    updatedAt,
    extra: {
      agentId,
      ...(workspace ? { workspace } : {}),
    },
    model: { id: 'gemini', useModel: 'gemini-2.0-flash' },
  }) as unknown as TChatConversation;

// --- Tests ----------------------------------------------------------------- //

describe('useAgentProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.clear();
    mockConversations.length = 0;
  });

  describe('agent lookup from registry', () => {
    // UAP-001: Returns null when agent not found in registry
    it('UAP-001 (AC-2): returns null when agentId is not in the registry', () => {
      // Registry is empty — agent does not exist
      const { result } = renderHook(() => useAgentProfile('preset:nonexistent'));

      expect(result.current).toBeNull();
    });

    // UAP-002: Returns AgentProfileData when agent exists in registry
    it('UAP-002: returns AgentProfileData with identity when agentId is found in registry', () => {
      const identity = makeIdentity('preset:word-creator');
      mockRegistry.set('preset:word-creator', identity);

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      expect(result.current).not.toBeNull();
      expect(result.current?.identity).toEqual(identity);
    });

    // UAP-003: Passes agent key string to getAgentLogo (backendType ?? id)
    it('UAP-003: calls getAgentLogo with the agent key string (backendType ?? id)', () => {
      const identity = makeIdentity('custom:my-agent', { source: 'custom', backendType: 'claude' });
      mockRegistry.set('custom:my-agent', identity);

      renderHook(() => useAgentProfile('custom:my-agent'));

      // Implementation calls getAgentLogo(identity.backendType ?? identity.id)
      expect(mockGetAgentLogo).toHaveBeenCalledWith('claude');
    });

    // UAP-004: agentLogo from getAgentLogo is returned in result
    it('UAP-004: agentLogo in returned data matches getAgentLogo return value', () => {
      mockGetAgentLogo.mockReturnValue('/logo/my-agent.svg');
      const identity = makeIdentity('custom:logo-agent', { source: 'custom' });
      mockRegistry.set('custom:logo-agent', identity);

      const { result } = renderHook(() => useAgentProfile('custom:logo-agent'));

      expect(result.current?.agentLogo).toBe('/logo/my-agent.svg');
    });

    // UAP-005: Returns null agentLogo when getAgentLogo returns null
    it('UAP-005: agentLogo is null when getAgentLogo returns null', () => {
      mockGetAgentLogo.mockReturnValue(null);
      const identity = makeIdentity('preset:word-creator');
      mockRegistry.set('preset:word-creator', identity);

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      expect(result.current?.agentLogo).toBeNull();
    });
  });

  describe('conversation filtering by agentId', () => {
    // UAP-006: AC-13 — Returns only conversations matching the target agentId
    it('UAP-006 (AC-13): returns only conversations where resolveAgentId === agentId', () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      mockConversations.push(
        makeConversation('match-1', 'preset:word-creator', 3000),
        makeConversation('match-2', 'preset:word-creator', 2000),
        makeConversation('other-1', 'custom:other-agent', 1000)
      );

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      const ids = result.current?.conversations.map((c) => c.id);
      expect(ids).toContain('match-1');
      expect(ids).toContain('match-2');
      expect(ids).not.toContain('other-1');
    });

    // UAP-007: AC-13 — Returns empty array when no conversations match
    it('UAP-007 (AC-13): returns empty conversations array when none match agentId', () => {
      mockRegistry.set('preset:lonely-agent', makeIdentity('preset:lonely-agent'));
      mockConversations.push(
        makeConversation('other-1', 'custom:other-agent', 1000),
        makeConversation('other-2', 'claude', 2000)
      );

      const { result } = renderHook(() => useAgentProfile('preset:lonely-agent'));

      expect(result.current?.conversations).toHaveLength(0);
    });

    // UAP-008: All conversations excluded when registry returns null
    it('UAP-008: returns null (not an empty list) when agent not in registry', () => {
      mockConversations.push(makeConversation('orphan-1', 'preset:gone', 1000));
      // Registry does NOT have 'preset:gone'

      const { result } = renderHook(() => useAgentProfile('preset:gone'));

      expect(result.current).toBeNull();
    });
  });

  describe('conversation sort order (newest first)', () => {
    // UAP-009: AC-14 — Conversations sorted by updatedAt descending
    it('UAP-009 (AC-14): conversations are sorted by updatedAt descending', () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      mockConversations.push(
        makeConversation('old', 'preset:word-creator', 1000),
        makeConversation('newest', 'preset:word-creator', 5000),
        makeConversation('middle', 'preset:word-creator', 3000)
      );

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      const ids = result.current?.conversations.map((c) => c.id);
      expect(ids).toEqual(['newest', 'middle', 'old']);
    });

    // UAP-010: AC-14 — Maintains sort order even when input is already sorted ascending
    it('UAP-010 (AC-14): sorts correctly even when input is in ascending order', () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      mockConversations.push(
        makeConversation('a', 'preset:word-creator', 1000),
        makeConversation('b', 'preset:word-creator', 2000),
        makeConversation('c', 'preset:word-creator', 3000)
      );

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      const ids = result.current?.conversations.map((c) => c.id);
      expect(ids).toEqual(['c', 'b', 'a']);
    });

    // UAP-011: AC-14 — Conversations with equal updatedAt maintain stable relative order
    it('UAP-011 (AC-14): handles conversations with equal updatedAt without throwing', () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      mockConversations.push(
        makeConversation('eq-1', 'preset:word-creator', 2000),
        makeConversation('eq-2', 'preset:word-creator', 2000)
      );

      expect(() => renderHook(() => useAgentProfile('preset:word-creator'))).not.toThrow();
    });

    // UAP-012: Edge case — single conversation is returned without crash
    it('UAP-012: handles single matching conversation correctly', () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      mockConversations.push(makeConversation('solo', 'preset:word-creator', 9999));

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      expect(result.current?.conversations).toHaveLength(1);
      expect(result.current?.conversations[0].id).toBe('solo');
    });
  });

  describe('workspace collection', () => {
    // UAP-013: Collects unique workspace paths from matching conversations
    it('UAP-013: workspaces contains unique paths from matching conversations', () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      mockConversations.push(
        makeConversation('c1', 'preset:word-creator', 3000, '/projects/app-a'),
        makeConversation('c2', 'preset:word-creator', 2000, '/projects/app-b'),
        makeConversation('c3', 'preset:word-creator', 1000, '/projects/app-a') // duplicate
      );

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      expect(result.current?.workspaces).toHaveLength(2);
      expect(result.current?.workspaces).toContain('/projects/app-a');
      expect(result.current?.workspaces).toContain('/projects/app-b');
    });

    // UAP-014: Workspaces excludes conversations from other agents
    it("UAP-014: workspaces does not include paths from other agents' conversations", () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      mockConversations.push(
        makeConversation('mine', 'preset:word-creator', 2000, '/my-workspace'),
        makeConversation('other', 'custom:other', 1000, '/their-workspace')
      );

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      expect(result.current?.workspaces).toContain('/my-workspace');
      expect(result.current?.workspaces).not.toContain('/their-workspace');
    });

    // UAP-015: Workspaces is empty when no conversations have workspace set
    it('UAP-015: workspaces is empty when no matching conversations have a workspace', () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      mockConversations.push(
        makeConversation('no-ws', 'preset:word-creator', 1000) // no workspace
      );

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      expect(result.current?.workspaces).toHaveLength(0);
    });

    // UAP-016: Workspaces is empty array when conversations list is empty
    it('UAP-016: workspaces is an empty array when agent has no conversations', () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      // No conversations pushed

      const { result } = renderHook(() => useAgentProfile('preset:word-creator'));

      expect(result.current?.workspaces).toEqual([]);
    });
  });

  describe('edge cases', () => {
    // UAP-017: Handles empty agentId string without throwing
    it('UAP-017: does not throw when agentId is an empty string', () => {
      expect(() => renderHook(() => useAgentProfile(''))).not.toThrow();
    });

    // UAP-018: Handles empty registry + empty conversations without throwing
    it('UAP-018: returns null without throwing when both registry and conversations are empty', () => {
      const { result } = renderHook(() => useAgentProfile('preset:anything'));

      expect(result.current).toBeNull();
    });

    // UAP-019: Handles conversations without updatedAt field (undefined) without throwing
    it('UAP-019: handles conversations where updatedAt is undefined without throwing', () => {
      mockRegistry.set('preset:word-creator', makeIdentity('preset:word-creator'));
      const noTimestamp = {
        ...makeConversation('no-ts', 'preset:word-creator', 0),
        updatedAt: undefined,
      } as unknown as TChatConversation;
      mockConversations.push(noTimestamp);

      expect(() => renderHook(() => useAgentProfile('preset:word-creator'))).not.toThrow();
    });

    // UAP-020: Result is memoized — same reference returned when inputs unchanged
    it('UAP-020: returns stable reference across re-renders when inputs are unchanged', () => {
      const identity = makeIdentity('preset:word-creator');
      mockRegistry.set('preset:word-creator', identity);
      mockConversations.push(makeConversation('c1', 'preset:word-creator', 1000));

      const { result, rerender } = renderHook(() => useAgentProfile('preset:word-creator'));
      const firstResult = result.current;

      rerender();
      const secondResult = result.current;

      // Memoized hook should return the same object reference
      expect(secondResult).toBe(firstResult);
    });
  });
});
