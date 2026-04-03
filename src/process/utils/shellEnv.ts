/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell environment utilities for the main process.
 *
 * Loads environment variables from the user's login shell so that child
 * processes spawned by Electron (e.g. npx, codex, goose …) inherit the
 * correct PATH, SSL certificates, and authentication tokens — even when
 * the app is launched from Finder / launchd instead of a terminal.
 */

import { execFile, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

// Conditional import to avoid Electron dependency in worker processes
let appModule: typeof import('electron') | null = null;
try {
  appModule = require('electron');
} catch {
  // Running in worker process where electron is not available
}

/** Enable ACP performance diagnostics via ACP_PERF=1 */
const PERF_LOG = process.env.ACP_PERF === '1';

/**
 * Environment variables to inherit from user's shell.
 * These may not be available when Electron app starts from Finder/launchd.
 *
 * 需要从用户 shell 继承的环境变量。
 * 当 Electron 应用从 Finder/launchd 启动时，这些变量可能不可用。
 */
const SHELL_INHERITED_ENV_VARS = [
  'PATH', // Required for finding CLI tools (e.g., ~/.npm-global/bin, ~/.nvm/...)
  'NODE_EXTRA_CA_CERTS', // Custom CA certificates
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'ANTHROPIC_AUTH_TOKEN', // Claude authentication (#776)
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
] as const;

/** Cache for shell environment (loaded once per session) */
let cachedShellEnv: Record<string, string> | null = null;

/**
 * Load environment variables from user's login shell.
 * Captures variables set in .bashrc, .zshrc, .bash_profile, etc.
 *
 * 从用户的登录 shell 加载环境变量。
 * 捕获 .bashrc、.zshrc、.bash_profile 等配置中设置的变量。
 */
function loadShellEnvironment(): Record<string, string> {
  if (cachedShellEnv !== null) {
    return cachedShellEnv;
  }

  const startTime = Date.now();
  cachedShellEnv = {};

  // Skip on Windows - shell config loading not needed
  if (process.platform === 'win32') {
    if (PERF_LOG) console.log(`[ShellEnv] connect: shell env skipped (Windows) ${Date.now() - startTime}ms`);
    return cachedShellEnv;
  }

  try {
    const shell = process.env.SHELL || '/bin/bash';
    if (!path.isAbsolute(shell)) {
      console.warn('[ShellEnv] SHELL is not an absolute path, skipping shell env loading:', shell);
      return cachedShellEnv;
    }
    // Use -l (login) to load login shell configs (.bash_profile, .zprofile, etc.)
    // NOTE: Do NOT use -i (interactive) — interactive shells call tcsetpgrp() to
    // grab the terminal foreground process group and do not restore it on exit,
    // which prevents Ctrl+C from delivering SIGINT to the server process.
    const output = execFileSync(shell, ['-l', '-c', 'env'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: os.homedir() },
    });

    // Parse and capture only the variables we need
    for (const line of output.split('\n')) {
      const eqIndex = line.indexOf('=');
      if (eqIndex > 0) {
        const key = line.substring(0, eqIndex);
        const value = line.substring(eqIndex + 1);
        if (SHELL_INHERITED_ENV_VARS.includes(key as (typeof SHELL_INHERITED_ENV_VARS)[number])) {
          cachedShellEnv[key] = value;
        }
      }
    }

    if (PERF_LOG && cachedShellEnv.PATH) {
      console.log('[ShellEnv] Loaded PATH from shell:', cachedShellEnv.PATH.substring(0, 100) + '...');
    }
  } catch (error) {
    // Silent fail - shell environment loading is best-effort
    console.warn(
      '[ShellEnv] Failed to load shell environment:',
      error instanceof Error ? error.message : String(error)
    );
  }

  if (PERF_LOG) console.log(`[ShellEnv] connect: shell env loaded ${Date.now() - startTime}ms`);
  return cachedShellEnv;
}

/**
 * Async version of loadShellEnvironment() for preloading at app startup.
 * Uses async exec instead of execSync to avoid blocking the main process.
 *
 * 异步版本的 loadShellEnvironment()，用于应用启动时预加载。
 * 使用异步 exec 替代 execSync，避免阻塞主进程。
 */
export async function loadShellEnvironmentAsync(): Promise<Record<string, string>> {
  if (cachedShellEnv !== null) {
    return cachedShellEnv;
  }

  if (process.platform === 'win32') {
    cachedShellEnv = {};
    return cachedShellEnv;
  }

  const startTime = Date.now();

  try {
    const shell = process.env.SHELL || '/bin/bash';
    if (!path.isAbsolute(shell)) {
      console.warn('[ShellEnv] SHELL is not an absolute path, skipping async shell env loading:', shell);
      cachedShellEnv = {};
      return cachedShellEnv;
    }

    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        shell,
        ['-l', '-c', 'env'],
        {
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env, HOME: os.homedir() },
        },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });

    const env: Record<string, string> = {};
    for (const line of output.split('\n')) {
      const eqIndex = line.indexOf('=');
      if (eqIndex > 0) {
        const key = line.substring(0, eqIndex);
        const value = line.substring(eqIndex + 1);
        if (SHELL_INHERITED_ENV_VARS.includes(key as (typeof SHELL_INHERITED_ENV_VARS)[number])) {
          env[key] = value;
        }
      }
    }

    cachedShellEnv = env;

    if (PERF_LOG && cachedShellEnv.PATH) {
      console.log('[ShellEnv] Preloaded PATH from shell:', cachedShellEnv.PATH.substring(0, 100) + '...');
    }
    if (PERF_LOG) console.log(`[ShellEnv] preload: shell env async loaded ${Date.now() - startTime}ms`);
  } catch (error) {
    cachedShellEnv = {};
    console.warn(
      '[ShellEnv] Failed to async load shell environment:',
      error instanceof Error ? error.message : String(error)
    );
  }

  return cachedShellEnv;
}

/**
 * Merge two PATH strings, removing duplicates while preserving order.
 *
 * 合并两个 PATH 字符串，去重并保持顺序。
 */
export function mergePaths(path1?: string, path2?: string): string {
  const separator = process.platform === 'win32' ? ';' : ':';
  const paths1 = path1?.split(separator).filter(Boolean) || [];
  const paths2 = path2?.split(separator).filter(Boolean) || [];

  const seen = new Set<string>();
  const merged: string[] = [];

  // Add paths from first source (process.env, typically from terminal)
  for (const p of paths1) {
    if (!seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }

  // Add paths from second source (shell env, for Finder/launchd launches)
  for (const p of paths2) {
    if (!seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }

  return merged.join(separator);
}

/**
 * Get the directory containing the bundled bun binary.
 * Returns the path to `resources/bundled-bun/<platform>-<arch>/` which contains
 * the bun executable. Returns null if the directory doesn't exist.
 */
export function getBundledBunDir(): string | null {
  const isPackaged = !!process.resourcesPath || (appModule && appModule.app && appModule.app.isPackaged);
  const resourcesPath = isPackaged
    ? process.resourcesPath || ''
    : path.join(process.cwd(), 'resources');
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch;
  const bunDir = path.join(resourcesPath, 'bundled-bun', `${platform}-${arch}`);
  return existsSync(bunDir) ? bunDir : null;
}

/**
 * Get the path to the user's bun global bin directory.
 * - macOS/Linux: ~/.bun/bin
 * - Windows: %USERPROFILE%\.bun\bin
 */
export function getBunGlobalBinDir(): string {
  return path.join(os.homedir(), '.bun', 'bin');
}

/**
 * Scan well-known POSIX tool installation directories and return any that exist
 * but are not already in the current PATH.
 */
function getPosixExtraToolPaths(): string[] {
  if (process.platform === 'win32') return [];
  const homeDir = os.homedir();
  const currentPath = process.env.PATH || '';
  const candidates = [
    getBunGlobalBinDir(),
    path.join(homeDir, '.cargo', 'bin'),
    path.join(homeDir, 'go', 'bin'),
    path.join(homeDir, '.deno', 'bin'),
    path.join(homeDir, '.local', 'bin'),
  ];
  return candidates.filter((p) => existsSync(p) && !currentPath.includes(p));
}

/**
 * Scan well-known Windows tool installation directories and return any that exist
 * but are not already in the current PATH.
 *
 * On Windows, apps launched via shortcuts or the Start menu may miss user-local
 * tool paths (e.g. npm global packages, nvm-windows, Scoop, Volta) that are
 * added to PATH only when a shell session starts.
 *
 * 扫描 Windows 常见工具安装目录，返回当前 PATH 中缺少的路径。
 */
function getWindowsExtraToolPaths(): string[] {
  if (process.platform !== 'win32') return [];

  const homeDir = os.homedir();
  const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const currentPath = process.env.PATH || '';

  const candidates = [
    // Bun global bin directory
    getBunGlobalBinDir(),
    // npm global packages (most common - installed with Node.js)
    path.join(appData, 'npm'),
    // Node.js official installer
    path.join(programFiles, 'nodejs'),
    // nvm-windows: %APPDATA%\nvm (the active version symlink lives here)
    process.env.NVM_HOME || path.join(appData, 'nvm'),
    // nvm-windows symlink directory (where the active node version is linked)
    process.env.NVM_SYMLINK || path.join(programFiles, 'nodejs'),
    // fnm-windows: FNM_MULTISHELL_PATH is set per-shell session
    ...(process.env.FNM_MULTISHELL_PATH ? [process.env.FNM_MULTISHELL_PATH] : []),
    path.join(localAppData, 'fnm_multishells'),
    // Volta: cross-platform Node version manager
    path.join(homeDir, '.volta', 'bin'),
    // Scoop: Windows package manager
    process.env.SCOOP ? path.join(process.env.SCOOP, 'shims') : path.join(homeDir, 'scoop', 'shims'),
    // pnpm global store shims
    path.join(localAppData, 'pnpm'),
    // Chocolatey
    path.join(process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey', 'bin'),
    // Git for Windows — provides cygpath, git, and POSIX utilities.
    // Claude Code's agent-sdk calls `cygpath` internally on Windows; if this
    // directory is missing from PATH the SDK fails with "cygpath: not found".
    path.join(programFiles, 'Git', 'cmd'),
    path.join(programFiles, 'Git', 'bin'),
    path.join(programFiles, 'Git', 'usr', 'bin'),
    path.join(programFilesX86, 'Git', 'cmd'),
    path.join(programFilesX86, 'Git', 'bin'),
    path.join(programFilesX86, 'Git', 'usr', 'bin'),
    // Cygwin — alternative source for cygpath
    'C:\\cygwin64\\bin',
    'C:\\cygwin\\bin',
  ];

  return candidates.filter((p) => existsSync(p) && !currentPath.includes(p));
}

/**
 * Get enhanced environment variables by merging shell env with process.env.
 * For PATH, we merge both sources to ensure CLI tools are found regardless of
 * how the app was started (terminal vs Finder/launchd).
 *
 * On Windows, also appends well-known tool paths (npm globals, nvm, volta, scoop)
 * that may not be present when Electron starts from a shortcut.
 *
 * 获取增强的环境变量，合并 shell 环境变量和 process.env。
 * 对于 PATH，合并两个来源以确保无论应用如何启动都能找到 CLI 工具。
 * 在 Windows 上，还会追加常见工具路径（npm 全局包、nvm、volta、scoop 等）。
 */
export function getEnhancedEnv(customEnv?: Record<string, string>): Record<string, string> {
  const shellEnv = loadShellEnvironment();
  const separator = process.platform === 'win32' ? ';' : ':';

  // Merge PATH from both sources (shell env may miss nvm/fnm paths in dev mode)
  // 合并两个来源的 PATH（开发模式下 shell 环境可能缺少 nvm/fnm 路径）
  let mergedPath = mergePaths(process.env.PATH, shellEnv.PATH);

  // On Windows, also append any discovered tool paths not already in PATH
  // 在 Windows 上，追加未在 PATH 中的常见工具路径
  const winExtraPaths = getWindowsExtraToolPaths();
  if (winExtraPaths.length > 0) {
    mergedPath = mergePaths(mergedPath, winExtraPaths.join(';'));
  }

  // On macOS/Linux, append well-known global bin directories (bun, cargo, go, etc.)
  const posixExtraPaths = getPosixExtraToolPaths();
  if (posixExtraPaths.length > 0) {
    mergedPath = mergePaths(mergedPath, posixExtraPaths.join(':'));
  }

  // Prepend bundled bun directory (highest priority)
  const bundledBunDir = getBundledBunDir();
  if (bundledBunDir) {
    mergedPath = `${bundledBunDir}${separator}${mergedPath}`;
  }

  return {
    ...process.env,
    ...shellEnv,
    ...customEnv,
    // PATH must be set after spreading to ensure merged value is used
    // When customEnv.PATH exists, merge it with the already merged path (fix: don't override)
    PATH: customEnv?.PATH ? mergePaths(mergedPath, customEnv.PATH) : mergedPath,
  } as Record<string, string>;
}


/**
 * Parse `env` command output into a key-value map.
 * Handles multi-line values correctly by detecting new variable starts
 * with the pattern: KEY=value (KEY must match [A-Za-z_][A-Za-z0-9_]*).
 */
function parseEnvOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  const varStartRe = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)/;
  let currentKey: string | null = null;
  let currentValue: string | null = null;

  for (const line of output.split('\n')) {
    const match = varStartRe.exec(line);
    if (match) {
      // Flush previous variable
      if (currentKey !== null) {
        result[currentKey] = currentValue!;
      }
      currentKey = match[1];
      currentValue = match[2];
    } else if (currentKey !== null) {
      // Continuation of a multi-line value
      currentValue += '\n' + line;
    }
  }
  // Flush last variable
  if (currentKey !== null) {
    result[currentKey] = currentValue!;
  }
  return result;
}

export function getWindowsShellExecutionOptions(): {
  shell?: boolean;
  windowsHide?: boolean;
} {
  return process.platform === 'win32' ? { shell: true, windowsHide: true } : {};
}


/** Separate cache for full (unfiltered) shell environment */
let cachedFullShellEnv: Record<string, string> | null = null;

/**
 * Load ALL environment variables from user's login shell (no whitelist).
 * Used by agents (e.g. Codex) that need the complete shell env.
 * Shares the same shell invocation approach as loadShellEnvironment()
 * but caches separately and does not filter.
 */
export function loadFullShellEnvironment(): Record<string, string> {
  if (cachedFullShellEnv !== null) return cachedFullShellEnv;
  cachedFullShellEnv = {};
  if (process.platform === 'win32') return cachedFullShellEnv;

  try {
    const shell = process.env.SHELL || '/bin/bash';
    if (!path.isAbsolute(shell)) return cachedFullShellEnv;

    const output = execFileSync(shell, ['-l', '-c', 'env'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: os.homedir() },
    });

    cachedFullShellEnv = parseEnvOutput(output);
    const varCount = Object.keys(cachedFullShellEnv).length;
    const shellPath = cachedFullShellEnv.PATH || '(empty)';
    console.log(`[ShellEnv] Full shell env loaded: ${varCount} vars, shell=${shell}`);
    console.log(`[ShellEnv] Shell PATH (first 200 chars): ${shellPath.substring(0, 200)}`);
  } catch (error) {
    console.warn('[ShellEnv] Failed to load full shell env:', error instanceof Error ? error.message : String(error));
  }
  return cachedFullShellEnv;
}

/**
 * Log a one-time environment diagnostics snapshot.
 * Called once at app startup; output goes to electron-log file via console,
 * so users can share the log file for debugging (#1157).
 */
export function logEnvironmentDiagnostics(): void {
  const isWindows = process.platform === 'win32';
  const tag = '[ShellEnv-Diag]';

  console.log(`${tag} platform=${process.platform}, arch=${process.arch}, node=${process.version}`);
  console.log(`${tag} process.env.PATH (first 300): ${(process.env.PATH || '(empty)').substring(0, 300)}`);

  if (!isWindows) return;

  // Windows-specific diagnostics for cygpath / Git / tool discovery
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const gitUsrBin = path.join(programFiles, 'Git', 'usr', 'bin');
  const cygpathPath = path.join(gitUsrBin, 'cygpath.exe');

  console.log(`${tag} APPDATA=${process.env.APPDATA || '(unset)'}`);
  console.log(`${tag} LOCALAPPDATA=${process.env.LOCALAPPDATA || '(unset)'}`);
  console.log(`${tag} ProgramFiles=${programFiles}`);
  console.log(`${tag} Git usr/bin dir: ${existsSync(gitUsrBin) ? 'EXISTS' : 'MISSING'} (${gitUsrBin})`);
  console.log(`${tag} cygpath.exe: ${existsSync(cygpathPath) ? 'EXISTS' : 'MISSING'} (${cygpathPath})`);

  // Report which extra paths will be appended
  const enhanced = getEnhancedEnv();
  console.log(`${tag} Enhanced PATH (first 500): ${enhanced.PATH.substring(0, 500)}`);
}

