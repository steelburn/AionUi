/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictGuard } from '@/cli/ui/conflictGuard';

describe('ConflictGuard', () => {
  let guard: ConflictGuard;

  beforeEach(() => {
    guard = new ConflictGuard();
  });

  // ---------------------------------------------------------------------------
  // claim()
  // ---------------------------------------------------------------------------

  it('claim() returns null for the first claim on a path', () => {
    const result = guard.claim('task-1', 'src/foo.ts');
    expect(result).toBeNull();
  });

  it('claim() returns a ConflictReport when a second agent claims the same path', () => {
    guard.claim('task-1', 'src/foo.ts');
    const result = guard.claim('task-2', 'src/foo.ts');
    expect(result).not.toBeNull();
    expect(result!.path).toBe('src/foo.ts');
    expect(result!.claimedBy).toContain('task-1');
    expect(result!.claimedBy).toContain('task-2');
  });

  it('claim() is idempotent for the same agent claiming the same path twice', () => {
    guard.claim('task-1', 'src/foo.ts');
    const second = guard.claim('task-1', 'src/foo.ts');
    expect(second).toBeNull();
    // Still only one claimant
    expect(guard.getConflicts()).toHaveLength(0);
  });

  it('claim() normalizes ./prefix before comparing', () => {
    guard.claim('task-1', './src/foo.ts');
    const result = guard.claim('task-2', 'src/foo.ts');
    expect(result).not.toBeNull();
    expect(result!.claimedBy).toHaveLength(2);
  });

  it('claim() accumulates all claimants in the ConflictReport', () => {
    guard.claim('task-1', 'src/bar.ts');
    guard.claim('task-2', 'src/bar.ts');
    const result = guard.claim('task-3', 'src/bar.ts');
    expect(result).not.toBeNull();
    expect(result!.claimedBy).toHaveLength(3);
    expect(result!.claimedBy).toContain('task-3');
  });

  // ---------------------------------------------------------------------------
  // release()
  // ---------------------------------------------------------------------------

  it('release() removes all claims for the released task', () => {
    guard.claim('task-1', 'src/a.ts');
    guard.claim('task-1', 'src/b.ts');
    guard.release('task-1');
    // No more conflicts or claims for task-1
    expect(guard.getConflicts()).toHaveLength(0);
    // task-1 can now claim again without conflict
    const result = guard.claim('task-1', 'src/a.ts');
    expect(result).toBeNull();
  });

  it("release() leaves other tasks' claims intact", () => {
    guard.claim('task-1', 'src/shared.ts');
    guard.claim('task-2', 'src/shared.ts');
    guard.release('task-1');
    // task-2 still has its claim; adding task-3 should conflict
    const result = guard.claim('task-3', 'src/shared.ts');
    expect(result).not.toBeNull();
    expect(result!.claimedBy).toContain('task-2');
    expect(result!.claimedBy).toContain('task-3');
    expect(result!.claimedBy).not.toContain('task-1');
  });

  it('release() is a no-op for a task that has no claims', () => {
    expect(() => guard.release('nonexistent-task')).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // getConflicts()
  // ---------------------------------------------------------------------------

  it('getConflicts() returns empty array when there are no conflicts', () => {
    guard.claim('task-1', 'src/a.ts');
    guard.claim('task-2', 'src/b.ts');
    expect(guard.getConflicts()).toHaveLength(0);
  });

  it('getConflicts() returns conflicting paths', () => {
    guard.claim('task-1', 'src/shared.ts');
    guard.claim('task-2', 'src/shared.ts');
    const conflicts = guard.getConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.path).toBe('src/shared.ts');
    expect(conflicts[0]!.claimedBy).toHaveLength(2);
  });

  it('getConflicts() tracks multiple simultaneous conflicts', () => {
    guard.claim('task-1', 'src/alpha.ts');
    guard.claim('task-2', 'src/alpha.ts');
    guard.claim('task-3', 'src/beta.ts');
    guard.claim('task-4', 'src/beta.ts');
    const conflicts = guard.getConflicts();
    expect(conflicts).toHaveLength(2);
    const paths = conflicts.map((c) => c.path).sort();
    expect(paths).toEqual(['src/alpha.ts', 'src/beta.ts']);
  });

  it('getConflicts() returns a snapshot — mutating the result does not affect internal state', () => {
    guard.claim('task-1', 'src/x.ts');
    guard.claim('task-2', 'src/x.ts');
    const conflicts = guard.getConflicts();
    conflicts[0]!.claimedBy.push('injected');
    // Internal state should be unchanged
    const again = guard.getConflicts();
    expect(again[0]!.claimedBy).not.toContain('injected');
  });

  // ---------------------------------------------------------------------------
  // normalizePath (tested indirectly via claim)
  // ---------------------------------------------------------------------------

  it('normalizePath strips a leading ./ from the path', () => {
    guard.claim('task-1', './src/comp.ts');
    const result = guard.claim('task-2', 'src/comp.ts');
    expect(result).not.toBeNull();
    expect(result!.path).toBe('src/comp.ts');
  });

  it('normalizePath lowercases the path so case-insensitive duplicates conflict', () => {
    guard.claim('task-1', 'src/MyFile.ts');
    const result = guard.claim('task-2', 'src/myfile.ts');
    expect(result).not.toBeNull();
  });

  it('normalizePath converts backslashes to forward slashes (Windows paths)', () => {
    guard.claim('task-1', 'src\\windows\\file.ts');
    const result = guard.claim('task-2', 'src/windows/file.ts');
    expect(result).not.toBeNull();
    expect(result!.path).toBe('src/windows/file.ts');
  });
});
