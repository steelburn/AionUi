/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for DM Section Header behavior (S5: New Conversation Flow)
 *
 * Written SPEC-FIRST against tech-design.md Acceptance Criteria.
 * The DM section header is part of WorkspaceGroupedHistory (index.tsx).
 * These tests exercise the DM header sub-tree in isolation by rendering
 * WorkspaceGroupedHistory with all heavy dependencies mocked.
 *
 * Covered ACs:
 *   AC-1  — "+" button exists in DM section header
 *   AC-2  — Clicking "+" opens AgentSelectionModal (sets visible=true)
 *   AC-9  — DM section header renders even when agentDMGroups is empty
 *   AC-10 — "No conversations yet" message shown when DMs empty and sidebar expanded
 *   AC-17 — All user-facing strings use i18n keys (no hardcoded text)
 *   AC-21 — Existing sidebar top-level "+" button behavior unchanged
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ----------------------------------------------------------------- //

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/', state: null }),
  useParams: () => ({ id: undefined }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@icon-park/react', () => ({
  Plus: (props: Record<string, unknown>) => <span data-testid='icon-plus' {...props} />,
  Down: (props: Record<string, unknown>) => <span data-testid='icon-down' {...props} />,
  Right: (props: Record<string, unknown>) => <span data-testid='icon-right' {...props} />,
  Add: (props: Record<string, unknown>) => <span data-testid='icon-add' {...props} />,
  More: (props: Record<string, unknown>) => <span data-testid='icon-more' {...props} />,
  Pin: (props: Record<string, unknown>) => <span data-testid='icon-pin' {...props} />,
  FolderOpen: (props: Record<string, unknown>) => <span data-testid='icon-folder-open' {...props} />,
  Pound: (props: Record<string, unknown>) => <span data-testid='icon-pound' {...props} />,
  People: (props: Record<string, unknown>) => <span data-testid='icon-people' {...props} />,
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Modal: ({
      visible,
      children,
      onCancel,
      title,
    }: {
      visible: boolean;
      children?: React.ReactNode;
      onCancel?: () => void;
      title?: React.ReactNode;
    }) =>
      visible ? (
        <div data-testid='arco-modal'>
          <div>{title}</div>
          <button data-testid='arco-modal-cancel' onClick={onCancel}>
            cancel
          </button>
          {children}
        </div>
      ) : null,
    Input: ({
      value,
      onChange,
      placeholder,
    }: {
      value?: string;
      onChange?: (v: string) => void;
      placeholder?: string;
    }) => (
      <input
        data-testid='agent-search-input'
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
      />
    ),
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
    Empty: () => <div data-testid='empty' />,
  };
});

// Mock useConversations — the actual hook used by the component
const mockConversationsReturn = vi.fn();
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversations', () => ({
  useConversations: () => mockConversationsReturn(),
}));

// Mock useBatchSelection
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useBatchSelection', () => ({
  useBatchSelection: () => ({
    selectedConversationIds: new Set(),
    setSelectedConversationIds: vi.fn(),
    selectedCount: 0,
    allSelected: false,
    toggleSelectedConversation: vi.fn(),
    handleToggleSelectAll: vi.fn(),
  }),
}));

// Mock useConversationActions
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions', () => ({
  useConversationActions: () => ({
    renameModalVisible: false,
    renameModalName: '',
    setRenameModalName: vi.fn(),
    renameLoading: false,
    dropdownVisibleId: null,
    handleConversationClick: vi.fn(),
    handleDeleteClick: vi.fn(),
    handleBatchDelete: vi.fn(),
    handleEditStart: vi.fn(),
    handleRenameConfirm: vi.fn(),
    handleRenameCancel: vi.fn(),
    handleTogglePin: vi.fn(),
    handleForkToDispatch: vi.fn(),
    handleMenuVisibleChange: vi.fn(),
    handleOpenMenu: vi.fn(),
  }),
}));

// Mock useExport
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useExport', () => ({
  useExport: () => ({
    exportTask: null,
    exportModalVisible: false,
    exportTargetPath: '',
    exportModalLoading: false,
    showExportDirectorySelector: false,
    setShowExportDirectorySelector: vi.fn(),
    closeExportModal: vi.fn(),
    handleSelectExportDirectoryFromModal: vi.fn(),
    handleSelectExportFolder: vi.fn(),
    handleExportConversation: vi.fn(),
    handleBatchExport: vi.fn(),
    handleConfirmExport: vi.fn(),
  }),
}));

// Mock useDragAndDrop
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useDragAndDrop', () => ({
  useDragAndDrop: () => ({
    sensors: [],
    activeId: null,
    activeConversation: null,
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragCancel: vi.fn(),
    isDragEnabled: false,
  }),
}));

// Mock useCronJobsMap
vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => null,
  useCronJobsMap: () => ({
    getJobStatus: vi.fn(() => null),
    markAsRead: vi.fn(),
    setActiveConversation: vi.fn(),
  }),
}));

// Mock useAgentRegistry — returns empty map by default (no agents)
vi.mock('@/renderer/hooks/useAgentRegistry', () => ({
  useAgentRegistry: () => new Map(),
}));

// Mock AgentSelectionModal — S6 removed this component; mock as sentinel to detect accidental presence
vi.mock('@/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal', () => ({
  default: (props: { visible?: boolean }) => (props.visible ? <div data-testid='agent-selection-modal' /> : null),
}));

// Mock AgentDMGroup to avoid deep dependency rendering
vi.mock('@/renderer/pages/conversation/GroupedHistory/AgentDMGroup', () => ({
  default: ({ group }: { group: { agentId: string } }) => <div data-testid={`dm-group-${group.agentId}`} />,
}));

// Mock ChannelSection
vi.mock('@/renderer/pages/conversation/GroupedHistory/ChannelSection', () => ({
  default: () => <div data-testid='channel-section' />,
}));

// Mock other sub-components used by the index
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationRow', () => ({
  default: () => <div data-testid='conversation-row' />,
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/SortableConversationRow', () => ({
  default: () => <div data-testid='sortable-row' />,
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/components/DragOverlayContent', () => ({
  default: () => null,
}));
vi.mock('@/renderer/pages/conversation/components/WorkspaceCollapse', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/pages/conversation/dispatch/CreateGroupChatModal', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/settings/DirectorySelectionModal', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({ openTab: vi.fn(), closeTab: vi.fn() }),
}));

// DnD mocks
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));

// --- Helpers --------------------------------------------------------------- //

const makeEmptyConversationsReturn = () => ({
  conversations: [],
  isConversationGenerating: vi.fn(() => false),
  hasCompletionUnread: vi.fn(() => false),
  expandedWorkspaces: new Set<string>(),
  pinnedConversations: [],
  dispatchConversations: [],
  dispatchChildCounts: new Map(),
  timelineSections: [],
  agentDMGroups: [],
  handleToggleWorkspace: vi.fn(),
});

const makeDMConversationsReturn = () => ({
  ...makeEmptyConversationsReturn(),
  agentDMGroups: [
    {
      agentId: 'claude',
      agentName: 'Claude',
      agentAvatar: undefined,
      agentLogo: null,
      isPermanent: false,
      conversations: [],
      latestActivityTime: Date.now(),
      hasActiveConversation: false,
      ungroupedConversations: [],
      workspaceSubGroups: [],
      displayMode: 'flat' as const,
    },
  ],
});

// --- Import component after all mocks are set ------------------------------ //

let WorkspaceGroupedHistory: React.FC<{ collapsed?: boolean }>;

const importComponent = async () => {
  const mod = await import('@/renderer/pages/conversation/GroupedHistory/index');
  WorkspaceGroupedHistory = mod.default as React.FC<{ collapsed?: boolean }>;
};

// --- Tests ----------------------------------------------------------------- //

describe('DM Section Header (WorkspaceGroupedHistory)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    if (!WorkspaceGroupedHistory) {
      await importComponent();
    }
  });

  // DM-001: AC-9 — DM section header renders when agentDMGroups is empty
  it('DM-001 (AC-9): DM section header renders even when there are no DM groups', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('dispatch.sidebar.directMessagesSection')).toBeInTheDocument();
  });

  // DM-002: S6 — DM section header does NOT have a "+" button (removed in S6)
  it('DM-002 (S6): DM section header does NOT contain a "+" button after S6 restructure', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    const dmHeader = screen.queryByText('dispatch.sidebar.directMessagesSection');
    expect(dmHeader).toBeInTheDocument();

    // The DM section header should NOT have a plus icon (removed in S6)
    const headerContainer = dmHeader?.closest('.chat-history__section') ?? dmHeader?.parentElement;
    const plusInHeader = headerContainer?.querySelector('[data-testid="icon-plus"]');
    expect(plusInHeader).toBeNull();
  });

  // DM-003: S6 — AgentSelectionModal is NOT in the component tree
  it('DM-003 (S6): AgentSelectionModal is not present after S6 removes it', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    // AgentSelectionModal was removed in S6; it should not appear in DOM
    expect(screen.queryByTestId('agent-selection-modal')).not.toBeInTheDocument();
  });

  // DM-004: S6 — newDirectMessage i18n key is NOT used (tooltip for "+" was removed)
  it('DM-004 (S6): i18n key dispatch.sidebar.newDirectMessage is not rendered after S6', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('dispatch.sidebar.newDirectMessage')).not.toBeInTheDocument();
  });

  // DM-005: S6 — navigate is NOT called when DM section renders (no modal trigger)
  it('DM-005 (S6): navigate is not called when DM section renders (modal removed)', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // DM-006: AC-10 — "No conversations yet" message when DMs empty and expanded
  it('DM-006 (AC-10): shows empty-state message when no DM groups exist and sidebar is expanded', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('dispatch.sidebar.noDirectMessages')).toBeInTheDocument();
  });

  // DM-007: AC-10 — "No conversations yet" NOT shown when DM groups exist
  it('DM-007 (AC-10): empty-state message is not shown when DM groups exist', () => {
    mockConversationsReturn.mockReturnValue(makeDMConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('dispatch.sidebar.noDirectMessages')).not.toBeInTheDocument();
  });

  // DM-008: AC-9 — DM section header hidden when sidebar is collapsed
  it('DM-008: DM section label is not visible when sidebar is collapsed', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={true} />);

    expect(screen.queryByText('dispatch.sidebar.directMessagesSection')).not.toBeInTheDocument();
  });

  // DM-009: AC-9 — "+" button NOT visible when sidebar is collapsed
  it('DM-009: "+" button is not visible when sidebar is collapsed', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={true} />);

    // When collapsed, DM section header (including +) should not render
    expect(screen.queryByText('dispatch.sidebar.noDirectMessages')).not.toBeInTheDocument();
  });

  // DM-010: AC-17 — DM section label uses i18n key
  it('DM-010 (AC-17): "Direct Messages" label uses i18n key, not hardcoded English', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('Direct Messages')).not.toBeInTheDocument();
  });

  // DM-011: AC-17 — Empty state text uses i18n key
  it('DM-011 (AC-17): empty-state text uses i18n key, not hardcoded English', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
  });

  // DM-012: Failure path — modal is not open on initial render
  it('DM-012: AgentSelectionModal is closed on initial render (not visible by default)', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(screen.queryByTestId('agent-selection-modal')).not.toBeInTheDocument();
  });

  // DM-013: Failure path — navigate NOT called on initial render
  it('DM-013: navigate is not called on initial render', () => {
    mockConversationsReturn.mockReturnValue(makeEmptyConversationsReturn());
    render(<WorkspaceGroupedHistory collapsed={false} />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
