/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/DispatchAgentManager.ts

import fs from 'node:fs';
import path from 'node:path';
import { ipcBridge } from '@/common';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { TMessage, IMessageText, IMessageToolGroup } from '@/common/chat/chatLib';
import type { TProviderWithModel, TChatConversation } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import { addMessage, addOrUpdateMessage } from '@process/utils/message';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import type { IProvider } from '@/common/config/storage';
import { ProcessConfig } from '@process/utils/initStorage';
import BaseAgentManager from '../BaseAgentManager';
import { IpcAgentEventEmitter } from '../IpcAgentEventEmitter';
import type { IWorkerTaskManager } from '../IWorkerTaskManager';
import type { IAgentManager } from '../IAgentManager';
import type { AgentType } from '../agentTypes';
import { DispatchMcpServer } from './DispatchMcpServer';
import type { DispatchToolHandler } from './DispatchMcpServer';
import { DispatchHttpMcpServer } from './DispatchHttpMcpServer';
import { DispatchSessionTracker } from './DispatchSessionTracker';
import { DispatchNotifier } from './DispatchNotifier';
import { DispatchResourceGuard } from './DispatchResourceGuard';
import { buildDispatchSystemPrompt } from './dispatchPrompt';
import { createWorktree } from './worktreeManager';
import { checkPermission } from './permissionPolicy';
import type {
  ChildTaskInfo,
  StartChildTaskParams,
  ReadTranscriptOptions,
  TranscriptResult,
  GroupChatMessage,
  SendMessageToChildParams,
  ListSessionsParams,
} from './dispatchTypes';
import { DEFAULT_CONCURRENT_CHILDREN } from './dispatchTypes';

type DispatchAgentData = {
  workspace: string;
  conversation_id: string;
  model: TProviderWithModel;
  presetRules?: string;
  yoloMode?: boolean;
  dispatchSessionType?: string;
  dispatcherName?: string;
  /** Admin worker engine type. Defaults to 'gemini'. */
  adminAgentType?: AgentType;
};

/**
 * Dispatch agent manager that orchestrates multi-agent collaboration.
 *
 * Supports multiple admin agent types via composition:
 * - 'gemini': Creates inner GeminiAgentManager with dispatch MCP tools
 * - 'acp' (CC/Claude/Codex/etc.): Creates inner AcpAgentManager with dispatch MCP tools
 *
 * Dispatch tools are exposed via an HTTP MCP server (`aionui-team`) running in the
 * main process. Agent CLIs connect to it via HTTP MCP transport — no child process needed.
 */
export class DispatchAgentManager extends BaseAgentManager<
  {
    workspace: string;
    model: TProviderWithModel;
    presetRules?: string;
    yoloMode?: boolean;
    mcpServers?: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  },
  string
> {
  workspace: string;
  conversation_id: string;

  private readonly adminWorkerType: AgentType;
  private readonly model: TProviderWithModel;
  private readonly dispatcherName: string;
  private readonly tracker: DispatchSessionTracker;
  private notifier!: DispatchNotifier;
  private resourceGuard!: DispatchResourceGuard;
  private readonly mcpServer: DispatchMcpServer;

  /** HTTP MCP server for dispatch tools (runs in main process, no child process) */
  private httpMcpServer: DispatchHttpMcpServer | null = null;

  /**
   * Inner agent manager (GeminiAgentManager or AcpAgentManager) that handles
   * the actual conversation lifecycle. DispatchAgentManager delegates all
   * IAgentManager operations (sendMessage, confirm, getMode, etc.) to it.
   * This is the key insight: a dispatch leader is just a normal conversation
   * with extra MCP tools. The inner manager handles everything else.
   */
  private innerManager: (IAgentManager & { sendMessage(data: unknown): Promise<unknown> }) | null = null;

  /** F-5.2: Track children whose transcripts have been read (for lazy cleanup) */
  private readonly transcriptReadChildren = new Set<string>();

  /** F-5.2: Guard against concurrent resume of the same child */
  private readonly resumingChildren = new Map<string, Promise<void>>();

  /** Track children with active completion listeners to prevent duplicates */
  private readonly activePollers = new Set<string>();

  /** Unsubscribe handle for the shared responseStream listener */
  private responseStreamUnsubscribe: (() => void) | null = null;

  /** Reference to the shared WorkerTaskManager (set after construction) */
  private taskManager: IWorkerTaskManager | undefined;
  private conversationRepo: IConversationRepository | undefined;

  /** ACP-specific data needed for inner manager creation */
  private readonly initData: DispatchAgentData;

  private bootstrap: Promise<void>;

  constructor(data: DispatchAgentData) {
    const adminWorkerType: AgentType = data.adminAgentType || 'gemini';
    // Never fork — the inner manager (GeminiAgentManager or AcpAgentManager) handles its own lifecycle
    super('dispatch', { ...data, model: data.model }, new IpcAgentEventEmitter(), false, adminWorkerType);
    this.adminWorkerType = adminWorkerType;
    this.workspace = data.workspace;
    this.conversation_id = data.conversation_id;
    this.model = data.model;
    this.dispatcherName = data.dispatcherName ?? 'Dispatcher';
    this.initData = data;

    this.tracker = new DispatchSessionTracker();
    // notifier and resourceGuard need repo, will be set via setDependencies()

    // MCP server: handles tool calls from admin agent CLI
    const toolHandler: DispatchToolHandler = {
      parentSessionId: this.conversation_id,
      startChildSession: this.startChildSession.bind(this),
      readTranscript: this.readTranscript.bind(this),
      listChildren: this.listChildren.bind(this),
      sendMessageToChild: this.sendMessageToChild.bind(this),
      listSessions: this.listSessions.bind(this),
    };
    this.mcpServer = new DispatchMcpServer(toolHandler);

    // Bootstrap is deferred until dependencies are set
    this.bootstrap = Promise.resolve();
  }

  /**
   * Set external dependencies. Must be called before sendMessage.
   * Separated from constructor to avoid circular dependency with WorkerTaskManager.
   */
  setDependencies(taskManager: IWorkerTaskManager, conversationRepo: IConversationRepository): void {
    this.taskManager = taskManager;
    this.conversationRepo = conversationRepo;
    this.notifier = new DispatchNotifier(taskManager, this.tracker, conversationRepo);
    this.resourceGuard = new DispatchResourceGuard(taskManager, this.tracker);

    // Subscribe to response stream for event-driven child completion + permission monitoring
    this.responseStreamUnsubscribe = ipcBridge.conversation.responseStream.on((msg) => {
      if (!this.tracker.isDispatchChild(msg.conversation_id)) return;

      // Gap-2: Event-driven child completion detection
      if (msg.type === 'finish') {
        this.handleChildFinished(msg.conversation_id, 'completed');
      }

      // Gap-4: Monitor child tool calls for permission violations
      if (msg.type === 'tool_group') {
        const tools = msg.data as Array<{ name?: string; args?: Record<string, unknown> }> | undefined;
        if (Array.isArray(tools)) {
          for (const tool of tools) {
            if (tool.name) {
              this.handleChildToolCallReport(msg.conversation_id, tool.name, tool.args ?? {});
            }
          }
        }
      }
    });

    this.bootstrap = this.createBootstrap();
    this.bootstrap.catch((err) => {
      mainError('[DispatchAgentManager]', 'Bootstrap failed', err);
    });
  }

  /**
   * Initialize worker with dispatch config.
   */
  private async createBootstrap(): Promise<void> {
    // Read conversation extra for configurable settings
    let customInstructions: string | undefined;
    let maxConcurrentChildren: number | undefined;
    if (this.conversationRepo) {
      try {
        const conv = await this.conversationRepo.getConversation(this.conversation_id);
        if (conv) {
          const extra = conv.extra as {
            seedMessages?: string;
            maxConcurrentChildren?: number;
          };
          customInstructions = extra.seedMessages;
          maxConcurrentChildren = extra.maxConcurrentChildren;
        }
      } catch (err) {
        mainWarn('[DispatchAgentManager]', 'Failed to read conversation extra', err);
      }
    }

    // Apply configurable concurrent limit
    if (typeof maxConcurrentChildren === 'number') {
      this.resourceGuard.setMaxConcurrent(maxConcurrentChildren);
    }

    // Gemini CLI registers MCP tools with a qualified name prefix: "aionui-team__start_task"
    // ACP agents (Claude/Codex) use bare tool names from the MCP schema
    const toolPrefix = this.adminWorkerType === 'gemini' ? 'aionui-team__' : '';
    const combinedRules = buildDispatchSystemPrompt(this.dispatcherName, {
      workspace: this.workspace,
      maxConcurrentChildren: maxConcurrentChildren ?? DEFAULT_CONCURRENT_CHILDREN,
      customInstructions,
      toolPrefix,
    });

    // Start HTTP MCP server for dispatch tools (runs in main process, no child process)
    this.httpMcpServer = new DispatchHttpMcpServer(this.conversation_id, this.mcpServer);
    await this.httpMcpServer.start();
    mainLog('[DispatchAgentManager]', `HTTP MCP server started: ${this.httpMcpServer.url}`);

    if (this.adminWorkerType === 'gemini') {
      // Gemini path: create a real GeminiAgentManager — same as a normal conversation,
      // just with dispatch MCP tools injected. It handles everything: messages, confirmations,
      // mode switching, tool approval, streaming.
      const { GeminiAgentManager } = await import('../GeminiAgentManager');
      const sessionMode = this.initData.yoloMode ? 'yolo' : 'default';
      const geminiMcpConfig = this.httpMcpServer.getGeminiMcpConfig();
      mainLog('[DispatchAgentManager]', `Gemini MCP config: ${JSON.stringify(geminiMcpConfig)}`);
      const geminiManager = new GeminiAgentManager(
        {
          workspace: this.workspace,
          conversation_id: this.conversation_id,
          presetRules: combinedRules,
          yoloMode: this.initData.yoloMode,
          sessionMode,
          externalMcpServers: { 'aionui-team': geminiMcpConfig },
        },
        this.model,
      );
      this.innerManager = geminiManager as unknown as typeof this.innerManager;
      mainLog('[DispatchAgentManager]', 'Gemini admin booted via inner GeminiAgentManager');
    } else {
      // ACP path (CC/Claude/Codex/etc.): create inner AcpAgentManager
      await this.bootAcpAdmin(combinedRules);
    }

    // Restore parent-child mappings from DB (handles app restart)
    if (this.conversationRepo) {
      await this.tracker.restoreFromDb(this.conversationRepo, this.conversation_id);
    }

    // Restore any pending notifications from DB
    if (this.notifier) {
      await this.notifier.restoreFromDb(this.conversation_id);
    }

    // F-5.3: Inject resume context if children exist from a previous session
    const restoredChildren = this.tracker.getChildren(this.conversation_id);
    if (restoredChildren.length > 0 && this.notifier) {
      this.notifier.injectResumeContext(this.conversation_id, restoredChildren);
    }

    // G3.2: Auto-trigger welcome message on first bootstrap (only once per group chat)
    // Check DB for existing messages to avoid re-triggering on app restart / lazy rebuild
    let hasExistingMessages = false;
    if (this.conversationRepo) {
      try {
        const result = await this.conversationRepo.getMessages(this.conversation_id, 1, 1);
        hasExistingMessages = result.total > 0;
      } catch (_err) {
        // Non-fatal: skip welcome if we can't check
        hasExistingMessages = true;
      }
    }
    if (!hasExistingMessages) {
      void this.sendMessage({
        input: '[System] Group chat created. Please welcome the user.',
        msg_id: uuid(),
        isSystemNotification: true,
      }).catch((err) => {
        mainWarn('[DispatchAgentManager]', 'Welcome auto-trigger failed', err);
      });
    }
  }

  /**
   * Boot an ACP-based admin agent (CC, Claude, Codex, etc.).
   * Creates an inner AcpAgentManager with dispatch MCP tools injected.
   */
  private async bootAcpAdmin(systemPrompt: string): Promise<void> {
    if (!this.conversationRepo || !this.httpMcpServer) {
      throw new Error('conversationRepo or httpMcpServer not set');
    }

    // Read the conversation to get ACP-specific config
    const conv = await this.conversationRepo.getConversation(this.conversation_id);
    const extra = (conv?.extra ?? {}) as Record<string, unknown>;

    // Get HTTP MCP config for ACP agents (no child process needed)
    const acpMcpServer = this.httpMcpServer.getAcpMcpConfig();

    // Resolve ACP backend from adminAgentType or conversation extra
    // Cast is safe: adminWorkerType is validated at createGroupChat time
    const backend = ((extra.backend as string) || this.adminWorkerType) as import('@/common/types/acpTypes').AcpBackendAll;

    // Build AcpAgentManager data
    const isYolo = this.initData.yoloMode === true;
    const acpData = {
      workspace: this.workspace,
      backend,
      conversation_id: this.conversation_id,
      presetContext: systemPrompt,
      yoloMode: isYolo,
      externalMcpServers: [acpMcpServer],
      cliPath: extra.cliPath as string | undefined,
      customWorkspace: !!this.workspace,
      // Preserve session resume fields
      acpSessionId: extra.acpSessionId as string | undefined,
      acpSessionUpdatedAt: extra.acpSessionUpdatedAt as number | undefined,
      sessionMode: isYolo ? 'yolo' : ((extra.sessionMode as string) || 'plan'),
      currentModelId: extra.currentModelId as string | undefined,
    };

    // Dynamically import AcpAgentManager to avoid circular dependency
    const { default: AcpAgentManager } = await import('../AcpAgentManager');
    const acpManager = new AcpAgentManager(acpData) as unknown as typeof this.innerManager;
    this.innerManager = acpManager;

    mainLog('[DispatchAgentManager]', `ACP admin booted: backend=${backend}`);
  }

  /**
   * Override sendMessage to inject pending notifications before user message.
   */
  async sendMessage(data: { input: string; msg_id: string; files?: string[]; isSystemNotification?: boolean }) {
    // Save user message to DB
    if (!data.isSystemNotification) {
      const message: TMessage = {
        id: data.msg_id,
        type: 'text',
        position: 'right',
        conversation_id: this.conversation_id,
        content: { content: data.input },
      };
      addMessage(this.conversation_id, message);
    }

    this.status = 'pending';
    mainLog('[DispatchAgentManager]', `sendMessage: conv=${this.conversation_id}, input="${data.input.slice(0, 50)}"`);

    await this.bootstrap.catch((e) => {
      this.status = 'failed';
      mainError('[DispatchAgentManager]', 'sendMessage: bootstrap failed', e);
      throw e;
    });

    if (!this.innerManager) {
      throw new Error('Inner manager not initialized. Bootstrap may have failed.');
    }
    const sendToAdmin = (msg: { input: string; msg_id: string }) => this.innerManager!.sendMessage(msg);
    mainLog('[DispatchAgentManager]', `sendMessage: using ${this.adminWorkerType} admin`);

    // Check for pending notifications (cold parent wakeup)
    if (!data.isSystemNotification && this.notifier) {
      const pending = this.notifier.flushPending(this.conversation_id);
      if (pending) {
        mainLog('[DispatchAgentManager]', `Injecting ${pending.split('\n').length} pending notification(s)`);
        // Inject as system notification first (separate turn)
        await sendToAdmin({
          input: `[System Notification]\n${pending}`,
          msg_id: uuid(),
        });
        // Only clear after successful delivery
        this.notifier.confirmFlush(this.conversation_id);
      }
    }

    // Then send the actual message
    this.status = 'running';
    return sendToAdmin(data);
  }

  /**
   * No-op init override. The inner manager (GeminiAgentManager or AcpAgentManager)
   * handles its own worker lifecycle and message processing. DispatchAgentManager
   * never forks a worker directly.
   */
  protected init(): void {
    // Intentionally empty — inner manager handles everything
  }

  // ==================== Permission Mode & Confirmation ====================
  // All delegated to innerManager — dispatch leader is just a normal conversation.

  getMode(): { mode: string; initialized: boolean } {
    if (this.innerManager && 'getMode' in this.innerManager) {
      return (this.innerManager as { getMode(): { mode: string; initialized: boolean } }).getMode();
    }
    return { mode: 'default', initialized: false };
  }

  async setMode(mode: string): Promise<{ success: boolean; msg?: string; data?: { mode: string } }> {
    if (this.innerManager && 'setMode' in this.innerManager) {
      return (this.innerManager as { setMode(m: string): Promise<{ success: boolean; msg?: string; data?: { mode: string } }> }).setMode(mode);
    }
    return { success: false, msg: 'Inner manager not initialized' };
  }

  confirm(id: string, callId: string, data: unknown): void {
    if (this.innerManager) {
      this.innerManager.confirm(id, callId, data);
    }
  }

  getConfirmations() {
    if (this.innerManager) {
      return this.innerManager.getConfirmations();
    }
    return [];
  }

  // ==================== Tool Handler Implementations ====================

  /**
   * start_task implementation: create child conversation and agent.
   */
  private async startChildSession(params: StartChildTaskParams): Promise<string> {
    if (!this.taskManager || !this.conversationRepo) {
      throw new Error('Dependencies not set. Call setDependencies() first.');
    }

    // Check concurrency limit (F-5.2: pass transcriptReadChildren for lazy cleanup)
    const limitError = this.resourceGuard.checkConcurrencyLimit(this.conversation_id, this.transcriptReadChildren);
    if (limitError) {
      throw new Error(limitError);
    }

    // F-4.2: Resolve model override
    let childModel = this.model;
    let childModelName: string | undefined;
    if (params.model) {
      try {
        const providers = ((await ProcessConfig.get('model.config')) || []) as IProvider[];
        const provider = providers.find((p) => p.id === params.model!.providerId);
        if (
          provider &&
          provider.enabled !== false &&
          provider.model.includes(params.model.modelName) &&
          provider.modelEnabled?.[params.model.modelName] !== false
        ) {
          childModel = { ...provider, useModel: params.model.modelName };
          childModelName = params.model.modelName;
          mainLog('[DispatchAgentManager]', `Model override: ${params.model.providerId}::${params.model.modelName}`);
        } else {
          mainWarn(
            '[DispatchAgentManager]',
            `Model override not found: ${params.model.providerId}::${params.model.modelName}, fallback to default`
          );
        }
      } catch (err) {
        mainWarn('[DispatchAgentManager]', 'Failed to resolve model override, fallback to default', err);
      }
    }

    // F-6.1: Workspace resolution and validation
    let childWorkspace = this.workspace;
    if (params.workspace) {
      const resolved = path.resolve(params.workspace);
      const parentResolved = path.resolve(this.workspace);
      // Security: workspace must be within parent workspace to prevent path traversal
      if (!resolved.startsWith(parentResolved + path.sep) && resolved !== parentResolved) {
        throw new Error(`Workspace must be within parent workspace: ${this.workspace}`);
      }
      try {
        const stat = await fs.promises.stat(resolved);
        if (!stat.isDirectory()) {
          throw new Error(`Workspace is not a directory: ${params.workspace}`);
        }
        childWorkspace = resolved;
        mainLog('[DispatchAgentManager]', `Workspace override: ${resolved}`);
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Workspace directory does not exist: ${params.workspace}`, { cause: err });
        }
        throw err;
      }
    }

    // Resolve child agent type — default to same type as leader agent
    const childAgentType: AgentType = params.agent_type || this.adminWorkerType;

    // G2.1: Worktree isolation
    let worktreePath: string | undefined;
    let worktreeBranch: string | undefined;
    if (params.isolation === 'worktree') {
      try {
        const wtInfo = await createWorktree(childWorkspace, uuid(8));
        childWorkspace = wtInfo.worktreePath; // child works in the worktree
        worktreePath = wtInfo.worktreePath;
        worktreeBranch = wtInfo.branchName;
        mainLog('[DispatchAgentManager]', `Created worktree: ${wtInfo.worktreePath}`);
      } catch (err) {
        // Graceful degradation: not a git repo or git error
        mainWarn('[DispatchAgentManager]', `Worktree creation failed, using shared workspace`, err);
      }
    }

    // Create child conversation in DB.
    // Cast to TChatConversation — childAgentType determines the actual runtime type.
    // The AgentFactory routes by conversation.type, so the child worker is created correctly.
    const childId = uuid(16);

    // For ACP-type children, inherit backend/cliPath from parent conversation
    let acpChildExtra: Record<string, unknown> = {};
    if (childAgentType !== 'gemini' && this.conversationRepo) {
      try {
        const parentConv = await this.conversationRepo.getConversation(this.conversation_id);
        const parentExtra = (parentConv?.extra ?? {}) as Record<string, unknown>;
        acpChildExtra = {
          backend: parentExtra.backend || this.adminWorkerType,
          cliPath: parentExtra.cliPath,
        };
      } catch (_err) {
        // Fallback: use adminWorkerType as backend
        acpChildExtra = { backend: this.adminWorkerType };
      }
    }

    const childConversation = {
      id: childId,
      name: params.title,
      type: childAgentType,
      createTime: Date.now(),
      modifyTime: Date.now(),
      model: childModel,
      extra: {
        workspace: childWorkspace,
        dispatchSessionType: 'dispatch_child' as const,
        parentSessionId: this.conversation_id,
        dispatchTitle: params.title,
        yoloMode: true,
        childModelName,
        // G2.1: store worktree info
        worktreePath,
        worktreeBranch,
        // ACP-type children need backend config from parent
        ...acpChildExtra,
      },
    } as unknown as TChatConversation;
    await this.conversationRepo.createConversation(childConversation);

    // Register in tracker
    const childInfo: ChildTaskInfo = {
      sessionId: childId,
      title: params.title,
      status: 'pending',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      workspace: childWorkspace,
      agentType: childAgentType,
      worktreePath,
      worktreeBranch,
    };
    this.tracker.registerChild(this.conversation_id, childInfo);

    // Build and start child agent via AgentFactory
    const childTask = await this.taskManager.getOrBuildTask(childId, {
      yoloMode: true,
      dispatchSessionType: 'dispatch_child',
      parentSessionId: this.conversation_id,
    });

    // Listen for child completion
    this.listenForChildCompletion(childId, childTask);

    // Send initial prompt to child
    mainLog('[DispatchAgentManager]', `Starting child task: ${childId} (${params.title})`);
    this.tracker.updateChildStatus(childId, 'running');

    void childTask
      .sendMessage({
        input: params.prompt,
        msg_id: uuid(),
      })
      .catch((err: unknown) => {
        mainError('[DispatchAgentManager]', `Child task failed to start: ${childId}`, err);
        this.tracker.updateChildStatus(childId, 'failed');
        void this.notifier.handleChildCompletion(childId, 'failed');
      });

    // Emit child_started event for UI
    this.emitGroupChatEvent({
      sourceSessionId: childId,
      sourceRole: 'child',
      displayName: params.title,
      content: '',
      messageType: 'task_started',
      timestamp: Date.now(),
      childTaskId: childId,
    });

    return childId;
  }

  /**
   * Handle child agent completion. Deduplicates via activePollers set.
   * Updates tracker, notifies parent, emits UI event, and signals WorkerTaskManager.
   */
  private handleChildFinished(childId: string, result: 'completed' | 'failed'): void {
    if (!this.activePollers.has(childId)) return;
    this.activePollers.delete(childId);

    const status = result === 'completed' ? 'idle' : 'failed';
    this.tracker.updateChildStatus(childId, status);
    void this.notifier.handleChildCompletion(childId, result);

    // Signal WorkerTaskManager so waitForTaskIdle() resolves
    this.taskManager?.notifyTaskCompleted?.(childId, result);

    this.emitGroupChatEvent({
      sourceSessionId: childId,
      sourceRole: 'child',
      displayName: this.tracker.getChildInfo(childId)?.title ?? 'Task',
      content: '',
      messageType: result === 'completed' ? 'task_completed' : 'task_failed',
      timestamp: Date.now(),
      childTaskId: childId,
    });
  }

  /**
   * Listen for a child agent's completion.
   * Primary: event-driven via responseStream 'finish' events (subscribed in setDependencies).
   * Fallback: safety poll every 30s to catch missed events. Max lifetime: 30 minutes.
   */
  private listenForChildCompletion(childId: string, _childTask: IAgentManager): void {
    if (this.activePollers.has(childId)) return;
    this.activePollers.add(childId);

    const startTime = Date.now();
    const maxLifetimeMs = 30 * 60 * 1000;
    const safetyPollIntervalMs = 30_000;

    const poll = (): void => {
      // Already handled by event-driven path
      if (!this.activePollers.has(childId)) return;

      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= maxLifetimeMs) {
        mainWarn('[DispatchAgentManager]', `Max lifetime reached for child: ${childId}, marking idle`);
        this.handleChildFinished(childId, 'completed');
        return;
      }

      // Check if child was cancelled externally
      const childInfo = this.tracker.getChildInfo(childId);
      if (childInfo?.status === 'cancelled') {
        this.activePollers.delete(childId);
        return;
      }

      const task = this.taskManager?.getTask(childId);
      if (!task) {
        this.activePollers.delete(childId);
        return;
      }

      if (task.status === 'finished' || task.status === 'idle') {
        this.handleChildFinished(childId, 'completed');
        return;
      } else if (task.status === 'failed') {
        this.handleChildFinished(childId, 'failed');
        return;
      }

      // Schedule next safety poll
      setTimeout(poll, safetyPollIntervalMs);
    };

    // First safety poll after 30s (event-driven should fire much sooner)
    setTimeout(poll, safetyPollIntervalMs);
  }

  /**
   * read_transcript implementation: read child conversation messages.
   */
  private async readTranscript(options: ReadTranscriptOptions): Promise<TranscriptResult> {
    if (!this.taskManager || !this.conversationRepo) {
      throw new Error('Dependencies not set');
    }

    const childInfo = this.tracker.getChildInfo(options.sessionId);
    if (!childInfo) {
      return {
        sessionId: options.sessionId,
        title: 'Unknown',
        status: 'failed',
        transcript: `Error: No child task found with session_id "${options.sessionId}"`,
        isRunning: false,
      };
    }

    // Wait for completion if still running
    const maxWait = (options.maxWaitSeconds ?? 30) * 1000;
    if (childInfo.status === 'running' || childInfo.status === 'pending') {
      if (maxWait > 0) {
        const completed = await this.waitForChildIdle(options.sessionId, maxWait);
        if (!completed) {
          // Still running after timeout, return progress summary
          if (options.format !== 'full') {
            const timeAgo = this.formatTimeAgo(childInfo.lastActivityAt);
            const turnCount = await this.getMessageCount(options.sessionId);
            return {
              sessionId: options.sessionId,
              title: childInfo.title,
              status: childInfo.status,
              transcript: `${childInfo.title}: ${childInfo.status}, ${turnCount} turns completed, last activity ${timeAgo}`,
              isRunning: true,
            };
          }
        }
      } else if (options.format !== 'full') {
        // Immediate return with progress summary
        const timeAgo = this.formatTimeAgo(childInfo.lastActivityAt);
        const turnCount = await this.getMessageCount(options.sessionId);
        return {
          sessionId: options.sessionId,
          title: childInfo.title,
          status: childInfo.status,
          transcript: `${childInfo.title}: ${childInfo.status}, ${turnCount} turns completed, last activity ${timeAgo}`,
          isRunning: true,
        };
      }
    }

    // Read messages from DB
    const limit = options.limit ?? 20;
    const messages = await this.conversationRepo.getMessages(options.sessionId, 0, limit);
    const transcript = this.formatTranscript(messages.data);

    const currentInfo = this.tracker.getChildInfo(options.sessionId);
    const isRunning = currentInfo?.status === 'running' || currentInfo?.status === 'pending';

    // F-5.2: Track that this child's transcript has been read (for lazy cleanup).
    // No longer auto-release the child worker — idle children remain resumable.
    if (!isRunning) {
      this.transcriptReadChildren.add(options.sessionId);
    }

    return {
      sessionId: options.sessionId,
      title: childInfo.title,
      status: currentInfo?.status ?? 'finished',
      transcript: transcript || '[No messages yet]',
      isRunning,
    };
  }

  /**
   * Wait for a child task to reach idle/finished/failed/cancelled state.
   */
  private waitForChildIdle(childId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const check = () => {
        const info = this.tracker.getChildInfo(childId);
        if (
          !info ||
          info.status === 'idle' ||
          info.status === 'finished' ||
          info.status === 'failed' ||
          info.status === 'cancelled'
        ) {
          resolve(true);
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, 1000);
      };
      check();
    });
  }

  /**
   * List all children for this dispatcher.
   */
  private async listChildren(): Promise<ChildTaskInfo[]> {
    return this.tracker.getChildren(this.conversation_id);
  }

  /**
   * F-2.2: list_sessions implementation (replaces list_children for MCP tool).
   * Returns formatted session list sorted by recency.
   */
  private async listSessions(params: ListSessionsParams): Promise<string> {
    const children = this.tracker.getChildren(this.conversation_id);
    if (children.length === 0) {
      return 'No other sessions.';
    }

    const limit = params.limit ?? 20;
    const sorted = [...children].toSorted((a, b) => b.lastActivityAt - a.lastActivityAt);
    const shown = sorted.slice(0, limit);

    const statusLabel = (status: string): string => {
      if (status === 'running' || status === 'pending') return 'running';
      if (status === 'cancelled') return 'cancelled';
      if (status === 'failed') return 'failed';
      return 'idle';
    };

    const lines = shown.map((c) => {
      const workspaceLabel = c.workspace ? `, workspace: ${c.workspace}` : '';
      return `  - ${c.sessionId} "${c.title}" (${statusLabel(c.status)}, is_child: true${workspaceLabel})`;
    });

    const header =
      children.length > shown.length
        ? `Sessions (${shown.length} of ${children.length}, most recent first -- pass a higher limit to see more):`
        : `Sessions (${children.length}):`;

    return header + '\n' + lines.join('\n');
  }

  /**
   * F-2.1: send_message implementation.
   * Sends a follow-up message to a running child task.
   * Phase 2a: only supports running/pending children.
   */
  private async sendMessageToChild(params: SendMessageToChildParams): Promise<string> {
    if (!this.taskManager) throw new Error('Dependencies not set');

    const childInfo = this.tracker.getChildInfo(params.sessionId);
    if (!childInfo) {
      throw new Error(`Session "${params.sessionId}" not found. Use list_sessions to see available sessions.`);
    }

    // Terminal states cannot receive messages
    if (childInfo.status === 'cancelled' || childInfo.status === 'failed') {
      throw new Error(`Session "${childInfo.title}" has been ${childInfo.status}. Start a new task instead.`);
    }

    // F-5.2: Idle/finished children can be resumed by re-creating worker
    let task = this.taskManager.getTask(params.sessionId);

    if (!task || childInfo.status === 'idle' || childInfo.status === 'finished') {
      // Wait if this child is already being resumed by another concurrent call
      const inFlight = this.resumingChildren.get(params.sessionId);
      if (inFlight) {
        await inFlight;
        task = this.taskManager.getTask(params.sessionId);
      } else {
        // Re-create worker for the idle child
        const resumePromise = this.resumeChild(params.sessionId);
        this.resumingChildren.set(params.sessionId, resumePromise);
        try {
          await resumePromise;
        } finally {
          this.resumingChildren.delete(params.sessionId);
        }
        task = this.taskManager.getTask(params.sessionId);
      }
    }

    if (!task) {
      throw new Error(`Child task process not found for "${params.sessionId}"`);
    }

    mainLog('[DispatchAgentManager]', `Sending message to child: ${params.sessionId} (status: ${childInfo.status})`);
    this.tracker.updateChildStatus(params.sessionId, 'running');

    await task.sendMessage({
      input: params.message,
      msg_id: uuid(),
    });

    return `Message sent to "${childInfo.title}". Use read_transcript to see the response.`;
  }

  /**
   * F-5.2: Re-create a worker for an idle/finished child session.
   * Reads config from conversation DB and rebuilds the agent.
   */
  private async resumeChild(childId: string): Promise<void> {
    if (!this.taskManager) throw new Error('Dependencies not set');

    mainLog('[DispatchAgentManager]', `Resuming idle child: ${childId}`);

    const childTask = await this.taskManager.getOrBuildTask(childId, {
      yoloMode: true,
      dispatchSessionType: 'dispatch_child',
      parentSessionId: this.conversation_id,
    });

    // Re-attach completion listener
    this.listenForChildCompletion(childId, childTask);

    // Clear from transcript-read set since child is being resumed
    this.transcriptReadChildren.delete(childId);
  }

  /**
   * F-2.5: Cancel a running child task.
   * Called from dispatchBridge when user clicks cancel in UI.
   * Kills worker, updates tracker, notifies parent, emits UI event.
   */
  async cancelChild(childSessionId: string): Promise<void> {
    const childInfo = this.tracker.getChildInfo(childSessionId);
    if (!childInfo) {
      throw new Error(`Child session not found: ${childSessionId}`);
    }

    if (childInfo.status === 'cancelled' || childInfo.status === 'finished' || childInfo.status === 'idle') {
      // Already done, nothing to cancel
      return;
    }

    mainLog('[DispatchAgentManager]', `Cancelling child: ${childSessionId}, previousStatus=${childInfo.status}`);

    // Capture info before kill (kill removes task from taskList)
    const displayName = childInfo.title;

    // 1. Kill the worker process FIRST (ensures polling loop exits cleanly)
    if (this.taskManager) {
      this.taskManager.kill(childSessionId);
    }

    // 2. Update tracker status AFTER kill
    this.tracker.updateChildStatus(childSessionId, 'cancelled');

    // 3. Notify parent dispatcher (uses extended signature with 'cancelled')
    if (this.notifier) {
      try {
        await this.notifier.handleChildCompletion(childSessionId, 'cancelled');
      } catch (err) {
        mainError('[DispatchAgentManager]', `Failed to notify parent about cancel: ${childSessionId}`, err);
      }
    }

    // 4. Emit UI event (emitGroupChatEvent now also persists to DB per CF-1 fix)
    this.emitGroupChatEvent({
      sourceSessionId: childSessionId,
      sourceRole: 'child',
      displayName,
      content: '',
      messageType: 'task_cancelled',
      timestamp: Date.now(),
      childTaskId: childSessionId,
    });

    mainLog('[DispatchAgentManager]', `cancelChild success: childId=${childSessionId}, workerKilled=true`);
  }

  /**
   * Monitor child tool calls for dangerous operations.
   * SOFT enforcement: log + notify admin, do not block.
   */
  private handleChildToolCallReport(childId: string, toolName: string, args: Record<string, unknown>): void {
    const childInfo = this.tracker.getChildInfo(childId);
    if (!childInfo) return;

    const result = checkPermission(toolName, args, undefined);

    if (result.requiresApproval) {
      const description = `${toolName}(${JSON.stringify(args).slice(0, 200)})`;
      mainWarn(
        '[DispatchAgentManager]',
        `Dangerous tool call: child=${childId} tool=${toolName} -- requires user approval`
      );
      this.emitGroupChatEvent({
        sourceSessionId: childId,
        sourceRole: 'child',
        displayName: childInfo.title,
        content: `Dangerous operation detected: ${description}`,
        messageType: 'system',
        timestamp: Date.now(),
        childTaskId: childId,
      });
      void this.sendMessage({
        input: `[SYSTEM] Child "${childInfo.title}" (${childId}) is executing a dangerous operation: ${description}. Please inform the user.`,
        msg_id: uuid(),
        isSystemNotification: true,
      }).catch((err: unknown) => {
        mainWarn('[DispatchAgentManager]', 'Failed to inject permission notification', err);
      });
    }
  }

  // ==================== Helper Methods ====================

  private formatTranscript(messages: TMessage[]): string {
    const lines: string[] = [];
    for (const m of messages) {
      if (m.type === 'text') {
        const msg = m as IMessageText;
        const role = msg.position === 'right' ? '[user]' : '[assistant]';
        lines.push(`${role} ${msg.content?.content ?? ''}`);
      } else if (m.type === 'tool_group') {
        const group = m as IMessageToolGroup;
        if (!Array.isArray(group.content)) continue;
        const toolSummaries = group.content.map((tool) => {
          const status = tool.status === 'Success' ? 'success' : tool.status.toLowerCase();
          return `${tool.name} (${status})`;
        });
        lines.push(`[assistant] (called ${toolSummaries.join(', ')})`);
      }
    }
    return lines.join('\n');
  }

  private formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  private async getMessageCount(sessionId: string): Promise<number> {
    if (!this.conversationRepo) return 0;
    try {
      const result = await this.conversationRepo.getMessages(sessionId, 0, 1);
      return result.total;
    } catch (err) {
      mainWarn('[DispatchAgentManager]', `Failed to get message count for ${sessionId}`, err);
      return 0;
    }
  }


  private emitGroupChatEvent(message: GroupChatMessage): void {
    const msgId = uuid();

    // CF-1 Fix Part A: Persist dispatch event to DB before emitting to IPC.
    // For task_progress, use addOrUpdateMessage (upsert by childTaskId) to
    // avoid DB bloat -- same child's progress should overwrite, not accumulate.
    try {
      const dbMessage: TMessage = {
        id:
          message.messageType === 'task_progress' && message.childTaskId
            ? `dispatch-progress-${message.childTaskId}`
            : msgId,
        type: 'dispatch_event',
        position: 'left',
        conversation_id: this.conversation_id,
        content: { ...message },
        createdAt: message.timestamp,
      };
      if (message.messageType === 'task_progress' && message.childTaskId) {
        addOrUpdateMessage(this.conversation_id, dbMessage, 'dispatch');
      } else {
        addMessage(this.conversation_id, dbMessage);
      }
    } catch (err) {
      mainError('[DispatchAgentManager]', 'Failed to persist dispatch event to DB', err);
    }

    // Emit to the group chat stream (dispatch-specific channel)
    ipcBridge.geminiConversation.responseStream.emit({
      type: 'dispatch_event',
      conversation_id: this.conversation_id,
      msg_id: msgId,
      data: message,
    } as IResponseMessage);
  }

  kill(): void {
    if (this.innerManager) {
      this.innerManager.kill();
    }
    this.cleanupResponseStreamSubscription();
    // Don't call super.kill() — we never forked a worker
  }

  stop(): Promise<void> {
    if (this.innerManager) {
      return this.innerManager.stop();
    }
    return Promise.resolve();
  }

  private cleanupResponseStreamSubscription(): void {
    if (this.responseStreamUnsubscribe) {
      this.responseStreamUnsubscribe();
      this.responseStreamUnsubscribe = null;
    }
  }

  /**
   * Clean up all resources when the dispatcher is disposed.
   */
  dispose(): void {
    this.mcpServer.dispose();
    if (this.httpMcpServer) {
      this.httpMcpServer.dispose();
      this.httpMcpServer = null;
    }
    this.cleanupResponseStreamSubscription();
    if (this.resourceGuard) {
      this.resourceGuard.cascadeKill(this.conversation_id, this.workspace);
    } else {
      this.kill();
    }
  }

  /**
   * Get the tracker instance (for external access by bridge).
   */
  getTracker(): DispatchSessionTracker {
    return this.tracker;
  }

  /**
   * Get the notifier instance (for external access by bridge).
   */
  getNotifier(): DispatchNotifier {
    return this.notifier;
  }

  /**
   * F-6.2: Update the concurrent task limit at runtime.
   */
  setMaxConcurrent(limit: number): void {
    this.resourceGuard.setMaxConcurrent(limit);
  }
}
