/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../router/WsRouter';
import { SERVER_CONFIG } from '@server/http/config/constants';
import { WebuiService } from '@server/services/WebuiService';
import { generateQRLoginUrlDirect, verifyQRTokenDirect } from '@process/bridge/webuiQR';
import { startWebServerWithInstance } from '@server/http/index';
import { cleanupWebAdapter } from '@server/http/adapter';

// WebUI server instance reference
let webServerInstance: {
  server: import('http').Server;
  wss: import('ws').WebSocketServer;
  port: number;
  allowRemote: boolean;
} | null = null;

/**
 * Set WebUI server instance (called from webserver/index.ts)
 */
export function setWebServerInstance(instance: typeof webServerInstance): void {
  webServerInstance = instance;
}

/**
 * Get WebUI server instance
 */
export function getWebServerInstance(): typeof webServerInstance {
  return webServerInstance;
}

/**
 * Register WebUI endpoint handlers on the WsRouter.
 * Replaces initWebuiBridge() from src/process/bridge/webuiBridge.ts.
 */
export function registerWebuiHandlers(router: WsRouter): void {
  // Get WebUI status
  router.handle('webui.get-status', async () => {
    return WebuiService.handleAsync(async () => {
      const status = await WebuiService.getStatus(webServerInstance);
      return { success: true, data: status };
    }, 'Get status');
  });

  // Start WebUI
  router.handle('webui.start', async (params) => {
    try {
      const { port: requestedPort, allowRemote } = params ?? {};

      // If server is already running, stop it first (supports restart for config changes)
      if (webServerInstance) {
        try {
          const { server: oldServer, wss: oldWss } = webServerInstance;
          oldWss.clients.forEach((client) => client.close(1000, 'Server restarting'));
          await new Promise<void>((resolve) => {
            oldServer.close(() => resolve());
            // Force resolve after 2s to avoid hanging
            setTimeout(resolve, 2000);
          });
          cleanupWebAdapter();
        } catch (err) {
          console.warn('[WebuiHandler] Error stopping previous server:', err);
        }
        webServerInstance = null;
      }

      const port = requestedPort ?? SERVER_CONFIG.DEFAULT_PORT;
      const remote = allowRemote ?? false;

      // Use preloaded module
      const instance = await startWebServerWithInstance(port, remote);
      webServerInstance = instance;

      // Get server info
      const status = await WebuiService.getStatus(webServerInstance);
      const localUrl = `http://localhost:${port}`;
      const lanIP = WebuiService.getLanIP();
      const networkUrl = remote && lanIP ? `http://${lanIP}:${port}` : undefined;
      const initialPassword = status.initialPassword;

      // Emit status changed event
      router.emit('webui.status-changed', {
        running: true,
        port,
        localUrl,
        networkUrl,
      });

      return {
        success: true,
        data: {
          port,
          localUrl,
          networkUrl,
          lanIP: lanIP ?? undefined,
          initialPassword,
        },
      };
    } catch (error) {
      console.error('[WebuiHandler] Start error:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Failed to start WebUI',
      };
    }
  });

  // Stop WebUI
  router.handle('webui.stop', async () => {
    try {
      if (!webServerInstance) {
        return {
          success: false,
          msg: 'WebUI is not running',
        };
      }

      const { server, wss } = webServerInstance;

      // Close all WebSocket connections
      wss.clients.forEach((client) => {
        client.close(1000, 'Server shutting down');
      });

      // Close server
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Cleanup WebSocket broadcaster registration
      cleanupWebAdapter();

      webServerInstance = null;

      // Emit status changed event
      router.emit('webui.status-changed', {
        running: false,
      });

      return { success: true };
    } catch (error) {
      console.error('[WebuiHandler] Stop error:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Failed to stop WebUI',
      };
    }
  });

  // Change password (no current password required)
  router.handle('webui.change-password', async (params) => {
    const { newPassword } = params ?? {};
    return WebuiService.handleAsync(async () => {
      await WebuiService.changePassword(newPassword);
      return { success: true };
    }, 'Change password');
  });

  // Change username
  router.handle('webui.change-username', async (params) => {
    const { newUsername } = params ?? {};
    return WebuiService.handleAsync(async () => {
      const username = await WebuiService.changeUsername(newUsername);
      return { success: true, data: { username } };
    }, 'Change username');
  });

  // Reset password (generate new random password)
  router.handle('webui.reset-password', async () => {
    const result = await WebuiService.handleAsync(async () => {
      const newPassword = await WebuiService.resetPassword();
      return { success: true, data: { newPassword } };
    }, 'Reset password');

    // Emit result via router
    if (result.success && result.data) {
      router.emit('webui.reset-password-result', { success: true, newPassword: result.data.newPassword });
    } else {
      router.emit('webui.reset-password-result', { success: false, msg: result.msg });
    }

    return result;
  });

  // Generate QR login token
  router.handle('webui.generate-qr-token', async () => {
    if (!webServerInstance) {
      return {
        success: false,
        msg: 'WebUI is not running. Please start WebUI first.',
      };
    }

    try {
      const { port, allowRemote } = webServerInstance;
      const { qrUrl, expiresAt } = generateQRLoginUrlDirect(port, allowRemote);
      // Extract token from QR URL
      const token = new URL(qrUrl).searchParams.get('token') ?? '';

      return {
        success: true,
        data: {
          token,
          expiresAt,
          qrUrl,
        },
      };
    } catch (error) {
      console.error('[WebuiHandler] Generate QR token error:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Failed to generate QR token',
      };
    }
  });

  // Verify QR token
  router.handle('webui.verify-qr-token', async (params) => {
    const { qrToken } = params ?? {};
    return verifyQRTokenDirect(qrToken);
  });
}
