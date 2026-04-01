/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * System Notification Handler
 *
 * Provides showNotification() for direct use in main process,
 * and registers a WsRouter handler so renderer can invoke it cross-process.
 */

import { getPlatformServices } from '@/common/platform';
import { ProcessConfig } from '@process/utils/initStorage';
import path from 'path';
import fs from 'fs';
import type { WsRouter } from '../router/WsRouter';

/**
 * Get app icon path for notifications
 */
const getNotificationIcon = (): string | undefined => {
  try {
    const resourcesPath = getPlatformServices().paths.isPackaged()
      ? process.resourcesPath
      : path.join(process.cwd(), 'resources');
    const iconPath = path.join(resourcesPath, 'app.png');
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  } catch {
    // Ignore icon error, notification will still show
  }
  return undefined;
};

/**
 * Show a system notification.
 * Can be called directly from main process or via WsRouter from renderer.
 * In standalone mode this is a no-op (NodePlatformServices.notification.send is a no-op).
 */
export async function showNotification({
  title,
  body,
}: {
  title: string;
  body: string;
  conversationId?: string;
}): Promise<void> {
  // Check if notification is enabled
  const notificationEnabled = await ProcessConfig.get('system.notificationEnabled');
  if (notificationEnabled === false) {
    return;
  }

  const iconPath = getNotificationIcon();

  try {
    getPlatformServices().notification.send({ title, body, icon: iconPath });
  } catch (error) {
    console.error('[Notification] Error creating notification:', error);
  }
}

/**
 * Register notification endpoint handlers on the WsRouter.
 * Replaces initNotificationBridge() from src/process/bridge/notificationBridge.ts.
 */
export function registerNotificationHandlers(router: WsRouter): void {
  router.handle('notification.show', async (options) => {
    await showNotification(options);
  });
}
