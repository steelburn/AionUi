/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/dispatchTypes.ts

import type { AgentStatus, AgentType } from '../agentTypes';

/** Dispatch session role type, maps to CC's agent/dispatch_child/scheduled */
export type DispatchSessionType = 'dispatcher' | 'dispatch_child' | 'normal';

/** Default concurrent child tasks per dispatcher */
export const DEFAULT_CONCURRENT_CHILDREN = 3;
/** @deprecated Use DEFAULT_CONCURRENT_CHILDREN. Kept for backward compatibility. */
export const MAX_CONCURRENT_CHILDREN = DEFAULT_CONCURRENT_CHILDREN;
/** Minimum configurable concurrent children */
export const MIN_CONCURRENT_CHILDREN = 1;
/** Maximum configurable concurrent children */
export const MAX_CONCURRENT_CHILDREN_LIMIT = 10;

/** Parameters for creating a child task */
export type StartChildTaskParams = {
  /** Initial prompt */
  prompt: string;
  /** Short title (3-6 words) */
  title: string;
  /** Optional model override for child agent */
  model?: {
    providerId: string;
    modelName: string;
  };
  /** Optional working directory override for child agent */
  workspace?: string;
  /** Engine type for the child worker. Defaults to 'gemini'. */
  agent_type?: AgentType;
  /** Isolation mode: 'worktree' for git worktree isolation (used by start_code_task). */
  isolation?: 'worktree';
};

/** Child task info (for listing/querying) */
export type ChildTaskInfo = {
  sessionId: string;
  title: string;
  /** Unified AgentStatus, no separate DispatchLifecycleState */
  status: AgentStatus;
  createdAt: number;
  lastActivityAt: number;
  /** Working directory for this child */
  workspace?: string;
  /** Engine type of this child worker */
  agentType?: AgentType;
  /** Worktree path if isolation='worktree' was used */
  worktreePath?: string;
  /** Worktree branch name for merge/cleanup */
  worktreeBranch?: string;
};

/** Options for reading child task transcript */
export type ReadTranscriptOptions = {
  sessionId: string;
  /** Max messages to return (default 20) */
  limit?: number;
  /** Seconds to wait for completion (default 30, 0 for immediate) */
  maxWaitSeconds?: number;
  /**
   * Output format:
   *   - 'auto': running -> progress summary (template); completed -> full transcript
   *   - 'full': always return full transcript
   */
  format?: 'auto' | 'full';
};

/** Result of reading child task transcript */
export type TranscriptResult = {
  sessionId: string;
  title: string;
  status: AgentStatus;
  /** Formatted conversation text */
  transcript: string;
  /** Whether still running */
  isRunning: boolean;
};

/** Parameters for send_message tool */
export type SendMessageToChildParams = {
  sessionId: string;
  message: string;
};

/** Parameters for list_sessions tool */
export type ListSessionsParams = {
  limit?: number;
};

/** Structured pending notification for deduplication and correlation */
export type PendingNotification = {
  childSessionId: string;
  childTitle: string;
  result: 'completed' | 'failed' | 'cancelled' | 'context_resume';
  message: string;
  timestamp: number;
};

/** Child task completion notification */
export type ChildCompletionNotification = {
  childSessionId: string;
  parentSessionId: string;
  title: string;
  result: 'completed' | 'failed' | 'cancelled';
  /** Notification message to inject into parent agent */
  message: string;
};

/** Dispatch event types emitted via IPC */
export type DispatchEventData =
  | { type: 'dispatch:child_started'; childId: string; title: string }
  | { type: 'dispatch:child_progress'; childId: string; summary: string }
  | { type: 'dispatch:child_completed'; childId: string; title: string; resultSummary: string }
  | { type: 'dispatch:child_failed'; childId: string; title: string; error: string }
  | { type: 'dispatch:child_cancelled'; childId: string; title: string };

/** Group chat aggregated message type */
export type GroupChatMessage = {
  /** Source session ID */
  sourceSessionId: string;
  /** Source role: dispatcher / child / user */
  sourceRole: 'dispatcher' | 'child' | 'user';
  /** Display name */
  displayName: string;
  /** Message content */
  content: string;
  /** Message type */
  messageType:
    | 'text'
    | 'system'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'task_progress'
    | 'task_cancelled';
  /** Timestamp */
  timestamp: number;
  /** Associated child task ID (optional) */
  childTaskId?: string;
  /** Avatar */
  avatar?: string;
  /** Progress summary for task_progress messages, separate from content (CF-2) */
  progressSummary?: string;
};
