/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IConversationTurnCompletedEvent } from '@/common/ipcBridge';
import { getDatabase } from '@process/database';
import { CallbackService } from '@/webserver/services/CallbackService';

/**
 * API Callback Manager
 * Listens to unified conversation turn completion events and triggers HTTP callbacks
 */
export class ApiCallbackManager {
  private static instance: ApiCallbackManager | null = null;
  private unsubscribe: (() => void) | null = null;

  private constructor() {
    this.initialize();
  }

  static getInstance(): ApiCallbackManager {
    if (!this.instance) {
      this.instance = new ApiCallbackManager();
    }
    return this.instance;
  }

  private initialize(): void {
    console.log('[ApiCallbackManager] Initializing...');

    this.unsubscribe = ipcBridge.conversation.turnCompleted.on(async (event: IConversationTurnCompletedEvent) => {
      try {
        await this.handleTurnCompleted(event);
      } catch (error) {
        console.error('[ApiCallbackManager] Error handling turn completion:', error);
      }
    });

    console.log('[ApiCallbackManager] Initialized successfully');
  }

  private async handleTurnCompleted(event: IConversationTurnCompletedEvent): Promise<void> {
    const db = getDatabase();

    const configResult = db.getApiConfig();
    if (!configResult.success || !configResult.data?.enabled || !configResult.data.callbackEnabled || !configResult.data.callbackUrl) {
      return;
    }

    const messagesResult = db.getConversationMessages(event.sessionId, 0, 100);
    const messages = messagesResult.data || [];
    const hasLastMessage = messages.some((message) => message.id === event.lastMessage.id);
    const conversationHistory = hasLastMessage ? messages : [...messages, event.lastMessage];

    const variables = {
      conversationHistory,
      sessionId: event.sessionId,
      workspace: event.workspace,
      model: event.model,
      lastMessage: event.lastMessage,
      status: event.status,
      state: event.state,
      detail: event.detail,
      canSendMessage: event.canSendMessage,
      runtime: event.runtime,
    };

    void CallbackService.sendCallback(configResult.data, variables);
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    console.log('[ApiCallbackManager] Destroyed');
  }

  static destroyInstance(): void {
    if (this.instance) {
      this.instance.destroy();
      this.instance = null;
    }
  }
}
