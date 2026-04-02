/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bridge initialiser for standalone (no-Electron) mode.
 * Skips Electron-only bridges:
 *   dialogBridge, applicationBridge (partial — core handlers in applicationBridgeCore),
 *   windowControlsBridge, updateBridge, webuiBridge
 * Note: shellBridge is replaced by shellBridgeStandalone (child_process-based).
 */
import { logger } from '@office-ai/platform';
import { acpDetector } from '@server/agent/acp/AcpDetector';
import { SqliteChannelRepository } from '@server/services/database/SqliteChannelRepository';
import { SqliteConversationRepository } from '@server/services/database/SqliteConversationRepository';
import { ConversationServiceImpl } from '@server/services/ConversationServiceImpl';
import { workerTaskManager } from '@server/task/workerTaskManagerSingleton';
import { initAcpConversationBridge } from '@server/bridge/acpConversationBridge';
import { initAuthBridge } from '@server/bridge/authBridge';
import { initBedrockBridge } from '@server/bridge/bedrockBridge';
import { initChannelBridge } from '@server/bridge/channelBridge';
import { initConversationBridge } from '@server/bridge/conversationBridge';
import { initDatabaseBridge } from '@server/bridge/databaseBridge';
import { initDocumentBridge } from '@server/bridge/documentBridge';
import { initExtensionsBridge } from '@server/bridge/extensionsBridge';
import { initFileWatchBridge } from '@server/bridge/fileWatchBridge';
import { initGeminiBridge } from '@server/bridge/geminiBridge';
import { initGeminiConversationBridge } from '@server/bridge/geminiConversationBridge';
import { initModelBridge } from '@server/bridge/modelBridge';
import { initPreviewHistoryBridge } from '@server/bridge/previewHistoryBridge';
import { initPptPreviewBridge } from '@server/bridge/pptPreviewBridge';
import { initOfficeWatchBridge } from '@server/bridge/officeWatchBridge';
import { initStarOfficeBridge } from '@server/bridge/starOfficeBridge';
import { initApplicationBridgeCore } from '@server/bridge/applicationBridgeCore';
import { initShellBridgeStandalone } from '@server/bridge/shellBridgeStandalone';
import { initCronBridge } from '@server/bridge/cronBridge';
import { initFsBridge } from '@server/bridge/fsBridge';
import { initMcpBridge } from '@server/bridge/mcpBridge';
import { initNotificationBridge } from '@server/bridge/notificationBridge';
import { initSystemSettingsBridge } from '@server/bridge/systemSettingsBridge';
import { initTaskBridge } from '@server/bridge/taskBridge';
import { initSpeechToTextBridge } from '@server/bridge/speechToTextBridge';

logger.config({ print: true });

export async function initBridgeStandalone(): Promise<void> {
  const repo = new SqliteConversationRepository();
  const conversationService = new ConversationServiceImpl(repo);
  const channelRepo = new SqliteChannelRepository();

  // Skipped (Electron-only): dialogBridge, applicationBridge (partial — see applicationBridgeCore),
  // windowControlsBridge, updateBridge, webuiBridge

  initApplicationBridgeCore();
  initShellBridgeStandalone();
  initFileWatchBridge();
  initFsBridge();
  initConversationBridge(conversationService, workerTaskManager);
  initGeminiConversationBridge(workerTaskManager);
  initGeminiBridge();
  initBedrockBridge();
  initAcpConversationBridge(workerTaskManager);
  initAuthBridge();
  initModelBridge();
  initPreviewHistoryBridge();
  initDocumentBridge();
  initPptPreviewBridge();
  initOfficeWatchBridge();
  initChannelBridge(channelRepo);
  initDatabaseBridge(repo);
  initExtensionsBridge(repo, workerTaskManager);
  initSystemSettingsBridge();
  initCronBridge();
  initMcpBridge();
  initNotificationBridge();
  initTaskBridge(workerTaskManager);
  initStarOfficeBridge();
  initSpeechToTextBridge();

  // Initialize ACP detector to scan for installed CLI agents (claude, codex, etc.)
  // Must mirror Electron's initializeAcpDetector() call in src/index.ts
  try {
    await acpDetector.initialize();
  } catch (error) {
    console.error('[ACP] Failed to initialize detector in standalone mode:', error);
  }
}
