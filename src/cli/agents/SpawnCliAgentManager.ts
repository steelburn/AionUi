/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SpawnCliAgentManager — agent manager that spawns a local CLI tool.
 *
 * Supports any CLI that accepts a prompt and streams text to stdout:
 *   claude --print "<prompt>"       (Claude Code CLI)
 *   codex exec "<prompt>"           (OpenAI Codex CLI)
 *
 * This is the correct Aion architecture: Aion aggregates installed CLI agents,
 * each using their own stored credentials. No API keys needed in environment.
 *
 * Multi-turn (solo mode): claude supports --continue (-c) to continue the
 * most recent session. codex uses exec resume for follow-ups.
 *
 * Team mode: each sub-task gets a fresh spawn with no continuation.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter } from '@process/task/IAgentEventEmitter';
import type { IConfirmation } from '@/common/chat/chatLib';
import type { AgentType, AgentStatus } from '@process/task/agentTypes';

export type SpawnAgentConfig = {
  /** Absolute path to the CLI binary */
  bin: string;
  /** Which CLI flavor to use — controls how args are assembled */
  flavor: 'claude' | 'codex';
  /** Extra args always appended (e.g. --model sonnet) */
  extraArgs?: string[];
};

export class SpawnCliAgentManager implements IAgentManager {
  readonly type: AgentType = 'acp';
  status: AgentStatus | undefined = 'pending';
  readonly workspace: string;
  readonly conversation_id: string;

  private isFirstTurn = true;
  private currentProc: ReturnType<typeof spawn> | null = null;

  constructor(
    conversationId: string,
    private readonly config: SpawnAgentConfig,
    private readonly emitter: IAgentEventEmitter,
    workspace?: string,
  ) {
    this.conversation_id = conversationId;
    this.workspace = workspace ?? process.cwd();
  }

  async sendMessage(data: { content: string }): Promise<void> {
    this.status = 'running';

    const args = this.buildArgs(data.content);

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(this.config.bin, args, {
        cwd: this.workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      this.currentProc = proc;

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (text) {
          this.emitter.emitMessage(this.conversation_id, {
            type: 'text',
            data: { content: text, msg_id: randomUUID() },
          });
        }
      });

      // Surface stderr as dim text so the user can see tool activity
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) {
          this.emitter.emitMessage(this.conversation_id, {
            type: 'text',
            data: { content: `\x1b[2m${text}\x1b[0m\n`, msg_id: randomUUID() },
          });
        }
      });

      proc.on('close', (code) => {
        this.currentProc = null;
        this.isFirstTurn = false;
        this.status = 'finished';

        this.emitter.emitMessage(this.conversation_id, {
          type: 'status',
          data: { status: 'done' },
        });

        if (code === 0 || code === null) {
          resolve();
        } else {
          // Non-zero exit: still resolve so Orchestrator can collect partial output
          resolve();
        }
      });

      proc.on('error', (err) => {
        this.status = 'finished';
        this.emitter.emitMessage(this.conversation_id, {
          type: 'status',
          data: { status: 'done' },
        });
        reject(err);
      });
    });
  }

  private buildArgs(prompt: string): string[] {
    const extra = this.config.extraArgs ?? [];

    if (this.config.flavor === 'claude') {
      // claude --print [-c] [--extra...] "<prompt>"
      return [
        '--print',
        ...(this.isFirstTurn ? [] : ['-c']),
        ...extra,
        prompt,
      ];
    }

    if (this.config.flavor === 'codex') {
      // codex exec [--extra...] "<prompt>"
      return ['exec', ...extra, prompt];
    }

    // Generic fallback: pass prompt as last arg
    return [...extra, prompt];
  }

  async stop(): Promise<void> {
    this.currentProc?.kill('SIGTERM');
    this.status = 'finished';
  }

  confirm(_msgId: string, _callId: string, _data: unknown): void {}
  getConfirmations(): IConfirmation[] {
    return [];
  }
  kill(): void {
    this.currentProc?.kill('SIGKILL');
  }
}
