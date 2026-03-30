/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/DispatchResourceGuard.ts

import type { IWorkerTaskManager } from '../IWorkerTaskManager';
import type { DispatchSessionTracker } from './DispatchSessionTracker';
import { DEFAULT_CONCURRENT_CHILDREN, MIN_CONCURRENT_CHILDREN, MAX_CONCURRENT_CHILDREN_LIMIT } from './dispatchTypes';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { cleanupWorktree } from './worktreeManager';

/**
 * Phase 1 basic resource management for dispatch sessions.
 * Handles concurrency limits, child release, and cascade kill.
 */
export class DispatchResourceGuard {
  /** F-6.2: Dynamic max concurrent children, configurable per session */
  private maxConcurrent: number = DEFAULT_CONCURRENT_CHILDREN;

  constructor(
    private readonly taskManager: IWorkerTaskManager,
    private readonly tracker: DispatchSessionTracker
  ) {}

  /**
   * F-6.2: Update the maximum concurrent children limit.
   * Clamped to [MIN_CONCURRENT_CHILDREN, MAX_CONCURRENT_CHILDREN_LIMIT].
   */
  setMaxConcurrent(limit: number): void {
    this.maxConcurrent = Math.max(MIN_CONCURRENT_CHILDREN, Math.min(MAX_CONCURRENT_CHILDREN_LIMIT, limit));
    mainLog('[DispatchResourceGuard]', `Max concurrent set to ${this.maxConcurrent}`);
  }

  /**
   * Check concurrency limit before creating a new child task.
   * F-5.2: Before rejecting, attempt lazy cleanup of stale idle children.
   * @returns undefined if allowed; error message string if limit exceeded
   */
  checkConcurrencyLimit(parentId: string, transcriptReadSet?: Set<string>): string | undefined {
    let activeCount = this.tracker.countActiveChildren(parentId);

    if (activeCount >= this.maxConcurrent) {
      // F-5.2: Try to free slots by cleaning up stale idle children
      if (transcriptReadSet) {
        const freed = this.cleanupStaleChildren(parentId, transcriptReadSet);
        if (freed > 0) {
          activeCount = this.tracker.countActiveChildren(parentId);
        }
      }

      if (activeCount >= this.maxConcurrent) {
        return (
          `Maximum concurrent tasks reached (${activeCount}/${this.maxConcurrent}). ` +
          `Wait for existing tasks to complete or read their transcripts.`
        );
      }
    }
    return undefined;
  }

  /**
   * Release a completed child worker process.
   * Called after notification sent + transcript read by dispatcher.
   * Transitions child from 'idle' to 'finished' and kills worker.
   */
  releaseChild(childId: string): void {
    const task = this.taskManager.getTask(childId);
    if (task && (task.status === 'idle' || task.status === 'failed' || task.status === 'cancelled')) {
      mainLog('[DispatchResourceGuard]', `Releasing child worker: ${childId}`);
      this.taskManager.kill(childId);
      this.tracker.removeChild(childId);
    }
  }

  /**
   * F-5.2: Clean up the oldest idle children whose transcripts have been read.
   * Called when concurrency limit is hit to free slots for new tasks.
   * @returns number of children released
   */
  cleanupStaleChildren(parentId: string, transcriptReadSet: Set<string>): number {
    const children = this.tracker.getChildren(parentId);
    // Find idle children whose transcripts have been read, sorted oldest first
    const stale = children
      .filter((c) => (c.status === 'idle' || c.status === 'finished') && transcriptReadSet.has(c.sessionId))
      .toSorted((a, b) => a.lastActivityAt - b.lastActivityAt);

    let freed = 0;
    for (const child of stale) {
      mainLog('[DispatchResourceGuard]', `Lazy cleanup: releasing stale child ${child.sessionId}`);
      this.taskManager.kill(child.sessionId);
      this.tracker.removeChild(child.sessionId);
      transcriptReadSet.delete(child.sessionId);
      freed++;
      // Only free enough to get below the limit
      if (this.tracker.countActiveChildren(parentId) < this.maxConcurrent) {
        break;
      }
    }

    return freed;
  }

  /**
   * Cascade kill: when dispatcher is killed, kill all children too.
   * G2.1: Also cleans up worktrees for any children that had isolation='worktree'.
   * Triggered by: user closes group chat, dispatcher finishes, app exit.
   */
  cascadeKill(parentId: string, parentWorkspace?: string): void {
    const children = this.tracker.getChildren(parentId);
    for (const child of children) {
      mainLog('[DispatchResourceGuard]', `Cascade killing child: ${child.sessionId}`);
      this.taskManager.kill(child.sessionId);

      // G2.1: Cleanup worktree if present
      if (child.worktreePath && child.worktreeBranch && parentWorkspace) {
        cleanupWorktree(parentWorkspace, child.worktreePath, child.worktreeBranch).catch((err) => {
          mainWarn('[DispatchResourceGuard]', `Failed to cleanup worktree: ${child.worktreePath}`, err);
        });
      }
    }
    this.tracker.removeParent(parentId);
    this.taskManager.kill(parentId);
  }
}
