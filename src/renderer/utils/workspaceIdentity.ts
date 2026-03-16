/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalize workspace path for equality checks and persistence.
 */
export const normalizeWorkspacePath = (workspacePath: string): string => workspacePath.trim().replace(/[\\/]+$/, '');

/**
 * Canonical key for case-insensitive workspace identity comparisons.
 */
export const getWorkspaceIdentityKey = (workspacePath: string): string =>
  normalizeWorkspacePath(workspacePath).toLowerCase();

/**
 * Compare whether two paths point to the same workspace.
 */
export const isSameWorkspacePath = (leftPath: string, rightPath: string): boolean => {
  const leftKey = getWorkspaceIdentityKey(leftPath);
  const rightKey = getWorkspaceIdentityKey(rightPath);
  return !!leftKey && leftKey === rightKey;
};
