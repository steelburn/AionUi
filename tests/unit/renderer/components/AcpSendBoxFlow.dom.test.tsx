import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { IMessageAgentStatus } from '@/common/chat/chatLib';
import MessageAgentStatus from '@/renderer/pages/conversation/Messages/components/MessageAgentStatus';
import AcpRuntimeStatusButton from '@/renderer/pages/conversation/components/ChatLayout/AcpRuntimeStatusButton';
import AcpWarmupIndicator from '@/renderer/pages/conversation/platforms/acp/AcpWarmupIndicator';
import AcpSendBox from '@/renderer/pages/conversation/platforms/acp/AcpSendBox';
import { clearAcpRuntimeDiagnosticsSnapshot } from '@/renderer/pages/conversation/platforms/acp/acpRuntimeDiagnostics';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONVERSATION_ID = 'conv-acp-flow';

const responseListeners = new Set<(message: unknown) => void>();
const messageListListeners = new Set<() => void>();

const mockConversationGetInvoke = vi.fn();
const mockConversationStopInvoke = vi.fn();
const mockConversationWarmupInvoke = vi.fn();
const mockAcpSendInvoke = vi.fn();
const mockAcpAuthenticateInvoke = vi.fn();
const mockDatabaseMessagesInvoke = vi.fn();
const mockAddOrUpdateMessage = vi.fn();
const mockCheckAndUpdateTitle = vi.fn();
const mockEmitterEmit = vi.fn();
const mockAssertBridgeSuccess = vi.fn();
const mockSetSendBoxHandler = vi.fn();
const mockClearFiles = vi.fn();
const mockQueueResetActiveExecution = vi.fn();
const mockArcoError = vi.fn();
const mockArcoSuccess = vi.fn();
const mockCopyText = vi.fn();
let mockMessageList: unknown[] = [];

const emitAcpResponse = (message: unknown) => {
  for (const listener of responseListeners) {
    listener(message);
  }
};

const setMockMessageList = (nextMessageList: unknown[]): void => {
  mockMessageList = nextMessageList;
  for (const listener of messageListListeners) {
    listener();
  }
};

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const renderAcpSendBoxWithDiagnostics = (
  props: React.ComponentProps<typeof AcpSendBox> = { conversation_id: CONVERSATION_ID, backend: 'claude' }
) => {
  return render(
    <>
      <AcpRuntimeStatusButton
        conversationId={props.conversation_id}
        backend={props.backend}
        agentName={props.agentName}
      />
      <AcpWarmupIndicator conversationId={props.conversation_id} backend={props.backend} agentName={props.agentName} />
      <AcpSendBox {...props} />
    </>
  );
};

const openAcpDiagnostics = async (): Promise<void> => {
  fireEvent.click(screen.getByTestId('acp-runtime-status-button'));

  await waitFor(() => {
    expect(screen.getByTestId('acp-logs-panel')).toBeInTheDocument();
  });
};

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: (...args: unknown[]) => mockConversationGetInvoke(...args) },
      stop: { invoke: (...args: unknown[]) => mockConversationStopInvoke(...args) },
      warmup: { invoke: (...args: unknown[]) => mockConversationWarmupInvoke(...args) },
    },
    acpConversation: {
      sendMessage: { invoke: (...args: unknown[]) => mockAcpSendInvoke(...args) },
      authenticate: { invoke: (...args: unknown[]) => mockAcpAuthenticateInvoke(...args) },
      responseStream: {
        on: vi.fn((listener: (message: unknown) => void) => {
          responseListeners.add(listener);
          return () => {
            responseListeners.delete(listener);
          };
        }),
        emit: vi.fn((message: unknown) => emitAcpResponse(message)),
      },
    },
    database: {
      getConversationMessages: { invoke: (...args: unknown[]) => mockDatabaseMessagesInvoke(...args) },
    },
    team: {
      sendMessage: { invoke: vi.fn() },
      sendMessageToAgent: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/common/chat/sideQuestion', () => ({
  isSideQuestionSupported: vi.fn(() => false),
}));

vi.mock('@/renderer/components/chat/sendbox', () => ({
  __esModule: true,
  default: ({
    loading,
    placeholder,
    onSend,
    onStop,
  }: {
    loading?: boolean;
    placeholder?: string;
    onSend?: (message: string) => Promise<void> | void;
    onStop?: () => Promise<void> | void;
  }) =>
    React.createElement(
      'div',
      {},
      React.createElement('div', { 'data-testid': 'sendbox-loading' }, String(Boolean(loading))),
      React.createElement('div', { 'data-testid': 'sendbox-placeholder' }, placeholder ?? ''),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void Promise.resolve(onSend?.('Hermetic request trace fallback')).catch(() => {});
          },
        },
        'trigger-send'
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void Promise.resolve(onStop?.()).catch(() => {});
          },
        },
        'trigger-stop'
      )
    ),
}));

vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({
  __esModule: true,
  default: ({ thought, running }: { thought?: { subject?: string; description?: string }; running?: boolean }) => {
    if (!thought?.subject && !running) {
      return null;
    }

    return React.createElement(
      'div',
      {
        'data-testid': 'thought-display',
        'data-running': String(Boolean(running)),
      },
      thought?.subject ? React.createElement('span', { 'data-testid': 'thought-subject' }, thought.subject) : null,
      thought?.description
        ? React.createElement('span', { 'data-testid': 'thought-description' }, thought.description)
        : null
    );
  },
}));

vi.mock('@/renderer/components/media/FilePreview', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('@/renderer/components/media/FileAttachButton', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/agent/AcpConfigSelector', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/agent/ContextUsageIndicator', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: vi.fn(() =>
    vi.fn(() => ({
      data: {
        atPath: [],
        content: '',
        uploadFile: [],
      },
      mutate: vi.fn(),
    }))
  ),
}));

vi.mock('@/renderer/hooks/chat/useSendBoxFiles', () => ({
  createSetUploadFile: vi.fn(() => vi.fn()),
  useSendBoxFiles: vi.fn(() => ({
    handleFilesAdded: vi.fn(),
    clearFiles: mockClearFiles,
  })),
}));

vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({
  useAutoTitle: () => ({
    checkAndUpdateTitle: mockCheckAndUpdateTitle,
  }),
}));

vi.mock('@/renderer/hooks/chat/useSlashCommands', () => ({
  useSlashCommands: vi.fn(() => []),
}));

vi.mock('@/renderer/hooks/file/useOpenFileSelector', () => ({
  useOpenFileSelector: vi.fn(() => ({
    openFileSelector: vi.fn(),
    onSlashBuiltinCommand: vi.fn(),
  })),
}));

vi.mock('@/renderer/hooks/ui/useLatestRef', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  return {
    useLatestRef: <T,>(value: T) => {
      const ref = ReactModule.useRef(value);
      ref.current = value;
      return ref;
    },
  };
});

vi.mock('@/renderer/pages/conversation/Messages/hooks', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  return {
    useAddOrUpdateMessage: () => mockAddOrUpdateMessage,
    useMessageList: () =>
      ReactModule.useSyncExternalStore(
        (listener: () => void) => {
          messageListListeners.add(listener);
          return () => {
            messageListListeners.delete(listener);
          };
        },
        () => mockMessageList,
        () => mockMessageList
      ),
  };
});

vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  shouldEnqueueConversationCommand: vi.fn(() => false),
  useConversationCommandQueue: vi.fn(() => ({
    items: [],
    isPaused: false,
    isInteractionLocked: false,
    hasPendingCommands: false,
    enqueue: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    lockInteraction: vi.fn(),
    unlockInteraction: vi.fn(),
    resetActiveExecution: mockQueueResetActiveExecution,
  })),
}));

vi.mock('@/renderer/pages/conversation/platforms/assertBridgeSuccess', () => ({
  assertBridgeSuccess: (...args: unknown[]) => mockAssertBridgeSuccess(...args),
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/useAcpInitialMessage', () => ({
  useAcpInitialMessage: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: mockSetSendBoxHandler,
  }),
}));

vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: vi.fn(() => null),
}));

vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: ['.txt'],
}));

vi.mock('@/renderer/styles/colors', () => ({
  iconColors: {
    secondary: '#999999',
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (...args: unknown[]) => mockEmitterEmit(...args),
  },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/utils/file/fileSelection', () => ({
  mergeFileSelectionItems: vi.fn((current: unknown) => current),
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: (...args: unknown[]) => mockCopyText(...args),
}));

vi.mock('@arco-design/web-react', () => ({
  Alert: ({
    title,
    content,
    children,
    closable: _closable,
    ...props
  }: {
    title?: React.ReactNode;
    content?: React.ReactNode;
    children?: React.ReactNode;
    closable?: boolean;
  }) => React.createElement('div', props, title, content, children),
  Badge: ({ text }: { text?: React.ReactNode }) => React.createElement('span', {}, text),
  Button: ({ children, onClick, ...props }: { children?: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { ...props, onClick }, children),
  Message: {
    error: (...args: unknown[]) => mockArcoError(...args),
    warning: vi.fn(),
    success: (...args: unknown[]) => mockArcoSuccess(...args),
  },
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
  Space: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('div', props, children),
  Spin: ({ ...props }: Record<string, unknown>) => React.createElement('span', { ...props }, 'Spin'),
  Tag: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
  Tooltip: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
  Typography: {
    Text: ({ children }: { children?: React.ReactNode }) => React.createElement('span', {}, children),
  },
}));

vi.mock('@icon-park/react', () => ({
  Shield: () => React.createElement('span'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const agent = typeof options?.agent === 'string' ? options.agent : 'Agent';
      switch (key) {
        case 'acp.logs.title':
          return 'ACP Logs';
        case 'acp.logs.requestStarted':
          return `${options?.backend} -> ${options?.model} started`;
        case 'acp.logs.firstResponse':
          return `${options?.backend} -> ${options?.model} first response in ${options?.duration}ms`;
        case 'acp.logs.requestFinished':
          return `${options?.backend} -> ${options?.model} finished in ${options?.duration}ms`;
        case 'acp.logs.requestErrored':
          return `${options?.backend} -> ${options?.model} failed in ${options?.duration}ms`;
        case 'acp.logs.sendFailed':
          return `Failed to send request for ${options?.agent}`;
        case 'acp.logs.authRequested':
          return `Authenticate requested for ${options?.agent}`;
        case 'acp.logs.authReady':
          return `Authentication ready for ${options?.agent}`;
        case 'acp.logs.authFailed':
          return `Authentication failed for ${options?.agent}`;
        case 'acp.logs.retryRequested':
          return `Retry requested for ${options?.agent}`;
        case 'acp.logs.retryReady':
          return `Connection warmup ready for ${options?.agent}`;
        case 'acp.logs.retryFailed':
          return `Connection warmup failed for ${options?.agent}`;
        case 'acp.logs.cancelRequested':
          return 'Stop requested';
        case 'acp.logs.disconnectReason':
          return `code: ${options?.code}, signal: ${options?.signal}`;
        case 'common.show':
          return 'Show';
        case 'common.hide':
          return 'Hide';
        case 'common.copy':
          return 'Copy';
        case 'common.copySuccess':
          return 'Copied';
        case 'common.copyFailed':
          return 'Copy failed';
        case 'common.close':
          return 'Close';
        case 'acp.connection.disconnectedHint':
          return 'The ACP runtime stopped unexpectedly. Retry the connection now, or send another message to start a fresh session.';
        case 'acp.auth.requiredHint':
          return `${agent} needs authentication before this thread can continue. Authenticate now, or refresh the local CLI login.`;
        case 'acp.auth.authenticate':
          return 'Authenticate';
        case 'acp.auth.authenticateFailed':
          return `Failed to authenticate ${agent}. Try again or refresh your local CLI login.`;
        case 'acp.send.failed':
          return `Failed to send message to ${typeof options?.backend === 'string' ? options.backend : 'agent'}:\n\n${options?.error}`;
        case 'acp.status.auth_required':
          return `${agent} authentication required`;
        case 'acp.connection.retryFailed':
          return `Failed to warm up ${agent}. Try again or send a new message.`;
        case 'acp.status.disconnected':
          return `${agent} disconnected`;
        case 'acp.status.error':
          return 'Connection error';
        case 'acp.status.connecting':
          return `Connecting to ${agent}...`;
        case 'acp.warmup.awaitingFirstResponse':
          return `Waiting for the first response from ${agent}...`;
        case 'conversation.chat.processing':
          return 'Processing';
        case 'common.retry':
          return 'Retry';
        case 'acp.sendbox.placeholder':
          return `Send message to ${typeof options?.backend === 'string' ? options.backend : 'agent'}...`;
        default:
          return key;
      }
    },
  }),
}));

describe('AcpSendBox live ACP flow', () => {
  beforeEach(() => {
    responseListeners.clear();
    setMockMessageList([]);
    clearAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID);
    vi.clearAllMocks();

    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockConversationStopInvoke.mockResolvedValue(undefined);
    mockConversationWarmupInvoke.mockResolvedValue(true);
    mockAcpSendInvoke.mockResolvedValue({ success: true });
    mockAcpAuthenticateInvoke.mockResolvedValue({ success: true });
    mockDatabaseMessagesInvoke.mockResolvedValue([]);
    mockCopyText.mockResolvedValue(undefined);
  });

  it('suppresses late content after stop in the live send box flow', async () => {
    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-stop' }));

    await waitFor(() => {
      expect(mockConversationStopInvoke).toHaveBeenCalledWith({ conversation_id: CONVERSATION_ID });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    mockAddOrUpdateMessage.mockClear();

    act(() => {
      emitAcpResponse({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'late-content',
        data: {
          content: '[late chunk after cancel]',
        },
      });
    });

    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    expect(mockQueueResetActiveExecution).toHaveBeenCalledWith('stop');
    expect(screen.queryByTestId('acp-logs-panel')).not.toBeInTheDocument();

    await openAcpDiagnostics();

    expect(screen.getByText('Stop requested')).toBeInTheDocument();
  });

  it('shows an explicit thread warmup indicator while ACP is waiting for the first response', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(screen.getByTestId('acp-warmup-indicator')).toBeInTheDocument();
    });
    expect(screen.getByTestId('acp-warmup-indicator')).toHaveTextContent('Processing');
    expect(screen.getByTestId('acp-warmup-indicator')).toHaveTextContent('Connecting to Claude...');
  });

  it('updates the warmup subtitle when runtime status becomes session_active before the first visible response', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(screen.getByTestId('acp-warmup-indicator')).toHaveTextContent('Connecting to Claude...');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-before-first-content',
        data: {
          status: 'session_active',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-warmup-indicator')).toHaveTextContent(
        'Waiting for the first response from Claude...'
      );
    });
    expect(screen.getByTestId('acp-warmup-indicator')).not.toHaveTextContent('Connecting to Claude...');
  });

  it('does not show the warmup indicator when reopening a running ACP conversation mid-turn', async () => {
    setMockMessageList([
      {
        id: 'assistant-mid-turn',
        type: 'text',
        msg_id: 'assistant-mid-turn',
        position: 'left',
        conversation_id: CONVERSATION_ID,
        content: { content: 'Assistant content is already streaming' },
      },
    ]);

    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    expect(screen.queryByTestId('acp-warmup-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('acp-runtime-status-dot')).not.toHaveClass('animate-pulse');
  });

  it('shows the warmup indicator when reopening a running ACP conversation before the first response arrives', async () => {
    setMockMessageList([
      {
        id: 'user-before-first-response',
        type: 'text',
        msg_id: 'user-before-first-response',
        position: 'right',
        conversation_id: CONVERSATION_ID,
        content: { content: 'User message still waiting for ACP' },
      },
    ]);

    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    expect(screen.getByTestId('acp-warmup-indicator')).toHaveTextContent('Processing');
    expect(screen.getByTestId('acp-warmup-indicator')).toHaveTextContent('Connecting to Claude...');
    expect(screen.getByTestId('acp-runtime-status-dot')).toHaveClass('animate-pulse');
  });

  it('switches the sendbox placeholder to processing while ACP is busy', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('sendbox-placeholder')).toHaveTextContent('Send message to Claude...');

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-placeholder')).toHaveTextContent('Processing');
    });

    act(() => {
      emitAcpResponse({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'content-placeholder-streaming',
        data: {
          content: 'First token',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-placeholder')).toHaveTextContent('Processing');
    });
    expect(screen.queryByTestId('acp-warmup-indicator')).not.toBeInTheDocument();

    act(() => {
      emitAcpResponse({
        type: 'finish',
        conversation_id: CONVERSATION_ID,
        msg_id: 'finish-placeholder-reset',
        data: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-placeholder')).toHaveTextContent('Send message to Claude...');
    });
  });

  it('lets inline ACP thinking replace the thread warmup indicator before the first content arrives', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(screen.getByTestId('acp-warmup-indicator')).toHaveTextContent('Connecting to Claude...');
    });

    act(() => {
      emitAcpResponse({
        type: 'thinking',
        conversation_id: CONVERSATION_ID,
        msg_id: 'thinking-before-content',
        data: {
          content: 'Thinking through the next step',
          status: 'thinking',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-warmup-indicator')).not.toBeInTheDocument();
    });
    expect(mockAddOrUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'thinking',
        content: expect.objectContaining({
          content: 'Thinking through the next step',
          status: 'thinking',
        }),
      })
    );
    expect(screen.getByTestId('acp-runtime-status-dot')).toHaveClass('animate-pulse');
  });

  it('renders ACP logs for request lifecycle events in the live send box flow', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    try {
      dateNowSpy.mockReturnValue(1000);

      renderAcpSendBoxWithDiagnostics({
        conversation_id: CONVERSATION_ID,
        backend: 'claude',
        agentName: 'Claude',
      });

      await waitFor(() => {
        expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
      });

      act(() => {
        emitAcpResponse({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'request-trace-1',
          data: {
            backend: 'Claude',
            modelId: 'claude-sonnet',
            timestamp: 1000,
          },
        });
      });

      expect(screen.queryByTestId('acp-logs-panel')).not.toBeInTheDocument();

      await openAcpDiagnostics();

      expect(screen.getByText('Claude -> claude-sonnet started')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('acp-logs-toggle'));

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        emitAcpResponse({
          type: 'content',
          conversation_id: CONVERSATION_ID,
          msg_id: 'content-trace-1',
          data: {
            content: 'First token',
          },
        });
      });

      dateNowSpy.mockReturnValue(1900);
      act(() => {
        emitAcpResponse({
          type: 'finish',
          conversation_id: CONVERSATION_ID,
          msg_id: 'finish-trace-1',
          data: null,
        });
      });

      const logsList = screen.getByTestId('acp-logs-list');
      expect(within(logsList).getByText('Claude -> claude-sonnet started')).toBeInTheDocument();
      expect(within(logsList).getByText('Claude -> claude-sonnet first response in 300ms')).toBeInTheDocument();
      expect(within(logsList).getByText('Claude -> claude-sonnet finished in 900ms')).toBeInTheDocument();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('renders ACP logs for a normal send even if request_trace and start arrive before subscription', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      mockConversationGetInvoke.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        type: 'acp',
        status: 'finished',
        extra: {},
      });

      dateNowSpy.mockReturnValue(1000);
      renderAcpSendBoxWithDiagnostics({
        conversation_id: CONVERSATION_ID,
        backend: 'custom',
        agentName: 'Fake ACP Agent',
      });

      await waitFor(() => {
        expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
      });

      fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

      await waitFor(() => {
        expect(mockAcpSendInvoke).toHaveBeenCalledWith({
          input: 'Hermetic request trace fallback',
          msg_id: expect.any(String),
          conversation_id: CONVERSATION_ID,
          files: [],
        });
      });

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        emitAcpResponse({
          type: 'content',
          conversation_id: CONVERSATION_ID,
          msg_id: 'content-without-trace',
          data: {
            content: 'First token without explicit trace',
          },
        });
      });

      dateNowSpy.mockReturnValue(1700);
      act(() => {
        emitAcpResponse({
          type: 'finish',
          conversation_id: CONVERSATION_ID,
          msg_id: 'finish-without-trace',
          data: null,
        });
      });

      expect(screen.queryByTestId('acp-logs-panel')).not.toBeInTheDocument();
      await openAcpDiagnostics();
      fireEvent.click(screen.getByTestId('acp-logs-toggle'));

      const logsList = screen.getByTestId('acp-logs-list');
      expect(within(logsList).getByText('Fake ACP Agent -> unknown first response in 300ms')).toBeInTheDocument();
      expect(within(logsList).getByText('Fake ACP Agent -> unknown finished in 700ms')).toBeInTheDocument();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('records an auth failure UI log instead of a fake request lifecycle when send rejects before ACP starts', async () => {
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });
    mockAcpSendInvoke.mockRejectedValueOnce(new Error('[ACP-AUTH-TEST] authentication failed'));

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'custom',
      agentName: 'Fake ACP Agent',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledWith({
        input: 'Hermetic request trace fallback',
        msg_id: expect.any(String),
        conversation_id: CONVERSATION_ID,
        files: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('acp-auth-banner')).toHaveTextContent('Fake ACP Agent authentication required');
    expect(screen.queryByTestId('acp-logs-panel')).not.toBeInTheDocument();
    expect(mockAddOrUpdateMessage).toHaveBeenCalledTimes(1);
    expect(mockAddOrUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tips',
        content: expect.objectContaining({
          type: 'error',
        }),
      })
    );

    await openAcpDiagnostics();
    fireEvent.click(screen.getByTestId('acp-logs-toggle'));
    const logsList = screen.getByTestId('acp-logs-list');
    expect(within(logsList).getByText('Authentication failed for Fake ACP Agent')).toBeInTheDocument();
    expect(within(logsList).queryByText(/-> .* failed in /)).not.toBeInTheDocument();
  });

  it('records a send failure UI log instead of a fake request lifecycle when send rejects before ACP starts', async () => {
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });
    mockAcpSendInvoke.mockRejectedValueOnce(new Error('Fake send failure before request trace'));

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'custom',
      agentName: 'Fake ACP Agent',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledWith({
        input: 'Hermetic request trace fallback',
        msg_id: expect.any(String),
        conversation_id: CONVERSATION_ID,
        files: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('acp-error-banner')).toBeInTheDocument();
    expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('Failed to send request for Fake ACP Agent');
    expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('Fake send failure before request trace');
    expect(screen.queryByTestId('acp-logs-panel')).not.toBeInTheDocument();
    expect(mockAddOrUpdateMessage).toHaveBeenCalledTimes(1);
    expect(mockAddOrUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tips',
        content: expect.objectContaining({
          type: 'error',
        }),
      })
    );

    await openAcpDiagnostics();
    fireEvent.click(screen.getByTestId('acp-logs-toggle'));
    const logsList = screen.getByTestId('acp-logs-list');
    expect(within(logsList).getByText('Failed to send request for Fake ACP Agent')).toBeInTheDocument();
    expect(within(logsList).getByText('Fake send failure before request trace')).toBeInTheDocument();
    expect(within(logsList).queryByText(/-> .* failed in /)).not.toBeInTheDocument();
  });

  it('surfaces a generic ACP error banner for live request errors until a newer lifecycle entry replaces it', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      mockConversationGetInvoke.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        type: 'acp',
        status: 'finished',
        extra: {},
      });

      dateNowSpy.mockReturnValue(1000);
      renderAcpSendBoxWithDiagnostics({
        conversation_id: CONVERSATION_ID,
        backend: 'custom',
        agentName: 'Fake ACP Agent',
      });

      await waitFor(() => {
        expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
      });

      act(() => {
        emitAcpResponse({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-live-request-error',
          data: {
            backend: 'custom',
            modelId: 'fake-model',
            timestamp: 1000,
          },
        });
      });

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        emitAcpResponse({
          type: 'error',
          conversation_id: CONVERSATION_ID,
          msg_id: 'live-request-error',
          data: 'socket reset by peer',
        });
      });

      expect(screen.getByTestId('acp-error-banner')).toBeInTheDocument();
      expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('Fake ACP Agent -> fake-model failed in 300ms');
      expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('socket reset by peer');

      dateNowSpy.mockReturnValue(1600);
      act(() => {
        emitAcpResponse({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-recovery-request',
          data: {
            backend: 'custom',
            modelId: 'fake-model',
            timestamp: 1600,
          },
        });
      });

      await waitFor(() => {
        expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();
      });
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('lets the user copy and dismiss a live generic ACP error banner', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      mockConversationGetInvoke.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        type: 'acp',
        status: 'finished',
        extra: {},
      });

      dateNowSpy.mockReturnValue(1000);
      renderAcpSendBoxWithDiagnostics({
        conversation_id: CONVERSATION_ID,
        backend: 'custom',
        agentName: 'Fake ACP Agent',
      });

      await waitFor(() => {
        expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
      });

      act(() => {
        emitAcpResponse({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-copy-dismiss-request-error',
          data: {
            backend: 'custom',
            modelId: 'fake-model',
            timestamp: 1000,
          },
        });
      });

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        emitAcpResponse({
          type: 'error',
          conversation_id: CONVERSATION_ID,
          msg_id: 'copy-dismiss-request-error',
          data: 'socket reset by peer',
        });
      });

      const errorBanner = screen.getByTestId('acp-error-banner');
      expect(errorBanner).toHaveTextContent('Fake ACP Agent -> fake-model failed in 300ms');
      expect(errorBanner).toHaveTextContent('socket reset by peer');

      fireEvent.click(screen.getByTestId('acp-error-banner-copy'));

      await waitFor(() => {
        expect(mockCopyText).toHaveBeenCalledWith(
          'Fake ACP Agent -> fake-model failed in 300ms\n\nsocket reset by peer'
        );
      });
      expect(mockArcoSuccess).toHaveBeenCalledWith('Copied');

      fireEvent.click(screen.getByTestId('acp-error-banner-dismiss'));

      await waitFor(() => {
        expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();
      });

      await openAcpDiagnostics();
      fireEvent.click(screen.getByTestId('acp-logs-toggle'));
      expect(screen.getByTestId('acp-logs-list')).toHaveTextContent('socket reset by peer');
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('retries the last failed ACP command directly from the generic error banner', async () => {
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });

    mockAcpSendInvoke
      .mockRejectedValueOnce(new Error('Fake send failure before request trace'))
      .mockResolvedValueOnce({ success: true });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'custom',
      agentName: 'Fake ACP Agent',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(screen.getByTestId('acp-error-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('acp-error-banner-retry'));

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenNthCalledWith(2, {
        input: 'Hermetic request trace fallback',
        msg_id: expect.any(String),
        conversation_id: CONVERSATION_ID,
        files: [],
      });
    });

    expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();
  });

  it('keeps a dismissed live generic ACP error banner hidden until a newer error arrives', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      mockConversationGetInvoke.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        type: 'acp',
        status: 'finished',
        extra: {},
      });

      dateNowSpy.mockReturnValue(1000);
      renderAcpSendBoxWithDiagnostics({
        conversation_id: CONVERSATION_ID,
        backend: 'custom',
        agentName: 'Fake ACP Agent',
      });

      await waitFor(() => {
        expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
      });

      act(() => {
        emitAcpResponse({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-dismissed-request-error',
          data: {
            backend: 'custom',
            modelId: 'fake-model',
            timestamp: 1000,
          },
        });
      });

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        emitAcpResponse({
          type: 'error',
          conversation_id: CONVERSATION_ID,
          msg_id: 'dismissed-request-error',
          data: 'socket reset by peer',
        });
      });

      fireEvent.click(screen.getByTestId('acp-error-banner-dismiss'));

      await waitFor(() => {
        expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();
      });

      dateNowSpy.mockReturnValue(1600);
      act(() => {
        emitAcpResponse({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-after-dismiss',
          data: {
            backend: 'custom',
            modelId: 'fake-model',
            timestamp: 1600,
          },
        });
      });

      expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();

      dateNowSpy.mockReturnValue(1900);
      act(() => {
        emitAcpResponse({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-new-request-error-after-dismiss',
          data: {
            backend: 'custom',
            modelId: 'fake-model',
            timestamp: 1900,
          },
        });
      });

      dateNowSpy.mockReturnValue(2250);
      act(() => {
        emitAcpResponse({
          type: 'error',
          conversation_id: CONVERSATION_ID,
          msg_id: 'new-request-error-after-dismiss',
          data: 'another socket reset by peer',
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('acp-error-banner')).toBeInTheDocument();
      });

      expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('Fake ACP Agent -> fake-model failed in 350ms');
      expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('another socket reset by peer');
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('gives the disconnected recovery banner precedence over a prior generic ACP error banner', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      mockConversationGetInvoke.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        type: 'acp',
        status: 'finished',
        extra: {},
      });

      dateNowSpy.mockReturnValue(1000);
      renderAcpSendBoxWithDiagnostics({
        conversation_id: CONVERSATION_ID,
        backend: 'custom',
        agentName: 'Fake ACP Agent',
      });

      await waitFor(() => {
        expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
      });

      act(() => {
        emitAcpResponse({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-before-disconnected-precedence',
          data: {
            backend: 'custom',
            modelId: 'fake-model',
            timestamp: 1000,
          },
        });
      });

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        emitAcpResponse({
          type: 'error',
          conversation_id: CONVERSATION_ID,
          msg_id: 'request-error-before-disconnected-precedence',
          data: 'socket reset by peer',
        });
      });

      expect(screen.getByTestId('acp-error-banner')).toBeInTheDocument();

      act(() => {
        emitAcpResponse({
          type: 'agent_status',
          conversation_id: CONVERSATION_ID,
          msg_id: 'disconnected-precedence',
          data: {
            backend: 'custom',
            status: 'disconnected',
            agentName: 'Fake ACP Agent',
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('gives the auth recovery banner precedence over a prior generic ACP error banner', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      mockConversationGetInvoke.mockResolvedValueOnce({
        id: CONVERSATION_ID,
        type: 'acp',
        status: 'finished',
        extra: {},
      });

      dateNowSpy.mockReturnValue(1000);
      renderAcpSendBoxWithDiagnostics({
        conversation_id: CONVERSATION_ID,
        backend: 'custom',
        agentName: 'Fake ACP Agent',
      });

      await waitFor(() => {
        expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
      });

      act(() => {
        emitAcpResponse({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-before-auth-precedence',
          data: {
            backend: 'custom',
            modelId: 'fake-model',
            timestamp: 1000,
          },
        });
      });

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        emitAcpResponse({
          type: 'error',
          conversation_id: CONVERSATION_ID,
          msg_id: 'request-error-before-auth-precedence',
          data: 'socket reset by peer',
        });
      });

      expect(screen.getByTestId('acp-error-banner')).toBeInTheDocument();

      act(() => {
        emitAcpResponse({
          type: 'agent_status',
          conversation_id: CONVERSATION_ID,
          msg_id: 'auth-precedence',
          data: {
            backend: 'custom',
            status: 'auth_required',
            agentName: 'Fake ACP Agent',
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('surfaces disconnect metadata for live ACP status:error banners', async () => {
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'custom',
      agentName: 'Fake ACP Agent',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-error-banner',
        data: {
          backend: 'custom',
          status: 'error',
          agentName: 'Fake ACP Agent',
          disconnectCode: 23,
          disconnectSignal: 'SIGTERM',
        },
      });
    });

    expect(screen.getByTestId('acp-error-banner')).toBeInTheDocument();
    expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('Connection error');
    expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('code: 23, signal: SIGTERM');
  });

  it('surfaces disconnected status and clears loading in the live send box flow', async () => {
    render(<AcpSendBox conversation_id={CONVERSATION_ID} backend='claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    mockAddOrUpdateMessage.mockClear();

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
          disconnectCode: 42,
          disconnectSignal: null,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    expect(mockAddOrUpdateMessage).toHaveBeenCalledTimes(1);

    const statusMessage = mockAddOrUpdateMessage.mock.calls[0]?.[0] as IMessageAgentStatus;
    const statusView = render(<MessageAgentStatus message={statusMessage} />);

    expect(within(statusView.container).getByText('Claude disconnected')).toBeInTheDocument();
  });

  it('shows a disconnected banner and dismisses it after a successful retry warmup', async () => {
    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-banner',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The ACP runtime stopped unexpectedly. Retry the connection now, or send another message to start a fresh session.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: CONVERSATION_ID });
    });

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    expect(screen.queryByText('Connection warmup ready for Claude')).not.toBeInTheDocument();

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-connected-after-retry',
        data: {
          backend: 'claude',
          status: 'connected',
          agentName: 'Claude',
        },
      });
    });

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    expect(screen.queryByText('Connection warmup ready for Claude')).not.toBeInTheDocument();

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-session-active-after-retry',
        data: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Connection warmup ready for Claude')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('acp-logs-toggle'));
    expect(within(screen.getByTestId('acp-logs-list')).getByText('Retry requested for Claude')).toBeInTheDocument();

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-banner-again',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
  });

  it('keeps the disconnected banner visible while retry warmup is still in flight through connected status noise', async () => {
    const warmupDeferred = createDeferred<boolean>();
    mockConversationWarmupInvoke.mockReturnValueOnce(warmupDeferred.promise);

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-before-connected-noise',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: CONVERSATION_ID });
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-connected-during-warmup',
        data: {
          backend: 'claude',
          status: 'connected',
          agentName: 'Claude',
        },
      });
    });

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    expect(screen.queryByText('Connection warmup ready for Claude')).not.toBeInTheDocument();

    await act(async () => {
      warmupDeferred.resolve(true);
      await warmupDeferred.promise;
    });

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-session-active-after-connected-noise',
        data: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Connection warmup ready for Claude')).toBeInTheDocument();
  });

  it('captures retry readiness even when session_active arrives before retry warmup resolves', async () => {
    const warmupDeferred = createDeferred<boolean>();
    mockConversationWarmupInvoke.mockReturnValueOnce(warmupDeferred.promise);

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-before-early-session-active',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: CONVERSATION_ID });
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-session-active-before-warmup-resolve',
        data: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
        },
      });
    });

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();

    await act(async () => {
      warmupDeferred.resolve(true);
      await warmupDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Connection warmup ready for Claude')).toBeInTheDocument();
  });

  it('keeps retry recovery in flight across remount and ignores duplicate retry clicks', async () => {
    const conversationId = 'conv-acp-retry-remount';
    const warmupDeferred = createDeferred<boolean>();
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockConversationWarmupInvoke.mockReturnValueOnce(warmupDeferred.promise);

    const firstRender = render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: conversationId,
        msg_id: 'status-disconnected-before-retry-remount',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledTimes(1);
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });

    firstRender.unmount();

    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          status: 'disconnected',
          backend: 'claude',
          agentName: 'Claude',
          updatedAt: 1_710_000_000_000,
        },
      },
    });

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    const retryButton = within(screen.getByTestId('acp-disconnected-banner')).getByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);
    expect(mockConversationWarmupInvoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      warmupDeferred.resolve(true);
      await warmupDeferred.promise;
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: conversationId,
        msg_id: 'status-session-active-after-retry-remount',
        data: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
    });
  });

  it('clears retry pending state when an unmounted same-barrier retry later fails', async () => {
    const conversationId = 'conv-acp-retry-remount-same-barrier-failure';
    const warmupDeferred = createDeferred<boolean>();
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockConversationWarmupInvoke.mockReturnValueOnce(warmupDeferred.promise);

    const firstRender = renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: conversationId,
        msg_id: 'status-disconnected-before-same-barrier-retry-remount',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });

    firstRender.unmount();

    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          status: 'disconnected',
          backend: 'claude',
          agentName: 'Claude',
          updatedAt: 1_710_000_000_400,
        },
      },
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    await act(async () => {
      warmupDeferred.resolve(false);
      await warmupDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
    });

    expect(mockArcoError).not.toHaveBeenCalled();
    await openAcpDiagnostics();
    expect(screen.getByText('Claude disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Connection warmup failed for Claude')).not.toBeInTheDocument();
  });

  it('clears retry recovery across remount when hydrated auth_required takes over and suppresses stale retry failure', async () => {
    const conversationId = 'conv-acp-retry-remount-auth-handoff';
    const warmupDeferred = createDeferred<boolean>();
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockConversationWarmupInvoke.mockReturnValueOnce(warmupDeferred.promise);

    const firstRender = renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: conversationId,
        msg_id: 'status-disconnected-before-retry-auth-handoff-remount',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });

    firstRender.unmount();

    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          status: 'auth_required',
          backend: 'claude',
          agentName: 'Claude',
          updatedAt: 1_710_000_000_200,
        },
      },
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Claude authentication required')).toBeInTheDocument();

    await act(async () => {
      warmupDeferred.resolve(false);
      await warmupDeferred.promise;
    });

    expect(mockArcoError).not.toHaveBeenCalled();
    expect(screen.queryByText('Connection warmup failed for Claude')).not.toBeInTheDocument();
  });

  it('clears retry pending state when warmup falls back to auth_required', async () => {
    render(<AcpSendBox conversation_id={CONVERSATION_ID} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-before-auth-fallback',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: CONVERSATION_ID });
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-after-retry',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    expect(screen.queryByText('Connection warmup ready for Claude')).not.toBeInTheDocument();
  });

  it('suppresses stale retry failure after auth_required takes over the barrier', async () => {
    const warmupDeferred = createDeferred<boolean>();
    mockConversationWarmupInvoke.mockReturnValueOnce(warmupDeferred.promise);

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-before-stale-retry-failure',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: CONVERSATION_ID });
    });

    mockArcoError.mockClear();

    await act(async () => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-after-stale-retry-handoff',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
      warmupDeferred.resolve(false);
      await warmupDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    expect(mockArcoError).not.toHaveBeenCalled();
    await openAcpDiagnostics();
    fireEvent.click(screen.getByTestId('acp-logs-toggle'));
    const logsList = screen.getByTestId('acp-logs-list');
    expect(within(logsList).getByText('Retry requested for Claude')).toBeInTheDocument();
    expect(within(logsList).queryByText('Connection warmup failed for Claude')).not.toBeInTheDocument();
  });

  it('shows an auth banner and dismisses it only after a live session becomes active', async () => {
    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-banner',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Claude needs authentication before this thread can continue. Authenticate now, or refresh the local CLI login.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID });
    });

    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    expect(screen.queryByText('Authentication ready for Claude')).not.toBeInTheDocument();

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-authenticated-after-auth',
        data: {
          backend: 'claude',
          status: 'authenticated',
          agentName: 'Claude',
        },
      });
    });

    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    expect(screen.queryByText('Authentication ready for Claude')).not.toBeInTheDocument();

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-session-active-after-auth',
        data: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Authentication ready for Claude')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('acp-logs-toggle'));
    expect(
      within(screen.getByTestId('acp-logs-list')).getByText('Authenticate requested for Claude')
    ).toBeInTheDocument();
  });

  it('keeps the auth banner visible while authenticate is still in flight through authenticated status noise', async () => {
    const authDeferred = createDeferred<{ success: boolean }>();
    mockAcpAuthenticateInvoke.mockReturnValueOnce(authDeferred.promise);

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-before-authenticated-noise',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID });
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-authenticated-during-auth',
        data: {
          backend: 'claude',
          status: 'authenticated',
          agentName: 'Claude',
        },
      });
    });

    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    expect(screen.queryByText('Authentication ready for Claude')).not.toBeInTheDocument();

    await act(async () => {
      authDeferred.resolve({ success: true });
      await authDeferred.promise;
    });

    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-session-active-after-authenticated-noise',
        data: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Authentication ready for Claude')).toBeInTheDocument();
  });

  it('captures auth readiness even when session_active arrives before authenticate resolves', async () => {
    const authDeferred = createDeferred<{ success: boolean }>();
    mockAcpAuthenticateInvoke.mockReturnValueOnce(authDeferred.promise);

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-before-early-session-active',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID });
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-session-active-before-auth-resolve',
        data: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
        },
      });
    });

    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();

    await act(async () => {
      authDeferred.resolve({ success: true });
      await authDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Authentication ready for Claude')).toBeInTheDocument();
  });

  it('keeps authenticate recovery in flight across remount and ignores duplicate authenticate clicks', async () => {
    const conversationId = 'conv-acp-auth-remount';
    const authDeferred = createDeferred<{ success: boolean }>();
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockAcpAuthenticateInvoke.mockReturnValueOnce(authDeferred.promise);

    const firstRender = render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: conversationId,
        msg_id: 'status-auth-required-before-auth-remount',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledTimes(1);
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: conversationId });
    });

    firstRender.unmount();

    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          status: 'auth_required',
          backend: 'claude',
          agentName: 'Claude',
          updatedAt: 1_710_000_000_100,
        },
      },
    });

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    const authButton = within(screen.getByTestId('acp-auth-banner')).getByRole('button', { name: 'Authenticate' });
    fireEvent.click(authButton);
    expect(mockAcpAuthenticateInvoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      authDeferred.resolve({ success: true });
      await authDeferred.promise;
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: conversationId,
        msg_id: 'status-session-active-after-auth-remount',
        data: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
    });
  });

  it('clears auth pending state when an unmounted same-barrier authenticate later fails', async () => {
    const conversationId = 'conv-acp-auth-remount-same-barrier-failure';
    const authDeferred = createDeferred<{ success: boolean }>();
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockAcpAuthenticateInvoke.mockReturnValueOnce(authDeferred.promise);

    const firstRender = renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: conversationId,
        msg_id: 'status-auth-before-same-barrier-auth-remount',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: conversationId });
    });

    firstRender.unmount();

    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          status: 'auth_required',
          backend: 'claude',
          agentName: 'Claude',
          updatedAt: 1_710_000_000_500,
        },
      },
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    await act(async () => {
      authDeferred.resolve({ success: false });
      await authDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
    });

    expect(mockArcoError).not.toHaveBeenCalled();
    await openAcpDiagnostics();
    expect(screen.getByText('Claude authentication required')).toBeInTheDocument();
    expect(
      screen.queryByText('Failed to authenticate Claude. Try again or refresh your local CLI login.')
    ).not.toBeInTheDocument();
  });

  it('clears auth recovery across remount when hydrated disconnected takes over and suppresses stale auth failure', async () => {
    const conversationId = 'conv-acp-auth-remount-disconnected-handoff';
    const authDeferred = createDeferred<{ success: boolean }>();
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockAcpAuthenticateInvoke.mockReturnValueOnce(authDeferred.promise);

    const firstRender = renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: conversationId,
        msg_id: 'status-auth-required-before-auth-disconnected-handoff-remount',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: conversationId });
    });

    firstRender.unmount();

    mockConversationGetInvoke.mockResolvedValueOnce({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          status: 'disconnected',
          backend: 'claude',
          agentName: 'Claude',
          updatedAt: 1_710_000_000_300,
        },
      },
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Claude disconnected')).toBeInTheDocument();

    await act(async () => {
      authDeferred.resolve({ success: false });
      await authDeferred.promise;
    });

    expect(mockArcoError).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Failed to authenticate Claude. Try again or refresh your local CLI login.')
    ).not.toBeInTheDocument();
  });

  it('clears auth pending state when authenticate falls back to disconnected', async () => {
    render(<AcpSendBox conversation_id={CONVERSATION_ID} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-before-disconnect-fallback',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID });
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-after-auth',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    expect(screen.queryByText('Authentication ready for Claude')).not.toBeInTheDocument();
  });

  it('suppresses stale auth failure after disconnected takes over the barrier', async () => {
    const authDeferred = createDeferred<{ success: boolean }>();
    mockAcpAuthenticateInvoke.mockReturnValueOnce(authDeferred.promise);

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-before-stale-auth-failure',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID });
    });

    mockArcoError.mockClear();

    await act(async () => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-after-stale-auth-handoff',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
      authDeferred.reject(new Error('manual login failed'));
      try {
        await authDeferred.promise;
      } catch {}
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    expect(mockArcoError).not.toHaveBeenCalled();
    await openAcpDiagnostics();
    fireEvent.click(screen.getByTestId('acp-logs-toggle'));
    const logsList = screen.getByTestId('acp-logs-list');
    expect(within(logsList).getByText('Authenticate requested for Claude')).toBeInTheDocument();
    expect(within(logsList).queryByText('Authentication failed for Claude')).not.toBeInTheDocument();
  });

  it('keeps the auth banner visible when authenticate fails', async () => {
    mockAcpAuthenticateInvoke.mockResolvedValueOnce({
      success: false,
      msg: 'manual login failed',
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-failure',
        data: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID });
    });

    expect(mockArcoError).toHaveBeenCalledWith('manual login failed');
    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    await openAcpDiagnostics();
    expect(screen.getByText('Authentication failed for Claude')).toBeInTheDocument();
  });

  it('keeps the disconnected banner visible when retry warmup fails', async () => {
    mockConversationWarmupInvoke.mockResolvedValue(false);

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-retry-failed',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: CONVERSATION_ID });
    });

    expect(mockArcoError).toHaveBeenCalledWith('Failed to warm up Claude. Try again or send a new message.');
    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    await openAcpDiagnostics();
    expect(screen.getByText('Connection warmup failed for Claude')).toBeInTheDocument();
  });

  it('surfaces thrown retry warmup errors in the ACP logs', async () => {
    mockConversationWarmupInvoke.mockRejectedValueOnce(new Error('warmup socket refused'));

    renderAcpSendBoxWithDiagnostics({
      conversation_id: CONVERSATION_ID,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    act(() => {
      emitAcpResponse({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-retry-thrown',
        data: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: CONVERSATION_ID });
    });

    expect(mockArcoError).toHaveBeenCalledWith('warmup socket refused');
    await openAcpDiagnostics();
    expect(screen.getByText('warmup socket refused')).toBeInTheDocument();
  });

  it('keeps a hydrated disconnected status in diagnostics without restoring the disconnected banner', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
          updatedAt: Date.now(),
        },
      },
    });

    renderAcpSendBoxWithDiagnostics({ conversation_id: CONVERSATION_ID, backend: 'claude', agentName: 'Claude' });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    await openAcpDiagnostics();
    expect(screen.getByText('Claude disconnected')).toBeInTheDocument();
  });

  it('keeps a hydrated auth_required status in diagnostics without restoring the auth banner', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
          updatedAt: Date.now(),
        },
      },
    });

    renderAcpSendBoxWithDiagnostics({ conversation_id: CONVERSATION_ID, backend: 'claude', agentName: 'Claude' });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Claude authentication required')).toBeInTheDocument();
  });

  it('keeps a hydrated error status in diagnostics without restoring the generic error banner', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'error',
          agentName: 'Claude',
          updatedAt: Date.now(),
        },
      },
    });

    renderAcpSendBoxWithDiagnostics({ conversation_id: CONVERSATION_ID, backend: 'claude', agentName: 'Claude' });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();
    });

    await openAcpDiagnostics();
    expect(screen.getByText('Connection error')).toBeInTheDocument();
  });
});
