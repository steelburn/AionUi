import { useCallback, useSyncExternalStore } from 'react';

export type AcpRuntimeStatus =
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'session_active'
  | 'auth_required'
  | 'disconnected'
  | 'error';

export type AcpRuntimeStatusSource = 'live' | 'hydrated';
export type AcpRuntimeActivityPhase = 'idle' | 'waiting' | 'streaming';

export type AcpLogLevel = 'info' | 'success' | 'warning' | 'error';

export type AcpLogEntry = {
  id: string;
  kind:
    | 'status'
    | 'request_started'
    | 'first_response'
    | 'request_finished'
    | 'request_error'
    | 'send_failed'
    | 'auth_requested'
    | 'auth_ready'
    | 'auth_failed'
    | 'retry_requested'
    | 'retry_ready'
    | 'retry_failed'
    | 'send_now_requested'
    | 'cancel_requested';
  level: AcpLogLevel;
  timestamp: number;
  source: 'live' | 'hydrated' | 'ui';
  backend?: string;
  modelId?: string;
  sessionMode?: string;
  agentName?: string;
  status?: AcpRuntimeStatus;
  durationMs?: number;
  disconnectCode?: number | null;
  disconnectSignal?: string | null;
  detail?: string;
};

export type AcpRuntimeDiagnosticsSnapshot = {
  status: AcpRuntimeStatus | null;
  statusSource: AcpRuntimeStatusSource | null;
  statusRevision: number;
  activityPhase: AcpRuntimeActivityPhase;
  uiWarmupPending?: boolean;
  hasThinkingMessage?: boolean;
  logs: AcpLogEntry[];
};

const EMPTY_ACP_RUNTIME_DIAGNOSTICS_SNAPSHOT: AcpRuntimeDiagnosticsSnapshot = Object.freeze({
  status: null,
  statusSource: null,
  statusRevision: 0,
  activityPhase: 'idle',
  uiWarmupPending: false,
  hasThinkingMessage: false,
  logs: [],
});

const acpRuntimeDiagnosticsStore = new Map<string, AcpRuntimeDiagnosticsSnapshot>();
const acpRuntimeWarmupPendingStore = new Map<string, boolean>();
const acpRuntimeDiagnosticsListeners = new Map<string, Set<() => void>>();

export const readAcpRuntimeDiagnosticsSnapshot = (conversationId: string): AcpRuntimeDiagnosticsSnapshot => {
  return acpRuntimeDiagnosticsStore.get(conversationId) ?? EMPTY_ACP_RUNTIME_DIAGNOSTICS_SNAPSHOT;
};

export const isAcpRuntimeWaitingSnapshot = (
  snapshot: Pick<AcpRuntimeDiagnosticsSnapshot, 'activityPhase' | 'uiWarmupPending'>
): boolean => snapshot.activityPhase === 'waiting' || snapshot.uiWarmupPending === true;

export const isAcpRuntimeBusySnapshot = (
  snapshot: Pick<AcpRuntimeDiagnosticsSnapshot, 'activityPhase' | 'uiWarmupPending'>
): boolean => snapshot.activityPhase !== 'idle' || snapshot.uiWarmupPending === true;

const emitAcpRuntimeDiagnosticsSnapshot = (conversationId: string): void => {
  for (const listener of acpRuntimeDiagnosticsListeners.get(conversationId) ?? []) {
    listener();
  }
};

export const publishAcpRuntimeDiagnosticsSnapshot = (
  conversationId: string,
  snapshot: AcpRuntimeDiagnosticsSnapshot
): void => {
  const nextSnapshot: AcpRuntimeDiagnosticsSnapshot = {
    ...snapshot,
    uiWarmupPending: acpRuntimeWarmupPendingStore.get(conversationId) ?? false,
  };
  const currentSnapshot = acpRuntimeDiagnosticsStore.get(conversationId);
  if (
    currentSnapshot &&
    currentSnapshot.status === nextSnapshot.status &&
    currentSnapshot.statusSource === nextSnapshot.statusSource &&
    currentSnapshot.statusRevision === nextSnapshot.statusRevision &&
    currentSnapshot.activityPhase === nextSnapshot.activityPhase &&
    currentSnapshot.uiWarmupPending === nextSnapshot.uiWarmupPending &&
    Boolean(currentSnapshot.hasThinkingMessage) === Boolean(nextSnapshot.hasThinkingMessage) &&
    currentSnapshot.logs === nextSnapshot.logs
  ) {
    return;
  }

  if (
    nextSnapshot.status === null &&
    nextSnapshot.statusSource === null &&
    nextSnapshot.statusRevision === 0 &&
    nextSnapshot.activityPhase === 'idle' &&
    !nextSnapshot.uiWarmupPending &&
    !nextSnapshot.hasThinkingMessage &&
    nextSnapshot.logs.length === 0
  ) {
    acpRuntimeDiagnosticsStore.delete(conversationId);
  } else {
    acpRuntimeDiagnosticsStore.set(conversationId, nextSnapshot);
  }

  emitAcpRuntimeDiagnosticsSnapshot(conversationId);
};

export const setAcpRuntimeUiWarmupPending = (conversationId: string, pending: boolean): void => {
  const currentPending = acpRuntimeWarmupPendingStore.get(conversationId) ?? false;
  if (currentPending === pending) {
    return;
  }

  if (pending) {
    acpRuntimeWarmupPendingStore.set(conversationId, true);
  } else {
    acpRuntimeWarmupPendingStore.delete(conversationId);
  }

  const currentSnapshot = acpRuntimeDiagnosticsStore.get(conversationId);
  if (currentSnapshot) {
    const nextSnapshot: AcpRuntimeDiagnosticsSnapshot = {
      ...currentSnapshot,
      uiWarmupPending: pending,
    };

    if (
      nextSnapshot.status === null &&
      nextSnapshot.statusSource === null &&
      nextSnapshot.statusRevision === 0 &&
      nextSnapshot.activityPhase === 'idle' &&
      !nextSnapshot.uiWarmupPending &&
      !nextSnapshot.hasThinkingMessage &&
      nextSnapshot.logs.length === 0
    ) {
      acpRuntimeDiagnosticsStore.delete(conversationId);
    } else {
      acpRuntimeDiagnosticsStore.set(conversationId, nextSnapshot);
    }
  } else if (pending) {
    acpRuntimeDiagnosticsStore.set(conversationId, {
      ...EMPTY_ACP_RUNTIME_DIAGNOSTICS_SNAPSHOT,
      uiWarmupPending: true,
    });
  }

  emitAcpRuntimeDiagnosticsSnapshot(conversationId);
};

export const clearAcpRuntimeDiagnosticsSnapshot = (conversationId: string): void => {
  const hadDiagnostics = acpRuntimeDiagnosticsStore.has(conversationId);
  const hadWarmupPending = acpRuntimeWarmupPendingStore.has(conversationId);

  if (!hadDiagnostics && !hadWarmupPending) {
    return;
  }

  acpRuntimeDiagnosticsStore.delete(conversationId);
  acpRuntimeWarmupPendingStore.delete(conversationId);
  emitAcpRuntimeDiagnosticsSnapshot(conversationId);
};

const subscribeAcpRuntimeDiagnosticsSnapshot = (conversationId: string, listener: () => void): (() => void) => {
  const listeners = acpRuntimeDiagnosticsListeners.get(conversationId) ?? new Set<() => void>();
  listeners.add(listener);
  acpRuntimeDiagnosticsListeners.set(conversationId, listeners);

  return () => {
    const currentListeners = acpRuntimeDiagnosticsListeners.get(conversationId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      acpRuntimeDiagnosticsListeners.delete(conversationId);
    }
  };
};

export const useAcpRuntimeDiagnostics = (conversationId: string): AcpRuntimeDiagnosticsSnapshot => {
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => subscribeAcpRuntimeDiagnosticsSnapshot(conversationId, listener),
      [conversationId]
    ),
    useCallback(() => readAcpRuntimeDiagnosticsSnapshot(conversationId), [conversationId]),
    () => EMPTY_ACP_RUNTIME_DIAGNOSTICS_SNAPSHOT
  );
};
