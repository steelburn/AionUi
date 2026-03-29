/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ConflictGuard — tracks file-path write claims across concurrent sub-tasks.
 * Used by Orchestrator to detect potential write conflicts between parallel agents.
 */

export type ConflictReport = {
  path: string;
  claimedBy: string[];
};

export class ConflictGuard {
  private readonly claims = new Map<string, string[]>();

  claim(subTaskId: string, filePath: string): ConflictReport | null {
    const normalized = this.normalizePath(filePath);
    const existing = this.claims.get(normalized) ?? [];
    if (existing.length > 0 && !existing.includes(subTaskId)) {
      const all = [...existing, subTaskId];
      this.claims.set(normalized, all);
      return { path: normalized, claimedBy: all };
    }
    if (!existing.includes(subTaskId)) {
      this.claims.set(normalized, [...existing, subTaskId]);
    }
    return null;
  }

  release(subTaskId: string): void {
    for (const [path, ids] of this.claims) {
      const remaining = ids.filter((id) => id !== subTaskId);
      if (remaining.length === 0) this.claims.delete(path);
      else this.claims.set(path, remaining);
    }
  }

  getConflicts(): ConflictReport[] {
    const result: ConflictReport[] = [];
    for (const [path, ids] of this.claims) {
      if (ids.length > 1) result.push({ path, claimedBy: [...ids] });
    }
    return result;
  }

  private normalizePath(p: string): string {
    return p.replace(/^\.\//, '').replace(/\\/g, '/').toLowerCase();
  }
}
