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
  /** Resume the most recent claude session on the very first turn (--continue/-c) */
  continueSession?: boolean;
  /**
   * Never use -c/--continue even for subsequent turns.
   * Use this for coordinator sessions: each call already embeds the full context
   * in the prompt, so session continuation is unnecessary — and harmful when
   * other claude sessions (e.g. specialist runs) have run in between.
   */
  noAutoResume?: boolean;
  /**
   * Optional system prompt to inject via --append-system-prompt (claude only).
   * Used to inject role-specific instructions without touching the user message.
   */
  systemPrompt?: string;
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
    this.emitter.emitMessage(this.conversation_id, { type: 'status', data: { status: 'running' } });

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
      // claude --print --dangerously-skip-permissions [-c] [--extra...] [--append-system-prompt <sp>] "<prompt>"
      // Use -c on: (a) subsequent turns within this session, or (b) first turn with continueSession=true
      const useContinue = !this.config.noAutoResume && (!this.isFirstTurn || !!this.config.continueSession);
      const systemPromptArgs =
        this.config.systemPrompt
          ? ['--append-system-prompt', this.config.systemPrompt]
          : [];
      return [
        '--print',
        '--dangerously-skip-permissions',
        ...(useContinue ? ['-c'] : ['--no-session-persistence']),
        ...extra,
        ...systemPromptArgs,
        prompt,
      ];
    }

    if (this.config.flavor === 'codex') {
      // codex exec --full-auto --skip-git-repo-check [--extra...] "<prompt>"
      // --full-auto: skip tool-approval prompts (stdin is 'ignore', so any prompt hangs forever)
      // --skip-git-repo-check: allow running outside a trusted git directory
      return ['exec', '--full-auto', '--skip-git-repo-check', ...extra, prompt];
    }

    // Generic fallback: pass prompt as last arg
    return [...extra, prompt];
  }

  async stop(): Promise<void> {
    if (!this.currentProc || this.currentProc.exitCode !== null) {
      this.status = 'finished';
      return;
    }
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          this.currentProc?.kill('SIGKILL');
        } catch {
          // Process may have already exited
        }
        this.status = 'finished';
        resolve();
      }, 3000);
      this.currentProc!.once('close', () => {
        clearTimeout(timeout);
        this.status = 'finished';
        resolve();
      });
      try {
        this.currentProc!.kill('SIGTERM');
      } catch {
        // ESRCH: process no longer exists — treat as already exited
        clearTimeout(timeout);
        this.status = 'finished';
        resolve();
      }
    });
  }

  confirm(_msgId: string, _callId: string, _data: unknown): void {}
  getConfirmations(): IConfirmation[] {
    return [];
  }
  kill(): void {
    this.currentProc?.kill('SIGKILL');
  }
}
