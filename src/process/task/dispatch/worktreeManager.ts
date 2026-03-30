/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/worktreeManager.ts

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const execAsync = promisify(exec);

type WorktreeInfo = {
  worktreePath: string;
  branchName: string;
  sessionId: string;
  createdAt: number;
};

type MergeResult = {
  success: boolean;
  branchName: string;
  conflictFiles?: string[];
  error?: string;
};

/**
 * Check if a directory is a git repository.
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: dirPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a git worktree for a child session.
 * Branch name: aion-wt-{sessionId-prefix}
 * Location: {mainWorkspace}/.aion-worktrees/{branchName}/
 *
 * Returns WorktreeInfo or throws if the workspace is not a git repo.
 */
export async function createWorktree(mainWorkspace: string, sessionId: string): Promise<WorktreeInfo> {
  if (!(await isGitRepo(mainWorkspace))) {
    throw new Error(
      `Cannot create worktree: "${mainWorkspace}" is not a git repository. ` +
        'Worktree isolation requires a git repo. The child will use the shared workspace instead.'
    );
  }

  const branchName = `aion-wt-${sessionId.slice(0, 8)}`;
  const worktreeDir = path.join(mainWorkspace, '.aion-worktrees');
  const worktreePath = path.join(worktreeDir, branchName);

  // Ensure parent dir exists
  await fs.promises.mkdir(worktreeDir, { recursive: true });

  // Get current branch/HEAD to base from
  const { stdout: headRef } = await execAsync('git rev-parse HEAD', { cwd: mainWorkspace });
  const baseCommit = headRef.trim();

  // Create worktree with new branch from current HEAD
  await execAsync(`git worktree add "${worktreePath}" -b "${branchName}" ${baseCommit}`, {
    cwd: mainWorkspace,
  });

  return {
    worktreePath,
    branchName,
    sessionId,
    createdAt: Date.now(),
  };
}

/**
 * Merge a worktree branch back into the current branch of the main workspace.
 * Does NOT delete the worktree (call cleanupWorktree separately).
 */
export async function mergeWorktree(mainWorkspace: string, branchName: string): Promise<MergeResult> {
  try {
    await execAsync(`git merge "${branchName}" --no-edit`, { cwd: mainWorkspace });
    return { success: true, branchName };
  } catch (err) {
    // Check for merge conflicts
    try {
      const { stdout } = await execAsync('git diff --name-only --diff-filter=U', {
        cwd: mainWorkspace,
      });
      const conflictFiles = stdout.trim().split('\n').filter(Boolean);
      // Abort the failed merge
      await execAsync('git merge --abort', { cwd: mainWorkspace });
      return {
        success: false,
        branchName,
        conflictFiles,
        error: `Merge conflict in ${conflictFiles.length} file(s). Merge aborted.`,
      };
    } catch {
      return {
        success: false,
        branchName,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Remove a worktree and delete its branch.
 * Safe to call even if already removed.
 */
export async function cleanupWorktree(mainWorkspace: string, worktreePath: string, branchName: string): Promise<void> {
  try {
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: mainWorkspace,
    });
  } catch {
    // Already removed or path invalid; not an error
  }

  try {
    await execAsync(`git branch -D "${branchName}"`, { cwd: mainWorkspace });
  } catch {
    // Branch already deleted; not an error
  }
}
