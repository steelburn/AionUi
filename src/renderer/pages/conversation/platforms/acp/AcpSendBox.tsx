import { ipcBridge } from '@/common';
import type { AcpBackend } from '@/common/types/acpTypes';
import { isSideQuestionSupported } from '@/common/chat/sideQuestion';
import { uuid } from '@/common/utils';
import SendBox from '@/renderer/components/chat/sendbox';
import CommandQueuePanel from '@/renderer/components/chat/CommandQueuePanel';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@/renderer/hooks/chat/useSendBoxDraft';
import { createSetUploadFile, useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';
import {
  shouldEnqueueConversationCommand,
  useConversationCommandQueue,
  type ConversationCommandQueueItem,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { assertBridgeSuccess } from '@/renderer/pages/conversation/platforms/assertBridgeSuccess';
import { allSupportedExts } from '@/renderer/services/FileService';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { mergeFileSelectionItems } from '@/renderer/utils/file/fileSelection';
import { Message, Tag } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import { iconColors } from '@/renderer/styles/colors';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import AcpConfigSelector from '@/renderer/components/agent/AcpConfigSelector';
import React, { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import FilePreview from '@/renderer/components/media/FilePreview';
import HorizontalFileList from '@/renderer/components/media/HorizontalFileList';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { useOpenFileSelector } from '@/renderer/hooks/file/useOpenFileSelector';
import ContextUsageIndicator from '@/renderer/components/agent/ContextUsageIndicator';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import { useSlashCommands } from '@/renderer/hooks/chat/useSlashCommands';
import AcpAuthBanner from './AcpAuthBanner';
import AcpConnectionBanner from './AcpConnectionBanner';
import AcpErrorBanner from './AcpErrorBanner';
import type { AcpLogEntry } from './acpRuntimeDiagnostics';
import { useAcpMessage } from './useAcpMessage';
import { useAcpInitialMessage } from './useAcpInitialMessage';

const useAcpSendBoxDraft = getSendBoxDraftHook('acp', {
  _type: 'acp',
  atPath: [],
  content: '',
  uploadFile: [],
});

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];

type AcpRecoveryUiState = {
  authenticatingRevision: number | null;
  pendingAuthReadyRevision: number | null;
  retryingDisconnectedRevision: number | null;
  pendingRetryReadyRevision: number | null;
  sendNowPending: boolean;
};

const EMPTY_ACP_RECOVERY_UI_STATE: AcpRecoveryUiState = {
  authenticatingRevision: null,
  pendingAuthReadyRevision: null,
  retryingDisconnectedRevision: null,
  pendingRetryReadyRevision: null,
  sendNowPending: false,
};

const acpRecoveryUiStateStore = new Map<string, AcpRecoveryUiState>();
const acpRecoveryUiStateListeners = new Map<string, Set<() => void>>();

const readAcpRecoveryUiState = (conversationId: string): AcpRecoveryUiState => {
  return acpRecoveryUiStateStore.get(conversationId) ?? EMPTY_ACP_RECOVERY_UI_STATE;
};

const emitAcpRecoveryUiState = (conversationId: string): void => {
  for (const listener of acpRecoveryUiStateListeners.get(conversationId) ?? []) {
    listener();
  }
};

const subscribeAcpRecoveryUiState = (conversationId: string, listener: () => void): (() => void) => {
  const listeners = acpRecoveryUiStateListeners.get(conversationId) ?? new Set<() => void>();
  listeners.add(listener);
  acpRecoveryUiStateListeners.set(conversationId, listeners);

  return () => {
    const currentListeners = acpRecoveryUiStateListeners.get(conversationId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      acpRecoveryUiStateListeners.delete(conversationId);
    }
  };
};

const hasActiveAcpRecoveryUiState = (state: AcpRecoveryUiState): boolean => {
  return (
    state.authenticatingRevision !== null ||
    state.pendingAuthReadyRevision !== null ||
    state.retryingDisconnectedRevision !== null ||
    state.pendingRetryReadyRevision !== null ||
    state.sendNowPending
  );
};

const isCurrentPendingAuthRevision = (conversationId: string, revision: number): boolean => {
  return readAcpRecoveryUiState(conversationId).pendingAuthReadyRevision === revision;
};

const isCurrentPendingRetryRevision = (conversationId: string, revision: number): boolean => {
  return readAcpRecoveryUiState(conversationId).pendingRetryReadyRevision === revision;
};

const hasRecoveryBarrierHandedOff = (
  currentStatus: string | null,
  currentRevision: number,
  activeRevision: number,
  source: 'auth' | 'retry'
): boolean => {
  if (currentRevision <= activeRevision) {
    return false;
  }

  if (currentStatus === 'session_active') {
    return true;
  }

  if (!isTerminalAcpStatus(currentStatus)) {
    return false;
  }

  if (source === 'auth') {
    return currentStatus !== 'auth_required';
  }

  return currentStatus !== 'disconnected';
};

const updateStoredAcpRecoveryUiState = (
  conversationId: string,
  updater: (currentState: AcpRecoveryUiState) => AcpRecoveryUiState
): void => {
  const nextState = updater(readAcpRecoveryUiState(conversationId));

  if (hasActiveAcpRecoveryUiState(nextState)) {
    acpRecoveryUiStateStore.set(conversationId, nextState);
  } else {
    acpRecoveryUiStateStore.delete(conversationId);
  }

  emitAcpRecoveryUiState(conversationId);
};

const isTerminalAcpStatus = (status: string | null): status is 'auth_required' | 'disconnected' | 'error' =>
  status === 'auth_required' || status === 'disconnected' || status === 'error';

const isActionableAcpErrorLog = (entry: AcpLogEntry | undefined): entry is AcpLogEntry => {
  if (!entry || entry.source === 'hydrated') {
    return false;
  }

  switch (entry.kind) {
    case 'request_error':
    case 'send_failed':
    case 'retry_failed':
      return true;
    case 'status':
      return entry.status === 'error';
    default:
      return false;
  }
};

const clearConflictingRecoveryBarrierState = (
  currentState: AcpRecoveryUiState,
  nextStatus: 'auth_required' | 'disconnected' | 'error'
): AcpRecoveryUiState => {
  const shouldClearAuthState = nextStatus !== 'auth_required';
  const shouldClearRetryState = nextStatus !== 'disconnected';

  if (!shouldClearAuthState && !shouldClearRetryState) {
    return currentState;
  }

  return {
    ...currentState,
    authenticatingRevision: shouldClearAuthState ? null : currentState.authenticatingRevision,
    pendingAuthReadyRevision: shouldClearAuthState ? null : currentState.pendingAuthReadyRevision,
    retryingDisconnectedRevision: shouldClearRetryState ? null : currentState.retryingDisconnectedRevision,
    pendingRetryReadyRevision: shouldClearRetryState ? null : currentState.pendingRetryReadyRevision,
  };
};

const useSendBoxDraft = (conversation_id: string) => {
  const { data, mutate } = useAcpSendBoxDraft(conversation_id);
  const atPath = data?.atPath ?? EMPTY_AT_PATH;
  const uploadFile = data?.uploadFile ?? EMPTY_UPLOAD_FILES;
  const content = data?.content ?? '';

  const setAtPath = useCallback(
    (nextAtPath: Array<string | FileOrFolderItem>) => {
      mutate((prev) => ({ ...prev, atPath: nextAtPath }));
    },
    [data, mutate]
  );

  const setUploadFile = createSetUploadFile(mutate, data);

  const setContent = useCallback(
    (nextContent: string) => {
      mutate((prev) => ({ ...prev, content: nextContent }));
    },
    [data, mutate]
  );

  return {
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
    content,
    setContent,
  };
};

const AcpSendBox: React.FC<{
  conversation_id: string;
  backend: AcpBackend;
  sessionMode?: string;
  cachedConfigOptions?: import('@/common/types/acpTypes').AcpSessionConfigOption[];
  agentName?: string;
  teamId?: string;
  agentSlotId?: string;
}> = ({ conversation_id, backend, sessionMode, cachedConfigOptions, agentName, teamId, agentSlotId }) => {
  const {
    running,
    hasHydratedRunningState,
    acpStatus,
    acpStatusSource,
    acpStatusRevision,
    slashCommandsRevision,
    appendAcpUiLog,
    primeRequestTraceFallback,
    clearPendingRequestTraceFallback,
    acpLogs,
    aiProcessing,
    setAiProcessing,
    resetState,
    tokenUsage,
    contextLimit,
  } = useAcpMessage(conversation_id, { backend, agentName, sessionMode });
  const { t } = useTranslation();
  const teamPermission = useTeamPermission();
  const mountedRef = React.useRef(true);
  // In team mode, only the lead agent shows the permission mode selector
  const showModeSelector = !teamPermission || conversation_id === teamPermission.leadConversationId;
  const { checkAndUpdateTitle } = useAutoTitle();
  const slashCommands = useSlashCommands(conversation_id, {
    agentStatus: acpStatus,
    agentRevision: slashCommandsRevision,
  });
  const { atPath, uploadFile, setAtPath, setUploadFile, content, setContent } = useSendBoxDraft(conversation_id);
  const { setSendBoxHandler } = usePreviewContext();

  // Use useLatestRef to keep latest setters to avoid re-registering handler
  const setContentRef = useLatestRef(setContent);
  const atPathRef = useLatestRef(atPath);
  const acpStatusRef = useLatestRef(acpStatus);
  const acpStatusRevisionRef = useLatestRef(acpStatusRevision);

  // Shared file handling logic
  const { handleFilesAdded, clearFiles } = useSendBoxFiles({
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
  });
  const recoveryUiState = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeAcpRecoveryUiState(conversation_id, listener), [conversation_id]),
    useCallback(() => readAcpRecoveryUiState(conversation_id), [conversation_id]),
    () => EMPTY_ACP_RECOVERY_UI_STATE
  );
  const {
    authenticatingRevision,
    pendingAuthReadyRevision,
    retryingDisconnectedRevision,
    pendingRetryReadyRevision,
    sendNowPending,
  } = recoveryUiState;
  const isBusy = running || aiProcessing;
  const isAuthActionActive = authenticatingRevision !== null || pendingAuthReadyRevision !== null;
  const isRetryActionActive = retryingDisconnectedRevision !== null || pendingRetryReadyRevision !== null;
  const hasHydratedTerminalStatus = acpStatusSource === 'hydrated' && isTerminalAcpStatus(acpStatus);
  const shouldBlockQueueOnHistoricalBarrier = hasHydratedTerminalStatus;
  const shouldBlockQueueOnLiveAuthBarrier = !isBusy && acpStatus === 'auth_required' && !hasHydratedTerminalStatus;
  const shouldBlockQueueOnLiveDisconnectedBarrier =
    !isBusy && acpStatus === 'disconnected' && !hasHydratedTerminalStatus;
  const isQueueExecutionBlocked =
    shouldBlockQueueOnLiveAuthBarrier ||
    shouldBlockQueueOnLiveDisconnectedBarrier ||
    shouldBlockQueueOnHistoricalBarrier ||
    isAuthActionActive ||
    isRetryActionActive;

  const updateRecoveryUiState = useCallback(
    (updater: (currentState: AcpRecoveryUiState) => AcpRecoveryUiState) => {
      updateStoredAcpRecoveryUiState(conversation_id, updater);
    },
    [conversation_id]
  );

  const shouldSurfaceAuthFailure = useCallback(
    (activeRevision: number): boolean => {
      if (!mountedRef.current) {
        return false;
      }

      if (!isCurrentPendingAuthRevision(conversation_id, activeRevision)) {
        return false;
      }

      return !hasRecoveryBarrierHandedOff(acpStatusRef.current, acpStatusRevisionRef.current, activeRevision, 'auth');
    },
    [acpStatusRef, acpStatusRevisionRef, conversation_id]
  );

  const shouldSurfaceRetryFailure = useCallback(
    (activeRevision: number): boolean => {
      if (!mountedRef.current) {
        return false;
      }

      if (!isCurrentPendingRetryRevision(conversation_id, activeRevision)) {
        return false;
      }

      return !hasRecoveryBarrierHandedOff(acpStatusRef.current, acpStatusRevisionRef.current, activeRevision, 'retry');
    },
    [acpStatusRef, acpStatusRevisionRef, conversation_id]
  );

  const clearAuthRecoveryState = useCallback(
    (activeRevision: number, options?: { clearPending?: boolean }) => {
      updateRecoveryUiState((currentState) => ({
        ...currentState,
        authenticatingRevision:
          currentState.authenticatingRevision === activeRevision ? null : currentState.authenticatingRevision,
        pendingAuthReadyRevision:
          options?.clearPending && currentState.pendingAuthReadyRevision === activeRevision
            ? null
            : currentState.pendingAuthReadyRevision,
      }));
    },
    [updateRecoveryUiState]
  );

  const clearRetryRecoveryState = useCallback(
    (activeRevision: number, options?: { clearPending?: boolean }) => {
      updateRecoveryUiState((currentState) => ({
        ...currentState,
        retryingDisconnectedRevision:
          currentState.retryingDisconnectedRevision === activeRevision
            ? null
            : currentState.retryingDisconnectedRevision,
        pendingRetryReadyRevision:
          options?.clearPending && currentState.pendingRetryReadyRevision === activeRevision
            ? null
            : currentState.pendingRetryReadyRevision,
      }));
    },
    [updateRecoveryUiState]
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const subscribe = ipcBridge.acpConversation.responseStream?.on;
    if (typeof subscribe !== 'function') {
      return;
    }

    return subscribe((message: unknown) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      const acpMessage = message as {
        type?: unknown;
        conversation_id?: unknown;
        data?: { status?: unknown };
      };

      if (acpMessage.type !== 'agent_status' || acpMessage.conversation_id !== conversation_id) {
        return;
      }

      const nextStatus = typeof acpMessage.data?.status === 'string' ? acpMessage.data.status : null;
      if (nextStatus === null || !isTerminalAcpStatus(nextStatus)) {
        return;
      }

      const currentState = readAcpRecoveryUiState(conversation_id);
      const nextState = clearConflictingRecoveryBarrierState(currentState, nextStatus);

      if (nextState === currentState) {
        return;
      }

      updateRecoveryUiState(() => nextState);
    });
  }, [conversation_id, updateRecoveryUiState]);

  useEffect(() => {
    if (acpStatusSource !== 'hydrated' || !isTerminalAcpStatus(acpStatus)) {
      return;
    }

    updateRecoveryUiState((currentState) => clearConflictingRecoveryBarrierState(currentState, acpStatus));
  }, [acpStatus, acpStatusSource, updateRecoveryUiState]);

  // Register handler for adding text from preview panel to sendbox
  useEffect(() => {
    const handler = (text: string) => {
      // If there's existing content, add newline and new text; otherwise just set the text
      const newContent = content ? `${content}\n${text}` : text;
      setContentRef.current(newContent);
    };
    setSendBoxHandler(handler);
  }, [setSendBoxHandler, content]);

  // Listen for sendbox.fill event to populate input from external sources
  useAddEventListener(
    'sendbox.fill',
    (text: string) => {
      setContentRef.current(text);
    },
    []
  );

  // Check for and send initial message from guid page
  useAcpInitialMessage({
    conversationId: conversation_id,
    backend,
    agentName,
    sessionMode,
    setAiProcessing,
    appendAcpUiLog,
    primeRequestTraceFallback,
    clearPendingRequestTraceFallback,
    checkAndUpdateTitle,
  });

  const executeCommand = useCallback(
    async ({ input, files }: Pick<ConversationCommandQueueItem, 'input' | 'files'>) => {
      const msg_id = uuid();

      setAiProcessing(true);
      if (!teamId) {
        primeRequestTraceFallback({
          backend,
          agentName,
          sessionMode,
          timestamp: Date.now(),
        });
      }

      try {
        void checkAndUpdateTitle(conversation_id, input);
        if (teamId) {
          if (agentSlotId) {
            const result = await ipcBridge.team.sendMessageToAgent.invoke({
              teamId,
              slotId: agentSlotId,
              content: input,
            });
            const maybeError = result as unknown as { __bridgeError?: boolean; message?: string };
            if (maybeError.__bridgeError) {
              throw new Error(maybeError.message || 'Failed to send message to agent');
            }
          } else {
            const result = await ipcBridge.team.sendMessage.invoke({ teamId, content: input });
            const maybeError = result as unknown as { __bridgeError?: boolean; message?: string };
            if (maybeError.__bridgeError) {
              throw new Error(maybeError.message || 'Failed to send message to team');
            }
          }
        } else {
          const result = await ipcBridge.acpConversation.sendMessage.invoke({
            input,
            msg_id,
            conversation_id,
            files,
          });
          assertBridgeSuccess(result, `Failed to send message to ${backend}`);
        }
        emitter.emit('chat.history.refresh');
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const clearedFallbackRequestTrace = clearPendingRequestTraceFallback();
        const isAuthError =
          errorMsg.includes('[ACP-AUTH-') ||
          errorMsg.includes('authentication failed') ||
          errorMsg.includes('认证失败');
        if (clearedFallbackRequestTrace) {
          appendAcpUiLog({
            kind: isAuthError ? 'auth_failed' : 'send_failed',
            level: 'error',
            backend,
            agentName,
            detail: errorMsg,
          });
          const errorMessage = {
            id: uuid(),
            msg_id: uuid(),
            conversation_id,
            type: 'error',
            hidden: true,
            data: isAuthError
              ? t('acp.auth.failed', {
                  backend,
                  error: errorMsg,
                  defaultValue: `${backend} authentication failed:

{{error}}

Please check your local CLI tool authentication status`,
                })
              : t('acp.send.failed', {
                  backend,
                  error: errorMsg,
                  defaultValue: `Failed to send message to ${backend}:

{{error}}`,
                }),
          };

          ipcBridge.acpConversation.responseStream.emit(errorMessage);
        }

        setAiProcessing(false);
        throw error;
      }

      if (files.length > 0) {
        emitter.emit('acp.workspace.refresh');
      }
    },
    [
      agentSlotId,
      agentName,
      backend,
      checkAndUpdateTitle,
      conversation_id,
      clearPendingRequestTraceFallback,
      primeRequestTraceFallback,
      sessionMode,
      setAiProcessing,
      t,
      teamId,
    ]
  );

  const {
    items: queuedCommands,
    isPaused: isQueuePaused,
    isInteractionLocked: isQueueInteractionLocked,
    hasPendingCommands,
    enqueue,
    update,
    remove,
    clear,
    reorder,
    pause,
    resume,
    lockInteraction,
    unlockInteraction,
    resetActiveExecution,
  } = useConversationCommandQueue({
    conversationId: conversation_id,
    isBusy,
    isHydrated: hasHydratedRunningState,
    isExecutionBlocked: isQueueExecutionBlocked,
    onExecute: executeCommand,
  });

  const shouldShowAuthBanner =
    !isBusy &&
    ((acpStatus === 'auth_required' && (!hasHydratedTerminalStatus || hasPendingCommands)) ||
      isAuthActionActive ||
      acpLogs[0]?.kind === 'auth_failed');
  const isAuthenticating = shouldShowAuthBanner && isAuthActionActive;
  const shouldShowDisconnectedBanner =
    !isBusy &&
    !shouldShowAuthBanner &&
    ((acpStatus === 'disconnected' && (!hasHydratedTerminalStatus || hasPendingCommands)) || isRetryActionActive);
  const isRetryingConnection = shouldShowDisconnectedBanner && isRetryActionActive;
  const actionableErrorLog = isActionableAcpErrorLog(acpLogs[0]) ? acpLogs[0] : null;
  const shouldShowErrorBanner =
    !isBusy && !shouldShowAuthBanner && !shouldShowDisconnectedBanner && actionableErrorLog !== null;

  const onSendHandler = async (message: string) => {
    const atPathFiles = atPath.map((item) => (typeof item === 'string' ? item : item.path));
    const allFiles = [...uploadFile, ...atPathFiles];

    clearFiles();
    emitter.emit('acp.selected.file.clear');

    if (shouldEnqueueConversationCommand({ isBusy, hasPendingCommands })) {
      enqueue({ input: message, files: allFiles });
      return;
    }

    await executeCommand({ input: message, files: allFiles });
  };

  const appendSelectedFiles = useCallback(
    (files: string[]) => {
      setUploadFile((prev) => [...prev, ...files]);
    },
    [setUploadFile]
  );
  const { openFileSelector, onSlashBuiltinCommand } = useOpenFileSelector({
    onFilesSelected: appendSelectedFiles,
  });

  useAddEventListener('acp.selected.file', setAtPath);
  useAddEventListener('acp.selected.file.append', (selectedItems: Array<string | FileOrFolderItem>) => {
    const merged = mergeFileSelectionItems(atPathRef.current, selectedItems);
    if (merged !== atPathRef.current) {
      setAtPath(merged as Array<string | FileOrFolderItem>);
    }
  });

  // Stop conversation handler
  const handleStop = useCallback(
    async (reason: 'stop' | 'send_now' = 'stop'): Promise<void> => {
      // Use finally to ensure UI state is reset even if backend stop fails
      try {
        appendAcpUiLog({
          kind: reason === 'send_now' ? 'send_now_requested' : 'cancel_requested',
          level: 'warning',
          backend,
          agentName,
        });
        await ipcBridge.conversation.stop.invoke({ conversation_id });
      } finally {
        resetState();
        resetActiveExecution('stop');
      }
    },
    [agentName, appendAcpUiLog, backend, conversation_id, resetActiveExecution, resetState]
  );

  useEffect(() => {
    if (pendingAuthReadyRevision === null) {
      return;
    }

    if (acpStatusRevision <= pendingAuthReadyRevision) {
      return;
    }

    if (acpStatus === 'session_active') {
      appendAcpUiLog({
        kind: 'auth_ready',
        level: 'success',
        backend,
        agentName,
      });
      updateRecoveryUiState((currentState) => ({
        ...currentState,
        pendingAuthReadyRevision: null,
      }));
      return;
    }
  }, [
    acpStatus,
    acpStatusRevision,
    agentName,
    appendAcpUiLog,
    backend,
    pendingAuthReadyRevision,
    updateRecoveryUiState,
  ]);

  useEffect(() => {
    if (pendingAuthReadyRevision === null || acpStatusRevision <= pendingAuthReadyRevision) {
      return;
    }

    if (acpStatus === 'session_active') {
      return;
    }

    if (isTerminalAcpStatus(acpStatus)) {
      updateRecoveryUiState((currentState) => ({
        ...currentState,
        pendingAuthReadyRevision: null,
      }));
    }
  }, [acpStatus, acpStatusRevision, pendingAuthReadyRevision, updateRecoveryUiState]);

  useEffect(() => {
    if (pendingRetryReadyRevision === null) {
      return;
    }

    if (acpStatusRevision <= pendingRetryReadyRevision) {
      return;
    }

    if (acpStatus === 'session_active') {
      appendAcpUiLog({
        kind: 'retry_ready',
        level: 'success',
        backend,
        agentName,
      });
      updateRecoveryUiState((currentState) => ({
        ...currentState,
        pendingRetryReadyRevision: null,
      }));
      return;
    }
  }, [
    acpStatus,
    acpStatusRevision,
    agentName,
    appendAcpUiLog,
    backend,
    pendingRetryReadyRevision,
    updateRecoveryUiState,
  ]);

  useEffect(() => {
    if (pendingRetryReadyRevision === null || acpStatusRevision <= pendingRetryReadyRevision) {
      return;
    }

    if (acpStatus === 'session_active') {
      return;
    }

    if (isTerminalAcpStatus(acpStatus)) {
      updateRecoveryUiState((currentState) => ({
        ...currentState,
        pendingRetryReadyRevision: null,
      }));
    }
  }, [acpStatus, acpStatusRevision, pendingRetryReadyRevision, updateRecoveryUiState]);

  const handleAuthenticate = useCallback(async (): Promise<void> => {
    if (authenticatingRevision !== null || pendingAuthReadyRevision !== null) {
      return;
    }

    const activeRevision = acpStatusRevision;
    updateRecoveryUiState((currentState) => ({
      ...currentState,
      authenticatingRevision: activeRevision,
      pendingAuthReadyRevision: activeRevision,
    }));

    try {
      appendAcpUiLog({
        kind: 'auth_requested',
        level: 'warning',
        backend,
        agentName,
      });
      const result = await ipcBridge.acpConversation.authenticate.invoke({ conversationId: conversation_id });
      if (result?.success) {
        return;
      }

      if (!shouldSurfaceAuthFailure(activeRevision)) {
        if (!mountedRef.current) {
          clearAuthRecoveryState(activeRevision, { clearPending: true });
        }
        return;
      }

      clearAuthRecoveryState(activeRevision, { clearPending: true });

      const authFailedMessage = t('acp.auth.authenticateFailed', {
        agent: agentName || backend,
        defaultValue: `Failed to authenticate ${agentName || backend}. Try again or refresh your local CLI login.`,
      });
      appendAcpUiLog({
        kind: 'auth_failed',
        level: 'error',
        backend,
        agentName,
        detail: result?.msg || authFailedMessage,
      });
      Message.error(result?.msg || authFailedMessage);
    } catch (error) {
      const authFailedMessage =
        error instanceof Error
          ? error.message
          : t('acp.auth.authenticateFailed', {
              agent: agentName || backend,
              defaultValue: `Failed to authenticate ${agentName || backend}. Try again or refresh your local CLI login.`,
            });

      if (!shouldSurfaceAuthFailure(activeRevision)) {
        if (!mountedRef.current) {
          clearAuthRecoveryState(activeRevision, { clearPending: true });
        }
        return;
      }

      clearAuthRecoveryState(activeRevision, { clearPending: true });
      appendAcpUiLog({
        kind: 'auth_failed',
        level: 'error',
        backend,
        agentName,
        detail: authFailedMessage,
      });
      Message.error(authFailedMessage);
    } finally {
      clearAuthRecoveryState(activeRevision);
    }
  }, [
    acpStatusRevision,
    agentName,
    appendAcpUiLog,
    authenticatingRevision,
    backend,
    clearAuthRecoveryState,
    conversation_id,
    mountedRef,
    pendingAuthReadyRevision,
    shouldSurfaceAuthFailure,
    t,
    updateRecoveryUiState,
  ]);

  const handleRetryConnection = useCallback(async (): Promise<void> => {
    if (retryingDisconnectedRevision !== null || pendingRetryReadyRevision !== null) {
      return;
    }

    const activeRevision = acpStatusRevision;
    updateRecoveryUiState((currentState) => ({
      ...currentState,
      retryingDisconnectedRevision: activeRevision,
      pendingRetryReadyRevision: activeRevision,
    }));

    try {
      appendAcpUiLog({
        kind: 'retry_requested',
        level: 'warning',
        backend,
        agentName,
      });
      const warmed = await ipcBridge.conversation.warmup.invoke({ conversation_id });
      if (warmed) {
        return;
      }

      if (!shouldSurfaceRetryFailure(activeRevision)) {
        if (!mountedRef.current) {
          clearRetryRecoveryState(activeRevision, { clearPending: true });
        }
        return;
      }

      clearRetryRecoveryState(activeRevision, { clearPending: true });

      const retryFailedMessage = t('acp.connection.retryFailed', {
        agent: agentName || backend,
        defaultValue: `Failed to warm up ${agentName || backend}. Try again or send a new message.`,
      });
      appendAcpUiLog({
        kind: 'retry_failed',
        level: 'error',
        backend,
        agentName,
        detail: retryFailedMessage,
      });
      Message.error(retryFailedMessage);
    } catch (error) {
      const retryFailedMessage =
        error instanceof Error
          ? error.message
          : t('acp.connection.retryFailed', {
              agent: agentName || backend,
              defaultValue: `Failed to warm up ${agentName || backend}. Try again or send a new message.`,
            });

      if (!shouldSurfaceRetryFailure(activeRevision)) {
        if (!mountedRef.current) {
          clearRetryRecoveryState(activeRevision, { clearPending: true });
        }
        return;
      }

      clearRetryRecoveryState(activeRevision, { clearPending: true });
      appendAcpUiLog({
        kind: 'retry_failed',
        level: 'error',
        backend,
        agentName,
        detail: retryFailedMessage,
      });
      Message.error(retryFailedMessage);
    } finally {
      clearRetryRecoveryState(activeRevision);
    }
  }, [
    acpStatusRevision,
    agentName,
    appendAcpUiLog,
    backend,
    clearRetryRecoveryState,
    conversation_id,
    mountedRef,
    pendingRetryReadyRevision,
    retryingDisconnectedRevision,
    shouldSurfaceRetryFailure,
    t,
    updateRecoveryUiState,
  ]);

  const handleSendNow = useCallback(async (): Promise<void> => {
    if (sendNowPending) {
      return;
    }

    updateRecoveryUiState((currentState) => ({
      ...currentState,
      sendNowPending: true,
    }));
    try {
      await handleStop('send_now');
    } finally {
      updateRecoveryUiState((currentState) => ({
        ...currentState,
        sendNowPending: false,
      }));
    }
  }, [handleStop, sendNowPending, updateRecoveryUiState]);

  return (
    <div className='max-w-800px w-full mx-auto flex flex-col mt-auto mb-16px'>
      {shouldShowAuthBanner && (
        <AcpAuthBanner
          agentName={agentName}
          backend={backend}
          authenticating={isAuthenticating}
          onAuthenticate={() => {
            void handleAuthenticate();
          }}
        />
      )}
      {shouldShowDisconnectedBanner && (
        <AcpConnectionBanner
          agentName={agentName}
          backend={backend}
          retrying={isRetryingConnection}
          onRetry={() => {
            void handleRetryConnection();
          }}
        />
      )}
      {shouldShowErrorBanner && <AcpErrorBanner entry={actionableErrorLog} />}
      <CommandQueuePanel
        items={queuedCommands}
        paused={isQueuePaused}
        interactionLocked={isQueueInteractionLocked}
        onSendNow={
          isBusy && queuedCommands.length > 0 && !isQueuePaused && !isQueueInteractionLocked
            ? () => void handleSendNow()
            : undefined
        }
        sendNowLoading={sendNowPending}
        onPause={pause}
        onResume={resume}
        onInteractionLock={lockInteraction}
        onInteractionUnlock={unlockInteraction}
        onUpdate={(commandId, input) => update(commandId, { input })}
        onReorder={reorder}
        onRemove={remove}
        onClear={clear}
      />

      <SendBox
        value={content}
        onChange={setContent}
        loading={isBusy}
        disabled={false}
        placeholder={
          isBusy
            ? t('conversation.chat.processing')
            : t('acp.sendbox.placeholder', {
                backend: agentName || backend,
                defaultValue: `Send message to {{backend}}...`,
              })
        }
        onStop={handleStop}
        className='z-10'
        onFilesAdded={handleFilesAdded}
        hasPendingAttachments={uploadFile.length > 0 || atPath.length > 0}
        enableBtw={isSideQuestionSupported({ type: 'acp', backend })}
        supportedExts={allSupportedExts}
        defaultMultiLine={true}
        lockMultiLine={true}
        tools={
          <div className='flex items-center gap-4px'>
            <FileAttachButton openFileSelector={openFileSelector} onLocalFilesAdded={handleFilesAdded} />
            {showModeSelector && (
              <AgentModeSelector
                backend={backend}
                conversationId={conversation_id}
                compact
                initialMode={sessionMode}
                compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
                modeLabelFormatter={(mode) => t(`agentMode.${mode.value}`, { defaultValue: mode.label })}
                compactLabelPrefix={t('agentMode.permission')}
                hideCompactLabelPrefixOnMobile
                onModeChanged={teamPermission?.propagateMode}
              />
            )}
            <AcpConfigSelector
              conversationId={conversation_id}
              backend={backend}
              compact={!!teamId}
              initialConfigOptions={cachedConfigOptions}
            />
          </div>
        }
        prefix={
          <>
            {/* Files on top */}
            {(uploadFile.length > 0 || atPath.some((item) => (typeof item === 'string' ? true : item.isFile))) && (
              <HorizontalFileList>
                {uploadFile.map((path) => (
                  <FilePreview
                    key={path}
                    path={path}
                    onRemove={() => setUploadFile(uploadFile.filter((v) => v !== path))}
                  />
                ))}
                {atPath.map((item) => {
                  const isFile = typeof item === 'string' ? true : item.isFile;
                  const path = typeof item === 'string' ? item : item.path;
                  if (isFile) {
                    return (
                      <FilePreview
                        key={path}
                        path={path}
                        onRemove={() => {
                          const newAtPath = atPath.filter((v) =>
                            typeof v === 'string' ? v !== path : v.path !== path
                          );
                          emitter.emit('acp.selected.file', newAtPath);
                          setAtPath(newAtPath);
                        }}
                      />
                    );
                  }
                  return null;
                })}
              </HorizontalFileList>
            )}
            {/* Folder tags below */}
            {atPath.some((item) => (typeof item === 'string' ? false : !item.isFile)) && (
              <div className='flex flex-wrap items-center gap-8px mb-8px'>
                {atPath.map((item) => {
                  if (typeof item === 'string') return null;
                  if (!item.isFile) {
                    return (
                      <Tag
                        key={item.path}
                        color='blue'
                        closable
                        onClose={() => {
                          const newAtPath = atPath.filter((v) => (typeof v === 'string' ? true : v.path !== item.path));
                          emitter.emit('acp.selected.file', newAtPath);
                          setAtPath(newAtPath);
                        }}
                      >
                        {item.name}
                      </Tag>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </>
        }
        onSend={onSendHandler}
        slashCommands={slashCommands}
        onSlashBuiltinCommand={onSlashBuiltinCommand}
        allowSendWhileLoading
        compactActions={!!teamId}
        autoFocus={false}
        sendButtonPrefix={
          tokenUsage ? (
            <ContextUsageIndicator
              tokenUsage={tokenUsage}
              contextLimit={contextLimit > 0 ? contextLimit : undefined}
              size={24}
            />
          ) : undefined
        }
      ></SendBox>
    </div>
  );
};

export default AcpSendBox;
