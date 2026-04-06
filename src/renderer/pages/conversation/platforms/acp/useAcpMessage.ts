/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { transformMessage, type TMessage } from '@/common/chat/chatLib';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { TokenUsageData } from '@/common/config/storage';
import { useAddOrUpdateMessage, useMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import type { ThoughtData } from '@/renderer/components/chat/ThoughtDisplay';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  publishAcpRuntimeDiagnosticsSnapshot,
  setAcpRuntimeUiWarmupPending,
  type AcpLogEntry,
  type AcpPendingFirstResponseMode,
  type AcpRuntimeStatus,
  type AcpRuntimeStatusSource,
} from './acpRuntimeDiagnostics';

export type { AcpLogEntry, AcpRuntimeStatus } from './acpRuntimeDiagnostics';
export type AcpStatusSource = AcpRuntimeStatusSource;
type BufferedContentMessage = IResponseMessage & {
  type: 'content';
  data: {
    content: string;
    [key: string]: unknown;
  };
};

const LEGACY_ACP_ERROR_PATTERNS = [
  /^ACP process exited unexpectedly/i,
  /^Failed to send message\. Please try again\.?$/i,
  /^Failed to send message to .+:/i,
  /authentication failed/i,
  /local CLI tool authentication status/i,
];

const isLegacyAcpInfrastructureTip = (message: TMessage): boolean => {
  if (message.hidden || message.type !== 'tips' || message.position !== 'center') {
    return false;
  }

  const content = message.content as {
    type?: string;
    content?: unknown;
  };

  if (content.type !== 'error' || typeof content.content !== 'string') {
    return false;
  }

  const contentText = content.content;
  return LEGACY_ACP_ERROR_PATTERNS.some((pattern) => pattern.test(contentText));
};

export const sanitizeAcpTimelineMessages = (messages: TMessage[]): TMessage[] => {
  return messages.filter((message) => {
    if (message.hidden) {
      return true;
    }

    if (message.type === 'agent_status') {
      return false;
    }

    return !isLegacyAcpInfrastructureTip(message);
  });
};

const HYDRATED_RUNNING_ASSISTANT_ACTIVITY_TYPES = new Set<TMessage['type']>([
  'tool_group',
  'thinking',
  'available_commands',
  'skill_suggest',
  'cron_trigger',
]);

const shouldHydratedRunningEnterWaitingPhase = (conversationId: string, messages: TMessage[]): boolean => {
  const sanitizedMessages = sanitizeAcpTimelineMessages(
    messages.filter((message) => message.conversation_id === conversationId)
  );

  for (let index = sanitizedMessages.length - 1; index >= 0; index -= 1) {
    const message = sanitizedMessages[index];
    if (message.hidden) {
      continue;
    }

    if (message.position === 'right') {
      return true;
    }

    if (message.position === 'left' || HYDRATED_RUNNING_ASSISTANT_ACTIVITY_TYPES.has(message.type)) {
      return false;
    }
  }

  return true;
};

const getHydratedPendingFirstResponseMode = (
  conversationId: string,
  messages: TMessage[],
  hasLiveWarmSession: boolean
): AcpPendingFirstResponseMode => {
  const sanitizedMessages = sanitizeAcpTimelineMessages(
    messages.filter((message) => message.conversation_id === conversationId)
  );
  let sawTrailingUserMessage = false;

  for (let index = sanitizedMessages.length - 1; index >= 0; index -= 1) {
    const message = sanitizedMessages[index];
    if (message.hidden) {
      continue;
    }

    if (!sawTrailingUserMessage) {
      if (message.position === 'right') {
        sawTrailingUserMessage = true;
        continue;
      }

      if (message.position === 'left' || HYDRATED_RUNNING_ASSISTANT_ACTIVITY_TYPES.has(message.type)) {
        return null;
      }

      continue;
    }

    if (message.position === 'left' || HYDRATED_RUNNING_ASSISTANT_ACTIVITY_TYPES.has(message.type)) {
      return hasLiveWarmSession ? 'warm' : 'cold';
    }
  }

  return sawTrailingUserMessage ? 'cold' : null;
};

const isTerminalAcpStatus = (
  status: AcpRuntimeStatus | null | undefined
): status is 'auth_required' | 'disconnected' | 'error' =>
  status === 'auth_required' || status === 'disconnected' || status === 'error';

const ACP_CONTENT_REVEAL_BUFFER_MS = 40;

const isBufferedContentMessage = (message: IResponseMessage): message is BufferedContentMessage => {
  if (message.type !== 'content' || !message.data || typeof message.data !== 'object') {
    return false;
  }

  return typeof (message.data as { content?: unknown }).content === 'string';
};

type AppendAcpUiLogInput = Omit<AcpLogEntry, 'id' | 'timestamp' | 'source'> & {
  timestamp?: number;
};

const MAX_ACP_LOGS = 12;

const getAcpErrorDetail = (data: unknown): string | undefined => {
  if (typeof data === 'string') {
    return data;
  }

  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
    return data.message;
  }

  return undefined;
};

type UseAcpMessageReturn = {
  thought: ThoughtData;
  setThought: React.Dispatch<React.SetStateAction<ThoughtData>>;
  running: boolean;
  hasHydratedRunningState: boolean;
  acpStatus: AcpRuntimeStatus | null;
  acpStatusSource: AcpStatusSource | null;
  acpStatusRevision: number;
  slashCommandsRevision: number;
  acpLogs: AcpLogEntry[];
  appendAcpUiLog: (entry: AppendAcpUiLogInput) => void;
  primeRequestTraceFallback: (trace: {
    backend: string;
    agentName?: string;
    sessionMode?: string;
    timestamp?: number;
  }) => void;
  clearPendingRequestTraceFallback: () => boolean;
  aiProcessing: boolean;
  beginPendingFirstResponse: () => void;
  clearPendingFirstResponse: () => void;
  resetState: () => void;
  tokenUsage: TokenUsageData | null;
  contextLimit: number;
  hasThinkingMessage: boolean;
};

type UseAcpMessageOptions = {
  backend?: string;
  agentName?: string;
  sessionMode?: string;
};

export const useAcpMessage = (conversation_id: string, options: UseAcpMessageOptions = {}): UseAcpMessageReturn => {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const messageList = useMessageList();
  const [running, setRunning] = useState(false);
  const [hasHydratedRunningState, setHasHydratedRunningState] = useState(false);
  const [thought, setThought] = useState<ThoughtData>({
    description: '',
    subject: '',
  });
  const [acpStatus, setAcpStatus] = useState<AcpRuntimeStatus | null>(null);
  const [acpStatusSource, setAcpStatusSource] = useState<AcpStatusSource | null>(null);
  const [acpStatusRevision, setAcpStatusRevision] = useState(0);
  const [slashCommandsRevision, setSlashCommandsRevision] = useState(0);
  const [acpLogs, setAcpLogs] = useState<AcpLogEntry[]>([]);
  const [aiProcessing, setAiProcessingValue] = useState(false);
  const [pendingFirstResponseMode, setPendingFirstResponseModeValue] = useState<AcpPendingFirstResponseMode>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageData | null>(null);
  const [contextLimit, setContextLimit] = useState<number>(0);
  const acpLogSequenceRef = useRef(0);
  const bufferedContentRef = useRef<BufferedContentMessage[]>([]);
  const contentFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationIdRef = useRef(conversation_id);
  const messageListRef = useRef(messageList);
  conversationIdRef.current = conversation_id;
  messageListRef.current = messageList;

  // Use refs to sync state for immediate access in event handlers
  const runningRef = useRef(running);
  const aiProcessingRef = useRef(aiProcessing);
  const aiProcessingOwnerConversationIdRef = useRef<string | null>(aiProcessing ? conversation_id : null);
  const hasLiveAcpActivityRef = useRef(false);
  const acpStatusRef = useRef(acpStatus);
  const pendingFirstResponseModeRef = useRef(pendingFirstResponseMode);
  const hydratedConversationIdRef = useRef<string | null>(null);
  acpStatusRef.current = acpStatus;
  pendingFirstResponseModeRef.current = pendingFirstResponseMode;

  const setPendingFirstResponseMode = useCallback((nextMode: AcpPendingFirstResponseMode) => {
    setPendingFirstResponseModeValue(nextMode);
  }, []);

  const setPendingFirstResponseState = useCallback(
    (nextValue: React.SetStateAction<boolean>, nextMode?: AcpPendingFirstResponseMode) => {
      const currentValue = aiProcessingRef.current;
      const resolvedValue =
        typeof nextValue === 'function' ? (nextValue as (previousValue: boolean) => boolean)(currentValue) : nextValue;

      if (!resolvedValue) {
        setPendingFirstResponseMode(null);
      } else if (nextMode !== undefined) {
        setPendingFirstResponseMode(nextMode);
      }

      aiProcessingRef.current = resolvedValue;
      aiProcessingOwnerConversationIdRef.current = resolvedValue ? conversationIdRef.current : null;
      setAiProcessingValue(resolvedValue);
    },
    [setPendingFirstResponseMode]
  );

  const shouldTreatNextPendingFirstResponseAsWarmSession = useCallback((): boolean => {
    return acpStatusRef.current === 'session_active' && !runningRef.current;
  }, []);

  const syncHydratedPendingFirstResponseState = useCallback(
    (shouldWaitForFirstResponse: boolean, nextMode: AcpPendingFirstResponseMode) => {
      const isCurrentConversationProcessing =
        aiProcessingRef.current && aiProcessingOwnerConversationIdRef.current === conversation_id;

      if (
        isCurrentConversationProcessing === shouldWaitForFirstResponse &&
        (!shouldWaitForFirstResponse || pendingFirstResponseModeRef.current === nextMode)
      ) {
        return;
      }

      setPendingFirstResponseState(shouldWaitForFirstResponse, nextMode ?? undefined);
    },
    [conversation_id, setPendingFirstResponseState]
  );

  const beginPendingFirstResponse = useCallback(() => {
    setAcpRuntimeUiWarmupPending(conversation_id, true);
    setPendingFirstResponseState(true, shouldTreatNextPendingFirstResponseAsWarmSession() ? 'warm' : 'cold');
  }, [conversation_id, setPendingFirstResponseState, shouldTreatNextPendingFirstResponseAsWarmSession]);

  const clearPendingFirstResponse = useCallback(() => {
    setAcpRuntimeUiWarmupPending(conversation_id, false);
    setPendingFirstResponseState(false);
  }, [conversation_id, setPendingFirstResponseState]);

  // Track whether current turn has content output
  const hasContentInTurnRef = useRef(false);

  // Guard: after finish arrives, prevent auto-recover from setting running=true
  // until a new 'start' signal arrives for the next turn
  const turnFinishedRef = useRef(false);

  // Track whether current turn has a thinking message in the conversation
  const hasThinkingMessageRef = useRef(false);
  const [hasThinkingMessage, setHasThinkingMessage] = useState(false);

  // Track request trace state for displaying complete request lifecycle
  const requestTraceRef = useRef<{
    startTime: number;
    backend: string;
    modelId: string;
    sessionMode?: string;
    agentName?: string;
    source: 'trace' | 'fallback';
  } | null>(null);

  const appendAcpLog = useCallback(
    (entry: Omit<AcpLogEntry, 'id'>) => {
      const nextEntry: AcpLogEntry = {
        ...entry,
        id: `${conversation_id}-acp-log-${++acpLogSequenceRef.current}`,
      };
      setAcpLogs((currentLogs) => [nextEntry, ...currentLogs].slice(0, MAX_ACP_LOGS));
    },
    [conversation_id]
  );

  const appendAcpUiLog = useCallback(
    (entry: AppendAcpUiLogInput) => {
      appendAcpLog({
        ...entry,
        source: 'ui',
        timestamp: entry.timestamp ?? Date.now(),
      });
    },
    [appendAcpLog]
  );

  const primeRequestTraceFallback = useCallback(
    (trace: { backend: string; agentName?: string; sessionMode?: string; timestamp?: number }) => {
      if (requestTraceRef.current?.source === 'trace') {
        return;
      }

      requestTraceRef.current = {
        startTime: trace.timestamp ?? Date.now(),
        backend: trace.backend,
        modelId: 'unknown',
        sessionMode: trace.sessionMode,
        agentName: trace.agentName,
        source: 'fallback',
      };
    },
    []
  );

  const clearPendingRequestTraceFallback = useCallback(() => {
    if (requestTraceRef.current?.source !== 'fallback') {
      return false;
    }

    requestTraceRef.current = null;
    return true;
  }, []);

  const flushBufferedContent = useCallback(() => {
    if (contentFlushTimerRef.current) {
      clearTimeout(contentFlushTimerRef.current);
      contentFlushTimerRef.current = null;
    }

    const pendingBufferedContent = bufferedContentRef.current;
    if (pendingBufferedContent.length === 0) {
      return;
    }

    bufferedContentRef.current = [];
    for (const bufferedMessage of pendingBufferedContent) {
      addOrUpdateMessage(transformMessage(bufferedMessage));
    }
  }, [addOrUpdateMessage]);

  const clearBufferedContent = useCallback(() => {
    if (contentFlushTimerRef.current) {
      clearTimeout(contentFlushTimerRef.current);
      contentFlushTimerRef.current = null;
    }
    bufferedContentRef.current = [];
  }, []);

  const scheduleBufferedContentFlush = useCallback(() => {
    if (contentFlushTimerRef.current !== null) {
      return;
    }

    contentFlushTimerRef.current = setTimeout(() => {
      flushBufferedContent();
    }, ACP_CONTENT_REVEAL_BUFFER_MS);
  }, [flushBufferedContent]);

  const bufferContentMessage = useCallback(
    (message: IResponseMessage) => {
      if (!isBufferedContentMessage(message)) {
        addOrUpdateMessage(transformMessage(message));
        return;
      }

      const bufferedMessages = bufferedContentRef.current;
      const previousMessage = bufferedMessages[bufferedMessages.length - 1];

      if (
        previousMessage &&
        previousMessage.msg_id === message.msg_id &&
        previousMessage.conversation_id === message.conversation_id &&
        previousMessage.hidden === message.hidden
      ) {
        previousMessage.data = {
          ...previousMessage.data,
          ...message.data,
          content: previousMessage.data.content + message.data.content,
        };
      } else {
        bufferedMessages.push({
          ...message,
          data: { ...message.data },
        });
      }

      scheduleBufferedContentFlush();
    },
    [addOrUpdateMessage, scheduleBufferedContentFlush]
  );

  // Throttle thought updates to reduce render frequency
  const thoughtThrottleRef = useRef<{
    lastUpdate: number;
    pending: ThoughtData | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ lastUpdate: 0, pending: null, timer: null });

  const throttledSetThought = useMemo(() => {
    const THROTTLE_MS = 50;
    return (data: ThoughtData) => {
      const now = Date.now();
      const ref = thoughtThrottleRef.current;
      if (now - ref.lastUpdate >= THROTTLE_MS) {
        ref.lastUpdate = now;
        ref.pending = null;
        if (ref.timer) {
          clearTimeout(ref.timer);
          ref.timer = null;
        }
        setThought(data);
      } else {
        ref.pending = data;
        if (!ref.timer) {
          ref.timer = setTimeout(
            () => {
              ref.lastUpdate = Date.now();
              ref.timer = null;
              if (ref.pending) {
                setThought(ref.pending);
                ref.pending = null;
              }
            },
            THROTTLE_MS - (now - ref.lastUpdate)
          );
        }
      }
    };
  }, []);

  // Clean up throttle timer
  useEffect(() => {
    return () => {
      if (thoughtThrottleRef.current.timer) {
        clearTimeout(thoughtThrottleRef.current.timer);
      }
    };
  }, []);

  const handleResponseMessage = useCallback(
    (message: IResponseMessage) => {
      if (conversation_id !== message.conversation_id) {
        return;
      }

      hasLiveAcpActivityRef.current = true;

      if (message.type !== 'content' && bufferedContentRef.current.length > 0) {
        flushBufferedContent();
      }

      const transformedMessage = transformMessage(message);
      switch (message.type) {
        case 'thought':
          // Thought events are now handled by AcpAgentManager (converted to thinking messages)
          // Only auto-recover running state if turn hasn't finished
          if (!runningRef.current && !turnFinishedRef.current) {
            setRunning(true);
            runningRef.current = true;
          }
          break;
        case 'thinking': {
          const thinkingData = message.data as { status?: string };
          // Only set running for active thinking, not for done signal
          if (thinkingData?.status !== 'done' && !runningRef.current && !turnFinishedRef.current) {
            setRunning(true);
            runningRef.current = true;
          }
          setAcpRuntimeUiWarmupPending(conversation_id, false);
          hasThinkingMessageRef.current = true;
          setHasThinkingMessage(true);
          addOrUpdateMessage(transformedMessage);
          break;
        }
        case 'start':
          // New turn starting — clear the finished guard and content flag
          turnFinishedRef.current = false;
          hasContentInTurnRef.current = false;
          if (!requestTraceRef.current) {
            requestTraceRef.current = {
              startTime: Date.now(),
              backend: options.backend || 'unknown',
              modelId: 'unknown',
              sessionMode: options.sessionMode,
              agentName: options.agentName,
              source: 'fallback',
            };
          }
          setRunning(true);
          runningRef.current = true;
          setAcpStatusSource('live');
          setAcpStatus((prev) => {
            if (prev === 'session_active') {
              return prev;
            }
            setAcpStatusRevision((revision) => revision + 1);
            return 'session_active';
          });
          // Don't reset aiProcessing here - let content arrival handle it
          break;
        case 'finish':
          {
            // Mark turn as finished to prevent auto-recover from late messages
            turnFinishedRef.current = true;
            // Immediate state reset (notification is handled by centralized hook)
            setRunning(false);
            runningRef.current = false;
            clearPendingFirstResponse();
            setThought({ subject: '', description: '' });
            hasContentInTurnRef.current = false;
            hasThinkingMessageRef.current = false;
            setHasThinkingMessage(false);
            // Log request completion
            if (requestTraceRef.current) {
              const duration = Date.now() - requestTraceRef.current.startTime;
              appendAcpLog({
                kind: 'request_finished',
                level: 'success',
                source: 'live',
                timestamp: Date.now(),
                backend: requestTraceRef.current.backend,
                modelId: requestTraceRef.current.modelId,
                sessionMode: requestTraceRef.current.sessionMode,
                agentName: requestTraceRef.current.agentName,
                durationMs: duration,
              });
              console.log(
                `%c[RequestTrace]%c FINISH | ${requestTraceRef.current.backend} → ${requestTraceRef.current.modelId} | ${duration}ms | ${new Date().toISOString()}`,
                'color: #52c41a; font-weight: bold',
                'color: inherit'
              );
              requestTraceRef.current = null;
            }
          }
          break;
        case 'content': {
          if (turnFinishedRef.current) {
            // Ignore late chunks from a canceled or already-finished turn.
            // The next valid turn must reopen the gate with an explicit start event.
            break;
          }
          // First content token — AI has started responding, clear processing indicator
          if (!hasContentInTurnRef.current) {
            hasContentInTurnRef.current = true;
            setPendingFirstResponseState(false);
            if (requestTraceRef.current) {
              appendAcpLog({
                kind: 'first_response',
                level: 'success',
                source: 'live',
                timestamp: Date.now(),
                backend: requestTraceRef.current.backend,
                modelId: requestTraceRef.current.modelId,
                sessionMode: requestTraceRef.current.sessionMode,
                agentName: requestTraceRef.current.agentName,
                durationMs: Date.now() - requestTraceRef.current.startTime,
              });
            }
          }
          // Auto-recover running state only if turn hasn't finished
          if (!runningRef.current && !turnFinishedRef.current) {
            setRunning(true);
            runningRef.current = true;
          }
          setAcpStatusSource('live');
          setAcpStatus((prev) => {
            if (prev === 'session_active') {
              return prev;
            }
            setAcpStatusRevision((revision) => revision + 1);
            return 'session_active';
          });
          // Clear thought when final answer arrives
          setThought({ subject: '', description: '' });
          bufferContentMessage(message);
          break;
        }
        case 'agent_status': {
          // Agent lifecycle status is not a generation signal.
          // Keep turn loading driven by start/content/finish/error only.
          const agentData = message.data as {
            status?: AcpRuntimeStatus;
            backend?: string;
            agentName?: string;
            disconnectCode?: number | null;
            disconnectSignal?: string | null;
          };
          if (agentData?.status) {
            setAcpStatusSource('live');
            setAcpStatus(agentData.status);
            setAcpStatusRevision((revision) => revision + 1);
            if (isTerminalAcpStatus(agentData.status) && requestTraceRef.current) {
              appendAcpLog({
                kind: 'request_error',
                level: 'error',
                source: 'live',
                timestamp: Date.now(),
                backend: requestTraceRef.current.backend,
                modelId: requestTraceRef.current.modelId,
                sessionMode: requestTraceRef.current.sessionMode,
                durationMs: Date.now() - requestTraceRef.current.startTime,
                disconnectCode: agentData.disconnectCode ?? null,
                disconnectSignal: agentData.disconnectSignal ?? null,
              });
              requestTraceRef.current = null;
            }
            appendAcpLog({
              kind: 'status',
              level: isTerminalAcpStatus(agentData.status) ? 'error' : 'info',
              source: 'live',
              timestamp: Date.now(),
              backend: agentData.backend,
              agentName: agentData.agentName,
              status: agentData.status,
              disconnectCode: agentData.disconnectCode ?? null,
              disconnectSignal: agentData.disconnectSignal ?? null,
            });
            // Terminal ACP statuses end the current turn immediately so late
            // lifecycle noise cannot revive the send box loading state.
            if (isTerminalAcpStatus(agentData.status)) {
              turnFinishedRef.current = true;
              setRunning(false);
              runningRef.current = false;
              clearPendingFirstResponse();
            }
          }
          addOrUpdateMessage(transformedMessage);
          break;
        }
        case 'user_content':
          addOrUpdateMessage(transformedMessage);
          break;
        case 'teammate_message': {
          const tmMsg = message.data as import('@/common/chat/chatLib').TMessage;
          if (tmMsg && tmMsg.conversation_id === conversation_id) {
            addOrUpdateMessage(tmMsg);
          }
          break;
        }
        case 'acp_permission':
          // Auto-recover running state only if turn hasn't finished
          if (!runningRef.current && !turnFinishedRef.current) {
            setRunning(true);
            runningRef.current = true;
          }
          addOrUpdateMessage(transformedMessage);
          break;
        case 'acp_model_info':
          // Model info updates are handled by AcpModelSelector, no action needed here
          break;
        case 'slash_commands_updated':
          // Slash command availability is a cache invalidation signal only.
          // It must not be treated as proof that the ACP runtime recovered.
          setSlashCommandsRevision((revision) => revision + 1);
          break;
        case 'acp_context_usage': {
          const usageData = message.data as { used: number; size: number };
          if (usageData && typeof usageData.used === 'number') {
            setTokenUsage({ totalTokens: usageData.used });
            if (usageData.size > 0) {
              setContextLimit(usageData.size);
            }
          }
          break;
        }
        case 'request_trace':
          {
            const trace = message.data as Record<string, unknown>;
            const traceTimestamp = Number(trace.timestamp) || Date.now();
            const shouldAppendStartedLog = !requestTraceRef.current || requestTraceRef.current.source === 'fallback';
            requestTraceRef.current = {
              startTime: traceTimestamp,
              backend: String(trace.backend || 'unknown'),
              modelId: String(trace.modelId || 'unknown'),
              sessionMode: trace.sessionMode as string | undefined,
              agentName: options.agentName,
              source: 'trace',
            };
            if (shouldAppendStartedLog) {
              appendAcpLog({
                kind: 'request_started',
                level: 'info',
                source: 'live',
                timestamp: traceTimestamp,
                backend: requestTraceRef.current.backend,
                modelId: requestTraceRef.current.modelId,
                sessionMode: requestTraceRef.current.sessionMode,
                agentName: requestTraceRef.current.agentName,
              });
            }
            console.log(
              `%c[RequestTrace]%c START | ${trace.backend} → ${trace.modelId} | ${new Date().toISOString()}`,
              'color: #1890ff; font-weight: bold',
              'color: inherit',
              trace
            );
          }
          break;
        case 'error':
          // Stop all loading states when error occurs
          turnFinishedRef.current = true;
          setRunning(false);
          runningRef.current = false;
          clearPendingFirstResponse();
          addOrUpdateMessage(transformedMessage);
          // Log request error
          if (requestTraceRef.current) {
            const duration = Date.now() - requestTraceRef.current.startTime;
            appendAcpLog({
              kind: 'request_error',
              level: 'error',
              source: 'live',
              timestamp: Date.now(),
              backend: requestTraceRef.current.backend,
              modelId: requestTraceRef.current.modelId,
              sessionMode: requestTraceRef.current.sessionMode,
              agentName: requestTraceRef.current.agentName,
              durationMs: duration,
              detail: getAcpErrorDetail(message.data),
            });
            console.log(
              `%c[RequestTrace]%c ERROR | ${requestTraceRef.current.backend} → ${requestTraceRef.current.modelId} | ${duration}ms | ${new Date().toISOString()}`,
              'color: #ff4d4f; font-weight: bold',
              'color: inherit',
              message.data
            );
            requestTraceRef.current = null;
          }
          break;
        default:
          // Auto-recover running state only if turn hasn't finished
          if (!runningRef.current && !turnFinishedRef.current) {
            setRunning(true);
            runningRef.current = true;
          }
          addOrUpdateMessage(transformedMessage);
          break;
      }
    },
    [
      conversation_id,
      addOrUpdateMessage,
      appendAcpLog,
      options.agentName,
      options.backend,
      options.sessionMode,
      bufferContentMessage,
      flushBufferedContent,
      throttledSetThought,
      setThought,
      setRunning,
      clearPendingFirstResponse,
      setAcpStatus,
      setPendingFirstResponseState,
    ]
  );

  useEffect(() => {
    return ipcBridge.acpConversation.responseStream.on(handleResponseMessage);
  }, [handleResponseMessage]);

  useEffect(() => {
    const isCurrentConversationProcessing =
      aiProcessing && aiProcessingOwnerConversationIdRef.current === conversation_id;
    const shouldKeepWaitingForFirstResponse =
      running && shouldHydratedRunningEnterWaitingPhase(conversation_id, messageList);
    const activityPhase =
      isCurrentConversationProcessing || shouldKeepWaitingForFirstResponse ? 'waiting' : running ? 'streaming' : 'idle';
    publishAcpRuntimeDiagnosticsSnapshot(conversation_id, {
      status: acpStatus,
      statusSource: acpStatusSource,
      statusRevision: acpStatusRevision,
      activityPhase,
      pendingFirstResponseMode,
      hasThinkingMessage,
      logs: acpLogs,
    });
  }, [
    acpLogs,
    acpStatus,
    acpStatusRevision,
    acpStatusSource,
    aiProcessing,
    conversation_id,
    messageList,
    hasThinkingMessage,
    pendingFirstResponseMode,
    running,
  ]);

  useEffect(() => {
    const isCurrentConversationProcessing =
      aiProcessingRef.current && aiProcessingOwnerConversationIdRef.current === conversation_id;
    const shouldKeepWaitingForFirstResponse =
      runningRef.current && shouldHydratedRunningEnterWaitingPhase(conversation_id, messageList);

    if (isCurrentConversationProcessing || shouldKeepWaitingForFirstResponse) {
      return;
    }

    setAcpRuntimeUiWarmupPending(conversation_id, false);
  }, [conversation_id, messageList]);

  // Reset state when conversation changes and restore actual running status
  useEffect(() => {
    if (
      !hasHydratedRunningState ||
      hydratedConversationIdRef.current !== conversation_id ||
      hasLiveAcpActivityRef.current ||
      !runningRef.current
    ) {
      return;
    }

    const shouldWaitForFirstResponse = shouldHydratedRunningEnterWaitingPhase(conversation_id, messageList);
    const nextPendingFirstResponseMode = shouldWaitForFirstResponse
      ? getHydratedPendingFirstResponseMode(conversation_id, messageList, acpStatusRef.current === 'session_active')
      : null;

    syncHydratedPendingFirstResponseState(shouldWaitForFirstResponse, nextPendingFirstResponseMode);
  }, [conversation_id, hasHydratedRunningState, messageList, syncHydratedPendingFirstResponseState]);

  useEffect(() => {
    let cancelled = false;

    setThought({ subject: '', description: '' });
    setAcpStatus(null);
    setAcpStatusSource(null);
    setAcpStatusRevision(0);
    setSlashCommandsRevision(0);
    setAcpLogs([]);
    setPendingFirstResponseMode(null);
    setTokenUsage(null);
    setContextLimit(0);
    hasContentInTurnRef.current = false;
    turnFinishedRef.current = false;
    hasThinkingMessageRef.current = false;
    setHasThinkingMessage(false);
    setHasHydratedRunningState(false);
    hasLiveAcpActivityRef.current = false;
    requestTraceRef.current = null;
    acpLogSequenceRef.current = 0;
    hydratedConversationIdRef.current = null;
    clearBufferedContent();
    setAcpRuntimeUiWarmupPending(conversation_id, false);

    // Check actual conversation status from backend before resetting running/aiProcessing
    // to avoid flicker when switching to a running conversation
    void ipcBridge.conversation.get.invoke({ id: conversation_id }).then((res) => {
      if (cancelled) {
        return;
      }

      const hasLiveAcpActivity = hasLiveAcpActivityRef.current;
      const hasPendingProcessing =
        aiProcessingRef.current && aiProcessingOwnerConversationIdRef.current === conversation_id;

      if (!res) {
        if (!hasLiveAcpActivity && !hasPendingProcessing) {
          setRunning(false);
          runningRef.current = false;
          setPendingFirstResponseState(false);
        }
        hydratedConversationIdRef.current = conversation_id;
        setHasHydratedRunningState(true);
        return;
      }

      if (!hasLiveAcpActivity && !hasPendingProcessing) {
        const isRunning = res.status === 'running';
        const hasLiveWarmSession = res.type === 'acp' && res.extra?.liveAcpStatus?.status === 'session_active';
        setRunning(isRunning);
        runningRef.current = isRunning;
        const shouldWaitForFirstResponse =
          isRunning && shouldHydratedRunningEnterWaitingPhase(conversation_id, messageListRef.current);
        const nextPendingFirstResponseMode = shouldWaitForFirstResponse
          ? getHydratedPendingFirstResponseMode(conversation_id, messageListRef.current, hasLiveWarmSession)
          : null;
        syncHydratedPendingFirstResponseState(shouldWaitForFirstResponse, nextPendingFirstResponseMode);
      }
      hydratedConversationIdRef.current = conversation_id;
      setHasHydratedRunningState(true);

      if (
        res.type === 'acp' &&
        res.extra?.liveAcpStatus?.status === 'session_active' &&
        !hasLiveAcpActivity &&
        !hasPendingProcessing
      ) {
        setAcpStatus('session_active');
        setAcpStatusSource('hydrated');
        setAcpStatusRevision(1);
      }

      // Restore persisted context usage data
      if (res.type === 'acp' && res.extra?.lastTokenUsage) {
        const { lastTokenUsage, lastContextLimit } = res.extra;
        if (lastTokenUsage.totalTokens > 0) {
          setTokenUsage(lastTokenUsage);
        }
        if (lastContextLimit && lastContextLimit > 0) {
          setContextLimit(lastContextLimit);
        }
      }

      if (
        res.type === 'acp' &&
        res.extra?.lastAcpStatus?.status &&
        isTerminalAcpStatus(res.extra.lastAcpStatus.status) &&
        !hasLiveAcpActivity &&
        !hasPendingProcessing
      ) {
        setAcpStatus(res.extra.lastAcpStatus.status);
        setAcpStatusSource('hydrated');
        setAcpStatusRevision(1);
        setAcpLogs((currentLogs) => {
          if (currentLogs.length > 0) {
            return currentLogs;
          }

          return [
            {
              id: `${conversation_id}-acp-log-hydrated-status`,
              kind: 'status',
              level: 'error',
              source: 'hydrated',
              timestamp: res.extra.lastAcpStatus.updatedAt,
              backend: res.extra.lastAcpStatus.backend,
              agentName: res.extra.lastAcpStatus.agentName,
              status: res.extra.lastAcpStatus.status,
              disconnectCode: res.extra.lastAcpStatus.disconnectCode ?? null,
              disconnectSignal: res.extra.lastAcpStatus.disconnectSignal ?? null,
            },
          ];
        });
        if (acpLogSequenceRef.current === 0) {
          acpLogSequenceRef.current = 1;
        }
        setRunning(false);
        runningRef.current = false;
        setPendingFirstResponseState(false);
      }
    });

    return () => {
      cancelled = true;
      hydratedConversationIdRef.current = null;
      clearBufferedContent();
      setAcpRuntimeUiWarmupPending(conversation_id, false);
    };
  }, [clearBufferedContent, conversation_id, syncHydratedPendingFirstResponseState]);

  const resetState = useCallback(() => {
    clearBufferedContent();
    turnFinishedRef.current = true;
    setRunning(false);
    runningRef.current = false;
    clearPendingFirstResponse();
    setThought({ subject: '', description: '' });
    hasContentInTurnRef.current = false;
    hasThinkingMessageRef.current = false;
    setHasThinkingMessage(false);
  }, [clearBufferedContent, clearPendingFirstResponse]);

  const currentConversationAiProcessing =
    aiProcessing && aiProcessingOwnerConversationIdRef.current === conversation_id;

  return {
    thought,
    setThought,
    running,
    hasHydratedRunningState,
    acpStatus,
    acpStatusSource,
    acpStatusRevision,
    slashCommandsRevision,
    acpLogs,
    appendAcpUiLog,
    primeRequestTraceFallback,
    clearPendingRequestTraceFallback,
    aiProcessing: currentConversationAiProcessing,
    beginPendingFirstResponse,
    clearPendingFirstResponse,
    resetState,
    tokenUsage,
    contextLimit,
    hasThinkingMessage,
  };
};
