/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/permissionPolicy.ts

type ToolPermissionLevel = 'safe' | 'normal' | 'dangerous';

type PermissionCheckResult = {
  level: ToolPermissionLevel;
  allowed: boolean;
  /** If not allowed, the reason */
  reason?: string;
  /** If dangerous, requires user approval */
  requiresApproval?: boolean;
};

/**
 * Tool classification: which built-in tools are safe, normal, or dangerous.
 */
export const TOOL_CLASSIFICATION: Record<string, ToolPermissionLevel> = {
  Read: 'safe',
  Grep: 'safe',
  Glob: 'safe',
  Bash: 'dangerous', // further classified by command content
  Edit: 'normal',
  Write: 'normal',
  NotebookEdit: 'normal',
};

/**
 * Dangerous bash command patterns.
 * These always require user approval regardless of allowedTools.
 */
export const DANGEROUS_BASH_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\b/, description: 'recursive delete' },
  { pattern: /\bgit\s+push\b/, description: 'git push' },
  { pattern: /\bgit\s+push\s+--force\b/, description: 'force push' },
  { pattern: /\bgit\s+reset\s+--hard\b/, description: 'hard reset' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/, description: 'git clean' },
  { pattern: /\bcurl\b.*\|\s*(bash|sh)\b/, description: 'pipe to shell' },
  { pattern: /\bsudo\b/, description: 'sudo command' },
  { pattern: /\bchmod\s+777\b/, description: 'world-writable permissions' },
  { pattern: /\bnpm\s+publish\b/, description: 'npm publish' },
  { pattern: /\bdocker\s+(rm|rmi|system\s+prune)\b/, description: 'docker destructive' },
];

/**
 * Safe bash command patterns.
 * These are reclassified from 'dangerous' to 'safe' for Bash tool calls.
 */
const SAFE_BASH_PATTERNS: RegExp[] = [
  /^\s*(ls|pwd|cat|head|tail|wc|echo|date|which|type|file)\b/,
  /^\s*git\s+(status|log|diff|show|branch|tag)\b/,
  /^\s*(bun|npm|npx|bunx)\s+(run|test|exec)\b/,
  /^\s*tsc\s+--noEmit\b/,
];

/**
 * Classify a tool call by permission level.
 */
export function classifyToolCall(toolName: string, args: Record<string, unknown>): ToolPermissionLevel {
  const baseLevel = TOOL_CLASSIFICATION[toolName] ?? 'normal';

  if (toolName === 'Bash') {
    const cmd = String(args.command ?? '');

    // Check dangerous patterns first
    for (const { pattern } of DANGEROUS_BASH_PATTERNS) {
      if (pattern.test(cmd)) return 'dangerous';
    }

    // Check safe patterns
    for (const safePattern of SAFE_BASH_PATTERNS) {
      if (safePattern.test(cmd)) return 'safe';
    }

    return 'normal'; // default bash commands are normal, not dangerous
  }

  return baseLevel;
}

/**
 * Check whether a tool call is permitted for a given child session.
 *
 * This is SOFT ENFORCEMENT:
 * - safe tools: always allowed
 * - normal tools: allowed if in allowedTools list (or if allowedTools is not set)
 * - dangerous tools: logged + admin notified, NOT hard-blocked
 *
 * Returns the check result with violation info if applicable.
 */
export function checkPermission(
  toolName: string,
  args: Record<string, unknown>,
  allowedTools: string[] | undefined
): PermissionCheckResult {
  const level = classifyToolCall(toolName, args);

  // Safe tools always pass
  if (level === 'safe') {
    return { level, allowed: true };
  }

  // If no allowedTools configured, soft-allow everything (backward compat)
  if (!allowedTools || allowedTools.length === 0) {
    if (level === 'dangerous') {
      return { level, allowed: true, requiresApproval: true };
    }
    return { level, allowed: true };
  }

  // Normal tools: check allowedTools list
  if (level === 'normal') {
    const isInList = allowedTools.includes(toolName);
    if (!isInList) {
      return {
        level,
        allowed: false,
        reason: `Tool "${toolName}" is not in the allowed tools list for this session.`,
      };
    }
    return { level, allowed: true };
  }

  // Dangerous tools: always flag for approval
  return {
    level,
    allowed: true, // soft enforcement: don't block, but flag
    requiresApproval: true,
  };
}

/**
 * Get the description of why a bash command is classified as dangerous.
 */
export function getDangerousDescription(command: string): string | undefined {
  for (const { pattern, description } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(command)) return description;
  }
  return undefined;
}
