/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for AgentProfile page (S4: Agent Profile + DM Chat Entry)
 *
 * Written SPEC-FIRST against tech-design.md Acceptance Criteria.
 * Component lives at:
 *   src/renderer/pages/agent/index.tsx
 *
 * Covered ACs:
 *   AC-1  — Route renders at /agent/:agentId without errors
 *   AC-2  — Navigating to unknown agentId shows "Agent not found" empty state
 *   AC-3  — Back button calls navigate(-1)
 *   AC-4  — Header displays agent avatar (emoji | logo img | letter fallback)
 *   AC-5  — Header shows agent name as primary heading
 *   AC-6  — Tag badge shows "Permanent" (green) or "Temporary" (gray)
 *   AC-7  — Second Tag badge shows source (Preset / Custom / CLI Agent / Dispatch Teammate)
 *   AC-8  — "Start new conversation" Button navigates to /guid with state.prefillAgentId
 *   AC-9  — "Edit config" button visible for permanent agents
 *   AC-10 — "Edit config" button hidden for temporary agents
 *   AC-11 — Config section displays backend type, description, workspaces
 *   AC-12 — Edit config routes correctly per agent source (custom→/settings/agent, preset→/settings/assistants)
 *   AC-13 — Conversation list shows only conversations matching agentId
 *   AC-14 — Conversations are sorted by updatedAt descending
 *   AC-15 — Each row shows title, relative time, workspace path
 *   AC-16 — Clicking a conversation row navigates to /conversation/:id
 *   AC-17 — Empty state message shown when no conversations exist
 *   AC-24 — All user-facing strings use i18n keys (no hardcoded text)
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ----------------------------------------------------------------- //

const mockNavigate = vi.fn();
const mockUseParams = vi.fn(() => ({ agentId: 'preset%3Aword-creator' }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && Object.keys(params).length > 0) {
        const paramStr = Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(',');
        return `${key}(${paramStr})`;
      }
      return key;
    },
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@icon-park/react', () => ({
  Left: (props: Record<string, unknown>) => <span data-testid='icon-left' {...props} />,
  Edit: (props: Record<string, unknown>) => <span data-testid='icon-edit' {...props} />,
  MessageOne: (props: Record<string, unknown>) => <span data-testid='icon-message' {...props} />,
  User: (props: Record<string, unknown>) => <span data-testid='icon-user' {...props} />,
  Time: (props: Record<string, unknown>) => <span data-testid='icon-time' {...props} />,
  FolderOpen: (props: Record<string, unknown>) => <span data-testid='icon-folder' {...props} />,
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Button: ({
      children,
      onClick,
      type: _type,
      ...rest
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      type?: string;
    } & Record<string, unknown>) => (
      <button onClick={onClick} {...rest}>
        {children}
      </button>
    ),
    Tag: ({ children, color }: { children: React.ReactNode; color?: string }) => (
      <span data-testid='tag' data-color={color}>
        {children}
      </span>
    ),
    Empty: ({ description }: { description?: React.ReactNode }) => <div data-testid='empty-state'>{description}</div>,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Descriptions: ({ data }: { data?: Array<{ label: React.ReactNode; value: React.ReactNode }> }) => (
      <div data-testid='descriptions'>
        {data?.map((item, idx) => (
          <div key={idx} data-testid='description-item'>
            <span data-testid='description-label'>{item.label}</span>
            <span data-testid='description-value'>{item.value}</span>
          </div>
        ))}
      </div>
    ),
  };
});

// Mock useAgentProfile hook
const mockUseAgentProfile = vi.fn();
vi.mock('@/renderer/pages/agent/hooks/useAgentProfile', () => ({
  useAgentProfile: (agentId: string) => mockUseAgentProfile(agentId),
}));

// CSS Module mock
vi.mock('@/renderer/pages/agent/index.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock('@/renderer/pages/agent/components/AgentProfileHeader.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock('@/renderer/pages/agent/components/AgentConfigSection.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock('@/renderer/pages/agent/components/AgentConversationList.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import type { AgentProfileData } from '@/renderer/pages/agent/types';
import type { TChatConversation } from '@/common/config/storage';
import AgentProfilePage from '@/renderer/pages/agent';

// --- Fixtures -------------------------------------------------------------- //

const makeIdentity = (overrides: Partial<AgentProfileData['identity']> = {}): AgentProfileData['identity'] => ({
  id: 'preset:word-creator',
  name: 'Word Creator',
  avatar: '📝',
  employeeType: 'permanent',
  source: 'preset',
  backendType: 'gemini',
  description: 'A helpful writing assistant',
  ...overrides,
});

const makeConversation = (
  id: string,
  updatedAt: number,
  overrides: Partial<TChatConversation> = {}
): TChatConversation =>
  ({
    id,
    name: `Conversation ${id}`,
    type: 'gemini',
    createTime: updatedAt - 1000,
    modifyTime: updatedAt,
    updatedAt,
    extra: { agentId: 'preset:word-creator', workspace: `/projects/${id}` },
    model: { id: 'gemini', useModel: 'gemini-2.0-flash' },
    ...overrides,
  }) as unknown as TChatConversation;

const makeProfileData = (overrides: Partial<AgentProfileData> = {}): AgentProfileData => ({
  identity: makeIdentity(),
  conversations: [makeConversation('conv-2', 2000), makeConversation('conv-1', 1000)],
  agentLogo: null,
  workspaces: ['/projects/conv-2', '/projects/conv-1'],
  ...overrides,
});

// --- Tests ----------------------------------------------------------------- //

describe('AgentProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ agentId: 'preset%3Aword-creator' });
    mockUseAgentProfile.mockReturnValue(makeProfileData());
  });

  // AP-001: AC-1 — Route renders without errors
  it('AP-001 (AC-1): renders without throwing for a known agentId', () => {
    expect(() => render(<AgentProfilePage />)).not.toThrow();
  });

  // AP-002: AC-2 — Unknown agentId shows "Agent not found" empty state
  it('AP-002 (AC-2): shows agent-not-found empty state when useAgentProfile returns null', () => {
    mockUseAgentProfile.mockReturnValue(null);
    render(<AgentProfilePage />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    // i18n mock returns key — hardcoded "Agent not found" would fail this assertion
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.profile.notFound');
  });

  // AP-003: AC-2 — Not-found state still has a back button
  it('AP-003 (AC-2): not-found empty state includes a back button', () => {
    mockUseAgentProfile.mockReturnValue(null);
    render(<AgentProfilePage />);

    // A back navigation element should be present even in the not-found state
    const backBtn =
      screen.queryByTestId('back-button') ??
      screen.queryByRole('button', { name: /agent\.profile\.back/i }) ??
      screen.queryByTestId('icon-left')?.closest('button') ??
      screen.queryByTestId('icon-left')?.parentElement;

    expect(backBtn).not.toBeNull();
  });

  // AP-004: AC-3 — Back button calls navigate(-1)
  it('AP-004 (AC-3): clicking back button calls navigate(-1)', () => {
    render(<AgentProfilePage />);

    const backBtn =
      screen.queryByTestId('back-button') ??
      screen.queryByRole('button', { name: /agent\.profile\.back/i }) ??
      screen.queryByTestId('icon-left')?.closest('button') ??
      screen.queryByTestId('icon-left')?.closest('[role="button"]') ??
      screen.queryByTestId('icon-left')?.parentElement;

    expect(backBtn).not.toBeNull();
    fireEvent.click(backBtn!);

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  // AP-005: AC-5 — Agent name displayed as primary heading
  it('AP-005 (AC-5): agent name is displayed in the header', () => {
    render(<AgentProfilePage />);

    expect(screen.getByText('Word Creator')).toBeInTheDocument();
  });

  // AP-006: AC-4 — Avatar emoji shown for preset agents
  it('AP-006 (AC-4): emoji avatar is displayed for preset agents', () => {
    render(<AgentProfilePage />);

    expect(screen.getByText('📝')).toBeInTheDocument();
  });

  // AP-007: AC-4 — Logo <img> shown when agentLogo is a URL and no emoji avatar
  it('AP-007 (AC-4): logo image is rendered when agentLogo is provided and no emoji avatar', () => {
    mockUseAgentProfile.mockReturnValue(
      makeProfileData({
        identity: makeIdentity({ avatar: undefined }),
        agentLogo: '/assets/my-agent.svg',
      })
    );
    render(<AgentProfilePage />);

    const img = screen.queryByRole('img', { name: /word creator/i }) ?? screen.queryByAltText(/word creator/i);
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/assets/my-agent.svg');
  });

  // AP-008: AC-4 — Letter fallback shown when no emoji and no logo
  it('AP-008 (AC-4): letter fallback is rendered when no avatar and no logo', () => {
    mockUseAgentProfile.mockReturnValue(
      makeProfileData({
        identity: makeIdentity({ avatar: undefined }),
        agentLogo: null,
      })
    );
    render(<AgentProfilePage />);

    // The fallback is the first letter of the agent name
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  // AP-009: AC-6 — "Permanent" tag shown for permanent agents
  it('AP-009 (AC-6): "Permanent" i18n-keyed tag is shown for employeeType=permanent', () => {
    render(<AgentProfilePage />);

    const tags = screen.getAllByTestId('tag');
    const permanentTag = tags.find((t) => t.textContent?.includes('agent.profile.permanent'));
    expect(permanentTag).not.toBeUndefined();
    expect(permanentTag).toHaveAttribute('data-color', 'green');
  });

  // AP-010: AC-6 — "Temporary" tag shown for temporary agents
  it('AP-010 (AC-6): "Temporary" i18n-keyed tag is shown for employeeType=temporary', () => {
    mockUseAgentProfile.mockReturnValue(
      makeProfileData({
        identity: makeIdentity({ employeeType: 'temporary', source: 'cli_agent' }),
      })
    );
    render(<AgentProfilePage />);

    const tags = screen.getAllByTestId('tag');
    const tempTag = tags.find((t) => t.textContent?.includes('agent.profile.temporary'));
    expect(tempTag).not.toBeUndefined();
    expect(tempTag).toHaveAttribute('data-color', 'gray');
  });

  // AP-011: AC-7 — Source tag shows "Preset" for preset agents
  it('AP-011 (AC-7): source tag shows preset i18n key for source=preset', () => {
    render(<AgentProfilePage />);

    const tags = screen.getAllByTestId('tag');
    const sourceTag = tags.find(
      (t) =>
        t.textContent?.includes('agent.profile.sourcePreset') ||
        t.textContent?.includes('agent.profile.source.preset') ||
        t.textContent?.includes('Preset')
    );
    expect(sourceTag).not.toBeUndefined();
  });

  // AP-012: AC-7 — Source tag shows "Custom" for custom agents
  it('AP-012 (AC-7): source tag shows custom i18n key for source=custom', () => {
    mockUseAgentProfile.mockReturnValue(
      makeProfileData({
        identity: makeIdentity({ id: 'custom:abc123', source: 'custom', employeeType: 'permanent' }),
      })
    );
    render(<AgentProfilePage />);

    const tags = screen.getAllByTestId('tag');
    const sourceTag = tags.find(
      (t) =>
        t.textContent?.includes('agent.profile.sourceCustom') ||
        t.textContent?.includes('agent.profile.source.custom') ||
        t.textContent?.includes('Custom')
    );
    expect(sourceTag).not.toBeUndefined();
  });

  // AP-013: AC-8 — "Start new conversation" button is present
  it('AP-013 (AC-8): "Start new conversation" button is rendered', () => {
    render(<AgentProfilePage />);

    const btn =
      screen.queryByRole('button', { name: /agent\.profile\.startConversation/i }) ??
      screen.queryByTestId('start-conversation-btn');
    expect(btn).not.toBeNull();
  });

  // AP-014: AC-8 — "Start new conversation" navigates to /guid with prefillAgentId state
  it('AP-014 (AC-8): clicking "Start new conversation" navigates to /guid with prefillAgentId', () => {
    render(<AgentProfilePage />);

    const btn =
      screen.queryByRole('button', { name: /agent\.profile\.startConversation/i }) ??
      screen.queryByTestId('start-conversation-btn');
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/guid',
      expect.objectContaining({ state: expect.objectContaining({ prefillAgentId: 'preset:word-creator' }) })
    );
  });

  // AP-015: AC-9 — "Edit config" button visible for permanent agents
  it('AP-015 (AC-9): "Edit config" button is visible for employeeType=permanent', () => {
    render(<AgentProfilePage />);

    const editBtn =
      screen.queryByRole('button', { name: /agent\.profile\.editConfig/i }) ?? screen.queryByTestId('edit-config-btn');
    expect(editBtn).not.toBeNull();
  });

  // AP-016: AC-10 — "Edit config" button hidden for temporary agents
  it('AP-016 (AC-10): "Edit config" button is NOT rendered for employeeType=temporary', () => {
    mockUseAgentProfile.mockReturnValue(
      makeProfileData({
        identity: makeIdentity({ employeeType: 'temporary', source: 'cli_agent' }),
      })
    );
    render(<AgentProfilePage />);

    expect(screen.queryByRole('button', { name: /agent\.profile\.editConfig/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-config-btn')).not.toBeInTheDocument();
  });

  // AP-017: AC-11 — Config section displays backend type
  it('AP-017 (AC-11): config section displays backend type', () => {
    render(<AgentProfilePage />);

    // With i18n mock, the label key should be present, and the value "gemini" should appear
    const descriptions = screen.getByTestId('descriptions');
    expect(descriptions).toHaveTextContent('gemini');
  });

  // AP-018: AC-11 — Config section displays description when present
  it('AP-018 (AC-11): config section displays agent description when provided', () => {
    render(<AgentProfilePage />);

    expect(screen.getByTestId('descriptions')).toHaveTextContent('A helpful writing assistant');
  });

  // AP-019: AC-11 — Config section displays workspace paths
  it('AP-019 (AC-11): config section displays associated workspace paths', () => {
    render(<AgentProfilePage />);

    const descriptions = screen.getByTestId('descriptions');
    expect(descriptions).toHaveTextContent('/projects/conv-2');
  });

  // AP-020: AC-12 — Edit config for custom:* agents navigates to /settings/agent
  it('AP-020 (AC-12): Edit config for custom agent navigates to /settings/agent', () => {
    mockUseAgentProfile.mockReturnValue(
      makeProfileData({
        identity: makeIdentity({ id: 'custom:abc123', source: 'custom', employeeType: 'permanent' }),
      })
    );
    render(<AgentProfilePage />);

    const editBtn =
      screen.queryByRole('button', { name: /agent\.profile\.editConfig/i }) ?? screen.queryByTestId('edit-config-btn');
    expect(editBtn).not.toBeNull();
    fireEvent.click(editBtn!);

    expect(mockNavigate).toHaveBeenCalledWith('/settings/agent');
  });

  // AP-021: AC-12 — Edit config for preset:* agents navigates to /settings/assistants
  it('AP-021 (AC-12): Edit config for preset agent navigates to /settings/assistants', () => {
    render(<AgentProfilePage />);

    const editBtn =
      screen.queryByRole('button', { name: /agent\.profile\.editConfig/i }) ?? screen.queryByTestId('edit-config-btn');
    expect(editBtn).not.toBeNull();
    fireEvent.click(editBtn!);

    expect(mockNavigate).toHaveBeenCalledWith('/settings/assistants');
  });

  // AP-022: AC-13 — Conversation list shows matching conversations
  it('AP-022 (AC-13): conversation list renders all matching conversations', () => {
    render(<AgentProfilePage />);

    expect(screen.getByText('Conversation conv-2')).toBeInTheDocument();
    expect(screen.getByText('Conversation conv-1')).toBeInTheDocument();
  });

  // AP-023: AC-14 — Conversations sorted by updatedAt descending
  it('AP-023 (AC-14): most recent conversation appears before older conversations', () => {
    render(<AgentProfilePage />);

    const convItems = screen.getAllByText(/^Conversation conv-/);
    // conv-2 has updatedAt=2000 (newer), conv-1 has updatedAt=1000 (older)
    const positions = convItems.map((el) => el.textContent!);
    const conv2Pos = positions.indexOf('Conversation conv-2');
    const conv1Pos = positions.indexOf('Conversation conv-1');
    expect(conv2Pos).toBeLessThan(conv1Pos);
  });

  // AP-024: AC-16 — Clicking a conversation row navigates to /conversation/:id
  it('AP-024 (AC-16): clicking a conversation row navigates to /conversation/:id', () => {
    render(<AgentProfilePage />);

    const convRow =
      screen.queryByTestId('conversation-row-conv-2') ??
      screen.getByText('Conversation conv-2').closest('[role="button"]') ??
      screen.getByText('Conversation conv-2').closest('li') ??
      screen.getByText('Conversation conv-2').parentElement;

    expect(convRow).not.toBeNull();
    fireEvent.click(convRow!);

    expect(mockNavigate).toHaveBeenCalledWith('/conversation/conv-2');
  });

  // AP-025: AC-17 — Empty state shown when no conversations exist
  it('AP-025 (AC-17): empty-state message shown when agent has no conversations', () => {
    mockUseAgentProfile.mockReturnValue(makeProfileData({ conversations: [], workspaces: [] }));
    render(<AgentProfilePage />);

    const emptyMsg =
      screen.queryByTestId('conversation-empty-state') ?? screen.queryByText('agent.profile.noConversations');
    expect(emptyMsg).not.toBeNull();
  });

  // AP-026: AC-24 — No hardcoded English for "Permanent"
  it('AP-026 (AC-24): "Permanent" label is not hardcoded English', () => {
    render(<AgentProfilePage />);

    expect(screen.queryByText('Permanent')).not.toBeInTheDocument();
  });

  // AP-027: AC-24 — No hardcoded English for "Temporary"
  it('AP-027 (AC-24): "Temporary" label is not hardcoded English', () => {
    mockUseAgentProfile.mockReturnValue(
      makeProfileData({
        identity: makeIdentity({ employeeType: 'temporary', source: 'cli_agent' }),
      })
    );
    render(<AgentProfilePage />);

    expect(screen.queryByText('Temporary')).not.toBeInTheDocument();
  });

  // AP-028: AC-24 — No hardcoded "Edit configuration" English string
  it('AP-028 (AC-24): "Edit configuration" uses i18n key, not hardcoded English', () => {
    render(<AgentProfilePage />);

    expect(screen.queryByText('Edit configuration')).not.toBeInTheDocument();
  });

  // AP-029: AC-24 — No hardcoded "Start new conversation" English string
  it('AP-029 (AC-24): "Start new conversation" uses i18n key, not hardcoded English', () => {
    render(<AgentProfilePage />);

    expect(screen.queryByText('Start new conversation')).not.toBeInTheDocument();
  });

  // AP-030: AC-24 — No hardcoded "Configuration" section title
  it('AP-030 (AC-24): "Configuration" section title uses i18n key', () => {
    render(<AgentProfilePage />);

    expect(screen.queryByText('Configuration')).not.toBeInTheDocument();
  });

  // AP-031: AC-24 — No hardcoded "Agent not found" English string
  it('AP-031 (AC-24): "Agent not found" uses i18n key, not hardcoded English', () => {
    mockUseAgentProfile.mockReturnValue(null);
    render(<AgentProfilePage />);

    expect(screen.queryByText('Agent not found')).not.toBeInTheDocument();
  });

  // AP-032: Failure path — useAgentProfile is called with decoded agentId
  it('AP-032: useAgentProfile is called with the URL-decoded agentId', () => {
    // Route param is 'preset%3Aword-creator' (encoded colon)
    mockUseParams.mockReturnValue({ agentId: 'preset%3Aword-creator' });
    render(<AgentProfilePage />);

    // Hook must receive the decoded form: 'preset:word-creator'
    expect(mockUseAgentProfile).toHaveBeenCalledWith('preset:word-creator');
  });

  // AP-033: Failure path — navigate not called on initial render
  it('AP-033: navigate is not called on initial render', () => {
    render(<AgentProfilePage />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // AP-034: AC-15 — Conversation row shows workspace path
  it('AP-034 (AC-15): conversation row displays the workspace path when available', () => {
    render(<AgentProfilePage />);

    // Each conversation has workspace: '/projects/conv-2'
    expect(screen.getByText('/projects/conv-2')).toBeInTheDocument();
  });

  // AP-035: Failure path — page renders without crash when description is absent
  it('AP-035: renders without error when identity.description is undefined', () => {
    mockUseAgentProfile.mockReturnValue(
      makeProfileData({
        identity: makeIdentity({ description: undefined }),
      })
    );
    expect(() => render(<AgentProfilePage />)).not.toThrow();
  });

  // AP-036: Failure path — page renders without crash when workspaces is empty
  it('AP-036: renders without error when workspaces array is empty', () => {
    mockUseAgentProfile.mockReturnValue(makeProfileData({ workspaces: [] }));
    expect(() => render(<AgentProfilePage />)).not.toThrow();
  });
});
