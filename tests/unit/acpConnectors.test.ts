/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="node" />

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: null, result: { stdout: string; stderr: string }) => void
    ) => {
      cb(null, { stdout: '', stderr: '' });
    }
  ),
  execFileSync: vi.fn(() => 'v20.10.0\n'),
}));

vi.mock('@process/utils/shellEnv', () => ({
  findSuitableNodeBin: vi.fn(() => null),
  getEnhancedEnv: vi.fn(() => ({ PATH: '/usr/bin' })),
  getWindowsShellExecutionOptions: vi.fn(() =>
    process.platform === 'win32' ? { shell: true, windowsHide: true } : {}
  ),
  resolveNpxPath: vi.fn(() => 'npx'),
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
}));

import { execFileSync, spawn } from 'child_process';
import { connectCodex, createGenericSpawnConfig, spawnNpxBackend } from '../../src/agent/acp/acpConnectors';

const mockExecFileSync = vi.mocked(execFileSync);
const mockSpawn = vi.mocked(spawn);

describe('spawnNpxBackend - Windows UTF-8 fix', () => {
  const mockChild = { unref: vi.fn() };

  beforeEach(() => {
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses npxCommand directly on non-Windows (no chcp prefix)', () => {
    spawnNpxBackend('claude', '@pkg/cli@1.0.0', '/usr/local/bin/npx', {}, '/cwd', false, false);

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/local/bin/npx',
      expect.any(Array),
      expect.objectContaining({ shell: false })
    );
  });

  it('prefixes command with chcp 65001 on Windows to enable UTF-8', () => {
    spawnNpxBackend('claude', '@pkg/cli@1.0.0', 'npx.cmd', {}, '/cwd', true, false);

    const [command, , options] = mockSpawn.mock.calls[0];
    expect(command).toMatch(/^chcp 65001 >nul && /);
    expect(options).toMatchObject({ shell: true });
  });

  it('quotes npxCommand on Windows to handle paths with spaces', () => {
    const npxWithSpaces = 'C:\\Program Files\\nodejs\\npx.cmd';
    spawnNpxBackend('claude', '@pkg/cli@1.0.0', npxWithSpaces, {}, '/cwd', true, false);

    const [command] = mockSpawn.mock.calls[0];
    expect(command).toBe(`chcp 65001 >nul && "${npxWithSpaces}"`);
  });

  it('passes --yes and package name as spawn args', () => {
    spawnNpxBackend('claude', '@pkg/cli@1.0.0', 'npx', {}, '/cwd', false, false);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toContain('--yes');
    expect(args).toContain('@pkg/cli@1.0.0');
  });

  it('includes --prefer-offline when preferOffline is true', () => {
    spawnNpxBackend('claude', '@pkg/cli@1.0.0', 'npx', {}, '/cwd', false, true);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toContain('--prefer-offline');
  });

  it('omits --prefer-offline when preferOffline is false', () => {
    spawnNpxBackend('claude', '@pkg/cli@1.0.0', 'npx', {}, '/cwd', false, false);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).not.toContain('--prefer-offline');
  });

  it('calls child.unref() when detached is true', () => {
    spawnNpxBackend('claude', '@pkg/cli@1.0.0', 'npx', {}, '/cwd', false, false, { detached: true });

    expect(mockChild.unref).toHaveBeenCalled();
  });

  it('does not call child.unref() when detached is false', () => {
    spawnNpxBackend('claude', '@pkg/cli@1.0.0', 'npx', {}, '/cwd', false, false, { detached: false });

    expect(mockChild.unref).not.toHaveBeenCalled();
  });
});

describe('createGenericSpawnConfig - Windows path handling', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  const setWindowsPlatform = () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  };

  const setLinuxPlatform = () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  };

  it('returns plain command on non-Windows', () => {
    setLinuxPlatform();
    const config = createGenericSpawnConfig('goose', '/cwd', ['acp'], undefined, { PATH: '/usr/bin' });

    expect(config.command).toBe('goose');
    expect(config.args).toEqual(['acp']);
    expect(config.options).toMatchObject({ shell: false });
  });

  it('wraps cliPath with chcp 65001 and quotes on Windows', () => {
    setWindowsPlatform();
    const config = createGenericSpawnConfig('goose', 'C:\\cwd', ['acp'], undefined, { PATH: 'C:\\Windows' });

    expect(config.command).toBe('chcp 65001 >nul && "goose"');
    expect(config.options).toMatchObject({ shell: true });
  });

  it('handles Windows path with spaces using quotes', () => {
    setWindowsPlatform();
    const config = createGenericSpawnConfig('C:\\Program Files\\agent\\agent.exe', 'C:\\cwd', [], undefined, {
      PATH: 'C:\\Windows',
    });

    expect(config.command).toBe('chcp 65001 >nul && "C:\\Program Files\\agent\\agent.exe"');
  });

  it('splits npx package into command and args (no chcp prefix for npx path)', () => {
    const config = createGenericSpawnConfig('npx @pkg/cli', '/cwd', ['--acp'], undefined, { PATH: '/usr/bin' });

    expect(config.command).toBe('npx');
    expect(config.args).toContain('@pkg/cli');
    expect(config.args).toContain('--acp');
  });
});

describe('connectCodex - Windows package selection', () => {
  let originalPlatform: PropertyDescriptor | undefined;
  let originalArch: PropertyDescriptor | undefined;
  const mockChild = { unref: vi.fn() };

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    originalArch = Object.getOwnPropertyDescriptor(process, 'arch');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    mockExecFileSync.mockImplementation((file) => {
      if (file === 'node.exe') {
        return 'v20.10.0\n' as never;
      }
      return 'v20.0.0\n' as never;
    });
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    if (originalArch) {
      Object.defineProperty(process, 'arch', originalArch);
    }
    vi.clearAllMocks();
  });

  it('uses the published Windows platform package instead of the broken meta package', async () => {
    const hooks = {
      setup: vi.fn(async () => {}),
      cleanup: vi.fn(async () => {}),
    };

    await connectCodex('C:\\cwd', hooks);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toContain('@zed-industries/codex-acp-win32-x64@0.9.5');
  });
});
