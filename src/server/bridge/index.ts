/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { acpDetector } from '@server/agent/acp/AcpDetector';
import type { IChannelRepository } from '@server/services/database/IChannelRepository';
import type { IConversationRepository } from '@server/services/database/IConversationRepository';
import type { IConversationService } from '@server/services/IConversationService';
import type { IWorkerTaskManager } from '@server/task/IWorkerTaskManager';
import { initAcpConversationBridge } from './acpConversationBridge';
import { initApplicationBridge } from './applicationBridge';
import { initAuthBridge } from './authBridge';
import { initBedrockBridge } from './bedrockBridge';
import { initChannelBridge } from './channelBridge';
import { initConversationBridge } from './conversationBridge';
import { initCronBridge } from './cronBridge';
import { initDatabaseBridge } from './databaseBridge';
import { registerElectronHandlers } from '@electron/handlers';
import { initDocumentBridge } from './documentBridge';
import { initFileWatchBridge } from './fileWatchBridge';
import { initFsBridge } from './fsBridge';
import { initGeminiBridge } from './geminiBridge';
import { initGeminiConversationBridge } from './geminiConversationBridge';
import { initMcpBridge } from './mcpBridge';
import { initModelBridge } from './modelBridge';
import { initPreviewHistoryBridge } from './previewHistoryBridge';
import { initStarOfficeBridge } from './starOfficeBridge';
import { initSpeechToTextBridge } from './speechToTextBridge';
import { initTaskBridge } from './taskBridge';
import { initWebuiBridge } from './webuiBridge';
import { initSystemSettingsBridge } from './systemSettingsBridge';
import { initNotificationBridge } from './notificationBridge';
import { initPptPreviewBridge } from './pptPreviewBridge';
import { initOfficeWatchBridge } from './officeWatchBridge';
import { initExtensionsBridge } from './extensionsBridge';
import { initWeixinLoginBridge } from './weixinLoginBridge';
import { initWorkspaceSnapshotBridge } from './workspaceSnapshotBridge';
import { initRemoteAgentBridge } from './remoteAgentBridge';

export interface BridgeDependencies {
  conversationService: IConversationService;
  conversationRepo: IConversationRepository;
  workerTaskManager: IWorkerTaskManager;
  channelRepo: IChannelRepository;
}

/**
 * 初始化所有IPC桥接模块
 */
export function initAllBridges(deps: BridgeDependencies): void {
  // Electron-only handlers (dialog, shell, windowControls, update)
  registerElectronHandlers();

  initFsBridge();
  initFileWatchBridge();
  initConversationBridge(deps.conversationService, deps.workerTaskManager);
  initApplicationBridge(deps.workerTaskManager);
  initGeminiConversationBridge(deps.workerTaskManager);
  // 额外的 Gemini 辅助桥（订阅检测等）需要在对话桥初始化后可用 / extra helpers after core bridges
  initGeminiBridge();
  initBedrockBridge();
  initAcpConversationBridge(deps.workerTaskManager);
  initAuthBridge();
  initModelBridge();
  initMcpBridge();
  initPreviewHistoryBridge();
  initDocumentBridge();
  initPptPreviewBridge();
  initOfficeWatchBridge();
  initWebuiBridge();
  initChannelBridge(deps.channelRepo);
  initDatabaseBridge(deps.conversationRepo);
  initExtensionsBridge(deps.conversationRepo, deps.workerTaskManager);
  initCronBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
  initTaskBridge(deps.workerTaskManager);
  initStarOfficeBridge();
  initSpeechToTextBridge();
  initWeixinLoginBridge();
  initWorkspaceSnapshotBridge();
  initRemoteAgentBridge();
}

/**
 * 初始化ACP检测器
 */
export async function initializeAcpDetector(): Promise<void> {
  try {
    await acpDetector.initialize();
  } catch (error) {
    console.error('[ACP] Failed to initialize detector:', error);
  }
}

// Re-export individual bridge init functions for standalone mode (initBridgeStandalone.ts)
export {
  initAcpConversationBridge,
  initApplicationBridge,
  initAuthBridge,
  initBedrockBridge,
  initChannelBridge,
  initConversationBridge,
  initCronBridge,
  initDatabaseBridge,
  initDocumentBridge,
  initExtensionsBridge,
  initFsBridge,
  initGeminiBridge,
  initGeminiConversationBridge,
  initMcpBridge,
  initModelBridge,
  initNotificationBridge,
  initOfficeWatchBridge,
  initPptPreviewBridge,
  initPreviewHistoryBridge,
  initSpeechToTextBridge,
  initStarOfficeBridge,
  initSystemSettingsBridge,
  initTaskBridge,
  initWebuiBridge,
  initRemoteAgentBridge,
  initWeixinLoginBridge,
  initWorkspaceSnapshotBridge,
};
export { disposeAllSnapshots } from './workspaceSnapshotBridge';
// Re-export Electron handler utilities
export { registerElectronHandlers } from '@electron/handlers';
export { registerWindowMaximizeListeners } from '@electron/handlers/windowControls';
