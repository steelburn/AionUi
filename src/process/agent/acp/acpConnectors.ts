/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backend-specific ACP connector logic and environment helpers.
 * Extracted from AcpConnection to keep the main class focused on
 * process lifecycle, messaging, and session management.
 */

import type { ChildProcess, SpawnOptions } from 'child_process';
import { execFile as execFileCb, execFileSync, spawn } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  CLAUDE_ACP_NPX_PACKAGE,
  CODEBUDDY_ACP_NPX_PACKAGE,
  CODEX_ACP_BRIDGE_VERSION,
  CODEX_ACP_NPX_PACKAGE,
} from '@/common/types/acpTypes';
import {
  getEnhancedEnv,
  getWindowsShellExecutionOptions,
} from '@process/utils/shellEnv';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

const execFile = promisify(execFileCb);

/** Enable ACP performance diagnostics via ACP_PERF=1 */
export const ACP_PERF_LOG = process.env.ACP_PERF === '1';

function resolveCodexAcpPlatformPackage(): string | null {
  if (process.platform === 'win32') {
    if (process.arch === 'x64') {
      return '@zed-industries/codex-acp-win32-x64';
    }

    if (process.arch === 'arm64') {
      return '@zed-industries/codex-acp-win32-arm64';
    }
  }

  if (process.platform === 'linux') {
    if (process.arch === 'x64') {
      return '@zed-industries/codex-acp-linux-x64';
    }

    if (process.arch === 'arm64') {
      return '@zed-industries/codex-acp-linux-arm64';
    }
  }

  if (process.platform === 'darwin') {
    if (process.arch === 'x64') {
      return '@zed-industries/codex-acp-darwin-x64';
    }

    if (process.arch === 'arm64') {
      return '@zed-industries/codex-acp-darwin-arm64';
    }
  }

  return null;
}

function resolveCodexAcpPlatformPackageSpecifier(packageName: string): string {
  return process.platform === 'win32' ? `${packageName}@${CODEX_ACP_BRIDGE_VERSION}` : packageName;
}

function resolvePreferredCodexAcpPlatformPackage(): string | null {
  const packageName = resolveCodexAcpPlatformPackage();
  return packageName ? resolveCodexAcpPlatformPackageSpecifier(packageName) : null;
}

function shouldPreferDirectCodexAcpPackage(): boolean {
  return process.platform === 'win32' || process.platform === 'linux';
}

function extractCodexPlatformPackageFromError(errorMessage: string): string | null {
  const packageMatch = errorMessage.match(/Cannot find package '(@zed-industries\/codex-acp-[^']+)'/i);
  if (packageMatch) {
    return packageMatch[1];
  }

  const binaryMatch = errorMessage.match(/Failed to locate (@zed-industries\/codex-acp-[^\s]+) binary/i);
  if (binaryMatch) {
    return binaryMatch[1];
  }

  return null;
}

function isCodexMetaPackageOptionalDependencyError(errorMessage: string): boolean {
  return (
    errorMessage.includes('optional dependency was not installed') ||
    (errorMessage.includes('@zed-industries/codex-acp') &&
      /ERR_MODULE_NOT_FOUND|Cannot find package|Failed to locate .* binary/i.test(errorMessage))
  );
}

// ── Environment helpers ─────────────────────────────────────────────

/**
 * Prepare a clean environment for ACP backends.
 * Removes Electron-injected NODE_OPTIONS, npm lifecycle vars, and other
 * env vars that interfere with child Node.js processes.
 */
export function prepareCleanEnv(): Record<string, string | undefined> {
  const cleanEnv = getEnhancedEnv();
  delete cleanEnv.NODE_OPTIONS;
  delete cleanEnv.NODE_INSPECT;
  delete cleanEnv.NODE_DEBUG;
  // Remove CLAUDECODE env var to prevent claude-agent-sdk from detecting
  // a nested session when AionUi itself is launched from Claude Code.
  delete cleanEnv.CLAUDECODE;
  // Strip npm lifecycle vars inherited from parent `npm start` process.
  // These (npm_config_*, npm_lifecycle_*, npm_package_*) can cause npx to
  // behave as if running inside an npm script, interfering with package
  // resolution and child process startup.
  for (const key of Object.keys(cleanEnv)) {
    if (key.startsWith('npm_')) {
      delete cleanEnv[key];
    }
  }
  return cleanEnv;
}


// ── Generic spawn config ────────────────────────────────────────────

/**
 * Creates spawn configuration for ACP CLI commands.
 * Exported for unit testing.
 *
 * @param cliPath - CLI command path (e.g., 'goose', 'npx @pkg/cli')
 * @param workingDir - Working directory for the spawned process
 * @param acpArgs - Arguments to enable ACP mode (e.g., ['acp'] for goose, ['--acp'] for auggie, ['exec','--output-format','acp'] for droid)
 * @param customEnv - Custom environment variables
 * @param prebuiltEnv - Pre-built env to use directly (skips internal getEnhancedEnv)
 */
export function createGenericSpawnConfig(
  cliPath: string,
  workingDir: string,
  acpArgs?: string[],
  customEnv?: Record<string, string>,
  prebuiltEnv?: Record<string, string>
) {
  const isWindows = process.platform === 'win32';
  // Use prebuilt env if provided (already cleaned by caller), otherwise build from shell env
  const env = prebuiltEnv ?? getEnhancedEnv(customEnv);

  // Default to --experimental-acp only if acpArgs is strictly undefined.
  // This allows passing an empty array [] to bypass default flags.
  const effectiveAcpArgs = acpArgs === undefined ? ['--experimental-acp'] : acpArgs;

  let spawnCommand: string;
  let spawnArgs: string[];

  if (cliPath.startsWith('npx ')) {
    // For "npx @package/name [extra-args]", split into command and arguments
    const parts = cliPath.split(' ').filter(Boolean);
    spawnCommand = 'bun';
    spawnArgs = ['x', '--bun', ...parts.slice(1), ...effectiveAcpArgs];
  } else if (isWindows) {
    // On Windows with shell: true, let cmd.exe handle the full command string.
    // This correctly supports paths with spaces (e.g., "C:\Program Files\agent.exe")
    // and commands with inline args (e.g., "goose acp" or "node path/to/file.js").
    //
    // chcp 65001: switch console to UTF-8 so stderr/stdout doesn't get garbled
    // (Chinese Windows defaults to CP936/GBK).
    // Quotes around cliPath handle paths with spaces (e.g. "C:\Program Files\agent.exe").
    spawnCommand = `chcp 65001 >nul && "${cliPath}"`;
    spawnArgs = effectiveAcpArgs;
  } else {
    // Unix: simple command or path. If cliPath contains spaces (e.g., "goose acp"),
    // parse into command + inline args.
    const parts = cliPath.split(/\s+/);
    spawnCommand = parts[0];
    spawnArgs = [...parts.slice(1), ...effectiveAcpArgs];
  }

  const options: SpawnOptions = {
    cwd: workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    shell: isWindows,
  };

  return {
    command: spawnCommand,
    args: spawnArgs,
    options,
  };
}

// ── Spawn result type ───────────────────────────────────────────────

export type SpawnResult = { child: ChildProcess; isDetached: boolean };

/** Return type for bun backend prepare functions (prepareClaude, prepareCodex, prepareCodebuddy). */
export type BunPrepareResult = {
  cleanEnv: Record<string, string | undefined>;
  bunCommand: string;
  extraArgs?: string[];
};

// ── Backend-specific connectors ─────────────────────────────────────

/**
 * Spawn a bun-based ACP backend package.
 * Used by Claude, Codex, and CodeBuddy connectors.
 */
export function spawnBunBackend(
  backend: string,
  bunPackage: string,
  bunCommand: string,
  cleanEnv: Record<string, string | undefined>,
  workingDir: string,
  isWindows: boolean,
  { extraArgs = [], detached = false }: { extraArgs?: string[]; detached?: boolean } = {}
): SpawnResult {
  const spawnArgs = ['x', '--bun', bunPackage, ...extraArgs];

  const spawnStart = Date.now();
  // detached: true creates a new session (setsid) so the child has no controlling terminal.
  // Required for backends (e.g. CodeBuddy) that write to /dev/tty — without it, SIGTTOU
  // would suspend the entire Electron process group and freeze the UI.
  // On Windows, prefix with chcp 65001 to switch console to UTF-8, preventing GBK garbling.
  const effectiveCommand = isWindows ? `chcp 65001 >nul && "${bunCommand}"` : bunCommand;
  const child = spawn(effectiveCommand, spawnArgs, {
    cwd: workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv,
    shell: isWindows,
    detached,
  });
  // Prevent the detached child from keeping the parent alive when the parent wants to exit normally.
  if (detached) {
    child.unref();
  }
  if (ACP_PERF_LOG) {
    console.log(`[ACP-PERF] ${backend}: process spawned ${Date.now() - spawnStart}ms`);
  }

  return { child, isDetached: detached };
}

/** Prepare clean env for Claude ACP bridge. */
function prepareClaude(): BunPrepareResult {
  const cleanEnv = prepareCleanEnv();
  return { cleanEnv, bunCommand: 'bun' };
}

/** Prepare clean env and run diagnostics for Codex ACP bridge. */
async function prepareCodex(codexAcpPackage: string = CODEX_ACP_NPX_PACKAGE): Promise<BunPrepareResult> {
  const cleanEnv = prepareCleanEnv();

  const codexCommand = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  const codexExecOptions = {
    env: cleanEnv,
    timeout: 5000,
    windowsHide: true,
    ...getWindowsShellExecutionOptions(),
  };
  const diagnostics: {
    bridgeVersion: string;
    bridgePackage: string;
    codexCliVersion: string;
    loginStatus: string;
    hasCodexApiKey: boolean;
    hasOpenAiApiKey: boolean;
    hasChatGptSession: boolean;
  } = {
    bridgeVersion: CODEX_ACP_BRIDGE_VERSION,
    bridgePackage: codexAcpPackage,
    codexCliVersion: 'unknown',
    loginStatus: 'unknown',
    hasCodexApiKey: Boolean(cleanEnv.CODEX_API_KEY),
    hasOpenAiApiKey: Boolean(cleanEnv.OPENAI_API_KEY),
    hasChatGptSession: false,
  };

  try {
    const { stdout } = await execFile(codexCommand, ['--version'], codexExecOptions);
    diagnostics.codexCliVersion = stdout.trim() || diagnostics.codexCliVersion;
  } catch (error) {
    mainWarn('[ACP codex]', 'Failed to read codex CLI version', error);
  }

  try {
    const { stdout } = await execFile(codexCommand, ['login', 'status'], codexExecOptions);
    diagnostics.loginStatus = stdout.trim() || diagnostics.loginStatus;
    diagnostics.hasChatGptSession = /chatgpt/i.test(diagnostics.loginStatus);
  } catch (error) {
    mainWarn('[ACP codex]', 'Failed to read codex login status', error);
  }

  mainLog('[ACP codex]', 'Runtime diagnostics', diagnostics);
  return { cleanEnv, bunCommand: 'bun' };
}

// Cached binary resolution is no longer needed with bundled bun.
// bun x uses its own global cache with stable paths; we don't need to
// scan npm's _npx directory for platform-specific binaries.

/** Prepare clean env and load MCP config for CodeBuddy. */
async function prepareCodebuddy(): Promise<BunPrepareResult> {
  const cleanEnv = prepareCleanEnv();

  // Load user's MCP config if available (~/.codebuddy/mcp.json)
  // CodeBuddy CLI in --acp mode does not auto-load mcp.json, so we pass it explicitly
  const mcpConfigPath = path.join(os.homedir(), '.codebuddy', 'mcp.json');
  const extraArgs: string[] = [];
  try {
    await fs.access(mcpConfigPath);
    extraArgs.push('--mcp-config', mcpConfigPath);
    mainLog('[ACP]', `Loading CodeBuddy MCP config from ${mcpConfigPath}`);
  } catch {
    mainWarn('[ACP]', 'No CodeBuddy MCP config found, starting without MCP servers');
  }

  return { cleanEnv, bunCommand: 'bun', extraArgs };
}

/**
 * Spawn a generic ACP backend with clean env.
 * Generic backends may be Node.js CLIs or native binaries; prepareCleanEnv()
 * removes Electron-inherited NODE_OPTIONS so they don't interfere with Node-based agents.
 */
export async function spawnGenericBackend(
  backend: string,
  cliPath: string,
  workingDir: string,
  acpArgs?: string[],
  customEnv?: Record<string, string>
): Promise<SpawnResult> {
  try {
    await fs.mkdir(workingDir, { recursive: true });
  } catch {
    // best-effort: if mkdir fails, let spawn report the actual error
  }

  const cleanEnv = prepareCleanEnv();
  if (customEnv) {
    Object.assign(cleanEnv, customEnv);
  }

  const spawnStart = Date.now();
  const detached = process.platform !== 'win32';
  const config = createGenericSpawnConfig(cliPath, workingDir, acpArgs, undefined, cleanEnv as Record<string, string>);
  const child = spawn(config.command, config.args, {
    ...config.options,
    detached,
  });
  if (detached) {
    child.unref();
  }
  if (ACP_PERF_LOG) console.log(`[ACP-PERF] connect: ${backend} process spawned ${Date.now() - spawnStart}ms`);

  return { child, isDetached: detached };
}

/** Callbacks for wiring a spawned child into the AcpConnection instance. */
export type BunConnectHooks = {
  /** Wire the spawned child into the connection (e.g. attach protocol handlers). */
  setup: (result: SpawnResult) => Promise<void>;
  /** Terminate a failed child before retrying. */
  cleanup: () => Promise<void>;
};

/**
 * Connect to a bun-based ACP backend.
 * bun x has stable caching and doesn't require --prefer-offline retry logic.
 */
async function connectBunBackend(config: {
  backend: string;
  bunPackage: string;
  prepareFn: () => BunPrepareResult | Promise<BunPrepareResult>;
  workingDir: string;
  /** Wire the spawned child into the connection (e.g. attach protocol handlers). */
  setup: (result: SpawnResult) => Promise<void>;
  /** Terminate a failed child before retrying. */
  cleanup: () => Promise<void>;
  extraArgs?: string[];
  detached?: boolean;
}): Promise<void> {
  const { backend, bunPackage, prepareFn, workingDir, setup } = config;

  const envStart = Date.now();
  const { cleanEnv, bunCommand, extraArgs: prepExtraArgs = [] } = await prepareFn();
  if (ACP_PERF_LOG) console.log(`[ACP-PERF] ${backend}: env prepared ${Date.now() - envStart}ms`);

  const isWindows = process.platform === 'win32';
  const opts = {
    extraArgs: [...(config.extraArgs ?? []), ...prepExtraArgs],
    detached: config.detached ?? false,
  };

  await setup(spawnBunBackend(backend, bunPackage, bunCommand, cleanEnv, workingDir, isWindows, opts));
}

// ── Exported per-backend connect functions ───────────────────────────

/** Connect to Claude ACP bridge via bundled bun. */
export function connectClaude(workingDir: string, hooks: BunConnectHooks): Promise<void> {
  return connectBunBackend({
    backend: 'claude',
    bunPackage: CLAUDE_ACP_NPX_PACKAGE,
    prepareFn: prepareClaude,
    workingDir,
    ...hooks,
    detached: process.platform !== 'win32',
  });
}

/** Connect to Codex ACP bridge via bundled bun. */
export function connectCodex(workingDir: string, hooks: BunConnectHooks): Promise<void> {
  return (async () => {
    const codexPlatformPackage = resolvePreferredCodexAcpPlatformPackage();
    const preferDirectPackage = codexPlatformPackage !== null && shouldPreferDirectCodexAcpPackage();
    const codexPackageCandidates = preferDirectPackage
      ? [codexPlatformPackage, CODEX_ACP_NPX_PACKAGE]
      : [CODEX_ACP_NPX_PACKAGE, ...(codexPlatformPackage ? [codexPlatformPackage] : [])];

    let lastError: Error | null = null;

    for (const [index, bunPackage] of codexPackageCandidates.entries()) {
      try {
        await connectBunBackend({
          backend: 'codex',
          bunPackage,
          prepareFn: () => prepareCodex(bunPackage),
          workingDir,
          ...hooks,
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const fallbackPackageName = extractCodexPlatformPackageFromError(lastError.message);
        const fallbackPackage = fallbackPackageName
          ? resolveCodexAcpPlatformPackageSpecifier(fallbackPackageName)
          : null;
        const canRetryWithPlatformPackage =
          index === 0 &&
          !preferDirectPackage &&
          codexPlatformPackage !== null &&
          bunPackage === CODEX_ACP_NPX_PACKAGE &&
          isCodexMetaPackageOptionalDependencyError(lastError.message);
        const hasRemainingCandidates = index < codexPackageCandidates.length - 1;

        await hooks.cleanup();

        if (canRetryWithPlatformPackage) {
          if (fallbackPackage && !codexPackageCandidates.includes(fallbackPackage)) {
            codexPackageCandidates.push(fallbackPackage);
          }

          mainWarn(
            '[ACP codex]',
            `Meta bridge package failed to install its platform binary, retrying with direct package: ${codexPlatformPackage}`,
            lastError.message
          );
          continue;
        }

        if (hasRemainingCandidates) {
          mainWarn(
            '[ACP codex]',
            `Bridge package failed, retrying alternate package: ${bunPackage}`,
            lastError.message
          );
          continue;
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error('Failed to start codex ACP bridge');
  })();
}

/** Connect to CodeBuddy ACP via bundled bun. */
export function connectCodebuddy(workingDir: string, hooks: BunConnectHooks): Promise<void> {
  return connectBunBackend({
    backend: 'codebuddy',
    bunPackage: CODEBUDDY_ACP_NPX_PACKAGE,
    prepareFn: prepareCodebuddy,
    workingDir,
    ...hooks,
    extraArgs: ['--acp'],
    detached: process.platform !== 'win32',
  });
}
