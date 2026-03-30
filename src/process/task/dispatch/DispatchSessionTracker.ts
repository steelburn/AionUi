/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/DispatchSessionTracker.ts

import type { ChildTaskInfo } from './dispatchTypes';
import type { AgentStatus } from '../agentTypes';
import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import type { TChatConversation } from '@/common/config/storage';

/**
 * Tracks parent-child session relationships for dispatch orchestration.
 * Maintains in-memory mappings for fast lookup; DB stores the canonical state.
 */
export class DispatchSessionTracker {
  /** Parent -> children mapping */
  private parentChildren = new Map<string, Map<string, ChildTaskInfo>>();
  /** Child -> parent mapping */
  private childParent = new Map<string, string>();

  /**
   * Register a child session under a parent dispatcher.
   */
  registerChild(parentId: string, childInfo: ChildTaskInfo): void {
    if (!this.parentChildren.has(parentId)) {
      this.parentChildren.set(parentId, new Map());
    }
    this.parentChildren.get(parentId)!.set(childInfo.sessionId, childInfo);
    this.childParent.set(childInfo.sessionId, parentId);
  }

  /**
   * Get the parent session ID for a child.
   */
  getParent(childId: string): string | undefined {
    return this.childParent.get(childId);
  }

  /**
   * Get all child session IDs for a parent.
   */
  getChildIds(parentId: string): string[] {
    const children = this.parentChildren.get(parentId);
    return children ? [...children.keys()] : [];
  }

  /**
   * Get all child task info for a parent.
   */
  getChildren(parentId: string): ChildTaskInfo[] {
    const children = this.parentChildren.get(parentId);
    return children ? [...children.values()] : [];
  }

  /**
   * Get child task info by session ID.
   */
  getChildInfo(childId: string): ChildTaskInfo | undefined {
    const parentId = this.childParent.get(childId);
    if (!parentId) return undefined;
    return this.parentChildren.get(parentId)?.get(childId);
  }

  /**
   * Update the status of a child task.
   */
  updateChildStatus(childId: string, status: AgentStatus): void {
    const parentId = this.childParent.get(childId);
    if (!parentId) return;
    const child = this.parentChildren.get(parentId)?.get(childId);
    if (child) {
      child.status = status;
      child.lastActivityAt = Date.now();
    }
  }

  /**
   * Check if a session is a dispatch child.
   */
  isDispatchChild(id: string): boolean {
    return this.childParent.has(id);
  }

  /**
   * Count active (pending or running) children for a parent.
   */
  countActiveChildren(parentId: string): number {
    const children = this.parentChildren.get(parentId);
    if (!children) return 0;
    let count = 0;
    for (const child of children.values()) {
      if (child.status === 'pending' || child.status === 'running') {
        count++;
      }
    }
    return count;
  }

  /**
   * Remove a child from tracking (after resource release).
   */
  removeChild(childId: string): void {
    const parentId = this.childParent.get(childId);
    if (!parentId) return;
    this.parentChildren.get(parentId)?.delete(childId);
    this.childParent.delete(childId);
  }

  /**
   * Remove all tracking for a parent (cascade cleanup).
   */
  removeParent(parentId: string): void {
    const children = this.parentChildren.get(parentId);
    if (children) {
      for (const childId of children.keys()) {
        this.childParent.delete(childId);
      }
    }
    this.parentChildren.delete(parentId);
  }

  /**
   * Check if a session has any children registered.
   */
  hasChildren(parentId: string): boolean {
    const children = this.parentChildren.get(parentId);
    return children !== undefined && children.size > 0;
  }

  /**
   * Restore parent-child mappings and child task info from the database.
   * Called on app restart to rehydrate in-memory state.
   *
   * All previously running/pending children are marked idle (processes no longer exist).
   *
   * @param conversationRepo - conversation database repository
   * @param parentId - optional: only restore children of this dispatcher
   */
  async restoreFromDb(conversationRepo: IConversationRepository, parentId?: string): Promise<void> {
    // Fetch all conversations from DB and filter dispatch-related ones in memory,
    // since IConversationRepository does not support queryByExtra.
    const allConversations = await conversationRepo.listAllConversations();

    // Rebuild child mappings
    // BUG-001 fix: After CR-004, child conversations use type='gemini' (not 'dispatch').
    // Filter by extra.dispatchSessionType instead of conv.type to support both old and new data.
    for (const conv of allConversations) {
      const extra = conv.extra as
        | {
            dispatchSessionType?: string;
            parentSessionId?: string;
            dispatchTitle?: string;
            teammateConfig?: { name: string; avatar?: string };
            pendingNotifications?: string[];
          }
        | undefined;
      if (!extra || extra.dispatchSessionType !== 'dispatch_child') continue;
      if (!extra.parentSessionId) continue;
      if (parentId && extra.parentSessionId !== parentId) continue;

      const childInfo: ChildTaskInfo = {
        sessionId: conv.id,
        title: extra.dispatchTitle ?? conv.name ?? 'Untitled',
        // After restart, all processes are gone; running/pending become idle
        status: this.inferRestoredStatus(conv.status),
        createdAt: conv.createTime ?? Date.now(),
        lastActivityAt: conv.modifyTime ?? Date.now(),
      };

      this.registerChild(extra.parentSessionId, childInfo);
    }

    // Ensure dispatcher entries exist in parentChildren (even with no children)
    if (!parentId) {
      for (const conv of allConversations) {
        const extra = conv.extra as { dispatchSessionType?: string } | undefined;
        if (!extra || !extra.dispatchSessionType) continue;
        if (extra?.dispatchSessionType === 'dispatcher' && !this.parentChildren.has(conv.id)) {
          this.parentChildren.set(conv.id, new Map());
        }
      }
    }
  }

  /**
   * Infer the restored status for a child task after app restart.
   * Since all worker processes are terminated on restart,
   * running/pending tasks are marked as idle (transcript still readable).
   */
  private inferRestoredStatus(dbStatus?: string): AgentStatus {
    switch (dbStatus) {
      case 'finished':
      case 'idle':
        return 'idle';
      case 'failed':
        return 'failed';
      case 'cancelled':
        return 'cancelled';
      case 'running':
      case 'pending':
      default:
        return 'idle';
    }
  }
}
