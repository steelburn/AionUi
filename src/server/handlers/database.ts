/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../router/WsRouter';
import type { TChatConversation } from '@aionui/protocol/config/storage';
import { ProcessChat } from '@server/utils/initStorage';
import { migrateConversationToDatabase } from '@server/services/migrationUtils';
import type { IConversationRepository } from '@server/services/database/IConversationRepository';

/**
 * Register database endpoint handlers on the WsRouter.
 * Replaces initDatabaseBridge() from src/process/bridge/databaseBridge.ts.
 */
export function registerDatabaseHandlers(router: WsRouter, repo: IConversationRepository): void {
  // Get conversation messages from database
  router.handle('database.get-conversation-messages', async (_params) => {
    const { conversation_id, page = 0, pageSize = 10000 } = _params ?? {};
    try {
      const result = await repo.getMessages(conversation_id, page, pageSize);
      return result.data;
    } catch (error) {
      console.error('[DatabaseHandler] Error getting conversation messages:', error);
      return [];
    }
  });

  // Get user conversations from database with lazy migration from file storage
  router.handle('database.get-user-conversations', async (_params) => {
    const { page = 0, pageSize = 10000 } = _params ?? {};
    try {
      const result = await repo.getUserConversations(undefined, page * pageSize, pageSize);
      const dbConversations = result.data;

      // Try to get conversations from file storage
      let fileConversations: TChatConversation[] = [];
      try {
        fileConversations = (await ProcessChat.get('chat.history')) || [];
      } catch (error) {
        console.warn('[DatabaseHandler] No file-based conversations found:', error);
      }

      // Use database conversations as the primary source while backfilling missing ones from file storage
      const dbConversationMap = new Map(dbConversations.map((conv) => [conv.id, conv] as const));

      // Filter out conversations that already exist in database
      const fileOnlyConversations = fileConversations.filter((conv) => !dbConversationMap.has(conv.id));

      // If there are conversations that only exist in file storage, migrate them in background
      if (fileOnlyConversations.length > 0) {
        void Promise.all(fileOnlyConversations.map((conv) => migrateConversationToDatabase(conv)));
      }

      // Combine database conversations (source of truth) with any remaining file-only conversations
      const allConversations = [...dbConversations, ...fileOnlyConversations];
      // Re-sort by modifyTime (or createTime as fallback) to maintain correct order
      allConversations.sort((a, b) => (b.modifyTime || b.createTime || 0) - (a.modifyTime || a.createTime || 0));
      return allConversations;
    } catch (error) {
      console.error('[DatabaseHandler] Error getting user conversations:', error);
      return [];
    }
  });

  router.handle('database.search-conversation-messages', async (_params) => {
    const { keyword, page = 0, pageSize = 20 } = _params ?? {};
    try {
      const result = await repo.searchMessages(keyword, page, pageSize);
      return result;
    } catch (error) {
      console.error('[DatabaseHandler] Error searching conversation messages:', error);
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        hasMore: false,
      };
    }
  });
}
