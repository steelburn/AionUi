/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/index.ts

export { DispatchAgentManager } from './DispatchAgentManager';
export { DispatchMcpServer } from './DispatchMcpServer';
export { DispatchNotifier } from './DispatchNotifier';
export { DispatchSessionTracker } from './DispatchSessionTracker';
export { DispatchResourceGuard } from './DispatchResourceGuard';
export { buildDispatchSystemPrompt } from './dispatchPrompt';
export type {
  DispatchSessionType,
  StartChildTaskParams,
  ChildTaskInfo,
  ReadTranscriptOptions,
  TranscriptResult,
  ChildCompletionNotification,
  DispatchEventData,
  GroupChatMessage,
} from './dispatchTypes';
export { MAX_CONCURRENT_CHILDREN } from './dispatchTypes';
