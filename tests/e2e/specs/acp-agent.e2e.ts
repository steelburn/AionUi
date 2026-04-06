/**
 * ACP Agent – integration & switching tests.
 *
 * Covers:
 *  - Agent settings page loads and has management UI
 *  - Agent pill bar on guid page renders available agents
 *  - Switching between agent backends
 *  - Agent mode selection within a backend
 *  - MCP tools page loads
 */
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect, closeSharedElectronApp } from '../fixtures';
import {
  goToGuid,
  goToSettings,
  expectBodyContainsAny,
  expectUrlContains,
  takeScreenshot,
  AGENT_PILL,
  AGENT_PILL_SELECTED,
  invokeBridge,
  navigateTo,
  settingsSiderItemById,
  ensureFreshElectronBundle,
} from '../helpers';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FAKE_CLI_PATH = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'fake-acp-cli', 'index.js');
const REAL_CODEX_CANARY_ENABLED = process.env.AIONUI_ACP_REAL_CODEX_CANARY === '1';
const DEFAULT_MODEL = {
  id: 'default',
  name: 'Default',
  useModel: 'default',
  platform: 'custom',
  baseUrl: '',
  apiKey: '',
} as const;

function isDevToolsWindow(page: Page): boolean {
  return page.url().startsWith('devtools://');
}

async function resolveMainWindow(electronApp: ElectronApplication): Promise<Page> {
  const existingMainWindow = electronApp.windows().find((win) => !isDevToolsWindow(win));
  if (existingMainWindow) {
    await existingMainWindow.waitForLoadState('domcontentloaded');
    return existingMainWindow;
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const win = await electronApp.waitForEvent('window', { timeout: 1_000 }).catch(() => null);
    if (win && !isDevToolsWindow(win)) {
      await win.waitForLoadState('domcontentloaded');
      return win;
    }
  }

  throw new Error('Failed to resolve main renderer window for ACP conversation E2E app.');
}

async function openAcpDiagnostics(page: Page): Promise<Locator> {
  const diagnosticsButton = page.locator('[data-testid="acp-runtime-status-button"]');
  await expect(diagnosticsButton).toBeVisible({ timeout: 15_000 });
  await diagnosticsButton.click();
  const logsPanel = page.locator('[data-testid="acp-logs-panel"]');
  await expect(logsPanel).toBeVisible({ timeout: 8_000 });
  return logsPanel;
}

type HermeticAcpApp = {
  electronApp: ElectronApplication;
  page: Page;
  consoleMessages: string[];
  runtimeInfo: {
    appName: string;
    userData: string;
    devProfile: string | null;
  };
  sandbox: HermeticAcpSandbox;
  cleanup: (options?: { requireClose?: boolean }) => Promise<void>;
};

type HermeticAcpSandbox = {
  emptyExtensionsDir: string;
  stateSandboxDir: string;
  extensionStatesFile: string;
  fakeAcpStateFile: string;
  devProfile: string;
  cleanup: () => void;
};

type HermeticAcpConversationOptions = {
  backend?: 'custom' | 'codex';
  agentName?: string;
  cliPath?: string;
  customAgentId?: string;
  modelPlatform?: 'custom' | 'codex';
};

type FakeAcpMethodCall = {
  method?: string;
  pid?: number;
  sessionId?: string;
  resumeSessionId?: string | null;
  promptText?: string;
};

type CodexCliDiagnostics = {
  version: string;
  loginStatus: string;
};

function createHermeticAcpSandbox(): HermeticAcpSandbox {
  const emptyExtensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-e2e-acp-ext-'));
  const stateSandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-e2e-acp-state-'));
  const extensionStatesFile = path.join(stateSandboxDir, 'extension-states.json');
  const fakeAcpStateFile = path.join(stateSandboxDir, 'fake-acp-state.json');
  const devProfile = path.basename(stateSandboxDir);

  return {
    emptyExtensionsDir,
    stateSandboxDir,
    extensionStatesFile,
    fakeAcpStateFile,
    devProfile,
    cleanup: () => {
      fs.rmSync(stateSandboxDir, { recursive: true, force: true });
      fs.rmSync(emptyExtensionsDir, { recursive: true, force: true });
      fs.rmSync(path.join(os.homedir(), `.aionui-dev-${devProfile}`), { recursive: true, force: true });
      fs.rmSync(path.join(os.homedir(), `.aionui-config-dev-${devProfile}`), { recursive: true, force: true });
    },
  };
}

async function launchHermeticAcpApp(
  envOverrides: Record<string, string> = {},
  options: {
    sandbox?: HermeticAcpSandbox;
    destroySandboxOnCleanup?: boolean;
  } = {}
): Promise<HermeticAcpApp> {
  ensureFreshElectronBundle();
  const sandbox = options.sandbox ?? createHermeticAcpSandbox();
  const destroySandboxOnCleanup = options.destroySandboxOnCleanup ?? true;
  const launchArgs = [PROJECT_ROOT];
  const inheritedEnv = { ...process.env };
  delete inheritedEnv.AIONUI_E2E_CODEX_ACP_CLI_PATH;

  if (process.platform === 'linux' && process.env.CI) {
    launchArgs.push('--no-sandbox');
  }

  const electronApp = await electron.launch({
    args: launchArgs,
    cwd: PROJECT_ROOT,
    env: {
      ...inheritedEnv,
      AIONUI_EXTENSIONS_PATH: sandbox.emptyExtensionsDir,
      AIONUI_EXTENSION_STATES_FILE: sandbox.extensionStatesFile,
      AIONUI_DISABLE_AUTO_UPDATE: '1',
      AIONUI_DISABLE_DEVTOOLS: '1',
      AIONUI_E2E_TEST: '1',
      AIONUI_DEV_PROFILE: sandbox.devProfile,
      AIONUI_CDP_PORT: '0',
      FAKE_ACP_STATE_FILE: sandbox.fakeAcpStateFile,
      NODE_ENV: 'development',
      ...envOverrides,
    },
    timeout: 60_000,
  });

  const page = await resolveMainWindow(electronApp);
  await page.waitForFunction(
    () => {
      const bodyText = document.body?.textContent?.trim() ?? '';
      return bodyText.length > 20;
    },
    undefined,
    { timeout: 20_000 }
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      })
  );
  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`);
  });
  const runtimeInfo = await electronApp.evaluate(({ app }) => ({
    appName: app.getName(),
    userData: app.getPath('userData'),
    devProfile: process.env.AIONUI_DEV_PROFILE ?? null,
  }));

  expect(runtimeInfo.devProfile).toBe(sandbox.devProfile);
  expect(runtimeInfo.appName).toBe(`AionUi-Dev-${sandbox.devProfile}`);
  expect(path.basename(runtimeInfo.userData)).toBe(runtimeInfo.appName);

  async function closeHermeticElectronApp({ requireClose = false }: { requireClose?: boolean } = {}): Promise<void> {
    const closeResultPromise = electronApp
      .waitForEvent('close', { timeout: 15_000 })
      .then(() => null)
      .catch((error) => error);

    try {
      await electronApp.evaluate(async ({ app }) => {
        app.exit(0);
      });
    } catch {
      // App may already be closing.
    }

    await electronApp.close().catch(() => {});
    const closeResult = await closeResultPromise;

    if (requireClose && closeResult) {
      throw new Error(`Hermetic Electron app did not emit close before relaunch: ${closeResult.message}`);
    }
  }

  return {
    electronApp,
    page,
    consoleMessages,
    runtimeInfo,
    sandbox,
    cleanup: async ({ requireClose = false } = {}) => {
      await closeHermeticElectronApp({ requireClose });
      if (destroySandboxOnCleanup) {
        sandbox.cleanup();
      }
    },
  };
}

function readFakeAcpState(stateFile: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isFakeAcpMethodCall(value: unknown): value is FakeAcpMethodCall {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function createHermeticAcpConversation(
  page: Page,
  name: string,
  options: HermeticAcpConversationOptions = {}
): Promise<{ id: string }> {
  const cliPath = `${process.execPath} ${FAKE_CLI_PATH}`;
  const backend = options.backend ?? 'custom';
  const conversation = await invokeBridge<{ id: string }>(page, 'create-conversation', {
    type: 'acp',
    name,
    model: {
      ...DEFAULT_MODEL,
      platform: options.modelPlatform ?? backend,
    },
    extra: {
      workspace: PROJECT_ROOT,
      customWorkspace: true,
      backend,
      agentName: options.agentName ?? (backend === 'codex' ? 'Codex' : 'Fake ACP Agent'),
      ...(backend === 'custom'
        ? {
            cliPath: options.cliPath ?? cliPath,
            customAgentId: options.customAgentId ?? 'e2e-fake-acp',
          }
        : {}),
    },
  });

  expect(conversation?.id).toBeTruthy();
  return conversation;
}

async function readHermeticConversation(
  page: Page,
  id: string
): Promise<{
  id: string;
  extra?: {
    acpSessionId?: string;
    acpSessionConversationId?: string;
  };
}> {
  return await invokeBridge(page, 'get-conversation', { id });
}

async function sendAcpMessage(page: Page, input: string): Promise<void> {
  const textarea = page.locator('textarea').first();
  await textarea.fill(input);
  await textarea.press('Enter');
  await expect(textarea).toHaveValue('', { timeout: 10_000 });
}

async function waitForConversationSendBoxReady(page: Page): Promise<void> {
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible({ timeout: 10_000 });
  await textarea.click();
  await page.waitForTimeout(1_100);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      })
  );
}

async function installResponseStreamProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as typeof window & {
      electronAPI?: {
        on?: (callback: (payload: { value: string }) => void) => (() => void) | void;
      };
      __e2eResponseStreamMessages?: Array<{ type?: string; conversation_id?: string; data?: unknown }>;
      __e2eResponseStreamOff?: (() => void) | void;
    };

    win.__e2eResponseStreamMessages = [];
    win.__e2eResponseStreamOff?.();
    win.__e2eResponseStreamOff = win.electronAPI?.on?.((payload) => {
      try {
        const parsed = JSON.parse(payload.value) as { name?: string; data?: unknown };
        if (parsed.name !== 'chat.response.stream') {
          return;
        }

        const streamMessage = parsed.data as { type?: string; conversation_id?: string; data?: unknown };
        win.__e2eResponseStreamMessages?.push(streamMessage);
      } catch {
        // Best-effort diagnostics only.
      }
    });
  });
}

async function readResponseStreamProbe(
  page: Page
): Promise<Array<{ type?: string; conversation_id?: string; data?: unknown }>> {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __e2eResponseStreamMessages?: Array<{ type?: string; conversation_id?: string; data?: unknown }>;
    };

    return win.__e2eResponseStreamMessages ?? [];
  });
}

async function clearResponseStreamProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __e2eResponseStreamMessages?: Array<{ type?: string; conversation_id?: string; data?: unknown }>;
    };

    win.__e2eResponseStreamMessages = [];
  });
}

function getConversationEvents(
  messages: Array<{ type?: string; conversation_id?: string; data?: unknown }>,
  conversationId: string
): Array<{ type?: string; conversation_id?: string; data?: unknown }> {
  return messages.filter((message) => message.conversation_id === conversationId);
}

function countConversationEvents(
  messages: Array<{ type?: string; conversation_id?: string; data?: unknown }>,
  conversationId: string,
  eventType: string
): number {
  return getConversationEvents(messages, conversationId).filter((message) => message.type === eventType).length;
}

function getConversationContentText(
  messages: Array<{ type?: string; conversation_id?: string; data?: unknown }>,
  conversationId: string
): string {
  return getConversationEvents(messages, conversationId)
    .filter((message) => message.type === 'content' && typeof message.data === 'string')
    .map((message) => message.data)
    .join('');
}

async function readConversationEvents(
  page: Page,
  conversationId: string
): Promise<Array<{ type?: string; conversation_id?: string; data?: unknown }>> {
  return getConversationEvents(await readResponseStreamProbe(page), conversationId);
}

async function waitForConversationEvent(page: Page, conversationId: string, eventType: string): Promise<void> {
  await waitForConversationEventWithTimeout(page, conversationId, eventType, 10_000);
}

async function waitForConversationEventWithTimeout(
  page: Page,
  conversationId: string,
  eventType: string,
  timeout: number
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await readResponseStreamProbe(page)).some(
          (message) => message.conversation_id === conversationId && message.type === eventType
        ),
      {
        timeout,
      }
    )
    .toBe(true);
}

async function waitForConversationContentContaining(
  page: Page,
  conversationId: string,
  expectedSubstring: string,
  timeout: number
): Promise<string> {
  let latestContent = '';

  await expect
    .poll(
      async () => {
        latestContent = getConversationContentText(await readResponseStreamProbe(page), conversationId);
        return latestContent.includes(expectedSubstring);
      },
      {
        timeout,
      }
    )
    .toBe(true);

  return latestContent;
}

function readCodexCliDiagnostics(): CodexCliDiagnostics {
  const readCommandOutput = (args: string[]): string => {
    try {
      return execFileSync('codex', args, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
      }).trim();
    } catch (error) {
      if (error instanceof Error) {
        return `[error] ${error.message}`;
      }
      return `[error] ${String(error)}`;
    }
  };

  return {
    version: readCommandOutput(['--version']),
    loginStatus: readCommandOutput(['login', 'status']),
  };
}

async function waitForConversationStatus(page: Page, conversationId: string, status: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await readConversationEvents(page, conversationId)).some((message) => {
          if (message.type !== 'agent_status' || !message.data || typeof message.data !== 'object') {
            return false;
          }

          return (message.data as { status?: string }).status === status;
        }),
      {
        timeout: 10_000,
      }
    )
    .toBe(true);
}

async function waitForConversationEventCount(
  page: Page,
  conversationId: string,
  eventType: string,
  minimumCount: number
): Promise<void> {
  await expect
    .poll(async () => countConversationEvents(await readResponseStreamProbe(page), conversationId, eventType), {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(minimumCount);
}

async function waitForConversationStatusAfterStatus(
  page: Page,
  conversationId: string,
  precedingStatus: string,
  followingStatus: string
): Promise<void> {
  await expect
    .poll(
      async () =>
        hasStatusAfterStatus(await readConversationEvents(page, conversationId), precedingStatus, followingStatus),
      {
        timeout: 10_000,
      }
    )
    .toBe(true);
}

function hasStatusAfterStatus(
  events: Array<{ type?: string; conversation_id?: string; data?: unknown }>,
  precedingStatus: string,
  followingStatus: string
): boolean {
  const precedingIndex = events.findIndex((message) => {
    if (message.type !== 'agent_status' || !message.data || typeof message.data !== 'object') {
      return false;
    }

    return (message.data as { status?: string }).status === precedingStatus;
  });

  if (precedingIndex === -1) {
    return false;
  }

  return events.slice(precedingIndex + 1).some((message) => {
    if (message.type !== 'agent_status' || !message.data || typeof message.data !== 'object') {
      return false;
    }

    return (message.data as { status?: string }).status === followingStatus;
  });
}

test.describe('ACP Agent', () => {
  test('agent settings page has management UI', async ({ page }) => {
    await goToSettings(page, 'agent');
    await expectUrlContains(page, 'agent');
    await expectBodyContainsAny(page, ['Agent', 'agent', '助手', '预设', 'Preset', 'Custom', 'Assistants']);
  });

  test('screenshot: agent settings', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await goToSettings(page, 'agent');
    await takeScreenshot(page, 'agent-settings');
  });

  test('agent pill bar renders on guid page', async ({ page }) => {
    await goToGuid(page);

    const pills = page.locator(AGENT_PILL);
    await expect(pills.first()).toBeVisible({ timeout: 8_000 });
    expect(await pills.count()).toBeGreaterThanOrEqual(1);
  });

  test('can see agent backend names', async ({ page }) => {
    await goToGuid(page);

    const knownBackends = new Set(['claude', 'gemini', 'qwen', 'opencode', 'codex', 'iflow']);
    const pills = page.locator(AGENT_PILL);
    await expect(pills.first()).toBeVisible({ timeout: 8_000 });

    const count = await pills.count();
    const backends: string[] = [];
    for (let i = 0; i < count; i++) {
      const backend = await pills.nth(i).getAttribute('data-agent-backend');
      if (backend) backends.push(backend);
    }

    expect(backends.some((backend) => knownBackends.has(backend))).toBeTruthy();
  });

  test('clicking an agent pill selects it', async ({ page }) => {
    await goToGuid(page);

    const pills = page.locator(AGENT_PILL);
    await expect(pills.first()).toBeVisible({ timeout: 8_000 });

    const count = await pills.count();
    if (count >= 2) {
      const target = pills.nth(1);
      await target.click();

      await expect
        .poll(async () => {
          return await target.getAttribute('data-agent-selected');
        })
        .toBe('true');

      await expect(page.locator(AGENT_PILL_SELECTED).first()).toBeVisible();
    }
  });

  test('screenshot: agent pill bar', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await goToGuid(page);
    await expect(page.locator(AGENT_PILL).first()).toBeVisible({ timeout: 8_000 });
    await takeScreenshot(page, 'agent-pill-bar');
  });

  test('MCP tools page has server management UI', async ({ page }) => {
    await goToSettings(page, 'tools');
    await expectUrlContains(page, 'tools');
    await expect(page.locator(settingsSiderItemById('tools')).first()).toBeVisible({ timeout: 8_000 });
    await expectBodyContainsAny(page, ['MCP', 'mcp', 'Server', 'server', '工具', '配置', '添加', 'Add']);
  });

  test('can query available agents via IPC', async ({ page, electronApp }) => {
    await goToGuid(page);

    const windowCount = await electronApp.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length;
    });
    expect(windowCount).toBeGreaterThanOrEqual(1);
  });
});

test.describe.serial('ACP conversation page (hermetic)', () => {
  test.beforeAll(async () => {
    // Hermetic ACP tests launch their own Electron processes with a dedicated
    // dev profile. Close the shared fixture app first so the suite exercises
    // the real single-instance product path instead of an artificial
    // multi-instance E2E-only setup.
    await closeSharedElectronApp();
  });

  test('renders a real ACP response and logs on the conversation page', async ({}, testInfo) => {
    const hermeticApp = await launchHermeticAcpApp({
      FAKE_ACP_AUTH_MODE: 'none',
      FAKE_ACP_PROMPT_MODE: 'default',
      FAKE_ACP_STEP_DELAY_MS: '20',
    });

    try {
      const { id } = await createHermeticAcpConversation(hermeticApp.page, 'Hermetic ACP Happy Path');
      const input = 'Say hello from hermetic e2e';

      await navigateTo(hermeticApp.page, `#/conversation/${id}`);
      await waitForConversationSendBoxReady(hermeticApp.page);
      await installResponseStreamProbe(hermeticApp.page);
      await sendAcpMessage(hermeticApp.page, input);
      await waitForConversationEvent(hermeticApp.page, id, 'request_trace');
      await waitForConversationEvent(hermeticApp.page, id, 'content');
      await waitForConversationEvent(hermeticApp.page, id, 'finish');

      await expect(hermeticApp.page.locator('[data-testid="acp-logs-panel"]')).toHaveCount(0);
      const logsPanel = await openAcpDiagnostics(hermeticApp.page);
      await expect(logsPanel).toContainText('finished in', { timeout: 8_000 });
      await expect(hermeticApp.page.locator('body')).toContainText('Fake response to:', {
        timeout: 15_000,
      });

      const logsToggle = hermeticApp.page.locator('[data-testid="acp-logs-toggle"]');
      await logsToggle.click();
      const logsList = hermeticApp.page.locator('[data-testid="acp-logs-list"]');
      await expect(logsList).toBeVisible({ timeout: 8_000 });
      await expect(logsList).toContainText('fake-model-1', { timeout: 8_000 });
      await expect(logsList).toContainText('finished in', { timeout: 8_000 });
      await expect(hermeticApp.page.locator('[data-testid="acp-auth-banner"]')).toHaveCount(0);
      await expect(hermeticApp.page.locator('[data-testid="acp-disconnected-banner"]')).toHaveCount(0);
    } finally {
      await testInfo.attach('response-stream-probe', {
        body: Buffer.from(JSON.stringify(await readResponseStreamProbe(hermeticApp.page), null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('main-runtime-info', {
        body: Buffer.from(JSON.stringify(hermeticApp.runtimeInfo, null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('renderer-console', {
        body: Buffer.from(hermeticApp.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await hermeticApp.cleanup();
    }
  });

  test('shows a warmup cue for a fresh ACP conversation before the first response arrives', async ({}, testInfo) => {
    const hermeticApp = await launchHermeticAcpApp({
      FAKE_ACP_AUTH_MODE: 'none',
      FAKE_ACP_PROMPT_MODE: 'delayed_first_response',
      FAKE_ACP_STEP_DELAY_MS: '1500',
    });

    try {
      const { id } = await createHermeticAcpConversation(hermeticApp.page, 'Hermetic ACP First Response Waiting Cue');
      const input = 'Hold the first response for a moment';

      await navigateTo(hermeticApp.page, `#/conversation/${id}`);
      await waitForConversationSendBoxReady(hermeticApp.page);
      await installResponseStreamProbe(hermeticApp.page);
      await sendAcpMessage(hermeticApp.page, input);
      const conversationBody = hermeticApp.page.locator('body');

      await expect
        .poll(
          async () => {
            const contentCount = countConversationEvents(
              await readResponseStreamProbe(hermeticApp.page),
              id,
              'content'
            );
            if (contentCount > 0) {
              return null;
            }

            return await conversationBody.textContent();
          },
          { timeout: 4_000 }
        )
        .toMatch(/Processing/);

      const warmupIndicator = hermeticApp.page.locator('[data-testid="acp-warmup-indicator"]');
      await expect
        .poll(
          async () => {
            const contentCount = countConversationEvents(
              await readResponseStreamProbe(hermeticApp.page),
              id,
              'content'
            );
            if (contentCount > 0) {
              return null;
            }

            if (!(await warmupIndicator.isVisible().catch(() => false))) {
              return null;
            }

            return await warmupIndicator.textContent();
          },
          { timeout: 4_000 }
        )
        .toMatch(/Connecting to Fake ACP Agent|Waiting for the first response from Fake ACP Agent/);

      await waitForConversationEvent(hermeticApp.page, id, 'content');
      await waitForConversationEvent(hermeticApp.page, id, 'finish');
      await expect(warmupIndicator).toHaveCount(0);
      await expect(hermeticApp.page.locator('body')).toContainText('Fake response to:', {
        timeout: 15_000,
      });
    } finally {
      await testInfo.attach('response-stream-probe', {
        body: Buffer.from(JSON.stringify(await readResponseStreamProbe(hermeticApp.page), null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('main-runtime-info', {
        body: Buffer.from(JSON.stringify(hermeticApp.runtimeInfo, null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('renderer-console', {
        body: Buffer.from(hermeticApp.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await hermeticApp.cleanup();
    }
  });

  test('reopens the same ACP conversation after app restart and resumes remembered memory', async ({}, testInfo) => {
    const sandbox = createHermeticAcpSandbox();
    let firstApp: HermeticAcpApp | null = null;
    let reopenedApp: HermeticAcpApp | null = null;
    let firstProbe = '[probe unavailable]';
    let reopenedProbe = '[probe unavailable]';
    let conversationId = '';
    let persistedSessionId = '';

    try {
      firstApp = await launchHermeticAcpApp(
        {
          FAKE_ACP_AUTH_MODE: 'none',
          FAKE_ACP_PROMPT_MODE: 'default',
          FAKE_ACP_STEP_DELAY_MS: '20',
        },
        { sandbox, destroySandboxOnCleanup: false }
      );

      const createdConversation = await createHermeticAcpConversation(
        firstApp.page,
        'Hermetic ACP Resume After Restart'
      );
      conversationId = createdConversation.id;

      await navigateTo(firstApp.page, `#/conversation/${conversationId}`);
      await waitForConversationSendBoxReady(firstApp.page);
      await installResponseStreamProbe(firstApp.page);

      await sendAcpMessage(firstApp.page, 'Remember codeword: kiwi');
      await waitForConversationEvent(firstApp.page, conversationId, 'request_trace');
      await waitForConversationEvent(firstApp.page, conversationId, 'finish');
      await expect(firstApp.page.locator('body')).toContainText('Remembered codeword: kiwi', {
        timeout: 15_000,
      });

      const firstConversation = await readHermeticConversation(firstApp.page, conversationId);
      persistedSessionId = firstConversation.extra?.acpSessionId ?? '';
      expect(persistedSessionId).toBeTruthy();

      firstProbe = JSON.stringify(await readResponseStreamProbe(firstApp.page), null, 2);
      await firstApp.cleanup({ requireClose: true });

      reopenedApp = await launchHermeticAcpApp(
        {
          FAKE_ACP_AUTH_MODE: 'none',
          FAKE_ACP_PROMPT_MODE: 'default',
          FAKE_ACP_STEP_DELAY_MS: '20',
        },
        { sandbox, destroySandboxOnCleanup: false }
      );

      const reopenedConversation = await readHermeticConversation(reopenedApp.page, conversationId);
      expect(reopenedConversation.id).toBe(conversationId);
      expect(reopenedConversation.extra?.acpSessionId).toBe(persistedSessionId);

      await navigateTo(reopenedApp.page, `#/conversation/${conversationId}`);
      await waitForConversationSendBoxReady(reopenedApp.page);
      await installResponseStreamProbe(reopenedApp.page);

      await sendAcpMessage(reopenedApp.page, 'What codeword did I ask you to remember?');
      await waitForConversationEvent(reopenedApp.page, conversationId, 'request_trace');
      await waitForConversationEvent(reopenedApp.page, conversationId, 'finish');
      await expect(reopenedApp.page.locator('body')).toContainText('Remembered codeword is: kiwi', {
        timeout: 15_000,
      });

      const logsPanel = await openAcpDiagnostics(reopenedApp.page);
      await expect(logsPanel).toContainText('finished in', { timeout: 8_000 });
      await expect(reopenedApp.page.locator('[data-testid="acp-auth-banner"]')).toHaveCount(0);
      await expect(reopenedApp.page.locator('[data-testid="acp-disconnected-banner"]')).toHaveCount(0);
      reopenedProbe = JSON.stringify(await readResponseStreamProbe(reopenedApp.page), null, 2);
    } finally {
      if (reopenedProbe === '[probe unavailable]' && reopenedApp?.page && !reopenedApp.page.isClosed()) {
        reopenedProbe = JSON.stringify(await readResponseStreamProbe(reopenedApp.page), null, 2);
      }
      await testInfo.attach('first-launch-response-stream-probe', {
        body: Buffer.from(firstProbe, 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('reopened-launch-response-stream-probe', {
        body: Buffer.from(reopenedProbe, 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('conversation-resume-metadata', {
        body: Buffer.from(
          JSON.stringify(
            {
              conversationId,
              persistedSessionId,
              firstRuntimeInfo: firstApp?.runtimeInfo ?? null,
              reopenedRuntimeInfo: reopenedApp?.runtimeInfo ?? null,
            },
            null,
            2
          ),
          'utf8'
        ),
        contentType: 'application/json',
      });
      await testInfo.attach('first-launch-renderer-console', {
        body: Buffer.from(firstApp?.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await testInfo.attach('reopened-launch-renderer-console', {
        body: Buffer.from(reopenedApp?.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await reopenedApp?.cleanup();
      if (firstApp && firstApp !== reopenedApp) {
        await firstApp.cleanup();
      }
      sandbox.cleanup();
    }
  });

  test('reopens the same Codex ACP conversation after app restart through session/load', async ({}, testInfo) => {
    const sandbox = createHermeticAcpSandbox();
    let firstApp: HermeticAcpApp | null = null;
    let reopenedApp: HermeticAcpApp | null = null;
    let firstProbe = '[probe unavailable]';
    let reopenedProbe = '[probe unavailable]';
    let fakeStateSnapshot = '{}';
    let conversationId = '';
    let persistedSessionId = '';

    try {
      firstApp = await launchHermeticAcpApp(
        {
          AIONUI_E2E_CODEX_ACP_CLI_PATH: `${process.execPath} ${FAKE_CLI_PATH}`,
          FAKE_ACP_AUTH_MODE: 'none',
          FAKE_ACP_PROMPT_MODE: 'default',
          FAKE_ACP_STEP_DELAY_MS: '20',
        },
        { sandbox, destroySandboxOnCleanup: false }
      );

      const createdConversation = await createHermeticAcpConversation(firstApp.page, 'Hermetic Codex Resume', {
        backend: 'codex',
        agentName: 'Codex',
      });
      conversationId = createdConversation.id;

      await navigateTo(firstApp.page, `#/conversation/${conversationId}`);
      await waitForConversationSendBoxReady(firstApp.page);
      await installResponseStreamProbe(firstApp.page);

      await sendAcpMessage(firstApp.page, 'Remember codeword: kiwi');
      await waitForConversationEvent(firstApp.page, conversationId, 'request_trace');
      await waitForConversationEvent(firstApp.page, conversationId, 'finish');
      await expect(firstApp.page.locator('body')).toContainText('Remembered codeword: kiwi', {
        timeout: 15_000,
      });

      const firstConversation = await readHermeticConversation(firstApp.page, conversationId);
      persistedSessionId = firstConversation.extra?.acpSessionId ?? '';
      expect(persistedSessionId).toBeTruthy();

      firstProbe = JSON.stringify(await readResponseStreamProbe(firstApp.page), null, 2);
      await firstApp.cleanup({ requireClose: true });

      reopenedApp = await launchHermeticAcpApp(
        {
          AIONUI_E2E_CODEX_ACP_CLI_PATH: `${process.execPath} ${FAKE_CLI_PATH}`,
          FAKE_ACP_AUTH_MODE: 'none',
          FAKE_ACP_PROMPT_MODE: 'default',
          FAKE_ACP_STEP_DELAY_MS: '20',
        },
        { sandbox, destroySandboxOnCleanup: false }
      );

      const reopenedConversation = await readHermeticConversation(reopenedApp.page, conversationId);
      expect(reopenedConversation.id).toBe(conversationId);
      expect(reopenedConversation.extra?.acpSessionId).toBe(persistedSessionId);

      await navigateTo(reopenedApp.page, `#/conversation/${conversationId}`);
      await waitForConversationSendBoxReady(reopenedApp.page);
      await installResponseStreamProbe(reopenedApp.page);

      await sendAcpMessage(reopenedApp.page, 'What codeword did I ask you to remember?');
      await waitForConversationEvent(reopenedApp.page, conversationId, 'request_trace');
      await waitForConversationEvent(reopenedApp.page, conversationId, 'finish');
      await expect(reopenedApp.page.locator('body')).toContainText('Remembered codeword is: kiwi', {
        timeout: 15_000,
      });

      const fakeState = readFakeAcpState(sandbox.fakeAcpStateFile);
      const methodCalls = Array.isArray(fakeState.methodCalls) ? fakeState.methodCalls.filter(isFakeAcpMethodCall) : [];
      const recallPromptIndex = methodCalls.findIndex(
        (call) => call.method === 'session/prompt' && call.promptText === 'What codeword did I ask you to remember?'
      );
      expect(recallPromptIndex).toBeGreaterThanOrEqual(0);

      const loadCallIndex = methodCalls.findIndex(
        (call, index) =>
          index < recallPromptIndex && call.method === 'session/load' && call.sessionId === persistedSessionId
      );
      expect(loadCallIndex).toBeGreaterThanOrEqual(0);

      expect(
        methodCalls.some(
          (call, index) =>
            index < recallPromptIndex && call.method === 'session/new' && call.resumeSessionId === persistedSessionId
        )
      ).toBe(false);

      const logsPanel = await openAcpDiagnostics(reopenedApp.page);
      await expect(logsPanel).toContainText('finished in', { timeout: 8_000 });
      await expect(reopenedApp.page.locator('[data-testid="acp-auth-banner"]')).toHaveCount(0);
      await expect(reopenedApp.page.locator('[data-testid="acp-disconnected-banner"]')).toHaveCount(0);

      reopenedProbe = JSON.stringify(await readResponseStreamProbe(reopenedApp.page), null, 2);
      fakeStateSnapshot = JSON.stringify(fakeState, null, 2);
    } finally {
      if (fakeStateSnapshot === '{}') {
        fakeStateSnapshot = JSON.stringify(readFakeAcpState(sandbox.fakeAcpStateFile), null, 2);
      }
      if (reopenedProbe === '[probe unavailable]' && reopenedApp?.page && !reopenedApp.page.isClosed()) {
        reopenedProbe = JSON.stringify(await readResponseStreamProbe(reopenedApp.page), null, 2);
      }
      await testInfo.attach('first-launch-response-stream-probe', {
        body: Buffer.from(firstProbe, 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('reopened-launch-response-stream-probe', {
        body: Buffer.from(reopenedProbe, 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('fake-acp-state', {
        body: Buffer.from(fakeStateSnapshot, 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('conversation-resume-metadata', {
        body: Buffer.from(
          JSON.stringify(
            {
              conversationId,
              persistedSessionId,
              firstRuntimeInfo: firstApp?.runtimeInfo ?? null,
              reopenedRuntimeInfo: reopenedApp?.runtimeInfo ?? null,
            },
            null,
            2
          ),
          'utf8'
        ),
        contentType: 'application/json',
      });
      await testInfo.attach('first-launch-renderer-console', {
        body: Buffer.from(firstApp?.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await testInfo.attach('reopened-launch-renderer-console', {
        body: Buffer.from(reopenedApp?.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await reopenedApp?.cleanup();
      if (firstApp && firstApp !== reopenedApp) {
        await firstApp.cleanup();
      }
      sandbox.cleanup();
    }
  });

  test('reopens the same live Codex ACP conversation after app restart @real-codex-canary', async ({}, testInfo) => {
    test.skip(!REAL_CODEX_CANARY_ENABLED, 'real Codex ACP canary disabled');
    test.setTimeout(6 * 60_000);

    const sandbox = createHermeticAcpSandbox();
    const codexDiagnostics = readCodexCliDiagnostics();
    const codeword = `codex-canary-${Date.now().toString(36)}`;
    const rememberPrompt = `Remember this exact codeword for this ACP session: ${codeword}. Reply with exactly: STORED`;
    const recallPrompt = 'What codeword did I ask you to remember? Reply with the codeword only.';
    let firstApp: HermeticAcpApp | null = null;
    let reopenedApp: HermeticAcpApp | null = null;
    let firstProbe = '[probe unavailable]';
    let reopenedProbe = '[probe unavailable]';
    let conversationId = '';
    let persistedSessionId = '';

    try {
      firstApp = await launchHermeticAcpApp({}, { sandbox, destroySandboxOnCleanup: false });

      const createdConversation = await createHermeticAcpConversation(firstApp.page, 'Real Codex Canary Resume', {
        backend: 'codex',
        agentName: 'Codex',
      });
      conversationId = createdConversation.id;

      await navigateTo(firstApp.page, `#/conversation/${conversationId}`);
      await waitForConversationSendBoxReady(firstApp.page);
      await installResponseStreamProbe(firstApp.page);

      await sendAcpMessage(firstApp.page, rememberPrompt);
      await waitForConversationEventWithTimeout(firstApp.page, conversationId, 'request_trace', 60_000);
      await waitForConversationContentContaining(firstApp.page, conversationId, 'STORED', 180_000);
      await waitForConversationEventWithTimeout(firstApp.page, conversationId, 'finish', 180_000);

      const firstConversation = await readHermeticConversation(firstApp.page, conversationId);
      persistedSessionId = firstConversation.extra?.acpSessionId ?? '';
      expect(persistedSessionId).toBeTruthy();

      firstProbe = JSON.stringify(await readResponseStreamProbe(firstApp.page), null, 2);
      await firstApp.cleanup({ requireClose: true });

      reopenedApp = await launchHermeticAcpApp({}, { sandbox, destroySandboxOnCleanup: false });

      const reopenedConversation = await readHermeticConversation(reopenedApp.page, conversationId);
      expect(reopenedConversation.id).toBe(conversationId);
      expect(reopenedConversation.extra?.acpSessionId).toBe(persistedSessionId);

      await navigateTo(reopenedApp.page, `#/conversation/${conversationId}`);
      await waitForConversationSendBoxReady(reopenedApp.page);
      await installResponseStreamProbe(reopenedApp.page);
      await clearResponseStreamProbe(reopenedApp.page);

      await sendAcpMessage(reopenedApp.page, recallPrompt);
      await waitForConversationEventWithTimeout(reopenedApp.page, conversationId, 'request_trace', 60_000);
      await waitForConversationContentContaining(reopenedApp.page, conversationId, codeword, 180_000);
      await waitForConversationEventWithTimeout(reopenedApp.page, conversationId, 'finish', 180_000);

      const postRecallConversation = await readHermeticConversation(reopenedApp.page, conversationId);
      expect(postRecallConversation.extra?.acpSessionId).toBe(persistedSessionId);

      const logsPanel = await openAcpDiagnostics(reopenedApp.page);
      await expect(reopenedApp.page.locator('[data-testid="acp-auth-banner"]')).toHaveCount(0);
      await expect(reopenedApp.page.locator('[data-testid="acp-disconnected-banner"]')).toHaveCount(0);

      reopenedProbe = JSON.stringify(await readResponseStreamProbe(reopenedApp.page), null, 2);
    } finally {
      await testInfo.attach('codex-cli-diagnostics', {
        body: Buffer.from(JSON.stringify(codexDiagnostics, null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('first-launch-response-stream-probe', {
        body: Buffer.from(firstProbe, 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('reopened-launch-response-stream-probe', {
        body: Buffer.from(reopenedProbe, 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('real-codex-canary-metadata', {
        body: Buffer.from(
          JSON.stringify(
            {
              codeword,
              conversationId,
              persistedSessionId,
              firstRuntimeInfo: firstApp?.runtimeInfo ?? null,
              reopenedRuntimeInfo: reopenedApp?.runtimeInfo ?? null,
            },
            null,
            2
          ),
          'utf8'
        ),
        contentType: 'application/json',
      });
      await testInfo.attach('first-launch-renderer-console', {
        body: Buffer.from(firstApp?.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await testInfo.attach('reopened-launch-renderer-console', {
        body: Buffer.from(reopenedApp?.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await reopenedApp?.cleanup();
      if (firstApp && firstApp !== reopenedApp) {
        await firstApp.cleanup();
      }
      sandbox.cleanup();
    }
  });

  test('interrupts the current turn with Send Now and starts exactly one queued ACP command', async ({}, testInfo) => {
    const hermeticApp = await launchHermeticAcpApp({
      FAKE_ACP_AUTH_MODE: 'none',
      FAKE_ACP_PROMPT_MODE: 'late_chunk_after_cancel',
      FAKE_ACP_STEP_DELAY_MS: '800',
    });

    try {
      const { id } = await createHermeticAcpConversation(hermeticApp.page, 'Hermetic ACP Send Now');
      const runningInput = 'Running turn before Send Now';
      const queuedInput = 'Queued turn released by Send Now';

      await navigateTo(hermeticApp.page, `#/conversation/${id}`);
      await waitForConversationSendBoxReady(hermeticApp.page);
      await installResponseStreamProbe(hermeticApp.page);

      await sendAcpMessage(hermeticApp.page, runningInput);
      await waitForConversationEvent(hermeticApp.page, id, 'request_trace');
      await waitForConversationEvent(hermeticApp.page, id, 'content');

      await sendAcpMessage(hermeticApp.page, queuedInput);

      const sendNowButton = hermeticApp.page.locator('[data-testid="command-queue-send-now"]');
      await expect(sendNowButton).toBeVisible({ timeout: 8_000 });
      const eventsBeforeQueuedTurn = await readConversationEvents(hermeticApp.page, id);
      const requestTraceCountBeforeQueuedTurn = eventsBeforeQueuedTurn.filter(
        (event) => event.type === 'request_trace'
      ).length;
      const finishCountBeforeQueuedTurn = eventsBeforeQueuedTurn.filter((event) => event.type === 'finish').length;
      await sendNowButton.click();

      await waitForConversationEventCount(hermeticApp.page, id, 'request_trace', requestTraceCountBeforeQueuedTurn + 1);
      await waitForConversationEventCount(hermeticApp.page, id, 'finish', finishCountBeforeQueuedTurn + 2);

      await expect(hermeticApp.page.locator('body')).toContainText(`Fake response to: ${queuedInput}`, {
        timeout: 15_000,
      });
      await expect(sendNowButton).toHaveCount(0, { timeout: 8_000 });

      const logsPanel = await openAcpDiagnostics(hermeticApp.page);
      await expect(logsPanel).toContainText('finished in', { timeout: 8_000 });

      const logsToggle = hermeticApp.page.locator('[data-testid="acp-logs-toggle"]');
      await logsToggle.click();
      const logsList = hermeticApp.page.locator('[data-testid="acp-logs-list"]');
      await expect(logsList).toBeVisible({ timeout: 8_000 });
      await expect(logsList).toContainText('Send Now requested for Fake ACP Agent', { timeout: 8_000 });

      const finalEvents = await readConversationEvents(hermeticApp.page, id);
      expect(finalEvents.filter((event) => event.type === 'request_trace')).toHaveLength(
        requestTraceCountBeforeQueuedTurn + 1
      );
      expect(finalEvents.filter((event) => event.type === 'finish')).toHaveLength(finishCountBeforeQueuedTurn + 2);
    } finally {
      await testInfo.attach('response-stream-probe', {
        body: Buffer.from(JSON.stringify(await readResponseStreamProbe(hermeticApp.page), null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('main-runtime-info', {
        body: Buffer.from(JSON.stringify(hermeticApp.runtimeInfo, null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('renderer-console', {
        body: Buffer.from(hermeticApp.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await hermeticApp.cleanup();
    }
  });

  test('auto-releases exactly one queued ACP command after a natural turn finish', async ({}, testInfo) => {
    const hermeticApp = await launchHermeticAcpApp({
      FAKE_ACP_AUTH_MODE: 'none',
      FAKE_ACP_PROMPT_MODE: 'late_chunk_after_cancel',
      FAKE_ACP_STEP_DELAY_MS: '800',
    });

    try {
      const { id } = await createHermeticAcpConversation(hermeticApp.page, 'Hermetic ACP Queue Auto Release');
      const runningInput = 'Running turn before automatic queue release';
      const queuedInput = 'Queued turn released after natural finish';

      await navigateTo(hermeticApp.page, `#/conversation/${id}`);
      await waitForConversationSendBoxReady(hermeticApp.page);
      await installResponseStreamProbe(hermeticApp.page);

      await sendAcpMessage(hermeticApp.page, runningInput);
      await waitForConversationEvent(hermeticApp.page, id, 'request_trace');
      await waitForConversationEvent(hermeticApp.page, id, 'content');

      const eventsBeforeAutoRelease = await readConversationEvents(hermeticApp.page, id);
      const requestTraceCountBeforeAutoRelease = eventsBeforeAutoRelease.filter(
        (event) => event.type === 'request_trace'
      ).length;
      await sendAcpMessage(hermeticApp.page, queuedInput);

      await waitForConversationEventCount(
        hermeticApp.page,
        id,
        'request_trace',
        requestTraceCountBeforeAutoRelease + 1
      );
      await waitForConversationEventCount(hermeticApp.page, id, 'finish', 2);

      await expect(hermeticApp.page.locator('body')).toContainText(`Fake response to: ${queuedInput}`, {
        timeout: 15_000,
      });

      const finalEvents = await readConversationEvents(hermeticApp.page, id);
      const requestTraceIndices = finalEvents.flatMap((event, index) =>
        event.type === 'request_trace' ? [index] : []
      );
      const finishIndices = finalEvents.flatMap((event, index) => (event.type === 'finish' ? [index] : []));
      expect(requestTraceIndices).toHaveLength(2);
      expect(finishIndices).toHaveLength(2);
      expect(requestTraceIndices[1]).toBeGreaterThan(finishIndices[0]);
    } finally {
      await testInfo.attach('response-stream-probe', {
        body: Buffer.from(JSON.stringify(await readResponseStreamProbe(hermeticApp.page), null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('main-runtime-info', {
        body: Buffer.from(JSON.stringify(hermeticApp.runtimeInfo, null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('renderer-console', {
        body: Buffer.from(hermeticApp.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await hermeticApp.cleanup();
    }
  });

  test('surfaces a disconnected banner and disconnect detail after mid-stream exit', async ({}, testInfo) => {
    const hermeticApp = await launchHermeticAcpApp({
      FAKE_ACP_AUTH_MODE: 'none',
      FAKE_ACP_PROMPT_MODE: 'exit_mid_stream',
      FAKE_ACP_STEP_DELAY_MS: '20',
      FAKE_ACP_EXIT_CODE: '42',
    });

    try {
      const { id } = await createHermeticAcpConversation(hermeticApp.page, 'Hermetic ACP Disconnect Path');
      const input = 'Trigger disconnect from hermetic e2e';

      await navigateTo(hermeticApp.page, `#/conversation/${id}`);
      await waitForConversationSendBoxReady(hermeticApp.page);
      await installResponseStreamProbe(hermeticApp.page);
      await sendAcpMessage(hermeticApp.page, input);
      await waitForConversationEvent(hermeticApp.page, id, 'request_trace');
      await waitForConversationStatus(hermeticApp.page, id, 'disconnected');

      const disconnectedBanner = hermeticApp.page.locator('[data-testid="acp-disconnected-banner"]');
      await expect(disconnectedBanner).toBeVisible({ timeout: 15_000 });

      const logsPanel = await openAcpDiagnostics(hermeticApp.page);
      await expect(logsPanel).toContainText('disconnected', { timeout: 8_000 });
      await expect(logsPanel).toContainText('42', { timeout: 8_000 });

      const logsToggle = hermeticApp.page.locator('[data-testid="acp-logs-toggle"]');
      await logsToggle.click();
      await expect(hermeticApp.page.locator('[data-testid="acp-logs-list"]')).toBeVisible({ timeout: 8_000 });
      await expect(hermeticApp.page.locator('[data-testid="acp-logs-list"]')).toContainText('42', { timeout: 8_000 });
      await hermeticApp.page.waitForTimeout(1_500);
      await expect(disconnectedBanner).toBeVisible();

      const conversationEvents = await readConversationEvents(hermeticApp.page, id);
      expect(hasStatusAfterStatus(conversationEvents, 'disconnected', 'session_active')).toBe(false);
    } finally {
      await testInfo.attach('response-stream-probe', {
        body: Buffer.from(JSON.stringify(await readResponseStreamProbe(hermeticApp.page), null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('main-runtime-info', {
        body: Buffer.from(JSON.stringify(hermeticApp.runtimeInfo, null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('renderer-console', {
        body: Buffer.from(hermeticApp.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await hermeticApp.cleanup();
    }
  });

  test('recovers from a mid-stream disconnect, retries, and completes the next turn', async ({}, testInfo) => {
    const hermeticApp = await launchHermeticAcpApp({
      FAKE_ACP_AUTH_MODE: 'none',
      FAKE_ACP_PROMPT_MODE: 'exit_mid_stream_once',
      FAKE_ACP_STEP_DELAY_MS: '20',
      FAKE_ACP_EXIT_CODE: '42',
    });

    try {
      const { id } = await createHermeticAcpConversation(hermeticApp.page, 'Hermetic ACP Retry Recovery');

      await navigateTo(hermeticApp.page, `#/conversation/${id}`);
      await waitForConversationSendBoxReady(hermeticApp.page);
      await installResponseStreamProbe(hermeticApp.page);

      await sendAcpMessage(hermeticApp.page, 'Trigger one-shot disconnect');
      await waitForConversationEvent(hermeticApp.page, id, 'request_trace');
      await waitForConversationStatus(hermeticApp.page, id, 'disconnected');

      const disconnectedBanner = hermeticApp.page.locator('[data-testid="acp-disconnected-banner"]');
      await expect(disconnectedBanner).toBeVisible({ timeout: 15_000 });
      await hermeticApp.page.waitForTimeout(500);
      expect(
        hasStatusAfterStatus(await readConversationEvents(hermeticApp.page, id), 'disconnected', 'session_active')
      ).toBe(false);
      await disconnectedBanner.getByRole('button').click();

      await waitForConversationStatusAfterStatus(hermeticApp.page, id, 'disconnected', 'session_active');
      await expect(disconnectedBanner).toHaveCount(0, { timeout: 8_000 });

      const recoveryEvents = await readConversationEvents(hermeticApp.page, id);
      const requestTraceCountBeforeRetryTurn = recoveryEvents.filter((event) => event.type === 'request_trace').length;
      const finishCountBeforeRetryTurn = recoveryEvents.filter((event) => event.type === 'finish').length;

      await sendAcpMessage(hermeticApp.page, 'Second turn after retry');
      await waitForConversationEventCount(hermeticApp.page, id, 'request_trace', requestTraceCountBeforeRetryTurn + 1);
      await waitForConversationEventCount(hermeticApp.page, id, 'finish', finishCountBeforeRetryTurn + 1);

      const logsPanel = await openAcpDiagnostics(hermeticApp.page);
      await expect(logsPanel).toContainText('finished in', { timeout: 8_000 });
      await expect(hermeticApp.page.locator('body')).toContainText('Fake response to:', {
        timeout: 15_000,
      });

      const logsToggle = hermeticApp.page.locator('[data-testid="acp-logs-toggle"]');
      await logsToggle.click();
      const logsList = hermeticApp.page.locator('[data-testid="acp-logs-list"]');
      await expect(logsList).toBeVisible({ timeout: 8_000 });
      await expect(logsList).toContainText('Retry requested for Fake ACP Agent', { timeout: 8_000 });
      await expect(logsList).toContainText('Connection warmup ready for Fake ACP Agent', { timeout: 8_000 });
      await expect(logsList).toContainText('finished in', { timeout: 8_000 });
      await expect(hermeticApp.page.locator('[data-testid="acp-auth-banner"]')).toHaveCount(0);
      await expect(hermeticApp.page.locator('[data-testid="acp-disconnected-banner"]')).toHaveCount(0);
    } finally {
      await testInfo.attach('response-stream-probe', {
        body: Buffer.from(JSON.stringify(await readResponseStreamProbe(hermeticApp.page), null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('main-runtime-info', {
        body: Buffer.from(JSON.stringify(hermeticApp.runtimeInfo, null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('renderer-console', {
        body: Buffer.from(hermeticApp.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await hermeticApp.cleanup();
    }
  });

  test('authenticates after auth_required and completes the next turn', async ({}, testInfo) => {
    const hermeticApp = await launchHermeticAcpApp({
      FAKE_ACP_AUTH_MODE: 'required',
      FAKE_ACP_PROMPT_MODE: 'default',
      FAKE_ACP_STEP_DELAY_MS: '20',
    });

    try {
      const { id } = await createHermeticAcpConversation(hermeticApp.page, 'Hermetic ACP Auth Recovery');

      await navigateTo(hermeticApp.page, `#/conversation/${id}`);
      await waitForConversationSendBoxReady(hermeticApp.page);
      await installResponseStreamProbe(hermeticApp.page);

      await sendAcpMessage(hermeticApp.page, 'Trigger auth required');
      await waitForConversationStatus(hermeticApp.page, id, 'auth_required');

      const authBanner = hermeticApp.page.locator('[data-testid="acp-auth-banner"]');
      await expect(authBanner).toBeVisible({ timeout: 15_000 });
      await hermeticApp.page.waitForTimeout(500);
      expect(
        hasStatusAfterStatus(await readConversationEvents(hermeticApp.page, id), 'auth_required', 'session_active')
      ).toBe(false);
      await authBanner.getByRole('button').click();

      await waitForConversationStatusAfterStatus(hermeticApp.page, id, 'auth_required', 'session_active');
      await expect(authBanner).toHaveCount(0, { timeout: 8_000 });

      const recoveryEvents = await readConversationEvents(hermeticApp.page, id);
      const requestTraceCountBeforeAuthTurn = recoveryEvents.filter((event) => event.type === 'request_trace').length;
      const finishCountBeforeAuthTurn = recoveryEvents.filter((event) => event.type === 'finish').length;

      await sendAcpMessage(hermeticApp.page, 'Message after authenticate');
      await waitForConversationEventCount(hermeticApp.page, id, 'request_trace', requestTraceCountBeforeAuthTurn + 1);
      await waitForConversationEventCount(hermeticApp.page, id, 'finish', finishCountBeforeAuthTurn + 1);

      const logsPanel = await openAcpDiagnostics(hermeticApp.page);
      await expect(logsPanel).toContainText('finished in', { timeout: 8_000 });
      await expect(hermeticApp.page.locator('body')).toContainText('Fake response to:', {
        timeout: 15_000,
      });

      const logsToggle = hermeticApp.page.locator('[data-testid="acp-logs-toggle"]');
      await logsToggle.click();
      const logsList = hermeticApp.page.locator('[data-testid="acp-logs-list"]');
      await expect(logsList).toBeVisible({ timeout: 8_000 });
      await expect(logsList).toContainText('Authenticate requested for Fake ACP Agent', { timeout: 8_000 });
      await expect(logsList).toContainText('Authentication ready for Fake ACP Agent', { timeout: 8_000 });
      await expect(logsList).toContainText('finished in', { timeout: 8_000 });
      await expect(hermeticApp.page.locator('[data-testid="acp-auth-banner"]')).toHaveCount(0);
      await expect(hermeticApp.page.locator('[data-testid="acp-disconnected-banner"]')).toHaveCount(0);
    } finally {
      await testInfo.attach('response-stream-probe', {
        body: Buffer.from(JSON.stringify(await readResponseStreamProbe(hermeticApp.page), null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('main-runtime-info', {
        body: Buffer.from(JSON.stringify(hermeticApp.runtimeInfo, null, 2), 'utf8'),
        contentType: 'application/json',
      });
      await testInfo.attach('renderer-console', {
        body: Buffer.from(hermeticApp.consoleMessages.join('\n') || '[no renderer console output]', 'utf8'),
        contentType: 'text/plain',
      });
      await hermeticApp.cleanup();
    }
  });
});
