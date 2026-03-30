/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/IAgentEventEmitter.ts

import type { IConfirmation } from '@/common/chat/chatLib';

/** Dispatch-specific event data types */
export type DispatchEventData =
  | { type: 'dispatch:child_started'; childId: string; title: string }
  | { type: 'dispatch:child_progress'; childId: string; summary: string }
  | { type: 'dispatch:child_completed'; childId: string; title: string; resultSummary: string }
  | { type: 'dispatch:child_failed'; childId: string; title: string; error: string };

/** Discriminated union of all events an agent can emit to the renderer */
export type AgentMessageEvent =
  | { type: 'text'; data: { content: string; msg_id: string } }
  | { type: 'tool_group'; data: unknown[] }
  | { type: 'status'; data: { status: string } }
  | { type: 'dispatch_event'; data: DispatchEventData }
  | { type: string; data: unknown }; // agent-specific extensions

export interface IAgentEventEmitter {
  emitConfirmationAdd(conversationId: string, data: IConfirmation): void;
  emitConfirmationUpdate(conversationId: string, data: IConfirmation): void;
  emitConfirmationRemove(conversationId: string, confirmationId: string): void;
  emitMessage(conversationId: string, event: AgentMessageEvent): void;
}
