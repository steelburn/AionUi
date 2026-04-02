/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACP Conversation Handler
 *
 * Replaces initAcpConversationBridge() from src/process/bridge/acpConversationBridge.ts.
 * Registers all ACP (Agent Capability Protocol) related endpoint handlers on the WsRouter.
 */

import type { WsRouter } from '../router/WsRouter';
import { acpDetector } from '@server/agent/acp/AcpDetector';
import { AcpConnection } from '@server/agent/acp/AcpConnection';
import { buildAcpModelInfo, summarizeAcpModelInfo } from '@server/agent/acp/modelInfo';
import { CodexConnection } from '@server/agent/codex/connection/CodexConnection';
import type { IWorkerTaskManager } from '@server/task/IWorkerTaskManager';
import AcpAgentManager from '@server/task/AcpAgentManager';
import CodexAgentManager from '@server/task/CodexAgentManager';
import { GeminiAgentManager } from '@server/task/GeminiAgentManager';
import { mcpService } from '@server/services/mcpServices/McpService';
import { mainLog, mainWarn } from '@server/utils/mainLogger';
import * as os from 'os';

export function registerAcpConversationHandlers(router: WsRouter, workerTaskManager: IWorkerTaskManager): void {
  router.handle('acp.check.env', () => {
    return Promise.resolve({
      env: {
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ? '[SET]' : '[NOT SET]',
        GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ? '[SET]' : '[NOT SET]',
        NODE_ENV: process.env.NODE_ENV || '[NOT SET]',
      },
    });
  });

  router.handle('acp.detect-cli-path', ({ backend }) => {
    const agents = acpDetector.getDetectedAgents();
    const agent = agents.find((a) => a.backend === backend);

    if (agent?.cliPath) {
      return Promise.resolve({ success: true, data: { path: agent.cliPath } });
    }

    return Promise.resolve({
      success: false,
      msg: `${backend} CLI not found. Please install it and ensure it's accessible.`,
    });
  });

  router.handle('acp.get-available-agents', () => {
    try {
      const agents = acpDetector.getDetectedAgents();
      const enriched = agents.map((agent) => ({
        ...agent,
        supportedTransports: mcpService.getSupportedTransportsForAgent(agent),
      }));
      return Promise.resolve({ success: true, data: enriched });
    } catch (error) {
      return Promise.resolve({
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  router.handle('acp.refresh-custom-agents', async () => {
    try {
      await acpDetector.refreshCustomAgents();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  router.handle('acp.test-custom-agent', async (params) => {
    const { testCustomAgentConnection } = await import('@server/services/testCustomAgentConnection');
    return testCustomAgentConnection(params);
  });

  router.handle('acp.check-agent-health', async ({ backend }) => {
    const startTime = Date.now();

    const agents = acpDetector.getDetectedAgents();
    const agent = agents.find((a) => a.backend === backend);

    if (!agent?.cliPath && backend !== 'claude' && backend !== 'codebuddy' && backend !== 'codex') {
      return {
        success: false,
        msg: `${backend} CLI not found`,
        data: { available: false, error: 'CLI not installed' },
      };
    }

    const tempDir = os.tmpdir();

    // Handle Codex separately - it uses MCP protocol, not ACP
    if (backend === 'codex') {
      const codexConnection = new CodexConnection();
      try {
        await codexConnection.start(agent?.cliPath || 'codex', tempDir);
        await codexConnection.waitForServerReady(15000);
        const pingResult = await codexConnection.ping(5000);

        if (!pingResult) {
          throw new Error('Codex server not responding to ping');
        }

        const latency = Date.now() - startTime;
        void codexConnection.stop();

        return {
          success: true,
          data: { available: true, latency },
        };
      } catch (error) {
        try {
          void codexConnection.stop();
        } catch {
          // Ignore stop errors
        }

        const errorMsg = error instanceof Error ? error.message : String(error);
        const lowerError = errorMsg.toLowerCase();

        if (
          lowerError.includes('auth') ||
          lowerError.includes('login') ||
          lowerError.includes('api key') ||
          lowerError.includes('not found') ||
          lowerError.includes('command not found')
        ) {
          return {
            success: false,
            msg: `codex not available`,
            data: { available: false, error: errorMsg },
          };
        }

        return {
          success: false,
          msg: `codex health check failed: ${errorMsg}`,
          data: { available: false, error: errorMsg },
        };
      }
    }

    // For ACP-based agents (claude, gemini, qwen, etc.)
    const connection = new AcpConnection();

    try {
      await connection.connect(backend, agent?.cliPath, tempDir, agent?.acpArgs);
      await connection.newSession(tempDir);
      await connection.sendPrompt('hi');

      const latency = Date.now() - startTime;
      await connection.disconnect();

      return {
        success: true,
        data: { available: true, latency },
      };
    } catch (error) {
      try {
        await connection.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      const lowerError = errorMsg.toLowerCase();

      if (
        lowerError.includes('auth') ||
        lowerError.includes('login') ||
        lowerError.includes('credential') ||
        lowerError.includes('api key') ||
        lowerError.includes('unauthorized') ||
        lowerError.includes('forbidden')
      ) {
        return {
          success: false,
          msg: `${backend} not authenticated`,
          data: { available: false, error: 'Not authenticated' },
        };
      }

      return {
        success: false,
        msg: `${backend} health check failed: ${errorMsg}`,
        data: { available: false, error: errorMsg },
      };
    }
  });

  router.handle('acp.get-mode', ({ conversationId }) => {
    const task = workerTaskManager.getTask(conversationId);
    if (
      !task ||
      !(task instanceof AcpAgentManager || task instanceof GeminiAgentManager || task instanceof CodexAgentManager)
    ) {
      return Promise.resolve({
        success: true,
        data: { mode: 'default', initialized: false },
      });
    }
    return Promise.resolve({ success: true, data: task.getMode() });
  });

  router.handle('acp.get-model-info', ({ conversationId }) => {
    const task = workerTaskManager.getTask(conversationId);
    if (!task || !(task instanceof AcpAgentManager || task instanceof CodexAgentManager)) {
      return Promise.resolve({ success: true, data: { modelInfo: null } });
    }
    return Promise.resolve({
      success: true,
      data: { modelInfo: task.getModelInfo() },
    });
  });

  router.handle('acp.probe-model-info', async ({ backend }) => {
    const agents = acpDetector.getDetectedAgents();
    const agent = agents.find((item) => item.backend === backend);

    if (!agent?.cliPath && backend !== 'claude' && backend !== 'codebuddy' && backend !== 'codex') {
      return {
        success: false,
        msg: `${backend} CLI not found`,
      };
    }

    const connection = new AcpConnection();
    const tempDir = os.tmpdir();

    try {
      await connection.connect(backend, agent?.cliPath, tempDir, agent?.acpArgs);
      await connection.newSession(tempDir);

      const modelInfo = buildAcpModelInfo(connection.getConfigOptions(), connection.getModels());
      if (backend === 'codex') {
        const initializeResult = connection.getInitializeResponse() as unknown as Record<string, unknown> | null;
        mainLog('[ACP codex]', 'probeModelInfo completed', {
          initializeAgentInfo: initializeResult?.agentInfo || null,
          modelInfo: summarizeAcpModelInfo(modelInfo),
        });
      }

      return { success: true, data: { modelInfo } };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (backend === 'codex') {
        mainWarn('[ACP codex]', 'probeModelInfo failed', errorMsg);
      }
      return { success: false, msg: errorMsg };
    } finally {
      try {
        await connection.disconnect();
      } catch {
        // Ignore cleanup failures for best-effort probes
      }
    }
  });

  router.handle('acp.set-model', async ({ conversationId, modelId }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task || !(task instanceof AcpAgentManager)) {
        return {
          success: false,
          msg: 'Conversation not found or not an ACP agent',
        };
      }
      return {
        success: true,
        data: { modelInfo: await task.setModel(modelId) },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });

  router.handle('acp.set-mode', async ({ conversationId, mode }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task) {
        return { success: false, msg: 'Conversation not found' };
      }
      if (
        !(task instanceof AcpAgentManager || task instanceof GeminiAgentManager || task instanceof CodexAgentManager)
      ) {
        return {
          success: false,
          msg: 'Mode switching not supported for this agent type',
        };
      }
      return await task.setMode(mode);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });

  router.handle('acp.get-config-options', ({ conversationId }) => {
    const task = workerTaskManager.getTask(conversationId);
    if (!task || !(task instanceof AcpAgentManager)) {
      return Promise.resolve({ success: true, data: { configOptions: [] } });
    }
    return Promise.resolve({
      success: true,
      data: { configOptions: task.getConfigOptions() },
    });
  });

  router.handle('acp.set-config-option', async ({ conversationId, configId, value }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task || !(task instanceof AcpAgentManager)) {
        return {
          success: false,
          msg: 'Conversation not found or not an ACP agent',
        };
      }
      const configOptions = await task.setConfigOption(configId, value);
      return { success: true, data: { configOptions } };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });
}
