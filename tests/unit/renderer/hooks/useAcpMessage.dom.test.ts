import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAcpRuntimeDiagnosticsSnapshot,
  readAcpRuntimeDiagnosticsSnapshot,
} from '@/renderer/pages/conversation/platforms/acp/acpRuntimeDiagnostics';

let capturedResponseListener: ((message: unknown) => void) | null = null;
let mockMessageList: unknown[] = [];
const messageListListeners = new Set<() => void>();

const setMockMessageList = (nextMessageList: unknown[]): void => {
  mockMessageList = nextMessageList;
  for (const listener of messageListListeners) {
    listener();
  }
};

const mockConversationGetInvoke = vi.fn();
const mockAddOrUpdateMessage = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      responseStream: {
        on: vi.fn((listener: (message: unknown) => void) => {
          capturedResponseListener = listener;
          return () => {
            capturedResponseListener = null;
          };
        }),
      },
    },
    conversation: {
      get: {
        invoke: (...args: unknown[]) => mockConversationGetInvoke(...args),
      },
    },
  },
}));

vi.mock('@/common/chat/chatLib', () => ({
  transformMessage: vi.fn((message: unknown) => message),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  return {
    useAddOrUpdateMessage: vi.fn(() => mockAddOrUpdateMessage),
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

import { sanitizeAcpTimelineMessages, useAcpMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';

const CONVERSATION_ID = 'acp-conv-1';
const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('useAcpMessage', () => {
  beforeEach(() => {
    capturedResponseListener = null;
    setMockMessageList([]);
    mockAddOrUpdateMessage.mockReset();
    clearAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID);
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'running',
      extra: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the conversation disconnected and clears loading state on agent_status disconnected', async () => {
    setMockMessageList([
      {
        id: 'assistant-mid-stream-before-disconnect',
        type: 'text',
        msg_id: 'assistant-mid-stream-before-disconnect',
        position: 'left',
        conversation_id: CONVERSATION_ID,
        content: { content: 'Streaming response already started' },
      },
    ]);

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.running).toBe(true);
    expect(result.current.aiProcessing).toBe(false);

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-1',
        data: {
          backend: 'claude',
          status: 'disconnected',
          disconnectCode: 42,
          disconnectSignal: null,
        },
      });
    });

    expect(result.current.acpStatus).toBe('disconnected');
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
    expect(mockAddOrUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent_status',
        msg_id: 'status-1',
      })
    );
    expect(result.current.acpLogs[0]).toEqual(
      expect.objectContaining({
        kind: 'status',
        status: 'disconnected',
        disconnectCode: 42,
        disconnectSignal: null,
      })
    );
  });

  it('does not reset live ACP diagnostics when the message list changes after a terminal status arrives', async () => {
    setMockMessageList([
      {
        id: 'assistant-mid-stream-before-terminal',
        type: 'text',
        msg_id: 'assistant-mid-stream-before-terminal',
        position: 'left',
        conversation_id: CONVERSATION_ID,
        content: { content: 'Streaming response already started' },
      },
    ]);

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-before-message-list-update',
        data: {
          backend: 'claude',
          status: 'disconnected',
          disconnectCode: 7,
          disconnectSignal: 'SIGTERM',
        },
      });
    });

    expect(result.current.acpStatus).toBe('disconnected');
    expect(result.current.acpLogs[0]).toEqual(
      expect.objectContaining({
        status: 'disconnected',
        disconnectCode: 7,
        disconnectSignal: 'SIGTERM',
      })
    );

    act(() => {
      setMockMessageList([
        {
          id: 'assistant-mid-stream-before-terminal',
          type: 'text',
          msg_id: 'assistant-mid-stream-before-terminal',
          position: 'left',
          conversation_id: CONVERSATION_ID,
          content: { content: 'Streaming response already started' },
        },
        {
          id: 'assistant-late-history',
          type: 'thinking',
          msg_id: 'assistant-late-history',
          position: 'left',
          conversation_id: CONVERSATION_ID,
          content: {
            content: 'Thinking patch landed in the list',
            status: 'thinking',
          },
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.acpStatus).toBe('disconnected');
    });

    expect(result.current.acpLogs[0]).toEqual(
      expect.objectContaining({
        status: 'disconnected',
        disconnectCode: 7,
        disconnectSignal: 'SIGTERM',
      })
    );
  });

  it('publishes waiting then streaming ACP runtime diagnostics phases for the header status dot', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
      expect.objectContaining({
        status: null,
        statusSource: null,
        activityPhase: 'idle',
        hasThinkingMessage: false,
      })
    );

    act(() => {
      result.current.setAiProcessing(true);
    });

    await waitFor(() => {
      expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
        expect.objectContaining({
          activityPhase: 'waiting',
          hasThinkingMessage: false,
        })
      );
    });

    act(() => {
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'content-first-response',
        data: {
          content: 'hello',
        },
      });
    });

    await waitFor(() => {
      expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
        expect.objectContaining({
          status: 'session_active',
          statusSource: 'live',
          activityPhase: 'streaming',
          hasThinkingMessage: false,
        })
      );
    });

    act(() => {
      capturedResponseListener?.({
        type: 'finish',
        conversation_id: CONVERSATION_ID,
        msg_id: 'finish-after-content',
        data: null,
      });
    });

    await waitFor(() => {
      expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
        expect.objectContaining({
          activityPhase: 'idle',
          hasThinkingMessage: false,
        })
      );
    });
  });

  it('keeps a hydrated running ACP conversation in waiting when the latest visible timeline message is still user-side', async () => {
    setMockMessageList([
      {
        id: 'user-turn-1',
        type: 'text',
        msg_id: 'user-turn-1',
        position: 'right',
        conversation_id: CONVERSATION_ID,
        content: { content: 'User message before first ACP response' },
      },
    ]);

    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.running).toBe(true);
    expect(result.current.aiProcessing).toBe(true);
    expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
      expect.objectContaining({
        activityPhase: 'waiting',
        hasThinkingMessage: false,
      })
    );
  });

  it('ignores stale message-list entries from a different conversation when classifying a hydrated running ACP thread', async () => {
    setMockMessageList([
      {
        id: 'stale-assistant-from-other-conversation',
        type: 'text',
        msg_id: 'stale-assistant-from-other-conversation',
        position: 'left',
        conversation_id: 'other-conversation',
        content: { content: 'Other thread is already streaming' },
      },
      {
        id: 'current-user-message',
        type: 'text',
        msg_id: 'current-user-message',
        position: 'right',
        conversation_id: CONVERSATION_ID,
        content: { content: 'Current thread is still waiting for the first response' },
      },
    ]);

    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.running).toBe(true);
    expect(result.current.aiProcessing).toBe(true);
    expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
      expect.objectContaining({
        activityPhase: 'waiting',
      })
    );
  });

  it('hydrates a running ACP conversation as streaming instead of re-entering the warmup phase once assistant-side activity exists', async () => {
    setMockMessageList([
      {
        id: 'assistant-turn-1',
        type: 'text',
        msg_id: 'assistant-turn-1',
        position: 'left',
        conversation_id: CONVERSATION_ID,
        content: { content: 'Assistant content already streaming' },
      },
    ]);

    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.running).toBe(true);
    expect(result.current.aiProcessing).toBe(false);
    expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
      expect.objectContaining({
        activityPhase: 'streaming',
        hasThinkingMessage: false,
      })
    );
  });

  it('reclassifies a hydrated running ACP conversation from waiting to streaming when assistant-side history finishes hydrating', async () => {
    setMockMessageList([
      {
        id: 'user-turn-2',
        type: 'text',
        msg_id: 'user-turn-2',
        position: 'right',
        conversation_id: CONVERSATION_ID,
        content: { content: 'Still waiting for first response' },
      },
    ]);

    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'running',
      extra: {},
    });

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.aiProcessing).toBe(true);
    expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
      expect.objectContaining({
        activityPhase: 'waiting',
      })
    );

    act(() => {
      setMockMessageList([
        {
          id: 'assistant-turn-2',
          type: 'thinking',
          msg_id: 'assistant-turn-2',
          position: 'left',
          conversation_id: CONVERSATION_ID,
          content: {
            content: 'Thinking through the request',
            status: 'thinking',
          },
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.aiProcessing).toBe(false);
    });

    expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
      expect.objectContaining({
        activityPhase: 'streaming',
      })
    );
  });

  it('publishes inline thinking presence so warmup UI can yield while ACP is still waiting', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {},
    });

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      result.current.setAiProcessing(true);
    });

    await waitFor(() => {
      expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
        expect.objectContaining({
          activityPhase: 'waiting',
          hasThinkingMessage: false,
        })
      );
    });

    act(() => {
      capturedResponseListener?.({
        type: 'thinking',
        conversation_id: CONVERSATION_ID,
        msg_id: 'thinking-before-first-content',
        data: {
          content: 'Thinking through the request',
          status: 'thinking',
        },
      });
    });

    await waitFor(() => {
      expect(readAcpRuntimeDiagnosticsSnapshot(CONVERSATION_ID)).toEqual(
        expect.objectContaining({
          activityPhase: 'waiting',
          hasThinkingMessage: true,
        })
      );
    });
  });

  it('filters legacy ACP status and infrastructure error noise from hydrated timelines', () => {
    const sanitized = sanitizeAcpTimelineMessages([
      {
        id: 'status-message',
        msg_id: 'status-message',
        conversation_id: CONVERSATION_ID,
        type: 'agent_status',
        position: 'center',
        content: {
          backend: 'claude',
          status: 'disconnected',
        },
      },
      {
        id: 'runtime-error',
        msg_id: 'runtime-error',
        conversation_id: CONVERSATION_ID,
        type: 'tips',
        position: 'center',
        content: {
          type: 'error',
          content: 'ACP process exited unexpectedly (code: null, signal: SIGTERM)',
        },
      },
      {
        id: 'user-text',
        msg_id: 'user-text',
        conversation_id: CONVERSATION_ID,
        type: 'text',
        position: 'right',
        content: {
          content: 'hello',
        },
      },
    ]);

    expect(sanitized).toEqual([
      expect.objectContaining({
        id: 'user-text',
        type: 'text',
      }),
    ]);
  });

  it('does not let slash_commands_updated clear a stale disconnected ACP status before live recovery', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-for-recovery',
        data: {
          backend: 'claude',
          status: 'disconnected',
        },
      });
    });

    expect(result.current.acpStatus).toBe('disconnected');

    act(() => {
      capturedResponseListener?.({
        type: 'slash_commands_updated',
        conversation_id: CONVERSATION_ID,
        msg_id: 'slash-commands-updated-1',
        data: null,
      });
    });

    expect(result.current.acpStatus).toBe('disconnected');
    expect(result.current.slashCommandsRevision).toBe(1);
  });

  it('does not let slash_commands_updated clear a stale auth_required ACP status before live recovery', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-for-recovery',
        data: {
          backend: 'claude',
          status: 'auth_required',
        },
      });
    });

    expect(result.current.acpStatus).toBe('auth_required');
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);

    act(() => {
      capturedResponseListener?.({
        type: 'slash_commands_updated',
        conversation_id: CONVERSATION_ID,
        msg_id: 'slash-commands-updated-auth-recovery',
        data: null,
      });
    });

    expect(result.current.acpStatus).toBe('auth_required');
    expect(result.current.slashCommandsRevision).toBe(1);
  });

  it('recovers a stale disconnected ACP status when a fresh turn starts', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-before-fresh-start',
        data: {
          backend: 'claude',
          status: 'disconnected',
        },
      });
    });

    expect(result.current.acpStatus).toBe('disconnected');

    act(() => {
      capturedResponseListener?.({
        type: 'start',
        conversation_id: CONVERSATION_ID,
        msg_id: 'start-after-disconnected',
        data: null,
      });
    });

    expect(result.current.acpStatus).toBe('session_active');
    expect(result.current.running).toBe(true);
  });

  it('recovers a stale auth_required ACP status when the next turn starts', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-before-fresh-content',
        data: {
          backend: 'claude',
          status: 'auth_required',
        },
      });
    });

    expect(result.current.acpStatus).toBe('auth_required');

    act(() => {
      capturedResponseListener?.({
        type: 'start',
        conversation_id: CONVERSATION_ID,
        msg_id: 'start-after-auth-required',
        data: null,
      });
    });

    expect(result.current.acpStatus).toBe('session_active');
    expect(result.current.running).toBe(true);
  });

  it('ignores late content after auth_required until a fresh start reopens the turn gate', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-auth-required-before-late-content',
        data: {
          backend: 'claude',
          status: 'auth_required',
        },
      });
    });

    mockAddOrUpdateMessage.mockReset();

    act(() => {
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'late-content-after-auth-required',
        data: {
          content: 'should be ignored',
        },
      });
    });

    expect(result.current.acpStatus).toBe('auth_required');
    expect(result.current.running).toBe(false);
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  it('does not treat connection lifecycle statuses as a running turn', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-disconnected-for-connection-recovery',
        data: {
          backend: 'claude',
          status: 'disconnected',
        },
      });
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-connected-for-connection-recovery',
        data: {
          backend: 'claude',
          status: 'connected',
        },
      });
    });

    expect(result.current.acpStatus).toBe('connected');
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
  });

  it('records ACP request lifecycle logs for start, first response, and finish', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      dateNowSpy.mockReturnValue(1000);
      const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        capturedResponseListener?.({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-1',
          data: {
            backend: 'claude',
            modelId: 'claude-sonnet',
            timestamp: 1000,
          },
        });
      });

      dateNowSpy.mockReturnValue(1250);
      act(() => {
        capturedResponseListener?.({
          type: 'content',
          conversation_id: CONVERSATION_ID,
          msg_id: 'content-3',
          data: {
            content: 'hello',
          },
        });
      });

      dateNowSpy.mockReturnValue(1800);
      act(() => {
        capturedResponseListener?.({
          type: 'finish',
          conversation_id: CONVERSATION_ID,
          msg_id: 'finish-3',
          data: null,
        });
      });

      expect(result.current.acpLogs.map((entry) => entry.kind)).toEqual([
        'request_finished',
        'first_response',
        'request_started',
      ]);
      expect(result.current.acpLogs[0]).toEqual(
        expect.objectContaining({
          kind: 'request_finished',
          durationMs: 800,
          modelId: 'claude-sonnet',
        })
      );
      expect(result.current.acpLogs[1]).toEqual(
        expect.objectContaining({
          kind: 'first_response',
          durationMs: 250,
        })
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('falls back to first-response and finish logs when a turn starts without request_trace', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      dateNowSpy.mockReturnValue(1000);
      const { result } = renderHook(() =>
        useAcpMessage(CONVERSATION_ID, {
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          sessionMode: 'default',
        })
      );

      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        capturedResponseListener?.({
          type: 'start',
          conversation_id: CONVERSATION_ID,
          msg_id: 'start-fallback-1',
          data: null,
        });
      });

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        capturedResponseListener?.({
          type: 'content',
          conversation_id: CONVERSATION_ID,
          msg_id: 'content-fallback-1',
          data: {
            content: 'hello',
          },
        });
      });

      dateNowSpy.mockReturnValue(1700);
      act(() => {
        capturedResponseListener?.({
          type: 'finish',
          conversation_id: CONVERSATION_ID,
          msg_id: 'finish-fallback-1',
          data: null,
        });
      });

      expect(result.current.acpLogs.map((entry) => entry.kind)).toEqual(['request_finished', 'first_response']);
      expect(result.current.acpLogs[0]).toEqual(
        expect.objectContaining({
          kind: 'request_finished',
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          durationMs: 700,
        })
      );
      expect(result.current.acpLogs[1]).toEqual(
        expect.objectContaining({
          kind: 'first_response',
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          durationMs: 300,
        })
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('can prime a fallback request trace before the first response stream events arrive', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      dateNowSpy.mockReturnValue(1000);
      const { result } = renderHook(() =>
        useAcpMessage(CONVERSATION_ID, {
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          sessionMode: 'default',
        })
      );

      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        result.current.primeRequestTraceFallback({
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          sessionMode: 'default',
          timestamp: 1000,
        });
      });

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        capturedResponseListener?.({
          type: 'content',
          conversation_id: CONVERSATION_ID,
          msg_id: 'content-primed-1',
          data: {
            content: 'hello',
          },
        });
      });

      dateNowSpy.mockReturnValue(1700);
      act(() => {
        capturedResponseListener?.({
          type: 'finish',
          conversation_id: CONVERSATION_ID,
          msg_id: 'finish-primed-1',
          data: null,
        });
      });

      expect(result.current.acpLogs.map((entry) => entry.kind)).toEqual(['request_finished', 'first_response']);
      expect(result.current.acpLogs[0]).toEqual(
        expect.objectContaining({
          kind: 'request_finished',
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          durationMs: 700,
        })
      );
      expect(result.current.acpLogs[1]).toEqual(
        expect.objectContaining({
          kind: 'first_response',
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          durationMs: 300,
        })
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('refreshes a stale fallback request trace when a new send primes again before live events arrive', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      dateNowSpy.mockReturnValue(1000);
      const { result } = renderHook(() =>
        useAcpMessage(CONVERSATION_ID, {
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          sessionMode: 'default',
        })
      );

      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        result.current.primeRequestTraceFallback({
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          sessionMode: 'default',
          timestamp: 1000,
        });
      });

      dateNowSpy.mockReturnValue(2000);
      act(() => {
        result.current.primeRequestTraceFallback({
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          sessionMode: 'default',
          timestamp: 2000,
        });
      });

      dateNowSpy.mockReturnValue(2300);
      act(() => {
        capturedResponseListener?.({
          type: 'content',
          conversation_id: CONVERSATION_ID,
          msg_id: 'content-refreshed-fallback-1',
          data: {
            content: 'hello',
          },
        });
      });

      dateNowSpy.mockReturnValue(2600);
      act(() => {
        capturedResponseListener?.({
          type: 'finish',
          conversation_id: CONVERSATION_ID,
          msg_id: 'finish-refreshed-fallback-1',
          data: null,
        });
      });

      expect(result.current.acpLogs.map((entry) => entry.kind)).toEqual(['request_finished', 'first_response']);
      expect(result.current.acpLogs[0]).toEqual(
        expect.objectContaining({
          kind: 'request_finished',
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          durationMs: 600,
        })
      );
      expect(result.current.acpLogs[1]).toEqual(
        expect.objectContaining({
          kind: 'first_response',
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          durationMs: 300,
        })
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('does not turn a cleared fallback trace into a request lifecycle error when a synthetic send failure arrives', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      dateNowSpy.mockReturnValue(1000);
      const { result } = renderHook(() =>
        useAcpMessage(CONVERSATION_ID, {
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          sessionMode: 'default',
        })
      );

      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        result.current.primeRequestTraceFallback({
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          sessionMode: 'default',
          timestamp: 1000,
        });
      });

      expect(result.current.clearPendingRequestTraceFallback()).toBe(true);

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        capturedResponseListener?.({
          type: 'error',
          conversation_id: CONVERSATION_ID,
          msg_id: 'error-cleared-fallback-1',
          data: 'authentication failed before ACP request started',
        });
      });

      expect(result.current.acpLogs).toEqual([]);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('does not let fallback cleanup clear a live traced request', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      dateNowSpy.mockReturnValue(1000);
      const { result } = renderHook(() =>
        useAcpMessage(CONVERSATION_ID, {
          backend: 'custom',
          agentName: 'Fake ACP Agent',
          sessionMode: 'default',
        })
      );

      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        capturedResponseListener?.({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'request-trace-live-1',
          data: {
            backend: 'custom',
            modelId: 'fake-model-1',
            timestamp: 1000,
          },
        });
      });

      expect(result.current.clearPendingRequestTraceFallback()).toBe(false);

      dateNowSpy.mockReturnValue(1300);
      act(() => {
        capturedResponseListener?.({
          type: 'error',
          conversation_id: CONVERSATION_ID,
          msg_id: 'error-live-trace-1',
          data: 'runtime disconnected after ACP request started',
        });
      });

      expect(result.current.acpLogs.map((entry) => entry.kind)).toEqual(['request_error', 'request_started']);
      expect(result.current.acpLogs[0]).toEqual(
        expect.objectContaining({
          kind: 'request_error',
          backend: 'custom',
          modelId: 'fake-model-1',
          durationMs: 300,
        })
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('does not record a successful finish when a traced turn disconnects mid-stream', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      dateNowSpy.mockReturnValue(1000);
      const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        capturedResponseListener?.({
          type: 'request_trace',
          conversation_id: CONVERSATION_ID,
          msg_id: 'trace-crash-1',
          data: {
            backend: 'claude',
            modelId: 'claude-sonnet',
            timestamp: 1000,
          },
        });
      });

      dateNowSpy.mockReturnValue(1600);
      act(() => {
        capturedResponseListener?.({
          type: 'agent_status',
          conversation_id: CONVERSATION_ID,
          msg_id: 'status-crash-1',
          data: {
            backend: 'claude',
            status: 'disconnected',
            disconnectCode: 42,
            disconnectSignal: null,
          },
        });
        capturedResponseListener?.({
          type: 'finish',
          conversation_id: CONVERSATION_ID,
          msg_id: 'finish-crash-1',
          data: null,
        });
        capturedResponseListener?.({
          type: 'error',
          conversation_id: CONVERSATION_ID,
          msg_id: 'error-crash-1',
          data: 'runtime disconnected',
        });
      });

      expect(result.current.acpLogs.map((entry) => entry.kind)).toEqual(['status', 'request_error', 'request_started']);
      expect(result.current.acpLogs.find((entry) => entry.kind === 'request_finished')).toBeUndefined();
      expect(result.current.acpLogs.find((entry) => entry.kind === 'request_error')).toEqual(
        expect.objectContaining({
          disconnectCode: 42,
          durationMs: 600,
        })
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('ignores late content chunks after finish until a new turn starts', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      capturedResponseListener?.({
        type: 'finish',
        conversation_id: CONVERSATION_ID,
        msg_id: 'finish-1',
        data: null,
      });
    });

    mockAddOrUpdateMessage.mockReset();

    act(() => {
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'content-1',
        data: {
          content: '[late chunk after cancel]',
        },
      });
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  it('accepts content again after a new start signal resets the finished guard', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      capturedResponseListener?.({
        type: 'finish',
        conversation_id: CONVERSATION_ID,
        msg_id: 'finish-2',
        data: null,
      });
    });

    mockAddOrUpdateMessage.mockReset();
    vi.useFakeTimers();

    act(() => {
      capturedResponseListener?.({
        type: 'start',
        conversation_id: CONVERSATION_ID,
        msg_id: 'start-1',
        data: null,
      });
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'content-2',
        data: {
          content: 'fresh turn content',
        },
      });
    });

    expect(result.current.running).toBe(true);
    expect(result.current.aiProcessing).toBe(false);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(mockAddOrUpdateMessage).toHaveBeenCalledOnce();
    expect(mockAddOrUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'content',
        msg_id: 'content-2',
      })
    );
  });

  it('buffers rapid content chunks and flushes them together on the reveal timer', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    mockAddOrUpdateMessage.mockReset();
    vi.useFakeTimers();

    act(() => {
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'content-buffered-1',
        data: {
          content: 'hello ',
        },
      });
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'content-buffered-1',
        data: {
          content: 'world',
        },
      });
    });

    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(mockAddOrUpdateMessage).toHaveBeenCalledTimes(1);
    expect(mockAddOrUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'content',
        msg_id: 'content-buffered-1',
        data: {
          content: 'hello world',
        },
      })
    );
  });

  it('flushes buffered content immediately when finish arrives before the reveal timer', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    mockAddOrUpdateMessage.mockReset();
    vi.useFakeTimers();

    act(() => {
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'content-before-finish',
        data: {
          content: 'final buffered chunk',
        },
      });
    });

    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();

    act(() => {
      capturedResponseListener?.({
        type: 'finish',
        conversation_id: CONVERSATION_ID,
        msg_id: 'finish-after-buffered-content',
        data: null,
      });
    });

    expect(mockAddOrUpdateMessage).toHaveBeenCalledTimes(1);
    expect(mockAddOrUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'content',
        msg_id: 'content-before-finish',
        data: {
          content: 'final buffered chunk',
        },
      })
    );
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(mockAddOrUpdateMessage).toHaveBeenCalledTimes(1);
  });

  it('drops buffered content when resetState is called before the reveal timer fires', async () => {
    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    mockAddOrUpdateMessage.mockReset();
    vi.useFakeTimers();

    act(() => {
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'content-before-reset',
        data: {
          content: 'should disappear',
        },
      });
    });

    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();

    act(() => {
      result.current.resetState();
      vi.runOnlyPendingTimers();
    });

    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
  });

  it('clears buffered content on unmount instead of revealing it later', async () => {
    const { result, unmount } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    mockAddOrUpdateMessage.mockReset();
    vi.useFakeTimers();

    act(() => {
      capturedResponseListener?.({
        type: 'content',
        conversation_id: CONVERSATION_ID,
        msg_id: 'content-before-unmount',
        data: {
          content: 'should not flush after unmount',
        },
      });
    });

    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();

    unmount();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  it('does not let stale hydrated status overwrite a newer live ACP status', async () => {
    const deferredConversation = createDeferred<{
      id: string;
      type: 'acp';
      status: 'finished';
      extra: {
        lastAcpStatus: {
          backend: 'claude';
          status: 'disconnected';
          updatedAt: number;
        };
      };
    }>();
    mockConversationGetInvoke.mockReturnValueOnce(deferredConversation.promise);

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    act(() => {
      capturedResponseListener?.({
        type: 'agent_status',
        conversation_id: CONVERSATION_ID,
        msg_id: 'status-live-session-active',
        data: {
          backend: 'claude',
          status: 'session_active',
        },
      });
    });

    deferredConversation.resolve({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'disconnected',
          updatedAt: Date.now() - 1000,
        },
      },
    });

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.acpStatus).toBe('session_active');
    expect(result.current.acpStatusSource).toBe('live');
  });

  it('does not let delayed hydration clear a live turn that already started streaming', async () => {
    const deferredConversation = createDeferred<{
      id: string;
      type: 'acp';
      status: 'finished';
      extra: {
        lastAcpStatus: {
          backend: 'claude';
          status: 'disconnected';
          updatedAt: number;
        };
      };
    }>();
    mockConversationGetInvoke.mockReturnValueOnce(deferredConversation.promise);

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    act(() => {
      result.current.setAiProcessing(true);
      capturedResponseListener?.({
        type: 'start',
        conversation_id: CONVERSATION_ID,
        msg_id: 'start-before-hydration',
        data: null,
      });
    });

    deferredConversation.resolve({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'disconnected',
          updatedAt: Date.now() - 1000,
        },
      },
    });

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.running).toBe(true);
    expect(result.current.aiProcessing).toBe(true);
    expect(result.current.acpStatus).toBe('session_active');
    expect(result.current.acpStatusSource).toBe('live');
  });

  it('does not let delayed hydration clear a pending request after live request_trace arrives', async () => {
    const deferredConversation = createDeferred<{
      id: string;
      type: 'acp';
      status: 'finished';
      extra: {
        lastAcpStatus: {
          backend: 'claude';
          status: 'disconnected';
          updatedAt: number;
        };
      };
    }>();
    mockConversationGetInvoke.mockReturnValueOnce(deferredConversation.promise);

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    act(() => {
      result.current.setAiProcessing(true);
      capturedResponseListener?.({
        type: 'request_trace',
        conversation_id: CONVERSATION_ID,
        msg_id: 'trace-before-hydration',
        data: {
          backend: 'claude',
          modelId: 'claude-sonnet',
          timestamp: 1000,
        },
      });
    });

    deferredConversation.resolve({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'disconnected',
          updatedAt: Date.now() - 1000,
        },
      },
    });

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.aiProcessing).toBe(true);
    expect(result.current.acpStatus).toBeNull();
    expect(result.current.acpLogs[0]).toEqual(
      expect.objectContaining({
        kind: 'request_started',
        modelId: 'claude-sonnet',
      })
    );
  });

  it('hydrates a disconnected ACP log entry from persisted conversation status', async () => {
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
          disconnectCode: 42,
          disconnectSignal: 'SIGTERM',
          updatedAt: 1234,
        },
      },
    });

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.acpStatus).toBe('disconnected');
    expect(result.current.acpStatusSource).toBe('hydrated');
    expect(result.current.acpLogs).toEqual([
      expect.objectContaining({
        kind: 'status',
        source: 'hydrated',
        status: 'disconnected',
        agentName: 'Claude',
        disconnectCode: 42,
        disconnectSignal: 'SIGTERM',
        timestamp: 1234,
      }),
    ]);
  });

  it('hydrates an auth_required ACP status from persisted conversation status', async () => {
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
          updatedAt: 2234,
        },
      },
    });

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.acpStatus).toBe('auth_required');
    expect(result.current.acpStatusSource).toBe('hydrated');
    expect(result.current.acpLogs).toEqual([
      expect.objectContaining({
        kind: 'status',
        source: 'hydrated',
        status: 'auth_required',
        agentName: 'Claude',
        timestamp: 2234,
      }),
    ]);
  });

  it('does not hydrate a stale session_active status without a live runtime', async () => {
    mockConversationGetInvoke.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
          updatedAt: 1234,
        },
      },
    });

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.acpStatus).toBeNull();
    expect(result.current.acpLogs).toEqual([]);
  });

  it('does not let late hydration overwrite newer UI logs', async () => {
    const deferredConversation = createDeferred<{
      id: string;
      type: 'acp';
      status: 'finished';
      extra: {
        lastAcpStatus: {
          backend: 'claude';
          status: 'disconnected';
          agentName: 'Claude';
          updatedAt: number;
        };
      };
    }>();
    mockConversationGetInvoke.mockReturnValueOnce(deferredConversation.promise);

    const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

    act(() => {
      result.current.appendAcpUiLog({
        kind: 'retry_requested',
        level: 'warning',
        backend: 'claude',
        agentName: 'Claude',
      });
    });

    deferredConversation.resolve({
      id: CONVERSATION_ID,
      type: 'acp',
      status: 'finished',
      extra: {
        lastAcpStatus: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
          updatedAt: 1234,
        },
      },
    });

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.acpStatus).toBe('disconnected');
    expect(result.current.acpLogs[0]).toEqual(
      expect.objectContaining({
        kind: 'retry_requested',
        source: 'ui',
        agentName: 'Claude',
      })
    );
  });

  it.each(['authenticated', 'session_active'] as const)(
    'does not clear the active turn when %s arrives after start',
    async (status) => {
      const { result } = renderHook(() => useAcpMessage(CONVERSATION_ID));

      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        result.current.setAiProcessing(true);
        capturedResponseListener?.({
          type: 'start',
          conversation_id: CONVERSATION_ID,
          msg_id: `start-before-${status}`,
          data: null,
        });
      });

      expect(result.current.running).toBe(true);
      expect(result.current.aiProcessing).toBe(true);

      act(() => {
        capturedResponseListener?.({
          type: 'agent_status',
          conversation_id: CONVERSATION_ID,
          msg_id: `status-after-start-${status}`,
          data: {
            backend: 'claude',
            status,
          },
        });
      });

      expect(result.current.running).toBe(true);
      expect(result.current.aiProcessing).toBe(true);
    }
  );
});
