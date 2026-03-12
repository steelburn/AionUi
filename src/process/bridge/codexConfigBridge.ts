/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@/process/initStorage';
import { readCodexSandboxConfig, writeCodexSandboxMode, type CodexSandboxMode } from '@process/utils/codexConfig';

const DEFAULT_CODEX_SANDBOX_MODE: CodexSandboxMode = 'workspace-write';

export function initCodexConfigBridge(): void {
  ipcBridge.codexConfig.getSandboxMode.provider(async () => {
    const [storedConfig, runtimeConfig] = await Promise.all([ProcessConfig.get('codex.config'), readCodexSandboxConfig()]);
    const sandboxMode = runtimeConfig.sandboxMode || storedConfig?.sandboxMode || DEFAULT_CODEX_SANDBOX_MODE;

    if (storedConfig?.sandboxMode !== sandboxMode) {
      await ProcessConfig.set('codex.config', {
        ...storedConfig,
        sandboxMode,
      });
    }

    return {
      success: true,
      data: {
        sandboxMode,
        configPath: runtimeConfig.path,
        exists: runtimeConfig.exists,
      },
    };
  });

  ipcBridge.codexConfig.setSandboxMode.provider(async ({ sandboxMode }) => {
    const storedConfig = await ProcessConfig.get('codex.config');
    const runtimeConfig = await writeCodexSandboxMode(sandboxMode);

    await ProcessConfig.set('codex.config', {
      ...storedConfig,
      sandboxMode,
    });

    return {
      success: true,
      data: {
        sandboxMode,
        configPath: runtimeConfig.path,
        exists: runtimeConfig.exists,
      },
    };
  });
}
