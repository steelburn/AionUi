/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Conversation Handler
 *
 * Replaces initConversationBridge() from src/process/bridge/conversationBridge.ts.
 * Registers all conversation-related endpoint handlers on the WsRouter.
 */

import type { WsRouter } from '../router/WsRouter';
import type { CodexAgentManager } from '@server/agent/codex';
import { GeminiAgent, GeminiApprovalStore } from '@server/agent/gemini';
import type { TChatConversation } from '@/common/config/storage';
import type { IAgentManager } from '@server/task/IAgentManager';
import type { IConversationService } from '@server/services/IConversationService';
import type { IWorkerTaskManager } from '@server/task/IWorkerTaskManager';
import { getSkillsDir, getBuiltinSkillsCopyDir, getSystemDir, ProcessChat } from '@server/utils/initStorage';
import type AcpAgentManager from '@server/task/AcpAgentManager';
import type { GeminiAgentManager } from '@server/task/GeminiAgentManager';
import type OpenClawAgentManager from '@server/task/OpenClawAgentManager';
import { prepareFirstMessage } from '@server/task/agentUtils';
import { refreshTrayMenu } from '@electron/lifecycle/tray';
import { copyFilesToDirectory, readDirectoryRecursive } from '@server/utils';
import { computeOpenClawIdentityHash } from '@server/utils/openclawUtils';
import { migrateConversationToDatabase } from '@process/bridge/migrationUtils';
import { ConversationSideQuestionService } from '@server/services/ConversationSideQuestionService';

const refreshTrayMenuSafely = async (): Promise<void> => {
  try {
    await refreshTrayMenu();
  } catch (error) {
    console.warn('[ConversationHandler] Failed to refresh tray menu:', error);
  }
};

const VALID_CONVERSATION_TYPES = new Set<TChatConversation['type']>([
  'gemini',
  'acp',
  'codex',
  'openclaw-gateway',
  'nanobot',
  'remote',
]);

export function registerConversationHandlers(
  router: WsRouter,
  conversationService: IConversationService,
  workerTaskManager: IWorkerTaskManager
): void {
  const sideQuestionService = new ConversationSideQuestionService(conversationService);

  const emitConversationListChanged = (
    conversation: Pick<TChatConversation, 'id' | 'source'>,
    action: 'created' | 'updated' | 'deleted'
  ) => {
    router.emit('conversation.list-changed', {
      conversationId: conversation.id,
      action,
      source: conversation.source || 'aionui',
    });
  };

  // === OpenClaw ===

  router.handle('openclaw.get-runtime', async ({ conversation_id }) => {
    try {
      const conversation = await conversationService.getConversation(conversation_id);
      if (!conversation || conversation.type !== 'openclaw-gateway') {
        return { success: false, msg: 'OpenClaw conversation not found' };
      }
      const task = (await workerTaskManager.getOrBuildTask(conversation_id)) as unknown as
        | OpenClawAgentManager
        | undefined;
      if (!task || task.type !== 'openclaw-gateway') {
        return { success: false, msg: 'OpenClaw runtime not available' };
      }

      // Await bootstrap to ensure the agent is fully connected before returning runtime info.
      await task.bootstrap.catch(() => {});

      const diagnostics = task.getDiagnostics();
      const identityHash = await computeOpenClawIdentityHash(diagnostics.workspace || conversation.extra?.workspace);
      const conversationModel = (conversation as { model?: { useModel?: string } }).model;
      const extra = conversation.extra as
        | {
            cliPath?: string;
            gateway?: { cliPath?: string };
            runtimeValidation?: unknown;
          }
        | undefined;
      const gatewayCliPath = extra?.gateway?.cliPath;

      return {
        success: true,
        data: {
          conversationId: conversation_id,
          runtime: {
            workspace: diagnostics.workspace || conversation.extra?.workspace,
            backend: diagnostics.backend || conversation.extra?.backend,
            agentName: diagnostics.agentName || conversation.extra?.agentName,
            cliPath: diagnostics.cliPath || extra?.cliPath || gatewayCliPath,
            model: conversationModel?.useModel,
            sessionKey: diagnostics.sessionKey,
            isConnected: diagnostics.isConnected,
            hasActiveSession: diagnostics.hasActiveSession,
            identityHash,
          },
          expected: extra?.runtimeValidation,
        },
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // === Conversation CRUD ===

  router.handle('create-conversation', async (params): Promise<TChatConversation> => {
    if (!VALID_CONVERSATION_TYPES.has(params?.type as TChatConversation['type'])) {
      console.warn('[ConversationHandler] Rejecting create request with invalid conversation type:', params?.type);
      return undefined as unknown as TChatConversation;
    }
    const conversation = await conversationService.createConversation({
      ...params,
      source: 'aionui',
    });
    emitConversationListChanged(conversation, 'created');
    await refreshTrayMenuSafely();
    return conversation;
  });

  router.handle('conversation.reload-context', async ({ conversation_id }) => {
    try {
      const task = (await workerTaskManager.getOrBuildTask(conversation_id)) as unknown as
        | GeminiAgentManager
        | AcpAgentManager
        | CodexAgentManager
        | undefined;
      if (!task) return { success: false, msg: 'conversation not found' };
      if (task.type !== 'gemini') return { success: false, msg: 'only supported for gemini' };

      await (task as GeminiAgentManager).reloadContext();
      return { success: true };
    } catch (e: unknown) {
      return {
        success: false,
        msg: e instanceof Error ? e.message : String(e),
      };
    }
  });

  router.handle('get-associated-conversation', async ({ conversation_id }) => {
    try {
      let currentConversation: TChatConversation | undefined =
        await conversationService.getConversation(conversation_id);

      if (!currentConversation) {
        const history = await ProcessChat.get('chat.history');
        currentConversation = (history || []).find((item) => item.id === conversation_id);

        if (currentConversation) {
          void migrateConversationToDatabase(currentConversation);
        }
      }

      if (!currentConversation || !currentConversation.extra?.workspace) {
        return [];
      }

      let allConversations: TChatConversation[] = await conversationService.listAllConversations();

      const history = await ProcessChat.get('chat.history');
      if (allConversations.length < (history?.length || 0)) {
        allConversations = history || [];
        void Promise.all(allConversations.map((conv) => migrateConversationToDatabase(conv)));
      }

      return allConversations.filter((item) => item.extra?.workspace === currentConversation.extra.workspace);
    } catch (error) {
      console.error('[ConversationHandler] Failed to get associate conversations:', error);
      return [];
    }
  });

  router.handle(
    'create-conversation-with-conversation',
    async ({ conversation, sourceConversationId, migrateCron }) => {
      try {
        const result = await conversationService.createWithMigration({
          conversation,
          sourceConversationId,
          migrateCron,
        });
        workerTaskManager.getOrBuildTask(result.id).catch((err) => {
          console.warn('[ConversationHandler] Failed to pre-warm task after migration:', err);
        });
        emitConversationListChanged(result, 'created');
        if (sourceConversationId) {
          emitConversationListChanged({ id: sourceConversationId, source: conversation.source }, 'deleted');
        }
        await refreshTrayMenuSafely();
        return result;
      } catch (error) {
        console.error('[ConversationHandler] Failed to create conversation with conversation:', error);
        return Promise.resolve(conversation);
      }
    }
  );

  router.handle('remove-conversation', async ({ id }) => {
    try {
      const conversation = await conversationService.getConversation(id);
      const source = conversation?.source;

      workerTaskManager.kill(id);

      if (source && source !== 'aionui') {
        try {
          const { getChannelManager } = await import('@server/channels/core/ChannelManager');
          const channelManager = getChannelManager();
          if (channelManager.isInitialized()) {
            await channelManager.cleanupConversation(id);
          }
        } catch (cleanupError) {
          console.warn('[ConversationHandler] Failed to cleanup channel resources:', cleanupError);
        }
      }

      await conversationService.deleteConversation(id);
      if (conversation) {
        emitConversationListChanged(conversation, 'deleted');
      }
      await refreshTrayMenuSafely();
      return true;
    } catch (error) {
      console.error('[ConversationHandler] Failed to remove conversation:', error);
      return false;
    }
  });

  router.handle('update-conversation', async ({ id, updates, mergeExtra }) => {
    try {
      const existing = await conversationService.getConversation(id);
      const prevModel = existing && 'model' in existing ? existing.model : undefined;
      const nextModel = 'model' in updates ? updates.model : undefined;
      const modelChanged = !!nextModel && JSON.stringify(prevModel) !== JSON.stringify(nextModel);

      await conversationService.updateConversation(id, updates, mergeExtra);

      if (existing) {
        emitConversationListChanged(existing, 'updated');
      }

      if (modelChanged) {
        try {
          workerTaskManager.kill(id);
        } catch {
          // ignore kill error, will lazily rebuild later
        }
      }

      if ('name' in updates) {
        await refreshTrayMenuSafely();
      }

      return true;
    } catch (error) {
      console.error('[ConversationHandler] Failed to update conversation:', error);
      return false;
    }
  });

  // Pre-warm conversation bootstrap
  router.handle('conversation.warmup', async ({ conversation_id }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversation_id);
      if (task && task.type === 'acp') {
        await (task as unknown as AcpAgentManager).initAgent();
      }
    } catch {
      // Ignore errors — warmup is best-effort
    }
  });

  router.handle('reset-conversation', ({ id }) => {
    if (id) {
      workerTaskManager.kill(id);
    } else {
      workerTaskManager.clear();
    }
    return Promise.resolve();
  });

  router.handle('get-conversation', async ({ id }) => {
    try {
      const conversation = await conversationService.getConversation(id);
      if (conversation) {
        const task = workerTaskManager.getTask(id);
        return { ...conversation, status: task?.status || 'finished' };
      }

      const history = await ProcessChat.get('chat.history');
      const fileConversation = (history || []).find((item) => item.id === id);
      if (fileConversation) {
        const task = workerTaskManager.getTask(id);
        void migrateConversationToDatabase(fileConversation);
        return { ...fileConversation, status: task?.status || 'finished' };
      }

      return undefined;
    } catch (error) {
      console.error('[ConversationHandler] Failed to get conversation:', error);
      return undefined;
    }
  });

  // === Workspace ===

  const buildLastAbortController = (() => {
    let lastGetWorkspaceAbortController = new AbortController();
    return () => {
      lastGetWorkspaceAbortController.abort();
      return (lastGetWorkspaceAbortController = new AbortController());
    };
  })();

  router.handle('conversation.get-workspace', async ({ workspace, search, path }) => {
    try {
      const fileService = GeminiAgent.buildFileServer(workspace);
      return await readDirectoryRecursive(path, {
        root: workspace,
        fileService,
        abortController: buildLastAbortController(),
        maxDepth: 10,
        search: {
          text: search,
          onProcess(result) {
            // Push incremental search results to the client.
            // conversation.response.search.workspace is defined in EndpointMap (not EventMap)
            // because it was originally a bridge provider invoked from main→renderer.
            // In the WsRouter context we broadcast it as an event.
            (router as unknown as { emit(name: string, data: unknown): void }).emit(
              'conversation.response.search.workspace',
              result
            );
          },
        },
      }).then((res) => (res ? [res] : []));
    } catch (error) {
      if (error instanceof Error && (error.message.includes('aborted') || error.message.includes('ENOENT'))) {
        return [];
      }
      console.error('[ConversationHandler] getWorkspace error:', error);
      return [];
    }
  });

  // === Chat operations ===

  router.handle('chat.stop.stream', async ({ conversation_id }) => {
    const task = workerTaskManager.getTask(conversation_id);
    if (!task) return { success: true, msg: 'conversation not found' };
    await task.stop();
    return { success: true };
  });

  router.handle('conversation.get-slash-commands', async ({ conversation_id }) => {
    try {
      const conversation = await conversationService.getConversation(conversation_id);
      if (!conversation) {
        return { success: true, data: { commands: [] } };
      }

      if (conversation.type !== 'acp') {
        return { success: true, data: { commands: [] } };
      }

      const task = workerTaskManager.getTask(conversation_id) as unknown as AcpAgentManager | undefined;
      if (!task || task.type !== 'acp') {
        return { success: true, data: { commands: [] } };
      }

      const commands = await task.loadAcpSlashCommands();
      return { success: true, data: { commands } };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  router.handle('conversation.ask-side-question', async ({ conversation_id, question }) => {
    try {
      const result = await sideQuestionService.ask(conversation_id, question);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('[ConversationHandler] /btw request failed', {
        conversationId: conversation_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  router.handle('chat.send.message', async (params) => {
    if (!params) {
      return { success: false, msg: 'Missing request parameters' };
    }
    const { conversation_id, files, ...other } = params;
    let task: IAgentManager | undefined;
    try {
      task = await workerTaskManager.getOrBuildTask(conversation_id);
    } catch (err) {
      console.error(`[ConversationHandler] sendMessage: failed to get/build task: ${conversation_id}`, err);
      return {
        success: false,
        msg: err instanceof Error ? err.message : 'conversation not found',
      };
    }

    if (!task) {
      return { success: false, msg: 'conversation not found' };
    }

    let workspaceFiles: string[];
    try {
      workspaceFiles = await copyFilesToDirectory(task.workspace, files, false, getSystemDir().cacheDir);
    } catch (error) {
      console.error('[ConversationHandler] sendMessage: failed to copy files to workspace:', error);
      workspaceFiles = [];
    }

    let agentContent = other.input;
    if (other.injectSkills?.length) {
      agentContent = await prepareFirstMessage(other.input, {
        enabledSkills: other.injectSkills,
      });
      const skillsDir = getSkillsDir();
      const builtinSkillsCopyDir = getBuiltinSkillsCopyDir();
      agentContent = agentContent.replace(
        '[User Request]',
        `[Skills Directory]\nBuiltin skills: ${builtinSkillsCopyDir}\nUser skills: ${skillsDir}\nWhen skill instructions reference relative paths like "skills/{name}/scripts/...", resolve them under the appropriate directory.\n\n[User Request]`
      );
    }

    try {
      await task.sendMessage({
        ...other,
        content: other.input,
        files: workspaceFiles,
        agentContent,
      });
      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        msg: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // === Confirmation & Approval ===

  router.handle('confirmation.confirm', async ({ conversation_id, msg_id, data, callId }) => {
    const task = workerTaskManager.getTask(conversation_id);
    if (!task) return { success: false, msg: 'conversation not found' };
    task.confirm(msg_id, callId, data);
    return { success: true };
  });

  router.handle('confirmation.list', async ({ conversation_id }) => {
    const task = workerTaskManager.getTask(conversation_id);
    if (!task) return [];
    return task.getConfirmations();
  });

  router.handle('approval.check', async ({ conversation_id, action, commandType }) => {
    const task = workerTaskManager.getTask(conversation_id) as unknown as GeminiAgentManager | undefined;
    if (!task || task.type !== 'gemini' || !task.approvalStore) {
      return false;
    }
    const keys = GeminiApprovalStore.createKeysFromConfirmation(action, commandType);
    if (keys.length === 0) return false;
    return task.approvalStore.allApproved(keys);
  });
}
