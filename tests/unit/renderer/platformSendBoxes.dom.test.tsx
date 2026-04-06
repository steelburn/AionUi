import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueueItem = {
  commandId: string;
  input: string;
  files: string[];
  createdAt: number;
};

const queueSpies = {
  enqueue: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  reorder: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  lockInteraction: vi.fn(),
  unlockInteraction: vi.fn(),
  resetActiveExecution: vi.fn(),
};

const mockShouldEnqueueConversationCommand = vi.fn(() => false);
const mockUseConversationCommandQueue = vi.fn(() => ({
  items: [] as QueueItem[],
  isPaused: false,
  isInteractionLocked: false,
  hasPendingCommands: false,
  ...queueSpies,
}));

const mockConversationGetInvoke = vi.fn();
const mockConversationStopInvoke = vi.fn();
const mockConversationWarmupInvoke = vi.fn();
const mockConversationSendInvoke = vi.fn();
const mockAcpSendInvoke = vi.fn();
const mockAcpAuthenticateInvoke = vi.fn();
const mockGeminiSendInvoke = vi.fn();
const mockOpenClawSendInvoke = vi.fn();
const mockOpenClawRuntimeInvoke = vi.fn();
const mockDatabaseMessagesInvoke = vi.fn();

const mockAddOrUpdateMessage = vi.fn();
const mockRemoveMessageByMsgId = vi.fn();
const mockCheckAndUpdateTitle = vi.fn();
const mockEmitterEmit = vi.fn();
const mockArcoError = vi.fn();
const mockArcoWarning = vi.fn();
const mockArcoSuccess = vi.fn();
const mockAssertBridgeSuccess = vi.fn();
const mockSharedSendBoxRender = vi.fn();
const mockSetSendBoxHandler = vi.fn();
const mockClearFiles = vi.fn();
const mockAcpResetState = vi.fn();
const mockAppendAcpUiLog = vi.fn();
const mockPrimeRequestTraceFallback = vi.fn();
const mockClearPendingRequestTraceFallback = vi.fn(() => false);
const mockBeginPendingFirstResponse = vi.fn();
const mockClearPendingFirstResponse = vi.fn();
const mockUseAcpInitialMessage = vi.fn();
const mockUseAcpRuntimeDiagnostics = vi.fn(() => ({
  status: null,
  statusSource: null,
  statusRevision: 0,
  activityPhase: 'idle',
  uiWarmupPending: false,
  hasThinkingMessage: false,
  logs: [],
}));
const mockUseAcpMessage = vi.fn(() => ({
  thought: { subject: '', description: '' },
  running: false,
  hasHydratedRunningState: true,
  acpStatus: null,
  acpStatusRevision: 0,
  acpLogs: [],
  appendAcpUiLog: mockAppendAcpUiLog,
  primeRequestTraceFallback: mockPrimeRequestTraceFallback,
  clearPendingRequestTraceFallback: mockClearPendingRequestTraceFallback,
  aiProcessing: false,
  beginPendingFirstResponse: mockBeginPendingFirstResponse,
  clearPendingFirstResponse: mockClearPendingFirstResponse,
  resetState: mockAcpResetState,
  tokenUsage: null,
  contextLimit: 0,
  hasThinkingMessage: false,
}));

let uuidCounter = 0;

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: (...args: unknown[]) => mockConversationGetInvoke(...args) },
      stop: { invoke: (...args: unknown[]) => mockConversationStopInvoke(...args) },
      warmup: { invoke: (...args: unknown[]) => mockConversationWarmupInvoke(...args) },
      sendMessage: { invoke: (...args: unknown[]) => mockConversationSendInvoke(...args) },
      responseStream: { on: vi.fn(() => vi.fn()) },
    },
    acpConversation: {
      sendMessage: { invoke: (...args: unknown[]) => mockAcpSendInvoke(...args) },
      authenticate: { invoke: (...args: unknown[]) => mockAcpAuthenticateInvoke(...args) },
    },
    geminiConversation: {
      sendMessage: { invoke: (...args: unknown[]) => mockGeminiSendInvoke(...args) },
    },
    openclawConversation: {
      sendMessage: { invoke: (...args: unknown[]) => mockOpenClawSendInvoke(...args) },
      getRuntime: { invoke: (...args: unknown[]) => mockOpenClawRuntimeInvoke(...args) },
      responseStream: { on: vi.fn(() => vi.fn()) },
    },
    database: {
      getConversationMessages: { invoke: (...args: unknown[]) => mockDatabaseMessagesInvoke(...args) },
    },
  },
}));

vi.mock('@/common/chat/chatLib', () => ({
  transformMessage: vi.fn((message: unknown) => message),
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => `uuid-${++uuidCounter}`),
}));

vi.mock('@/renderer/components/chat/sendbox', () => ({
  __esModule: true,
  default: ({
    autoFocus,
    disabled,
    loading,
    placeholder,
    onSend,
    onStop,
  }: {
    autoFocus?: boolean;
    disabled?: boolean;
    loading?: boolean;
    placeholder?: string;
    onSend: (message: string) => Promise<void> | void;
    onStop?: () => Promise<void> | void;
  }) => {
    mockSharedSendBoxRender({
      autoFocus,
      disabled,
      loading,
      placeholder,
    });
    return React.createElement(
      'div',
      {},
      React.createElement('div', { 'data-testid': 'sendbox-loading' }, String(Boolean(loading))),
      React.createElement('div', { 'data-testid': 'sendbox-placeholder' }, placeholder ?? ''),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled,
          onClick: () => {
            void Promise.resolve(onSend('queued command')).catch(() => {});
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
    );
  },
}));

vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({
  __esModule: true,
  default: ({ items }: { items: QueueItem[] }) =>
    React.createElement('div', { 'data-testid': 'queue-panel' }, String(items.length)),
}));

vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'thought-display' }),
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

vi.mock('@/renderer/components/agent/AgentSetupCard', () => ({
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

vi.mock('@/renderer/hooks/agent/useAgentReadinessCheck', () => ({
  useAgentReadinessCheck: vi.fn(() => ({
    isChecking: false,
    error: null,
    availableAgents: [],
    bestAgent: null,
    progress: 0,
    currentAgent: null,
    performFullCheck: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  })),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => mockAddOrUpdateMessage,
  useRemoveMessageByMsgId: () => mockRemoveMessageByMsgId,
}));

vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  shouldEnqueueConversationCommand: (...args: unknown[]) => mockShouldEnqueueConversationCommand(...args),
  useConversationCommandQueue: (...args: unknown[]) => mockUseConversationCommandQueue(...args),
}));

vi.mock('@/renderer/pages/conversation/platforms/assertBridgeSuccess', () => ({
  assertBridgeSuccess: (...args: unknown[]) => mockAssertBridgeSuccess(...args),
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/useAcpMessage', () => ({
  useAcpMessage: (...args: unknown[]) => mockUseAcpMessage(...args),
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/acpRuntimeDiagnostics', () => ({
  useAcpRuntimeDiagnostics: (...args: unknown[]) => mockUseAcpRuntimeDiagnostics(...args),
  setAcpRuntimeUiWarmupPending: vi.fn(),
  isAcpRuntimeWaitingSnapshot: ({
    activityPhase,
    uiWarmupPending,
  }: {
    activityPhase?: string;
    uiWarmupPending?: boolean;
  }) => activityPhase === 'waiting' || uiWarmupPending === true,
  isAcpRuntimeBusySnapshot: ({
    activityPhase,
    uiWarmupPending,
  }: {
    activityPhase?: string;
    uiWarmupPending?: boolean;
  }) => activityPhase !== 'idle' || uiWarmupPending === true,
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/useAcpInitialMessage', () => ({
  useAcpInitialMessage: (...args: unknown[]) => mockUseAcpInitialMessage(...args),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/useGeminiMessage', () => ({
  useGeminiMessage: vi.fn(() => ({
    thought: { subject: '', description: '' },
    running: false,
    tokenUsage: 0,
    setActiveMsgId: vi.fn(),
    setWaitingResponse: vi.fn(),
    resetState: vi.fn(),
  })),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/useGeminiQuotaFallback', () => ({
  useGeminiQuotaFallback: vi.fn(() => ({
    handleGeminiError: vi.fn(),
  })),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/useGeminiInitialMessage', () => ({
  useGeminiInitialMessage: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: mockSetSendBoxHandler,
  }),
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

vi.mock('@/renderer/utils/file/messageFiles', () => ({
  buildDisplayMessage: vi.fn(
    (input: string, files: string[], workspacePath: string) => `${input}|${files.join(',')}|${workspacePath}`
  ),
  collectSelectedFiles: vi.fn((uploadFile: string[], atPath: Array<string | { path: string }>) => [
    ...uploadFile,
    ...atPath.map((item) => (typeof item === 'string' ? item : item.path)),
  ]),
}));

vi.mock('@/renderer/utils/model/modelContextLimits', () => ({
  getModelContextLimit: vi.fn(() => 8192),
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
    error: (...args: unknown[]) => mockArcoError(...args),
    warning: (...args: unknown[]) => mockArcoWarning(...args),
    success: (...args: unknown[]) => mockArcoSuccess(...args),
  },
  Space: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('div', props, children),
  Tag: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
  Typography: {
    Text: ({ children }: { children?: React.ReactNode }) => React.createElement('span', {}, children),
  },
}));

vi.mock('@icon-park/react', () => ({
  Shield: () => React.createElement('span'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; backend?: string; model?: string }) => {
      if (key === 'conversation.chat.processing') {
        return 'Processing';
      }

      return options?.defaultValue ?? options?.backend ?? options?.model ?? key;
    },
  }),
}));

import AcpSendBox from '@/renderer/pages/conversation/platforms/acp/AcpSendBox';
import GeminiSendBox from '@/renderer/pages/conversation/platforms/gemini/GeminiSendBox';
import NanobotSendBox from '@/renderer/pages/conversation/platforms/nanobot/NanobotSendBox';
import OpenClawSendBox from '@/renderer/pages/conversation/platforms/openclaw/OpenClawSendBox';

const resetQueueSpies = () => {
  for (const spy of Object.values(queueSpies)) {
    spy.mockReset();
  }
};

describe('platform send box queue integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    resetQueueSpies();
    mockAcpResetState.mockReset();
    mockSharedSendBoxRender.mockReset();
    mockPrimeRequestTraceFallback.mockReset();
    mockClearPendingRequestTraceFallback.mockReset();
    mockClearPendingRequestTraceFallback.mockReturnValue(false);
    mockBeginPendingFirstResponse.mockReset();
    mockClearPendingFirstResponse.mockReset();
    mockUseAcpInitialMessage.mockReset();

    mockShouldEnqueueConversationCommand.mockReturnValue(false);
    mockUseAcpMessage.mockReturnValue({
      thought: { subject: '', description: '' },
      running: false,
      hasHydratedRunningState: true,
      acpStatus: null,
      acpStatusRevision: 0,
      acpLogs: [],
      appendAcpUiLog: mockAppendAcpUiLog,
      primeRequestTraceFallback: mockPrimeRequestTraceFallback,
      clearPendingRequestTraceFallback: mockClearPendingRequestTraceFallback,
      aiProcessing: false,
      beginPendingFirstResponse: mockBeginPendingFirstResponse,
      clearPendingFirstResponse: mockClearPendingFirstResponse,
      resetState: mockAcpResetState,
      tokenUsage: null,
      contextLimit: 0,
      hasThinkingMessage: false,
    });
    mockUseAcpRuntimeDiagnostics.mockReturnValue({
      status: null,
      statusSource: null,
      statusRevision: 0,
      activityPhase: 'idle',
      uiWarmupPending: false,
      hasThinkingMessage: false,
      logs: [],
    });
    mockUseConversationCommandQueue.mockReturnValue({
      items: [],
      isPaused: false,
      isInteractionLocked: false,
      hasPendingCommands: false,
      ...queueSpies,
    });

    mockConversationGetInvoke.mockResolvedValue({
      status: 'idle',
      extra: {
        workspace: 'C:/workspace',
      },
    });
    mockConversationStopInvoke.mockResolvedValue(undefined);
    mockConversationWarmupInvoke.mockResolvedValue(true);
    mockConversationSendInvoke.mockResolvedValue({ success: true });
    mockAcpSendInvoke.mockResolvedValue({ success: true });
    mockAcpAuthenticateInvoke.mockResolvedValue({ success: true });
    mockGeminiSendInvoke.mockResolvedValue({ success: true });
    mockOpenClawSendInvoke.mockResolvedValue({ success: true });
    mockOpenClawRuntimeInvoke.mockResolvedValue({
      success: true,
      data: {
        runtime: {
          workspace: 'C:/workspace',
          backend: 'openclaw',
          agentName: 'OpenClaw',
          cliPath: 'C:/cli/openclaw',
          model: 'model-a',
          identityHash: 'identity-1',
          hasActiveSession: true,
        },
        expected: {
          expectedWorkspace: 'C:/workspace',
          expectedBackend: 'openclaw',
          expectedAgentName: 'OpenClaw',
          expectedCliPath: 'C:/cli/openclaw',
          expectedModel: 'model-a',
          expectedIdentityHash: 'identity-1',
        },
      },
    });
    mockDatabaseMessagesInvoke.mockResolvedValue([]);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it.each([
    [
      'acp',
      <AcpSendBox conversation_id='conv-acp' backend='claude' />,
      mockAcpSendInvoke,
      (payload: { input: string; conversation_id: string }) => {
        expect(payload.input).toBe('queued command');
        expect(payload.conversation_id).toBe('conv-acp');
      },
    ],
    [
      'gemini',
      <GeminiSendBox
        conversation_id='conv-gemini'
        modelSelection={{
          currentModel: { useModel: 'gemini-2.5' },
          getDisplayModelName: (modelId: string) => modelId,
          providers: ['google'],
          geminiModeLookup: {},
          getAvailableModels: () => [],
          handleSelectModel: vi.fn(),
        }}
      />,
      mockGeminiSendInvoke,
      (payload: { input: string; conversation_id: string }) => {
        expect(payload.input).toContain('queued command');
        expect(payload.conversation_id).toBe('conv-gemini');
      },
    ],
    [
      'nanobot',
      <NanobotSendBox conversation_id='conv-nanobot' />,
      mockConversationSendInvoke,
      (payload: { input: string; conversation_id: string }) => {
        expect(payload.input).toContain('queued command');
        expect(payload.conversation_id).toBe('conv-nanobot');
      },
    ],
    [
      'openclaw',
      <OpenClawSendBox conversation_id='conv-openclaw' />,
      mockOpenClawSendInvoke,
      (payload: { input: string; conversation_id: string }) => {
        expect(payload.input).toContain('queued command');
        expect(payload.conversation_id).toBe('conv-openclaw');
      },
    ],
  ])(
    'sends commands immediately for %s when queueing is not required',
    async (_name, element, sendSpy, assertPayload) => {
      render(element);

      fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

      await waitFor(() => {
        expect(sendSpy).toHaveBeenCalledTimes(1);
      });

      assertPayload(sendSpy.mock.calls[0]?.[0] as { input: string; conversation_id: string });
      expect(queueSpies.enqueue).not.toHaveBeenCalled();
      expect(mockAssertBridgeSuccess).toHaveBeenCalled();
    }
  );

  it.each([
    ['acp', <AcpSendBox conversation_id='conv-acp' backend='claude' />],
    [
      'gemini',
      <GeminiSendBox
        conversation_id='conv-gemini'
        modelSelection={{
          currentModel: { useModel: 'gemini-2.5' },
          getDisplayModelName: (modelId: string) => modelId,
          providers: ['google'],
          geminiModeLookup: {},
          getAvailableModels: () => [],
          handleSelectModel: vi.fn(),
        }}
      />,
    ],
    ['nanobot', <NanobotSendBox conversation_id='conv-nanobot' />],
    ['openclaw', <OpenClawSendBox conversation_id='conv-openclaw' />],
  ])('enqueues commands for %s when the current turn is still busy', async (_name, element) => {
    mockShouldEnqueueConversationCommand.mockReturnValue(true);

    render(element);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(queueSpies.enqueue).toHaveBeenCalledWith({
        input: 'queued command',
        files: [],
      });
    });
  });

  it.each([
    ['acp', <AcpSendBox conversation_id='conv-acp' backend='claude' />],
    [
      'gemini',
      <GeminiSendBox
        conversation_id='conv-gemini'
        modelSelection={{
          currentModel: { useModel: 'gemini-2.5' },
          getDisplayModelName: (modelId: string) => modelId,
          providers: ['google'],
          geminiModeLookup: {},
          getAvailableModels: () => [],
          handleSelectModel: vi.fn(),
        }}
      />,
    ],
    ['nanobot', <NanobotSendBox conversation_id='conv-nanobot' />],
    ['openclaw', <OpenClawSendBox conversation_id='conv-openclaw' />],
  ])('resets active execution after stop for %s', async (_name, element) => {
    render(element);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-stop' }));

    await waitFor(() => {
      expect(mockConversationStopInvoke).toHaveBeenCalled();
    });

    expect(queueSpies.resetActiveExecution).toHaveBeenCalledWith('stop');
  });

  it('resets ACP hook state after stop resolves', async () => {
    render(<AcpSendBox conversation_id='conv-acp' backend='claude' />);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-stop' }));

    await waitFor(() => {
      expect(mockConversationStopInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockAcpResetState).toHaveBeenCalledTimes(1);
    expect(queueSpies.resetActiveExecution).toHaveBeenCalledWith('stop');
  });

  it('passes semantic pending-first-response helpers into the ACP initial-message hook', () => {
    render(<AcpSendBox conversation_id='conv-acp' backend='claude' />);

    expect(mockUseAcpInitialMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        beginPendingFirstResponse: mockBeginPendingFirstResponse,
        clearPendingFirstResponse: mockClearPendingFirstResponse,
      })
    );
  });

  it('starts ACP pending first-response state through the semantic helper on fresh sends', async () => {
    render(<AcpSendBox conversation_id='conv-acp' backend='claude' />);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(mockAcpSendInvoke).toHaveBeenCalledTimes(1);
    });

    expect(mockBeginPendingFirstResponse).toHaveBeenCalledTimes(1);
    expect(mockClearPendingFirstResponse).not.toHaveBeenCalled();
  });

  it('clears ACP pending first-response state through the semantic helper when dispatch fails', async () => {
    mockAcpSendInvoke.mockResolvedValueOnce({ success: false, msg: 'send failed' });
    mockAssertBridgeSuccess.mockImplementationOnce(() => {
      throw new Error('send failed');
    });

    render(<AcpSendBox conversation_id='conv-acp' backend='claude' />);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(mockClearPendingFirstResponse).toHaveBeenCalledTimes(1);
    });

    expect(mockBeginPendingFirstResponse).toHaveBeenCalledTimes(1);
  });

  it('renders the ACP disconnected banner when the hook reports a disconnected thread state', () => {
    mockUseAcpMessage.mockReturnValue({
      thought: { subject: '', description: '' },
      running: false,
      hasHydratedRunningState: true,
      acpStatus: 'disconnected',
      acpStatusRevision: 1,
      acpLogs: [],
      appendAcpUiLog: mockAppendAcpUiLog,
      primeRequestTraceFallback: mockPrimeRequestTraceFallback,
      clearPendingRequestTraceFallback: mockClearPendingRequestTraceFallback,
      aiProcessing: false,
      beginPendingFirstResponse: mockBeginPendingFirstResponse,
      clearPendingFirstResponse: mockClearPendingFirstResponse,
      resetState: mockAcpResetState,
      tokenUsage: null,
      contextLimit: 0,
      hasThinkingMessage: false,
    });

    render(<AcpSendBox conversation_id='conv-acp' backend='claude' agentName='Claude' />);

    expect(screen.getByTestId('acp-disconnected-banner')).toBeInTheDocument();
  });

  it('disables mount-time autofocus for ACP send boxes', () => {
    render(<AcpSendBox conversation_id='conv-acp' backend='claude' />);

    expect(mockSharedSendBoxRender).toHaveBeenCalled();
    const lastCall = mockSharedSendBoxRender.mock.calls.at(-1)?.[0] as { autoFocus?: boolean } | undefined;
    expect(lastCall?.autoFocus).toBe(false);
  });

  it('uses the processing placeholder for ACP send boxes while busy', () => {
    mockUseAcpMessage.mockReturnValue({
      thought: { subject: '', description: '' },
      running: true,
      hasHydratedRunningState: true,
      acpStatus: 'session_active',
      acpStatusSource: 'live',
      acpStatusRevision: 2,
      acpLogs: [],
      appendAcpUiLog: mockAppendAcpUiLog,
      primeRequestTraceFallback: mockPrimeRequestTraceFallback,
      clearPendingRequestTraceFallback: mockClearPendingRequestTraceFallback,
      aiProcessing: false,
      beginPendingFirstResponse: mockBeginPendingFirstResponse,
      clearPendingFirstResponse: mockClearPendingFirstResponse,
      resetState: mockAcpResetState,
      tokenUsage: null,
      contextLimit: 0,
      hasThinkingMessage: false,
    });
    mockUseAcpRuntimeDiagnostics.mockReturnValue({
      status: 'session_active',
      statusSource: 'live',
      statusRevision: 2,
      activityPhase: 'streaming',
      uiWarmupPending: false,
      hasThinkingMessage: false,
      logs: [],
    });

    render(<AcpSendBox conversation_id='conv-acp' backend='claude' agentName='Claude' />);

    const lastCall = mockSharedSendBoxRender.mock.calls.at(-1)?.[0] as { placeholder?: string } | undefined;
    expect(lastCall?.placeholder).toBe('Processing');
    expect(screen.getByTestId('sendbox-placeholder')).toHaveTextContent('Processing');
  });

  it('blocks OpenClaw dispatch when runtime validation fails', async () => {
    mockOpenClawRuntimeInvoke.mockResolvedValue({
      success: true,
      data: {
        runtime: {
          workspace: 'C:/another-workspace',
          backend: 'openclaw',
          agentName: 'OpenClaw',
          cliPath: 'C:/cli/openclaw',
          model: 'model-a',
          identityHash: 'identity-1',
          hasActiveSession: true,
        },
        expected: {
          expectedWorkspace: 'C:/workspace',
          expectedBackend: 'openclaw',
          expectedAgentName: 'OpenClaw',
          expectedCliPath: 'C:/cli/openclaw',
          expectedModel: 'model-a',
          expectedIdentityHash: 'identity-1',
        },
      },
    });

    render(<OpenClawSendBox conversation_id='conv-openclaw' />);

    fireEvent.click(screen.getByRole('button', { name: 'trigger-send' }));

    await waitFor(() => {
      expect(mockArcoError).toHaveBeenCalledWith(expect.stringContaining('Agent switch validation failed'));
    });

    expect(mockOpenClawSendInvoke).not.toHaveBeenCalled();
  });
});
