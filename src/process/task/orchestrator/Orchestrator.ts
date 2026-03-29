/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Orchestrator — 总控调度
 *
 * Decomposes a goal into sub-tasks, spawns SubTaskSessions, collects results.
 *
 * Usage:
 *   const orch = new Orchestrator(agentFactory);
 *   const results = await orch.run('Analyze the codebase and write a summary', [
 *     { id: '1', label: 'Read files', prompt: 'List all TypeScript files and summarize them' },
 *     { id: '2', label: 'Write report', prompt: 'Write a one-page architecture summary' },
 *   ]);
 */
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { StateManager } from './StateManager';
import { SubTaskSession } from './SubTaskSession';
import { ResultCollector } from './ResultCollector';
import type { SubTask, SubTaskResult, OrchestratorEvent, DependencyOutput } from './types';
import type { AgentManagerFactory } from './SubTaskSession';

export type { AgentManagerFactory };

export interface OrchestratorOptions {
  /** Max concurrent sub-tasks (default: 3) */
  concurrency?: number;
  /** Timeout per sub-task in ms (default: 5 minutes) */
  subTaskTimeoutMs?: number;
}

export class Orchestrator extends EventEmitter {
  private readonly concurrency: number;
  private readonly subTaskTimeoutMs: number;
  protected readonly activeSessions = new Map<string, SubTaskSession>();
  private readonly fileWriteTracker = new Map<string, string>(); // filePath → first subTaskId

  constructor(
    private readonly agentFactory: AgentManagerFactory,
    options: OrchestratorOptions = {},
  ) {
    super();
    this.concurrency = options.concurrency ?? 3;
    this.subTaskTimeoutMs = options.subTaskTimeoutMs ?? 5 * 60 * 1000;
  }

  /**
   * 总控调度 — run all sub-tasks and collect results.
   *
   * Supports two execution modes:
   *   - Parallel (default): all tasks dispatched with concurrency control.
   *   - Sequential / DAG: tasks with `dependsOn` wait until their deps complete,
   *     then their prompts are enriched with dep outputs before dispatch.
   *     If a dep fails, all dependent tasks are cancelled.
   */
  async run(goal: string, subTasks: SubTask[]): Promise<SubTaskResult[]> {
    if (subTasks.length === 0) return [];

    const runId = randomUUID();
    const stateManager = new StateManager(goal);
    const collector = new ResultCollector();

    // Track completed results and failures for dependency resolution
    const completedResults = new Map<string, SubTaskResult>();
    const failedIds = new Set<string>();

    // Pre-register all tasks so TeamPanel and StateManager know about them upfront
    for (const subTask of subTasks) {
      stateManager.register(subTask, `orch_${runId}_${subTask.id}`);
    }

    stateManager.on('complete', (status: string) => {
      if (status === 'failed') {
        this._emit({ type: 'orchestrator:failed', error: 'One or more sub-tasks failed' });
      } else {
        this._emit({ type: 'orchestrator:done', results: collector.getAllResults() });
      }
    });

    collector.on('result', (result: SubTaskResult) => {
      completedResults.set(result.subTaskId, result);
      stateManager.markDone(result.subTaskId);
      this._emit({ type: 'subtask:done', subTaskId: result.subTaskId, result });
      promoteWaiting();
    });

    collector.on('failure', ({ subTaskId, error }: { subTaskId: string; error: Error }) => {
      failedIds.add(subTaskId);
      stateManager.markFailed(subTaskId, error.message);
      this._emit({ type: 'subtask:failed', subTaskId, error: error.message });
      cancelBlockedBy(subTaskId);
      promoteWaiting();
    });

    collector.on('progress', ({ subTaskId, text }: { subTaskId: string; text: string }) => {
      stateManager.appendText(subTaskId, text);
      this._emit({ type: 'subtask:progress', subTaskId, text });
      this.checkWriteConflict(subTaskId, text);
    });

    // Split into ready (no deps) and waiting (has unresolved deps)
    const waiting = new Set(subTasks.filter((t) => t.dependsOn?.length));
    const queue: SubTask[] = subTasks.filter((t) => !t.dependsOn?.length);
    const running = new Set<Promise<void>>();

    /** Move newly-unblocked tasks from waiting → queue, enriched with dep outputs. */
    const promoteWaiting = () => {
      for (const task of [...waiting]) {
        const deps = task.dependsOn!;
        if (deps.some((id) => failedIds.has(id))) {
          // A dependency failed — cancel this task
          waiting.delete(task);
          stateManager.markFailed(task.id, 'Dependency failed');
          this._emit({ type: 'subtask:failed', subTaskId: task.id, error: 'Dependency failed' });
          failedIds.add(task.id);
          continue;
        }
        if (deps.every((id) => completedResults.has(id))) {
          waiting.delete(task);
          // Build structured dependency outputs for SubTaskSession to format
          const dependencyOutputs: DependencyOutput[] = deps.map((id) => {
            const res = completedResults.get(id)!;
            return {
              subTaskId: id,
              label: subTasks.find((t) => t.id === id)?.label ?? id,
              outputText: res.outputText.trim(),
              completedAt: res.completedAt,
            };
          });
          queue.push({ ...task, dependencyOutputs });
        }
      }
    };

    /** Cancel all tasks that (transitively) depend on a failed task. */
    const cancelBlockedBy = (failedId: string) => {
      for (const task of [...waiting]) {
        if (task.dependsOn?.includes(failedId)) {
          waiting.delete(task);
          stateManager.markFailed(task.id, `Dependency "${failedId}" failed`);
          this._emit({
            type: 'subtask:failed',
            subTaskId: task.id,
            error: `Dependency "${failedId}" failed`,
          });
          failedIds.add(task.id);
          cancelBlockedBy(task.id); // propagate transitively
        }
      }
    };

    const dispatch = async (subTask: SubTask): Promise<void> => {
      const conversationId = `orch_${runId}_${subTask.id}`;
      const session = new SubTaskSession(subTask, conversationId, this.agentFactory);
      this.activeSessions.set(subTask.id, session);
      collector.register(session);

      stateManager.markRunning(subTask.id);
      this._emit({ type: 'subtask:started', subTaskId: subTask.id, conversationId });

      const timeoutMs = this.subTaskTimeoutMs;
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`SubTask ${subTask.id} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      );

      try {
        await Promise.race([this._runSession(session, subTask.prompt), timeoutPromise]);
      } catch (err) {
        const isTimeout = err instanceof Error && err.message.includes('timed out');
        if (isTimeout) {
          // Graceful degradation: capture partial output instead of failing the subtask
          const partialText = collector.getPartialText(subTask.id);
          const partialResult: SubTaskResult = {
            subTaskId: subTask.id,
            conversationId,
            outputText: partialText || `[Timed out after ${timeoutMs}ms — partial output above]`,
            partialOutput: partialText,
            timedOut: true,
            completedAt: Date.now(),
          };
          collector.injectPartialResult(partialResult);
          this._emit({ type: 'subtask:partial', subTaskId: subTask.id, partialText: partialText ?? '' });
        } else {
          session.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
        session.stop().catch((): void => {});
      } finally {
        this.activeSessions.delete(subTask.id);
      }
    };

    // Concurrency-controlled dispatcher — loops until queue + waiting are drained
    while (queue.length > 0 || running.size > 0 || waiting.size > 0) {
      while (queue.length > 0 && running.size < this.concurrency) {
        const subTask = queue.shift()!;
        const p = dispatch(subTask).finally(() => running.delete(p));
        running.add(p);
      }
      if (running.size > 0) {
        await Promise.race(running);
      } else if (waiting.size > 0 && queue.length === 0) {
        // All running tasks done but waiting tasks still blocked — shouldn't happen in
        // a valid plan, but break the deadlock by failing remaining waiting tasks.
        for (const task of [...waiting]) {
          waiting.delete(task);
          stateManager.markFailed(task.id, 'Dependency deadlock');
          this._emit({ type: 'subtask:failed', subTaskId: task.id, error: 'Dependency deadlock' });
        }
        break;
      }
    }

    return collector.waitForAll();
  }

  /**
   * 消息续发 — send a follow-up to an existing session.
   * Returns updated result text after the continuation.
   */
  async continueSession(session: SubTaskSession, followUp: string): Promise<string> {
    const collector = new ResultCollector();
    collector.register(session);
    await session.continue(followUp);
    const results = await collector.waitForAll();
    return results[0]?.outputText ?? '';
  }

  private async _runSession(session: SubTaskSession, prompt: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      session.once('done', resolve);
      session.once('error', reject);
      session.start(prompt).catch(reject);
    });
  }

  /**
   * Detect concurrent write conflicts between sub-tasks.
   * Emits a subtask:conflict_warning event when two tasks write the same file.
   */
  private checkWriteConflict(subTaskId: string, text: string): void {
    const patterns = [
      /(?:Writing|Editing|Creating|Saving|Updated?)\s+([\w./\-]+\.\w{1,6})/i,
      /Edit\(([^)]+)\)/,
      /Write\(([^)]+)\)/,
    ];
    for (const pat of patterns) {
      const m = pat.exec(text);
      if (m?.[1]) {
        const fp = m[1].trim();
        const existing = this.fileWriteTracker.get(fp);
        if (existing && existing !== subTaskId) {
          this._emit({ type: 'subtask:conflict_warning', subTaskId, paths: [fp] });
        } else if (!existing) {
          this.fileWriteTracker.set(fp, subTaskId);
        }
      }
    }
  }

  /**
   * Background dispatch — starts orchestration without blocking on completion.
   * The caller can listen to the 'orchestrator:done' event for results.
   */
  runBackground(goal: string, subTasks: SubTask[]): void {
    this.run(goal, subTasks).catch((err: unknown) => {
      this._emit({
        type: 'orchestrator:failed',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private _emit(event: OrchestratorEvent): void {
    this.emit(event.type, event);
    this.emit('*', event);
  }
}
