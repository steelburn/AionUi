/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExtensionAgentActivitySnapshot } from '@/common/adapter/ipcBridge';
import type { WsRouter } from '../router/WsRouter';
import { ExtensionRegistry } from '@server/extensions';
import type { IConversationRepository } from '@server/services/database/IConversationRepository';
import type { IWorkerTaskManager } from '@server/task/IWorkerTaskManager';
import { ActivitySnapshotBuilder } from '@server/services/ActivitySnapshotBuilder';

const ACTIVITY_SNAPSHOT_TTL_MS = 3000;

let activitySnapshotCache: IExtensionAgentActivitySnapshot | null = null;
let activitySnapshotCachedAt = 0;
let activitySnapshotInFlight: Promise<IExtensionAgentActivitySnapshot> | null = null;

const makeGetActivitySnapshot =
  (builder: ActivitySnapshotBuilder) => async (): Promise<IExtensionAgentActivitySnapshot> => {
    const now = Date.now();
    if (activitySnapshotCache && now - activitySnapshotCachedAt <= ACTIVITY_SNAPSHOT_TTL_MS) {
      return activitySnapshotCache;
    }

    if (activitySnapshotInFlight) {
      return activitySnapshotInFlight;
    }

    activitySnapshotInFlight = Promise.resolve()
      .then(async () => {
        const snapshot = await builder.build();
        activitySnapshotCache = snapshot;
        activitySnapshotCachedAt = Date.now();
        return snapshot;
      })
      .finally(() => {
        activitySnapshotInFlight = null;
      });

    return activitySnapshotInFlight;
  };

/**
 * Register extensions endpoint handlers on the WsRouter.
 * Replaces initExtensionsBridge() from src/process/bridge/extensionsBridge.ts.
 */
export function registerExtensionsHandlers(
  router: WsRouter,
  repo: IConversationRepository,
  taskManager: IWorkerTaskManager,
): void {
  const getActivitySnapshot = makeGetActivitySnapshot(new ActivitySnapshotBuilder(repo, taskManager));

  // Get all extension-contributed CSS themes (converted to ICssTheme format)
  router.handle('extensions.get-themes', async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getThemes();
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get themes:', error);
      return [];
    }
  });

  // Get summary of all loaded extensions (with enabled/disabled status and permissions)
  router.handle('extensions.get-loaded-extensions', async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getLoadedExtensions().map((ext) => ({
        name: ext.manifest.name,
        displayName: ext.manifest.displayName,
        version: ext.manifest.version,
        description: ext.manifest.description,
        source: ext.source,
        directory: ext.directory,
        enabled: registry.isExtensionEnabled(ext.manifest.name),
        riskLevel: registry.getExtensionRiskLevel(ext.manifest.name),
        hasLifecycle: !!(ext.manifest as any).lifecycle,
      }));
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get loaded extensions:', error);
      return [];
    }
  });

  // Get all extension-contributed assistants
  router.handle('extensions.get-assistants', async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getAssistants();
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get assistants:', error);
      return [];
    }
  });

  // Get all extension-contributed ACP adapters
  router.handle('extensions.get-acp-adapters', async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getAcpAdapters();
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get ACP adapters:', error);
      return [];
    }
  });

  // Get all extension-contributed agents (autonomous agent presets)
  router.handle('extensions.get-agents', async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getAgents();
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get agents:', error);
      return [];
    }
  });

  // Get all extension-contributed MCP servers
  router.handle('extensions.get-mcp-servers', async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getMcpServers();
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get MCP servers:', error);
      return [];
    }
  });

  // Get all extension-contributed skills
  router.handle('extensions.get-skills', async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getSkills();
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get skills:', error);
      return [];
    }
  });

  // Get all extension-contributed settings tabs
  router.handle('extensions.get-settings-tabs', async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getSettingsTabs();
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get settings tabs:', error);
      return [];
    }
  });

  // Get extension-contributed WebUI metadata (api routes + static assets)
  router.handle('extensions.get-webui-contributions', async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getWebuiContributions().map((item) => ({
        extensionName: item.extensionName,
        apiRoutes: (item.config.apiRoutes || []).map((route) => ({
          path: route.path,
          auth: route.auth !== false,
        })),
        staticAssets: (item.config.staticAssets || []).map((asset) => ({
          urlPrefix: asset.urlPrefix,
          directory: asset.directory,
        })),
      }));
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get webui contributions:', error);
      return [];
    }
  });

  // Get activity snapshot for extension settings tabs (e.g. Star Office)
  router.handle('extensions.get-agent-activity-snapshot', async () => {
    try {
      return await getActivitySnapshot();
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to build agent activity snapshot:', error);
      return {
        generatedAt: Date.now(),
        totalConversations: 0,
        runningConversations: 0,
        agents: [],
      };
    }
  });

  // Get merged extension i18n translations for a specific locale
  router.handle('extensions.get-ext-i18n-for-locale', async (params) => {
    const { locale } = params ?? {};
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getExtI18nForLocale(locale);
    } catch (error) {
      console.error('[ExtensionsHandler] Failed to get ext i18n for locale:', error);
      return {};
    }
  });

  // --- Extension Management API (NocoBase-inspired) ---

  // Enable an extension
  router.handle('extensions.enable', async (params) => {
    const { name } = params ?? {};
    try {
      const registry = ExtensionRegistry.getInstance();
      const success = await registry.enableExtension(name);
      if (success) {
        router.emit('extensions.state-changed', { name, enabled: true });
      }
      return {
        success,
        msg: success ? undefined : `Failed to enable "${name}"`,
      };
    } catch (error) {
      console.error(`[ExtensionsHandler] Failed to enable "${name}":`, error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Disable an extension
  router.handle('extensions.disable', async (params) => {
    const { name, reason } = params ?? {};
    try {
      const registry = ExtensionRegistry.getInstance();
      const success = await registry.disableExtension(name, reason);
      if (success) {
        router.emit('extensions.state-changed', {
          name,
          enabled: false,
          reason,
        });
      }
      return {
        success,
        msg: success ? undefined : `Failed to disable "${name}"`,
      };
    } catch (error) {
      console.error(`[ExtensionsHandler] Failed to disable "${name}":`, error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Get permission summary for an extension (Figma-inspired)
  router.handle('extensions.get-permissions', async (params) => {
    const { name } = params ?? {};
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getExtensionPermissions(name);
    } catch (error) {
      console.error(`[ExtensionsHandler] Failed to get permissions for "${name}":`, error);
      return [];
    }
  });

  // Get risk level for an extension
  router.handle('extensions.get-risk-level', async (params) => {
    const { name } = params ?? {};
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getExtensionRiskLevel(name);
    } catch (error) {
      console.error(`[ExtensionsHandler] Failed to get risk level for "${name}":`, error);
      return 'safe';
    }
  });
}
