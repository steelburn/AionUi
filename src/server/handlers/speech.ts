/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../router/WsRouter';
import { SpeechToTextService } from '@process/bridge/services/SpeechToTextService';

/**
 * Register speech-to-text endpoint handlers on the WsRouter.
 * Replaces initSpeechToTextBridge() from src/process/bridge/speechToTextBridge.ts.
 */
export function registerSpeechHandlers(router: WsRouter): void {
  router.handle('speech-to-text.transcribe', async (request) => {
    return SpeechToTextService.transcribe(request);
  });
}
