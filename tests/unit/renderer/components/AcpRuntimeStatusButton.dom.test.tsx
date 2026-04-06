import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AcpRuntimeStatusButton from '@/renderer/pages/conversation/components/ChatLayout/AcpRuntimeStatusButton';
import {
  clearAcpRuntimeDiagnosticsSnapshot,
  publishAcpRuntimeDiagnosticsSnapshot,
  setAcpRuntimeUiWarmupPending,
  type AcpLogEntry,
} from '@/renderer/pages/conversation/platforms/acp/acpRuntimeDiagnostics';

const CONVERSATION_ID = 'conv-acp-runtime-status';

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  }) => React.createElement('button', { ...props, onClick }, children),
  Popover: ({
    children,
    content,
    popupVisible,
    onVisibleChange,
  }: {
    children: React.ReactNode;
    content: React.ReactNode;
    popupVisible?: boolean;
    onVisibleChange?: (visible: boolean) => void;
  }) =>
    React.createElement(
      'div',
      {},
      React.createElement('div', { onClick: () => onVisibleChange?.(!popupVisible) }, children),
      popupVisible ? React.createElement('div', { 'data-testid': 'mock-popover-content' }, content) : null
    ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
  Space: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('div', props, children),
  Tag: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('span', props, children),
  Typography: {
    Text: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('span', props, children),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      switch (key) {
        case 'acp.logs.title':
          return 'ACP Logs';
        case 'acp.logs.requestFinished':
          return `${options?.backend} -> ${options?.model} finished in ${options?.duration}ms`;
        case 'acp.logs.disconnectReason':
          return `code: ${options?.code}, signal: ${options?.signal}`;
        case 'acp.status.disconnected':
          return `${options?.agent} disconnected`;
        case 'acp.status.session_active':
          return `Active session with ${options?.agent}`;
        case 'acp.status.unknown':
          return 'Unknown status';
        case 'conversation.chat.processing':
          return 'Processing';
        case 'common.show':
          return 'Show';
        case 'common.hide':
          return 'Hide';
        default:
          return key;
      }
    },
  }),
}));

const createEntry = (overrides: Partial<AcpLogEntry>): AcpLogEntry => ({
  id: `entry-${Math.random().toString(36).slice(2)}`,
  kind: 'request_finished',
  level: 'success',
  timestamp: Date.now(),
  source: 'live',
  backend: 'codex',
  modelId: 'gpt-5.4',
  durationMs: 800,
  ...overrides,
});

describe('AcpRuntimeStatusButton', () => {
  beforeEach(() => {
    clearAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID);
  });

  it('opens a fallback diagnostics card when no ACP logs exist yet', () => {
    render(<AcpRuntimeStatusButton conversationId={CONVERSATION_ID} backend='codex' agentName='Codex' />);

    expect(screen.getByTestId('acp-runtime-status-button')).toHaveAttribute('aria-label', 'Unknown status');

    fireEvent.click(screen.getByTestId('acp-runtime-status-button'));

    const popover = screen.getByTestId('mock-popover-content');
    expect(within(popover).getByText('ACP Logs')).toBeInTheDocument();
    expect(within(popover).getByText('Unknown status')).toBeInTheDocument();
  });

  it('shows persisted ACP logs through the header diagnostics entry', () => {
    publishAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID, {
      status: 'session_active',
      statusSource: 'live',
      statusRevision: 3,
      activityPhase: 'idle',
      pendingFirstResponseMode: null,
      logs: [createEntry({ backend: 'Codex', agentName: 'Codex' })],
    });

    render(<AcpRuntimeStatusButton conversationId={CONVERSATION_ID} backend='codex' agentName='Codex' />);

    expect(screen.getByTestId('acp-runtime-status-button')).toHaveAttribute('aria-label', 'Active session with Codex');

    fireEvent.click(screen.getByTestId('acp-runtime-status-button'));

    expect(screen.getByTestId('acp-logs-panel')).toBeInTheDocument();
    expect(screen.getByText('Codex -> gpt-5.4 finished in 800ms')).toBeInTheDocument();
  });

  it('keeps hydrated terminal ACP status in diagnostics while demoting the header dot to neutral', () => {
    publishAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID, {
      status: 'disconnected',
      statusSource: 'hydrated',
      statusRevision: 5,
      activityPhase: 'idle',
      pendingFirstResponseMode: null,
      logs: [],
    });

    render(<AcpRuntimeStatusButton conversationId={CONVERSATION_ID} backend='codex' agentName='Codex' />);

    expect(screen.getByTestId('acp-runtime-status-button')).toHaveAttribute('aria-label', 'ACP Logs');
    expect(screen.getByTestId('acp-runtime-status-dot')).toHaveStyle({
      backgroundColor: 'var(--color-text-4)',
    });

    fireEvent.click(screen.getByTestId('acp-runtime-status-button'));

    expect(screen.getByTestId('acp-logs-panel')).toBeInTheDocument();
    expect(screen.getByText('Codex disconnected')).toBeInTheDocument();
  });

  it('keeps live terminal ACP status elevated in the header dot', () => {
    publishAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID, {
      status: 'disconnected',
      statusSource: 'live',
      statusRevision: 6,
      activityPhase: 'idle',
      pendingFirstResponseMode: null,
      logs: [],
    });

    render(<AcpRuntimeStatusButton conversationId={CONVERSATION_ID} backend='codex' agentName='Codex' />);

    expect(screen.getByTestId('acp-runtime-status-button')).toHaveAttribute('aria-label', 'Codex disconnected');
    expect(screen.getByTestId('acp-runtime-status-dot')).toHaveStyle({
      backgroundColor: 'rgb(var(--danger-6))',
    });
  });

  it('keeps the header dot animated and accented while waiting for the first ACP response', () => {
    publishAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID, {
      status: null,
      statusSource: null,
      statusRevision: 0,
      activityPhase: 'waiting',
      pendingFirstResponseMode: 'cold',
      logs: [],
    });

    render(<AcpRuntimeStatusButton conversationId={CONVERSATION_ID} backend='codex' agentName='Codex' />);

    expect(screen.getByTestId('acp-runtime-status-button')).toHaveAttribute('aria-label', 'Processing');
    expect(screen.getByTestId('acp-runtime-status-dot')).toHaveStyle({
      backgroundColor: 'var(--brand)',
    });
    expect(screen.getByTestId('acp-runtime-status-pulse-ring')).toHaveClass('animate-ping');
  });

  it('keeps the header dot animated while send-time warmup is pending even before live activity starts', () => {
    setAcpRuntimeUiWarmupPending(CONVERSATION_ID, true);

    render(<AcpRuntimeStatusButton conversationId={CONVERSATION_ID} backend='codex' agentName='Codex' />);

    expect(screen.getByTestId('acp-runtime-status-button')).toHaveAttribute('aria-label', 'Processing');
    expect(screen.getByTestId('acp-runtime-status-dot')).toHaveStyle({
      backgroundColor: 'var(--brand)',
    });
    expect(screen.getByTestId('acp-runtime-status-pulse-ring')).toHaveClass('animate-ping');
  });

  it('keeps a live warm-session waiting dot green without falling back to generic pulse', () => {
    publishAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID, {
      status: 'session_active',
      statusSource: 'live',
      statusRevision: 7,
      activityPhase: 'waiting',
      pendingFirstResponseMode: 'warm',
      logs: [],
    });

    render(<AcpRuntimeStatusButton conversationId={CONVERSATION_ID} backend='codex' agentName='Codex' />);

    expect(screen.getByTestId('acp-runtime-status-button')).toHaveAttribute('aria-label', 'Processing');
    expect(screen.queryByTestId('acp-runtime-status-pulse-ring')).not.toBeInTheDocument();
    expect(screen.getByTestId('acp-runtime-status-dot')).toHaveStyle({
      backgroundColor: 'rgb(var(--success-6))',
    });
  });

  it('marks the status dot as embedded when the header tucks it into the agent pill', () => {
    render(
      <AcpRuntimeStatusButton
        conversationId={CONVERSATION_ID}
        backend='codex'
        agentName='Codex'
        embeddedInAgentPill={true}
      />
    );

    expect(screen.getByTestId('acp-runtime-status-button')).toHaveAttribute('data-embedded-in-agent-pill', 'true');
  });
});
