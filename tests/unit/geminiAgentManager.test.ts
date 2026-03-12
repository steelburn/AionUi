/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const flushConversationMessages = vi.fn(async () => {});
const getConversationMessages = vi.fn();
const notifyPotentialCompletion = vi.fn();
const hasCronCommands = vi.fn(() => false);
const extractTextFromMessage = vi.fn(() => 'done');

vi.mock('@/channels/agent/ChannelEventBus', () => ({
  channelEventBus: {
    emitAgentMessage: vi.fn(),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    geminiConversation: {
      responseStream: {
        emit: vi.fn(),
      },
    },
    conversation: {
      confirmation: {
        add: { emit: vi.fn() },
        update: { emit: vi.fn() },
        remove: { emit: vi.fn() },
      },
    },
  },
}));

vi.mock('@/common/chatLib', () => ({
  transformMessage: vi.fn(() => null),
}));

vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => 'uuid-1'),
}));

vi.mock('@/common/utils/platformAuthType', () => ({
  getProviderAuthType: vi.fn(() => 'api-key'),
}));

vi.mock('@office-ai/aioncli-core', () => ({
  AuthType: {
    LOGIN_WITH_GOOGLE: 'login-with-google',
    USE_VERTEX_AI: 'use-vertex-ai',
  },
  getOauthInfoWithCache: vi.fn(),
  Storage: {
    getOAuthCredsPath: vi.fn(() => ''),
  },
}));

vi.mock('@/extensions', () => ({
  ExtensionRegistry: {
    getInstance: vi.fn(() => ({
      getMcpServers: vi.fn(() => []),
    })),
  },
}));

vi.mock('@/process/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(),
    set: vi.fn(),
  },
  getSkillsDir: vi.fn(() => ''),
}));

vi.mock('../../src/process/task/agentUtils', () => ({
  buildSystemInstructionsWithSkillsIndex: vi.fn(async () => ''),
}));

vi.mock('../../src/process/task/AcpSkillManager', () => ({
  detectSkillLoadRequest: vi.fn(() => []),
  buildSkillContentText: vi.fn(() => ''),
  AcpSkillManager: {
    getInstance: vi.fn(() => ({
      discoverSkills: vi.fn(async () => {}),
      getSkills: vi.fn(async () => []),
      getBuiltinSkillsIndex: vi.fn(() => []),
    })),
  },
}));

vi.mock('@process/database', () => ({
  getDatabase: vi.fn(() => ({
    getConversationMessages,
    updateConversation: vi.fn(),
  })),
}));

vi.mock('../../src/process/message', () => ({
  addMessage: vi.fn(),
  addOrUpdateMessage: vi.fn(),
  flushConversationMessages,
  nextTickToLocalFinish: vi.fn(),
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: {
    setProcessing: vi.fn(),
  },
}));

vi.mock('@process/services/ConversationTurnCompletionService', () => ({
  ConversationTurnCompletionService: {
    getInstance: vi.fn(() => ({
      notifyPotentialCompletion,
    })),
  },
}));

vi.mock('../../src/process/utils/previewUtils', () => ({
  handlePreviewOpenEvent: vi.fn(() => false),
}));

vi.mock('../../src/process/task/BaseAgentManager', () => ({
  default: class MockBaseAgentManager {
    type: string;
    data: unknown;

    constructor(type: string, data: unknown) {
      this.type = type;
      this.data = data;
    }

    protected init(): void {}

    protected addConfirmation(): void {}

    confirm(): void {}

    getConfirmations(): unknown[] {
      return [];
    }

    start(): Promise<void> {
      return Promise.resolve();
    }

    stop(): Promise<void> {
      return Promise.resolve();
    }

    sendMessage(): Promise<{ success: true }> {
      return Promise.resolve({ success: true });
    }

    kill(): void {}
  },
}));

vi.mock('../../src/process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('../../src/process/task/CronCommandDetector', () => ({
  hasCronCommands,
}));

vi.mock('../../src/process/task/MessageMiddleware', () => ({
  extractTextFromMessage,
  processCronInMessage: vi.fn(async () => {}),
}));

vi.mock('../../src/process/task/ThinkTagDetector', () => ({
  stripThinkTags: vi.fn((content: string) => content),
}));

vi.mock('../../src/agent/gemini/GeminiApprovalStore', () => ({
  GeminiApprovalStore: class MockGeminiApprovalStore {},
}));

vi.mock('../../src/agent/gemini/cli/tools/tools', () => ({
  ToolConfirmationOutcome: {
    ProceedOnce: 'proceed_once',
    ProceedAlways: 'proceed_always',
    ProceedAlwaysTool: 'proceed_always_tool',
    ProceedAlwaysServer: 'proceed_always_server',
    Cancel: 'cancel',
  },
}));

describe('GeminiAgentManager turn completion', () => {
  beforeEach(() => {
    flushConversationMessages.mockClear();
    getConversationMessages.mockReset();
    notifyPotentialCompletion.mockClear();
    hasCronCommands.mockReset();
    hasCronCommands.mockReturnValue(false);
    extractTextFromMessage.mockReset();
    extractTextFromMessage.mockReturnValue('done');
    vi.resetModules();
  });

  it('runs the first completion check immediately on finish', async () => {
    const { GeminiAgentManager } = await import('../../src/process/task/GeminiAgentManager');
    const manager = Object.create(GeminiAgentManager.prototype) as {
      checkCronCommandsOnFinish: ReturnType<typeof vi.fn>;
      checkCronWithRetry: (attempt: number) => void;
    };

    manager.checkCronCommandsOnFinish = vi.fn(async () => true);
    manager.checkCronWithRetry(0);
    await Promise.resolve();

    expect(manager.checkCronCommandsOnFinish).toHaveBeenCalledTimes(1);
  });

  it('flushes pending assistant output before notifying completion', async () => {
    const { GeminiAgentManager } = await import('../../src/process/task/GeminiAgentManager');
    const manager = Object.create(GeminiAgentManager.prototype) as {
      conversation_id: string;
      enabledSkills: string[];
      lastProcessedFinishMessageKey: string | null;
      sendMessage: ReturnType<typeof vi.fn>;
      checkCronCommandsOnFinish: (afterTimestamp: number) => Promise<boolean>;
    };

    manager.conversation_id = 'session-1';
    manager.enabledSkills = [];
    manager.lastProcessedFinishMessageKey = null;
    manager.sendMessage = vi.fn();
    getConversationMessages.mockReturnValue({
      data: [
        {
          id: 'assistant-1',
          msg_id: 'assistant-1',
          type: 'text',
          position: 'left',
          content: { content: 'done' },
          createdAt: 1,
        },
      ],
    });

    const found = await manager.checkCronCommandsOnFinish(Date.now());

    expect(found).toBe(true);
    expect(flushConversationMessages).toHaveBeenCalledWith('session-1');
    expect(notifyPotentialCompletion).toHaveBeenCalledWith('session-1');
  });
});
