/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { initAllBridges } from '../bridge';
import { SqliteChannelRepository } from '@server/services/database/SqliteChannelRepository';
import { SqliteConversationRepository } from '@server/services/database/SqliteConversationRepository';
import { ConversationServiceImpl } from '@server/services/ConversationServiceImpl';
import { cronService } from '@server/services/cron/cronServiceSingleton';
import { workerTaskManager } from '@server/task/workerTaskManagerSingleton';

logger.config({ print: true });

const repo = new SqliteConversationRepository();
const conversationServiceImpl = new ConversationServiceImpl(repo);
const channelRepo = new SqliteChannelRepository();

// 初始化所有IPC桥接
initAllBridges({
  conversationService: conversationServiceImpl,
  conversationRepo: repo,
  workerTaskManager,
  channelRepo,
});

// Initialize cron service (load jobs from database and start timers)
void cronService.init().catch((error) => {
  console.error('[initBridge] Failed to initialize CronService:', error);
});
