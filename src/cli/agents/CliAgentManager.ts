/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CliAgentManager — standalone IAgentManager for the Aion CLI.
 *
 * Unlike the Electron-coupled agent managers (GeminiAgentManager, AcpAgentManager),
 * this implementation:
 *   - Has zero Electron / IPC dependencies
 *   - Communicates results via an injected IAgentEventEmitter (typically a CaptureEmitter
 *     from SubTaskSession, or a passthrough emitter in solo mode)
 *   - Uses the Anthropic SDK directly for Claude models (already a project dependency)
 *   - Maintains multi-turn conversation history for follow-up messages (消息续发)
 */
import { randomUUID } from 'node:crypto';
import Anthropic, {
  AuthenticationError,
  RateLimitError,
  APIConnectionError,
  InternalServerError,
} from '@anthropic-ai/sdk';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter } from '@process/task/IAgentEventEmitter';
import type { IConfirmation } from '@/common/chat/chatLib';
import type { AgentType, AgentStatus } from '@process/task/agentTypes';
import type { AgentConfig } from '../config/types';

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

export class CliAgentManager implements IAgentManager {
  // IAgentManager requires AgentType; 'acp' is the most generic non-Gemini type
  readonly type: AgentType = 'acp';
  status: AgentStatus | undefined = 'pending';
  readonly workspace: string;
  readonly conversation_id: string;

  private readonly client: Anthropic;
  private history: HistoryMessage[] = [];
  private abortController: AbortController | null = null;

  constructor(
    conversationId: string,
    private readonly config: AgentConfig,
    private readonly emitter: IAgentEventEmitter,
    workspace?: string,
  ) {
    this.conversation_id = conversationId;
    this.workspace = workspace ?? process.cwd();
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async sendMessage(data: { content: string }): Promise<void> {
    this.status = 'running';
    this.emitter.emitMessage(this.conversation_id, { type: 'status', data: { status: 'running' } });
    this.abortController = new AbortController();
    this.history.push({ role: 'user', content: data.content });

    let fullText = '';
    try {
      const stream = this.client.messages.stream({
        model: this.config.model,
        max_tokens: 8192,
        messages: this.history,
      });

      for await (const chunk of stream) {
        if (this.abortController.signal.aborted) break;
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          const text = chunk.delta.text;
          fullText += text;
          this.emitter.emitMessage(this.conversation_id, {
            type: 'text',
            data: { content: text, msg_id: randomUUID() },
          });
        }
      }
    } catch (err) {
      let message: string;
      if (err instanceof AuthenticationError) {
        message = 'API Key 无效，请检查 ANTHROPIC_API_KEY 环境变量';
      } else if (err instanceof RateLimitError) {
        message = '请求频率过高，请稍等片刻再试';
      } else if (err instanceof APIConnectionError) {
        message = '无法连接到 Anthropic API，请检查网络';
      } else if (err instanceof InternalServerError) {
        message = 'Anthropic 服务暂时不可用，请稍后重试';
      } else {
        message = String(err);
      }
      this.emitter.emitMessage(this.conversation_id, {
        type: 'text',
        data: { content: `错误：${message}\n`, msg_id: randomUUID() },
      });
    } finally {
      if (fullText) {
        this.history.push({ role: 'assistant', content: fullText });
      }
      this.status = 'finished';
      // Signal turn completion — CaptureEmitter watches for this
      this.emitter.emitMessage(this.conversation_id, {
        type: 'status',
        data: { status: 'done' },
      });
    }
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    this.status = 'finished';
  }

  confirm(_msgId: string, _callId: string, _data: unknown): void {
    // No confirmation dialogs in CLI mode
  }

  getConfirmations(): IConfirmation[] {
    return [];
  }

  kill(): void {
    this.abortController?.abort();
  }
}
