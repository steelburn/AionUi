/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for AgentProfileDrawer component (S4: Agent Profile Sider)
 *
 * Written SPEC-FIRST against tech-design.md Acceptance Criteria.
 * Component lives at:
 *   src/renderer/pages/conversation/components/AgentProfileDrawer/index.tsx
 *
 * Covered ACs:
 *   AC-1  — Clicking agent name opens right-side Drawer panel
 *   AC-3  — General agents: avatar, name, "Start New Conversation" button, group chat list
 *   AC-4  — Assistants: avatar, name, button, Rule, Skills, mounted agents, group chat list
 *   AC-5  — "Start New Conversation" navigates with agent pre-selected
 *   AC-6  — Clicking group chat navigates to dispatch conversation
 *   AC-8  — Skills section shows skill names as tags
 *   AC-10 — Drawer closes on Escape / close button
 *   AC-11 — All user-facing text uses i18n keys
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ----------------------------------------------------------------- //

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params?.count !== undefined) return `${key}:${params.count}`;
      return key;
    },
    i18n: { language: 'en-US' },
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@icon-park/react', () => ({
  Close: (props: Record<string, unknown>) => <span data-testid='icon-close' {...props} />,
  Right: (props: Record<string, unknown>) => <span data-testid='icon-right' {...props} />,
  Plus: (props: Record<string, unknown>) => <span data-testid='icon-plus' {...props} />,
  AddOne: (props: Record<string, unknown>) => <span data-testid='icon-add-one' {...props} />,
  People: (props: Record<string, unknown>) => <span data-testid='icon-people' {...props} />,
  MessageOne: (props: Record<string, unknown>) => <span data-testid='icon-message' {...props} />,
  TagOne: (props: Record<string, unknown>) => <span data-testid='icon-tag' {...props} />,
  SettingTwo: (props: Record<string, unknown>) => <span data-testid='icon-setting' {...props} />,
  Down: (props: Record<string, unknown>) => <span data-testid='icon-down' {...props} />,
  Up: (props: Record<string, unknown>) => <span data-testid='icon-up' {...props} />,
}));

// Arco Drawer mock: renders children when visible, provides close button
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Drawer: ({
      visible,
      onCancel,
      children,
      title,
    }: {
      visible: boolean;
      onCancel?: () => void;
      children?: React.ReactNode;
      title?: React.ReactNode;
    }) =>
      visible ? (
        <div data-testid='agent-profile-drawer'>
          {title && <div data-testid='drawer-title'>{title}</div>}
          <button data-testid='drawer-close-btn' onClick={onCancel}>
            close
          </button>
          {children}
        </div>
      ) : null,
    Button: ({
      children,
      onClick,
      ...rest
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      [key: string]: unknown;
    }) => (
      <button data-testid={`arco-button`} onClick={onClick} {...rest}>
        {children}
      </button>
    ),
    Tag: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <span data-testid='arco-tag' {...rest}>
        {children}
      </span>
    ),
    Typography: actual.Typography,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Collapse: ({ children }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <div data-testid='arco-collapse'>{children}</div>
    ),
  };
});

// CSS Module mock
vi.mock('@/renderer/pages/conversation/components/AgentProfileDrawer/AgentProfileDrawer.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// --- Mock hook data -------------------------------------------------------- //

import type { AgentIdentity } from '@/renderer/utils/model/agentIdentity';
import type {
  AgentProfileDrawerData,
  GroupChatSummary,
} from '@/renderer/pages/conversation/components/AgentProfileDrawer/types';

const makeIdentity = (
  id: string,
  name: string,
  employeeType: 'permanent' | 'temporary',
  source: AgentIdentity['source'],
  avatar?: string
): AgentIdentity => ({
  id,
  name,
  employeeType,
  source,
  avatar,
});

const GENERAL_AGENT: AgentIdentity = makeIdentity('claude', 'Claude', 'temporary', 'cli_agent');

const ASSISTANT_AGENT: AgentIdentity = makeIdentity('preset:word-creator', 'Word Creator', 'permanent', 'preset', '📝');

const MOUNTED_AGENT: AgentIdentity = makeIdentity('gemini', 'Gemini', 'temporary', 'cli_agent');

const GROUP_CHATS: GroupChatSummary[] = [
  {
    conversationId: 'gc-001',
    name: 'Dev Team Chat',
    memberCount: 4,
    lastActivityAt: Date.now(),
  },
  {
    conversationId: 'gc-002',
    name: 'Code Review Group',
    memberCount: 3,
    lastActivityAt: Date.now() - 60000,
  },
];

const GENERAL_AGENT_DATA: AgentProfileDrawerData = {
  identity: GENERAL_AGENT,
  skills: [],
  mountedAgents: [],
  groupChats: GROUP_CHATS,
};

const ASSISTANT_AGENT_DATA: AgentProfileDrawerData = {
  identity: ASSISTANT_AGENT,
  rule: 'You are a writing assistant that helps create professional documents.',
  skills: ['Grammar Check', 'Tone Analysis', 'Document Formatting'],
  mountedAgents: [MOUNTED_AGENT],
  groupChats: GROUP_CHATS,
};

const GENERAL_AGENT_NO_GROUPS: AgentProfileDrawerData = {
  identity: GENERAL_AGENT,
  skills: [],
  mountedAgents: [],
  groupChats: [],
};

// Default: mock returns general agent data
// The actual hook returns AgentProfileDrawerData | null directly (not wrapped in { data, loading })
let mockDrawerData: AgentProfileDrawerData | null = GENERAL_AGENT_DATA;

vi.mock('@/renderer/pages/conversation/hooks/useAgentProfileDrawer', () => ({
  useAgentProfileDrawer: (_agentId: string) => mockDrawerData,
}));

// Mock useAgentRegistry in case the component imports it directly
vi.mock('@/renderer/hooks/useAgentRegistry', () => ({
  useAgentRegistry: () => ({
    agents: new Map([
      ['claude', GENERAL_AGENT],
      ['preset:word-creator', ASSISTANT_AGENT],
      ['gemini', MOUNTED_AGENT],
    ]),
    getAgent: (id: string) => {
      const map: Record<string, AgentIdentity> = {
        claude: GENERAL_AGENT,
        'preset:word-creator': ASSISTANT_AGENT,
        gemini: MOUNTED_AGENT,
      };
      return map[id];
    },
  }),
}));

import AgentProfileDrawer from '@/renderer/pages/conversation/components/AgentProfileDrawer/index';
import type { AgentProfileDrawerProps } from '@/renderer/pages/conversation/components/AgentProfileDrawer/types';

// --- Fixtures -------------------------------------------------------------- //

const defaultProps = (): AgentProfileDrawerProps => ({
  visible: true,
  agentId: 'claude',
  onClose: vi.fn(),
  onStartConversation: vi.fn(),
  onNavigateToGroupChat: vi.fn(),
});

// --- Helpers --------------------------------------------------------------- //

/** Find the "Start Conversation" button by its i18n key text content */
const findStartConversationBtn = () => {
  const buttons = screen.getAllByTestId('arco-button');
  return buttons.find((btn) => btn.textContent?.includes('agent.profile.startConversation'));
};

/** Find a group chat button by the chat name text */
const findGroupChatButton = (chatName: string) => {
  const el = screen.getByText(chatName);
  // Walk up until we find the button (data-testid="arco-button")
  let current: HTMLElement | null = el;
  while (current) {
    if (current.dataset?.testid === 'arco-button') return current;
    current = current.parentElement;
  }
  return null;
};

// --- Tests ----------------------------------------------------------------- //

describe('AgentProfileDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrawerData = GENERAL_AGENT_DATA;
  });

  // -- 1. Drawer Visibility --------------------------------------------------

  describe('Drawer Visibility', () => {
    // APD-001: Drawer is absent from DOM when visible=false
    it('APD-001: does not render when visible is false', () => {
      render(<AgentProfileDrawer {...defaultProps()} visible={false} />);

      expect(screen.queryByTestId('agent-profile-drawer')).not.toBeInTheDocument();
    });

    // APD-002: Drawer renders when visible=true
    it('APD-002: renders the drawer when visible is true', () => {
      render(<AgentProfileDrawer {...defaultProps()} />);

      expect(screen.getByTestId('agent-profile-drawer')).toBeInTheDocument();
    });

    // APD-003: Close button calls onClose
    it('APD-003: clicking the close button calls onClose', () => {
      const onClose = vi.fn();
      render(<AgentProfileDrawer {...defaultProps()} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('drawer-close-btn'));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // -- 2. General Agent View -------------------------------------------------

  describe('General Agent View', () => {
    beforeEach(() => {
      mockDrawerData = GENERAL_AGENT_DATA;
    });

    // APD-004: Shows agent name
    it('APD-004 (AC-3): displays the general agent name', () => {
      render(<AgentProfileDrawer {...defaultProps()} />);

      expect(screen.getByText('Claude')).toBeInTheDocument();
    });

    // APD-005: Shows "Start New Conversation" button
    it('APD-005 (AC-3): shows "Start New Conversation" button via i18n key', () => {
      render(<AgentProfileDrawer {...defaultProps()} />);

      const startBtn = findStartConversationBtn();
      expect(startBtn).toBeDefined();
    });

    // APD-006: Does NOT show Rule section (general agents are temporary, so AssistantDetail is not rendered)
    it('APD-006 (AC-3): does not render the Rule section for general agents', () => {
      render(<AgentProfileDrawer {...defaultProps()} />);

      expect(screen.queryByText('agent.drawer.ruleTitle')).not.toBeInTheDocument();
    });

    // APD-007: Does NOT show Skills section
    it('APD-007 (AC-3): does not render the Skills section for general agents', () => {
      render(<AgentProfileDrawer {...defaultProps()} />);

      expect(screen.queryByText('agent.drawer.skillsTitle')).not.toBeInTheDocument();
    });

    // APD-008: Does NOT show Mounted Agents section
    it('APD-008 (AC-3): does not render the Mounted Agents section for general agents', () => {
      render(<AgentProfileDrawer {...defaultProps()} />);

      expect(screen.queryByText('agent.drawer.mountedAgentsTitle')).not.toBeInTheDocument();
    });

    // APD-009: Shows Group Chat list section (even if empty)
    it('APD-009 (AC-3): renders the Group Chat list section', () => {
      render(<AgentProfileDrawer {...defaultProps()} />);

      expect(screen.getByText('agent.drawer.groupChatsTitle')).toBeInTheDocument();
    });

    // APD-010: Group Chat list section renders even when empty
    it('APD-010 (AC-3): renders Group Chat section even with no group chats', () => {
      mockDrawerData = GENERAL_AGENT_NO_GROUPS;
      render(<AgentProfileDrawer {...defaultProps()} />);

      expect(screen.getByText('agent.drawer.groupChatsTitle')).toBeInTheDocument();
    });

    // APD-011: Group chat items are rendered with their names
    it('APD-011 (AC-3): renders group chat items by name', () => {
      render(<AgentProfileDrawer {...defaultProps()} />);

      expect(screen.getByText('Dev Team Chat')).toBeInTheDocument();
      expect(screen.getByText('Code Review Group')).toBeInTheDocument();
    });
  });

  // -- 3. Assistant View -----------------------------------------------------

  describe('Assistant View', () => {
    beforeEach(() => {
      mockDrawerData = ASSISTANT_AGENT_DATA;
    });

    // APD-012: Shows assistant name
    it('APD-012 (AC-4): displays the assistant agent name', () => {
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      expect(screen.getByText('Word Creator')).toBeInTheDocument();
    });

    // APD-013: Shows avatar emoji
    it('APD-013 (AC-4): displays the assistant avatar emoji', () => {
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      expect(screen.getByText('📝')).toBeInTheDocument();
    });

    // APD-014: Shows "Start New Conversation" button
    it('APD-014 (AC-4): shows "Start New Conversation" button for assistants', () => {
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      const startBtn = findStartConversationBtn();
      expect(startBtn).toBeDefined();
    });

    // APD-015: Shows Rule section with read-only text (rule is in a collapsible section)
    it('APD-015 (AC-4, AC-7): renders the Rule section with rule text content', () => {
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      // Rule section header (collapsible button)
      expect(screen.getByText('agent.drawer.ruleTitle')).toBeInTheDocument();

      // Rule content is hidden until expanded — click the toggle button
      const ruleToggle = screen.getByText('agent.drawer.ruleTitle').closest('[data-testid="arco-button"]');
      expect(ruleToggle).not.toBeNull();
      fireEvent.click(ruleToggle!);

      // Rule text content is now visible
      expect(
        screen.getByText('You are a writing assistant that helps create professional documents.')
      ).toBeInTheDocument();
    });

    // APD-016: Shows Skills section with skill tags
    it('APD-016 (AC-4, AC-8): renders Skills section with skill name tags', () => {
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      // Skills section header
      expect(screen.getByText('agent.drawer.skillsTitle')).toBeInTheDocument();

      // Skill names rendered as tags
      expect(screen.getByText('Grammar Check')).toBeInTheDocument();
      expect(screen.getByText('Tone Analysis')).toBeInTheDocument();
      expect(screen.getByText('Document Formatting')).toBeInTheDocument();
    });

    // APD-017: Skill tags use Arco Tag component
    it('APD-017 (AC-8): skill names are rendered using Tag components', () => {
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      const tags = screen.getAllByTestId('arco-tag');
      // At least 3 tags for the 3 skills (there is also 1 tag for the employee type badge)
      expect(tags.length).toBeGreaterThanOrEqual(4);
    });

    // APD-018: Shows Mounted Agents section
    it('APD-018 (AC-4, AC-9): renders Mounted Agents section with agent names', () => {
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      // Mounted agents section header
      expect(screen.getByText('agent.drawer.mountedAgentsTitle')).toBeInTheDocument();

      // Mounted agent name
      expect(screen.getByText('Gemini')).toBeInTheDocument();
    });

    // APD-019: Shows Group Chat list section
    it('APD-019 (AC-4): renders the Group Chat list section for assistants', () => {
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      expect(screen.getByText('agent.drawer.groupChatsTitle')).toBeInTheDocument();
      expect(screen.getByText('Dev Team Chat')).toBeInTheDocument();
    });
  });

  // -- 4. Interactions -------------------------------------------------------

  describe('Interactions', () => {
    beforeEach(() => {
      mockDrawerData = GENERAL_AGENT_DATA;
    });

    // APD-020: "Start New Conversation" button calls onStartConversation with agentId
    it('APD-020 (AC-5): clicking "Start New Conversation" calls onStartConversation with agentId', () => {
      const onStartConversation = vi.fn();
      render(<AgentProfileDrawer {...defaultProps()} onStartConversation={onStartConversation} />);

      const startBtn = findStartConversationBtn();
      expect(startBtn).toBeDefined();
      fireEvent.click(startBtn!);

      expect(onStartConversation).toHaveBeenCalledTimes(1);
      expect(onStartConversation).toHaveBeenCalledWith('claude');
    });

    // APD-021: Clicking a group chat item calls onNavigateToGroupChat with conversationId
    it('APD-021 (AC-6): clicking a group chat item calls onNavigateToGroupChat with conversationId', () => {
      const onNavigateToGroupChat = vi.fn();
      render(<AgentProfileDrawer {...defaultProps()} onNavigateToGroupChat={onNavigateToGroupChat} />);

      // Find the button wrapping "Dev Team Chat"
      const groupChatBtn = findGroupChatButton('Dev Team Chat');
      expect(groupChatBtn).not.toBeNull();
      fireEvent.click(groupChatBtn!);

      expect(onNavigateToGroupChat).toHaveBeenCalledTimes(1);
      expect(onNavigateToGroupChat).toHaveBeenCalledWith('gc-001');
    });

    // APD-022: Close button calls onClose
    it('APD-022 (AC-10): close button calls onClose callback', () => {
      const onClose = vi.fn();
      render(<AgentProfileDrawer {...defaultProps()} onClose={onClose} />);

      fireEvent.click(screen.getByTestId('drawer-close-btn'));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // APD-023: Callbacks are NOT called on initial render
    it('APD-023: no callbacks are triggered on initial render', () => {
      const onClose = vi.fn();
      const onStartConversation = vi.fn();
      const onNavigateToGroupChat = vi.fn();
      render(
        <AgentProfileDrawer
          {...defaultProps()}
          onClose={onClose}
          onStartConversation={onStartConversation}
          onNavigateToGroupChat={onNavigateToGroupChat}
        />
      );

      expect(onClose).not.toHaveBeenCalled();
      expect(onStartConversation).not.toHaveBeenCalled();
      expect(onNavigateToGroupChat).not.toHaveBeenCalled();
    });

    // APD-024: Start conversation with assistant agent passes correct agentId
    it('APD-024 (AC-5): clicking "Start New Conversation" for an assistant passes the assistant agentId', () => {
      mockDrawerData = ASSISTANT_AGENT_DATA;
      const onStartConversation = vi.fn();
      render(
        <AgentProfileDrawer
          {...defaultProps()}
          agentId='preset:word-creator'
          onStartConversation={onStartConversation}
        />
      );

      const startBtn = findStartConversationBtn();
      expect(startBtn).toBeDefined();
      fireEvent.click(startBtn!);

      expect(onStartConversation).toHaveBeenCalledWith('preset:word-creator');
    });
  });

  // -- 5. Edge Cases ---------------------------------------------------------

  describe('Edge Cases', () => {
    // APD-025: Renders without crashing when agentId has no data
    it('APD-025: renders without error when drawer data has empty collections', () => {
      mockDrawerData = GENERAL_AGENT_NO_GROUPS;

      expect(() => render(<AgentProfileDrawer {...defaultProps()} />)).not.toThrow();
    });

    // APD-026: Assistant with no rule text does not crash
    it('APD-026: assistant with undefined rule does not crash', () => {
      mockDrawerData = {
        ...ASSISTANT_AGENT_DATA,
        rule: undefined,
      };

      expect(() => render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />)).not.toThrow();
    });

    // APD-027: Assistant with empty skills array renders Skills section without tags
    it('APD-027: assistant with empty skills array renders without skill tags', () => {
      mockDrawerData = {
        ...ASSISTANT_AGENT_DATA,
        skills: [],
      };
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      // Skills section header may still be present but no tag elements for skills
      expect(screen.queryByText('Grammar Check')).not.toBeInTheDocument();
    });

    // APD-028: Assistant with no mounted agents renders section without agent items
    it('APD-028: assistant with empty mountedAgents does not show agent names in that section', () => {
      mockDrawerData = {
        ...ASSISTANT_AGENT_DATA,
        mountedAgents: [],
      };
      render(<AgentProfileDrawer {...defaultProps()} agentId='preset:word-creator' />);

      expect(screen.queryByText('Gemini')).not.toBeInTheDocument();
    });

    // APD-029: i18n compliance — no hardcoded English strings
    it('APD-029 (AC-11): no hardcoded English strings like "Start New Conversation"', () => {
      render(<AgentProfileDrawer {...defaultProps()} />);

      expect(screen.queryByText('Start New Conversation')).not.toBeInTheDocument();
      expect(screen.queryByText('Group Chats')).not.toBeInTheDocument();
      expect(screen.queryByText('Rule')).not.toBeInTheDocument();
      expect(screen.queryByText('Skills')).not.toBeInTheDocument();
      expect(screen.queryByText('Mounted Agents')).not.toBeInTheDocument();
    });
  });
});
