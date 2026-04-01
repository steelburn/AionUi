/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../router/WsRouter';
import type { PreviewHistoryTarget } from '@aionui/protocol/types/preview';
import { previewHistoryService } from '@process/services/previewHistoryService';

/**
 * Register preview history endpoint handlers on the WsRouter.
 * Replaces initPreviewHistoryBridge() from src/process/bridge/previewHistoryBridge.ts.
 */
export function registerPreviewHistoryHandlers(router: WsRouter): void {
  router.handle('preview-history.list', ({ target }) => {
    return previewHistoryService.list(target as PreviewHistoryTarget);
  });

  router.handle('preview-history.save', ({ target, content }) => {
    return previewHistoryService.save(target as PreviewHistoryTarget, content);
  });

  router.handle('preview-history.get-content', async ({ target, snapshotId }) => {
    const result = await previewHistoryService.getContent(target as PreviewHistoryTarget, snapshotId);
    if (!result) {
      return null;
    }
    return result;
  });
}
