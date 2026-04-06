import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';

const mockLayoutContext = {
  isMobile: false,
  siderCollapsed: false,
  setSiderCollapsed: vi.fn(),
};

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: vi.fn(),
  },
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  __esModule: true,
  default: ({ trailingAccessory }: { trailingAccessory?: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'agent-mode-selector' },
      React.createElement('div', { 'data-testid': 'agent-mode-selector-trigger' }),
      trailingAccessory
    ),
}));

vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => mockLayoutContext,
}));

vi.mock('@/renderer/hooks/ui/useResizableSplit', () => ({
  useResizableSplit: () => ({
    splitRatio: 20,
    setSplitRatio: vi.fn(),
    createDragHandle: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/components/ConversationTabs', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'conversation-tabs' }),
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout/AcpRuntimeStatusButton', () => ({
  __esModule: true,
  default: ({ embeddedInAgentPill }: { embeddedInAgentPill?: boolean }) =>
    React.createElement('div', {
      'data-testid': 'acp-runtime-status-button',
      'data-embedded-in-agent-pill': String(Boolean(embeddedInAgentPill)),
    }),
}));

vi.mock('@/renderer/pages/conversation/components/ChatTitleEditor', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'chat-title-editor' }),
}));

vi.mock('@/renderer/pages/conversation/components/ConversationTitleMinimap', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'conversation-title-minimap' }),
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout/MobileWorkspaceOverlay', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
  DesktopWorkspaceToggle: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({
    openTabs: [],
    updateTabName: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useContainerWidth', () => ({
  useContainerWidth: () => ({
    containerRef: { current: null },
    containerWidth: 1200,
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useLayoutConstraints', () => ({
  useLayoutConstraints: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/hooks/usePreviewAutoCollapse', () => ({
  usePreviewAutoCollapse: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/hooks/useTitleRename', () => ({
  useTitleRename: () => ({
    editingTitle: false,
    setEditingTitle: vi.fn(),
    titleDraft: '',
    setTitleDraft: vi.fn(),
    renameLoading: false,
    canRenameTitle: true,
    submitTitleRename: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useWorkspaceCollapse', () => ({
  useWorkspaceCollapse: () => ({
    rightSiderCollapsed: true,
    setRightSiderCollapsed: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  PreviewPanel: () => React.createElement('div'),
  usePreviewContext: () => ({
    isOpen: false,
  }),
}));

vi.mock('@/renderer/pages/conversation/utils/detectPlatform', () => ({
  isMacEnvironment: () => false,
  isWindowsEnvironment: () => false,
}));

vi.mock('@/renderer/pages/conversation/utils/layoutCalc', () => ({
  MIN_WORKSPACE_RATIO: 10,
  WORKSPACE_HEADER_HEIGHT: 44,
  calcLayoutMetrics: () => ({
    chatFlex: 1,
    workspaceFlex: 0,
    workspaceWidthPx: 0,
    titleAreaMaxWidth: 360,
    mobileWorkspaceHandleRight: 0,
    dynamicChatMinRatio: 20,
    dynamicChatMaxRatio: 80,
  }),
}));

vi.mock('@/renderer/utils/workspace/workspaceEvents', () => ({
  dispatchWorkspaceToggleEvent: vi.fn(),
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: null }),
}));

vi.mock('@arco-design/web-react', () => {
  const LayoutRoot = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children);
  return {
    Layout: Object.assign(LayoutRoot, {
      Header: ({ children, ...props }: { children?: React.ReactNode }) =>
        React.createElement('header', props, children),
      Content: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('main', props, children),
    }),
  };
});

describe('ChatLayout ACP runtime diagnostics entry', () => {
  beforeEach(() => {
    mockLayoutContext.isMobile = false;
  });

  it('renders the ACP runtime status button when diagnostics are enabled', () => {
    render(
      <ChatLayout
        title='Test'
        backend='codex'
        conversationId='conv-acp'
        showAcpRuntimeDiagnostics={true}
        sider={<div />}
      >
        <div>body</div>
      </ChatLayout>
    );

    expect(screen.getByTestId('acp-runtime-status-button')).toBeInTheDocument();
  });

  it('renders the ACP runtime status button inside the desktop agent pill', () => {
    render(
      <ChatLayout
        title='Test'
        backend='codex'
        conversationId='conv-acp'
        showAcpRuntimeDiagnostics={true}
        sider={<div />}
      >
        <div>body</div>
      </ChatLayout>
    );

    const agentModeSelector = screen.getByTestId('agent-mode-selector');
    const runtimeStatusButton = within(agentModeSelector).getByTestId('acp-runtime-status-button');

    expect(runtimeStatusButton).toHaveAttribute('data-embedded-in-agent-pill', 'true');
  });

  it('renders the ACP runtime status button when diagnostics are enabled without backend', () => {
    render(
      <ChatLayout
        title='Test'
        agentName='Preset ACP Agent'
        conversationId='conv-acp'
        showAcpRuntimeDiagnostics={true}
        sider={<div />}
      >
        <div>body</div>
      </ChatLayout>
    );

    expect(screen.getByTestId('acp-runtime-status-button')).toBeInTheDocument();
  });

  it('does not render the ACP runtime status button when diagnostics are disabled', () => {
    render(
      <ChatLayout title='Test' backend='codex' conversationId='conv-acp' sider={<div />}>
        <div>body</div>
      </ChatLayout>
    );

    expect(screen.queryByTestId('acp-runtime-status-button')).not.toBeInTheDocument();
  });

  it('keeps the ACP runtime status button available on mobile when diagnostics are enabled', () => {
    mockLayoutContext.isMobile = true;

    render(
      <ChatLayout
        title='Test'
        backend='codex'
        conversationId='conv-acp'
        showAcpRuntimeDiagnostics={true}
        sider={<div />}
      >
        <div>body</div>
      </ChatLayout>
    );

    expect(screen.getByTestId('acp-runtime-status-button')).toBeInTheDocument();
  });
});
