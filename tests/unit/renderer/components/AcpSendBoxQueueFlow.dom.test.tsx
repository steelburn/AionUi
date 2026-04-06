import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AcpRuntimeStatusButton from '@/renderer/pages/conversation/components/ChatLayout/AcpRuntimeStatusButton';
import AcpSendBox from '@/renderer/pages/conversation/platforms/acp/AcpSendBox';
import {
  clearAcpRuntimeDiagnosticsSnapshot,
  isAcpRuntimeBusySnapshot,
  readAcpRuntimeDiagnosticsSnapshot,
} from '@/renderer/pages/conversation/platforms/acp/acpRuntimeDiagnostics';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const responseListeners = new Set<(message: unknown) => void>();
let mockMessageList: unknown[] = [];

const mockConversationGetInvoke = vi.fn();
const mockConversationStopInvoke = vi.fn();
const mockConversationWarmupInvoke = vi.fn();
const mockAcpAuthenticateInvoke = vi.fn();
const mockAcpSendInvoke = vi.fn();
const mockDatabaseMessagesInvoke = vi.fn();
const mockAddOrUpdateMessage = vi.fn();
const mockCheckAndUpdateTitle = vi.fn();
const mockEmitterEmit = vi.fn();
const mockAssertBridgeSuccess = vi.fn();
const mockSetSendBoxHandler = vi.fn();
const mockClearFiles = vi.fn();

const createConversationId = (): string => `conv-acp-queue-${Math.random().toString(36).slice(2)}`;
const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const flushMicrotasks = async (count = 4): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
};

const emitAcpResponse = (message: unknown): void => {
  act(() => {
    for (const listener of responseListeners) {
      listener(message);
    }
  });
};

const clickBannerAction = (testId: string): void => {
  const actionButton = screen.getByTestId(testId).querySelector('button');
  if (!(actionButton instanceof HTMLButtonElement)) {
    throw new Error(`No action button found for ${testId}`);
  }
  fireEvent.click(actionButton);
};

const renderAcpSendBoxWithDiagnostics = (props: React.ComponentProps<typeof AcpSendBox>) => {
  return render(
    <>
      <AcpRuntimeStatusButton
        conversationId={props.conversation_id}
        backend={props.backend}
        agentName={props.agentName}
      />
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
      authenticate: { invoke: (...args: unknown[]) => mockAcpAuthenticateInvoke(...args) },
      sendMessage: { invoke: (...args: unknown[]) => mockAcpSendInvoke(...args) },
      responseStream: {
        on: vi.fn((listener: (message: unknown) => void) => {
          responseListeners.add(listener);
          return () => {
            responseListeners.delete(listener);
          };
        }),
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
    onSend,
    onStop,
  }: {
    loading?: boolean;
    onSend?: (message: string) => Promise<void> | void;
    onStop?: () => Promise<void> | void;
  }) =>
    React.createElement(
      'div',
      {},
      React.createElement('div', { 'data-testid': 'sendbox-loading' }, String(Boolean(loading))),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void Promise.resolve(onSend?.('queued command 1')).catch(() => {});
          },
        },
        'trigger-send-1'
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void Promise.resolve(onSend?.('queued command 2')).catch(() => {});
          },
        },
        'trigger-send-2'
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
  default: ({
    items,
    paused,
    onSendNow,
    sendNowLoading,
    onPause,
    onResume,
    onRemove,
  }: {
    items: Array<{ id: string }>;
    paused?: boolean;
    onSendNow?: () => void;
    sendNowLoading?: boolean;
    onPause?: () => void;
    onResume?: () => void;
    onRemove?: (commandId: string) => void;
  }) =>
    React.createElement(
      'div',
      {},
      React.createElement('div', { 'data-testid': 'queue-panel' }, String(items.length)),
      React.createElement('div', { 'data-testid': 'queue-paused' }, String(Boolean(paused))),
      onPause || onResume
        ? React.createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'queue-toggle-pause',
              onClick: () => {
                if (paused) {
                  onResume?.();
                  return;
                }

                onPause?.();
              },
            },
            paused ? 'Resume' : 'Pause'
          )
        : null,
      onSendNow
        ? React.createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'queue-send-now',
              'data-loading': String(Boolean(sendNowLoading)),
              onClick: () => {
                onSendNow();
              },
            },
            'Send Now'
          )
        : null,
      onRemove && items[0]
        ? React.createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'queue-remove-first',
              onClick: () => {
                onRemove(items[0]!.id);
              },
            },
            'Remove First'
          )
        : null
    ),
}));

vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
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

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => mockAddOrUpdateMessage,
  useMessageList: () => mockMessageList,
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

vi.mock('@arco-design/web-react', () => ({
  Alert: ({
    title,
    content,
    children,
    ...props
  }: {
    title?: React.ReactNode;
    content?: React.ReactNode;
    children?: React.ReactNode;
  }) => React.createElement('div', props, title, content, children),
  Button: ({ children, onClick, ...props }: { children?: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { ...props, onClick }, children),
  Message: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
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
      if (key === 'acp.logs.sendNowRequested') {
        return `Send Now requested for ${typeof options?.agent === 'string' ? options.agent : 'agent'}`;
      }

      if (key === 'acp.logs.title') {
        return 'ACP Logs';
      }

      if (key === 'common.show') {
        return 'Show';
      }

      if (key === 'common.hide') {
        return 'Hide';
      }

      if (key === 'acp.status.unknown') {
        return 'Unknown status';
      }

      return options?.defaultValue ?? key;
    },
  }),
}));

describe('AcpSendBox queue flow', () => {
  beforeEach(() => {
    responseListeners.clear();
    mockMessageList = [];
    window.sessionStorage.clear();
    vi.clearAllMocks();

    mockConversationStopInvoke.mockResolvedValue(undefined);
    mockConversationWarmupInvoke.mockResolvedValue(true);
    mockAcpAuthenticateInvoke.mockResolvedValue({ success: true });
    mockAcpSendInvoke.mockResolvedValue({ success: true });
    mockDatabaseMessagesInvoke.mockResolvedValue([]);
  });

  it('keeps send box busy in sync with the shared ACP runtime diagnostics phases', async () => {
    const conversationId = createConversationId();
    clearAcpRuntimeDiagnosticsSnapshot(conversationId);
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
      expect(isAcpRuntimeBusySnapshot(readAcpRuntimeDiagnosticsSnapshot(conversationId))).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
      expect(isAcpRuntimeBusySnapshot(readAcpRuntimeDiagnosticsSnapshot(conversationId))).toBe(true);
      expect(readAcpRuntimeDiagnosticsSnapshot(conversationId)).toEqual(
        expect.objectContaining({
          activityPhase: 'waiting',
        })
      );
    });

    mockMessageList = [
      {
        id: 'assistant-streaming-content',
        type: 'text',
        msg_id: 'content-runtime-busy',
        position: 'left',
        conversation_id: conversationId,
        content: { content: 'assistant content' },
      },
    ];
    emitAcpResponse({
      type: 'content',
      conversation_id: conversationId,
      msg_id: 'content-runtime-busy',
      data: {
        content: 'assistant content',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
      expect(isAcpRuntimeBusySnapshot(readAcpRuntimeDiagnosticsSnapshot(conversationId))).toBe(true);
      expect(readAcpRuntimeDiagnosticsSnapshot(conversationId)).toEqual(
        expect.objectContaining({
          activityPhase: 'streaming',
        })
      );
    });

    emitAcpResponse({
      type: 'finish',
      conversation_id: conversationId,
      msg_id: 'finish-runtime-busy',
      data: null,
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
      expect(isAcpRuntimeBusySnapshot(readAcpRuntimeDiagnosticsSnapshot(conversationId))).toBe(false);
      expect(readAcpRuntimeDiagnosticsSnapshot(conversationId)).toEqual(
        expect.objectContaining({
          activityPhase: 'idle',
        })
      );
    });
  });

  it('starts the next queued command exactly once after stop resets a running ACP conversation', async () => {
    const conversationId = createConversationId();
    const stopDeferred = createDeferred<void>();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockConversationStopInvoke.mockReturnValue(stopDeferred.promise);

    render(<AcpSendBox conversation_id={conversationId} backend='claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    });
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'trigger-stop' }));

    await waitFor(() => {
      expect(mockConversationStopInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });
    expect(mockConversationStopInvoke).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');

    stopDeferred.resolve(undefined);

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });
    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    expect(mockAcpSendInvoke).not.toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 2',
      })
    );
  });

  it('still releases exactly one queued command when stop.invoke rejects', async () => {
    const conversationId = createConversationId();
    const stopDeferred = createDeferred<void>();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockConversationStopInvoke.mockReturnValue(stopDeferred.promise);

    render(<AcpSendBox conversation_id={conversationId} backend='claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-stop' }));

    await waitFor(() => {
      expect(mockConversationStopInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });
    expect(mockConversationStopInvoke).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');

    stopDeferred.reject(new Error('stop failed'));

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });
    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    expect(mockAcpSendInvoke).not.toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 2',
      })
    );
  });

  it('interrupts the current turn from the queue panel and releases exactly one queued command', async () => {
    const conversationId = createConversationId();
    const stopDeferred = createDeferred<void>();
    clearAcpRuntimeDiagnosticsSnapshot(conversationId);
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockConversationStopInvoke.mockReturnValue(stopDeferred.promise);

    renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    });
    expect(screen.getByTestId('queue-send-now')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('queue-send-now'));

    await waitFor(() => {
      expect(mockConversationStopInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });
    expect(mockConversationStopInvoke).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('queue-send-now')).toHaveAttribute('data-loading', 'true');
    await openAcpDiagnostics();
    expect(screen.getByText('Send Now requested for Claude')).toBeInTheDocument();

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');

    stopDeferred.resolve(undefined);

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });
    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    expect(mockAcpSendInvoke).not.toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 2',
      })
    );
  });

  it('keeps queued ACP commands blocked while the disconnected banner is active and resumes after retry recovery', async () => {
    const conversationId = createConversationId();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-disconnected-block-queue',
      data: {
        status: 'disconnected',
        backend: 'claude',
        agentName: 'Claude',
        disconnectCode: 9,
        disconnectSignal: 'SIGTERM',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');

    clickBannerAction('acp-disconnected-banner');

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-session-active-after-retry-unblocks-queue',
      data: {
        status: 'session_active',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    expect(mockAcpSendInvoke).not.toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 2',
      })
    );
  });

  it('pauses queued ACP commands behind a live generic error until the user explicitly resumes', async () => {
    const conversationId = createConversationId();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
      expect(screen.getByTestId('queue-paused')).toHaveTextContent('false');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-error-pauses-queue',
      data: {
        status: 'error',
        backend: 'claude',
        agentName: 'Claude',
        disconnectCode: 23,
        disconnectSignal: 'SIGTERM',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-error-banner')).toBeInTheDocument();
      expect(screen.getByTestId('queue-paused')).toHaveTextContent('true');
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('queue-toggle-pause'));

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });
    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });
  });

  it('keeps a live-error ACP queue paused after removing the first queued command until the user explicitly resumes', async () => {
    const conversationId = createConversationId();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
      expect(screen.getByTestId('queue-paused')).toHaveTextContent('false');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-error-preserves-pause-after-remove',
      data: {
        status: 'error',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-error-banner')).toBeInTheDocument();
      expect(screen.getByTestId('queue-paused')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByTestId('queue-remove-first'));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
      expect(screen.getByTestId('queue-paused')).toHaveTextContent('true');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('queue-toggle-pause'));

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });
    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 2',
      })
    );
  });

  it('resets the live-error queue acknowledgement when switching conversations', async () => {
    const conversationA = createConversationId();
    const conversationB = createConversationId();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationA,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    const { rerender } = renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationA,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationA,
      msg_id: 'status-error-before-switch',
      data: {
        status: 'error',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('queue-paused')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByTestId('queue-toggle-pause'));

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    mockConversationGetInvoke.mockResolvedValue({
      id: conversationB,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    rerender(
      <>
        <AcpRuntimeStatusButton conversationId={conversationB} backend='claude' agentName='Claude' />
        <AcpSendBox conversation_id={conversationB} backend='claude' agentName='Claude' />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('0');
    });

    mockConversationGetInvoke.mockResolvedValue({
      id: conversationA,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    rerender(
      <>
        <AcpRuntimeStatusButton conversationId={conversationA} backend='claude' agentName='Claude' />
        <AcpSendBox conversation_id={conversationA} backend='claude' agentName='Claude' />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationA,
      msg_id: 'status-error-after-switch',
      data: {
        status: 'error',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('queue-paused')).toHaveTextContent('true');
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps queued ACP commands blocked while retry warmup is pending even if session_active arrives early', async () => {
    const conversationId = createConversationId();
    const warmupDeferred = createDeferred<boolean>();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockConversationWarmupInvoke.mockReturnValueOnce(warmupDeferred.promise);

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-disconnected-before-early-session-active',
      data: {
        status: 'disconnected',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
      expect(screen.queryByTestId('queue-send-now')).not.toBeInTheDocument();
    });

    clickBannerAction('acp-disconnected-banner');

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-session-active-before-retry-resolves',
      data: {
        status: 'session_active',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await flushMicrotasks();
    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    await act(async () => {
      warmupDeferred.resolve(true);
      await warmupDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });
  });

  it('queues fresh sends behind a pending retry recovery instead of racing the warmup', async () => {
    const conversationId = createConversationId();
    const warmupDeferred = createDeferred<boolean>();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockConversationWarmupInvoke.mockReturnValueOnce(warmupDeferred.promise);

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-disconnected-before-pending-retry-send',
      data: {
        status: 'disconnected',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
    });

    clickBannerAction('acp-disconnected-banner');

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
      expect(screen.getByTestId('queue-paused')).toHaveTextContent('false');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-session-active-before-retry-send-resolves',
      data: {
        status: 'session_active',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    await act(async () => {
      warmupDeferred.resolve(true);
      await warmupDeferred.promise;
    });

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });
    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );
  });

  it('keeps queued ACP commands blocked while authenticate is pending even if session_active arrives early', async () => {
    const conversationId = createConversationId();
    const authenticateDeferred = createDeferred<{ success: boolean }>();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockAcpAuthenticateInvoke.mockReturnValueOnce(authenticateDeferred.promise);

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-auth-required-before-early-session-active',
      data: {
        status: 'auth_required',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
      expect(screen.queryByTestId('queue-send-now')).not.toBeInTheDocument();
    });

    clickBannerAction('acp-auth-banner');

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: conversationId });
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-session-active-before-auth-resolves',
      data: {
        status: 'session_active',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await flushMicrotasks();
    expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    await act(async () => {
      authenticateDeferred.resolve({ success: true });
      await authenticateDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });
  });

  it('queues fresh sends behind a pending authenticate recovery instead of racing the recovery flow', async () => {
    const conversationId = createConversationId();
    const authenticateDeferred = createDeferred<{ success: boolean }>();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });
    mockAcpAuthenticateInvoke.mockReturnValueOnce(authenticateDeferred.promise);

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-auth-required-before-pending-auth-send',
      data: {
        status: 'auth_required',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
    });

    clickBannerAction('acp-auth-banner');

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: conversationId });
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
      expect(screen.getByTestId('queue-paused')).toHaveTextContent('false');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-session-active-before-auth-send-resolves',
      data: {
        status: 'session_active',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    await act(async () => {
      authenticateDeferred.resolve({ success: true });
      await authenticateDeferred.promise;
    });

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });
    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );
  });

  it('keeps queued ACP commands blocked across disconnected-to-auth recovery handoff and hides Send Now', async () => {
    const conversationId = createConversationId();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
      expect(screen.getByTestId('queue-send-now')).toBeInTheDocument();
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-disconnected-before-auth-handoff',
      data: {
        status: 'disconnected',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
      expect(screen.queryByTestId('queue-send-now')).not.toBeInTheDocument();
    });

    clickBannerAction('acp-disconnected-banner');

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-auth-required-after-retry',
      data: {
        status: 'auth_required',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
      expect(screen.queryByTestId('queue-send-now')).not.toBeInTheDocument();
    });

    await flushMicrotasks();
    expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    clickBannerAction('acp-auth-banner');

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: conversationId });
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-session-active-after-auth-handoff',
      data: {
        status: 'session_active',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });
  });

  it('queues fresh sends behind a blocked recovery barrier when queued work already exists', async () => {
    const conversationId = createConversationId();
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-1' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-disconnected-before-fresh-send',
      data: {
        status: 'disconnected',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    clickBannerAction('acp-disconnected-banner');

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-session-active-after-fresh-send-block',
      data: {
        status: 'session_active',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'queued command 1',
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('1');
    });
  });

  it('keeps hydrated disconnected ACP queues blocked after reopen until retry recovery completes', async () => {
    const conversationId = createConversationId();
    window.sessionStorage.setItem(
      `conversation-command-queue/${conversationId}`,
      JSON.stringify({
        isPaused: false,
        items: [
          { id: 'persisted-disconnected-1', input: 'persisted queued 1', files: [], createdAt: 1 },
          { id: 'persisted-disconnected-2', input: 'persisted queued 2', files: [], createdAt: 2 },
        ],
      })
    );
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          status: 'disconnected',
          updatedAt: Date.now(),
          backend: 'claude',
          agentName: 'Claude',
          disconnectCode: 9,
          disconnectSignal: 'SIGTERM',
        },
      },
    });

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    clickBannerAction('acp-disconnected-banner');

    await waitFor(() => {
      expect(mockConversationWarmupInvoke).toHaveBeenCalledWith({ conversation_id: conversationId });
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-session-active-after-hydrated-disconnected',
      data: {
        status: 'session_active',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-disconnected-banner')).not.toBeInTheDocument();
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'persisted queued 1',
      })
    );
  });

  it('keeps hydrated auth-required ACP queues blocked after reopen until authentication completes', async () => {
    const conversationId = createConversationId();
    window.sessionStorage.setItem(
      `conversation-command-queue/${conversationId}`,
      JSON.stringify({
        isPaused: false,
        items: [
          { id: 'persisted-auth-1', input: 'persisted auth queue 1', files: [], createdAt: 1 },
          { id: 'persisted-auth-2', input: 'persisted auth queue 2', files: [], createdAt: 2 },
        ],
      })
    );
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          status: 'auth_required',
          updatedAt: Date.now(),
          backend: 'claude',
          agentName: 'Claude',
        },
      },
    });

    render(<AcpSendBox conversation_id={conversationId} backend='claude' agentName='Claude' />);

    await waitFor(() => {
      expect(screen.getByTestId('acp-auth-banner')).toBeInTheDocument();
      expect(screen.getByTestId('queue-panel')).toHaveTextContent('2');
      expect(screen.getByTestId('sendbox-loading')).toHaveTextContent('false');
    });

    await flushMicrotasks();
    expect(mockAcpSendInvoke).not.toHaveBeenCalled();

    clickBannerAction('acp-auth-banner');

    await waitFor(() => {
      expect(mockAcpAuthenticateInvoke).toHaveBeenCalledWith({ conversationId: conversationId });
    });

    emitAcpResponse({
      type: 'agent_status',
      conversation_id: conversationId,
      msg_id: 'status-session-active-after-hydrated-auth',
      data: {
        status: 'session_active',
        backend: 'claude',
        agentName: 'Claude',
      },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('acp-auth-banner')).not.toBeInTheDocument();
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'persisted auth queue 1',
      })
    );
  });

  it('does not leave hydrated generic ACP errors silently blocking queued work after reopen', async () => {
    const conversationId = createConversationId();
    window.sessionStorage.setItem(
      `conversation-command-queue/${conversationId}`,
      JSON.stringify({
        isPaused: false,
        items: [
          { id: 'persisted-error-1', input: 'persisted error queue 1', files: [], createdAt: 1 },
          { id: 'persisted-error-2', input: 'persisted error queue 2', files: [], createdAt: 2 },
        ],
      })
    );
    mockConversationGetInvoke.mockResolvedValue({
      id: conversationId,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          status: 'error',
          updatedAt: Date.now(),
          backend: 'claude',
          agentName: 'Claude',
        },
      },
    });

    renderAcpSendBoxWithDiagnostics({
      conversation_id: conversationId,
      backend: 'claude',
      agentName: 'Claude',
    });

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });
    expect(mockAcpSendInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: conversationId,
        input: 'persisted error queue 1',
      })
    );

    expect(screen.queryByTestId('acp-error-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('queue-paused')).toHaveTextContent('false');
  });
});
