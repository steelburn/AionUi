/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// configureChromium sets app name (dev isolation) and Chromium flags — must run before
// ANY module that calls app.getPath('userData'), because Electron caches the path on first call.
import './utils/chromiumConfig';
import * as Sentry from '@sentry/electron/main';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
});

import '@process/utils/configureConsoleLog';
import { app, BrowserWindow, nativeImage, net, powerMonitor, protocol, screen } from 'electron';
import fixPath from 'fix-path';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { initMainAdapterWithWindow } from '@/common/adapter/main';
import { ipcBridge } from '@/common';
import { AION_ASSET_PROTOCOL } from '@server/extensions';
import { initializeProcess } from '../process';
import { ProcessConfig } from '@server/utils/initStorage';
import { loadShellEnvironmentAsync, logEnvironmentDiagnostics, mergePaths } from '@server/utils/shellEnv';
import { acpDetector } from '@server/agent/acp/AcpDetector';
import { registerWindowMaximizeListeners } from '@electron/handlers/windowControls';
import { onCloseToTrayChanged, onLanguageChanged } from '@process/bridge/systemSettingsBridge';
import { setInitialLanguage } from '@server/services/i18n';
import { workerTaskManager } from '@server/task/workerTaskManagerSingleton';
import { setupApplicationMenu } from './lifecycle/appMenu';
import { startWebServer } from '@server/http';
import { applyZoomToWindow, initializeZoomFactor } from './utils/zoom';
import {
  clearPendingDeepLinkUrl,
  getPendingDeepLinkUrl,
  handleDeepLinkUrl,
  PROTOCOL_SCHEME,
} from './lifecycle/deepLink';
import { acquireSingleInstanceLock, onSecondInstance } from './lifecycle/singleInstance';
import {
  bindMainWindowReferences,
  showAndFocusMainWindow,
  showOrCreateMainWindow,
} from '@process/utils/mainWindowLifecycle';
import {
  loadUserWebUIConfig,
  resolveRemoteAccess,
  resolveWebUIPort,
  restoreDesktopWebUIFromPreferences,
} from '@process/utils/webuiConfig';
import {
  createOrUpdateTray,
  destroyTray,
  getCloseToTrayEnabled,
  getIsQuitting,
  refreshTrayMenu,
  setCloseToTrayEnabled,
  setIsQuitting,
} from './lifecycle/tray';
// @ts-expect-error - electron-squirrel-startup doesn't have types
import electronSquirrelStartup from 'electron-squirrel-startup';

// ============ Single Instance Lock ============
const isE2ETestMode = process.env.AIONUI_E2E_TEST === '1';
if (!acquireSingleInstanceLock()) {
  app.quit();
} else {
  onSecondInstance(() => {
    if (isWebUIMode || isResetPasswordMode) {
      return;
    }
    if (app.isReady()) {
      showOrCreateMainWindow({
        mainWindow,
        createWindow: () => {
          console.log('[AionUi] second-instance received with no active main window, recreating main window');
          createWindow();
        },
      });
    }
  });
}

// Fix PATH environment variable for macOS and Linux GUI apps
if (process.platform === 'darwin' || process.platform === 'linux') {
  fixPath();

  // Supplement nvm paths that fix-path might miss (nvm is often only in .zshrc, not .zshenv)
  const nvmDir = process.env.NVM_DIR || path.join(process.env.HOME || '', '.nvm');
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
  if (fs.existsSync(nvmVersionsDir)) {
    try {
      const versions = fs.readdirSync(nvmVersionsDir);
      const nvmPaths = versions.map((v) => path.join(nvmVersionsDir, v, 'bin')).filter((p) => fs.existsSync(p));
      if (nvmPaths.length > 0) {
        const currentPath = process.env.PATH || '';
        const missingPaths = nvmPaths.filter((p) => !currentPath.includes(p));
        if (missingPaths.length > 0) {
          process.env.PATH = [...missingPaths, currentPath].join(path.delimiter);
        }
      }
    } catch {
      // Ignore errors when reading nvm directory
    }
  }
}

// Log environment diagnostics once at startup (persisted via electron-log).
logEnvironmentDiagnostics();

// Handle Squirrel startup events (Windows installer)
if (electronSquirrelStartup) {
  app.quit();
}

// ============ Custom Asset Protocol ============
// Register aion-asset:// as a privileged scheme BEFORE app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: AION_ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

// Global error handlers for main process
// Sentry automatically captures these, but we keep the handlers to prevent Electron's default error dialog
process.on('uncaughtException', (_error) => {
  // Sentry captures this automatically
});

process.on('unhandledRejection', (_reason, _promise) => {
  // Sentry captures this automatically
});

const hasSwitch = (flag: string) => process.argv.includes(`--${flag}`) || app.commandLine.hasSwitch(flag);
const getSwitchValue = (flag: string): string | undefined => {
  const withEqualsPrefix = `--${flag}=`;
  const equalsArg = process.argv.find((arg) => arg.startsWith(withEqualsPrefix));
  if (equalsArg) {
    return equalsArg.slice(withEqualsPrefix.length);
  }

  const argIndex = process.argv.indexOf(`--${flag}`);
  if (argIndex !== -1) {
    const nextArg = process.argv[argIndex + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      return nextArg;
    }
  }

  const cliValue = app.commandLine.getSwitchValue(flag);
  return cliValue || undefined;
};
const hasCommand = (cmd: string) => process.argv.includes(cmd);

const isWebUIMode = hasSwitch('webui');
const isRemoteMode = hasSwitch('remote');
const isResetPasswordMode = hasCommand('--resetpass');
const isVersionMode = hasCommand('--version') || hasCommand('-v');

// Flag to distinguish intentional quit from unexpected exit in WebUI mode
let isExplicitQuit = false;

let mainWindow: BrowserWindow;

const createWindow = (): void => {
  console.log('[AionUi] Creating main window...');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Set window size to 80% of screen size for better visibility on high-resolution displays
  const windowWidth = Math.floor(screenWidth * 0.8);
  const windowHeight = Math.floor(screenHeight * 0.8);

  // Get app icon for development mode (Windows/Linux need icon in BrowserWindow)
  let devIcon: Electron.NativeImage | undefined;
  if (!app.isPackaged) {
    try {
      const iconFile = process.platform === 'win32' ? 'app.ico' : 'app_dev.png';
      const iconPath = path.join(process.cwd(), 'resources', iconFile);
      if (fs.existsSync(iconPath)) {
        devIcon = nativeImage.createFromPath(iconPath);
        if (devIcon.isEmpty()) devIcon = undefined;
      }
    } catch {
      // Ignore icon loading errors in development
    }
  }

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    show: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    ...(devIcon && process.platform !== 'darwin' ? { icon: devIcon } : {}),
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 10, y: 10 },
        }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      webviewTag: true,
    },
  });
  console.log(`[AionUi] Main window created (id=${mainWindow.id})`);

  // Show window after content is ready to prevent FOUC
  const showWindow = () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.log('[AionUi] Showing main window');
      mainWindow.show();
      mainWindow.focus();
    }
  };
  mainWindow.once('ready-to-show', () => {
    console.log('[AionUi] Window ready-to-show');
    showWindow();
  });
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[AionUi] Renderer did-finish-load');
    showWindow();
  });
  // Fallback: show window after 5s even if events don't fire
  setTimeout(showWindow, 5000);

  initMainAdapterWithWindow(mainWindow);
  bindMainWindowReferences(mainWindow);
  setupApplicationMenu();

  void applyZoomToWindow(mainWindow);
  registerWindowMaximizeListeners(mainWindow);

  // Initialize auto-updater service (skip when disabled via env, e.g. E2E / CI)
  const isCiRuntime = process.env.CI === 'true' || process.env.CI === '1' || process.env.GITHUB_ACTIONS === 'true';
  const disableAutoUpdater =
    process.env.AIONUI_DISABLE_AUTO_UPDATE === '1' || process.env.AIONUI_E2E_TEST === '1' || isCiRuntime;
  if (!disableAutoUpdater) {
    Promise.all([import('@server/services/autoUpdaterService'), import('./handlers/update')])
      .then(([{ autoUpdaterService }, { createAutoUpdateStatusBroadcast }]) => {
        const statusBroadcast = createAutoUpdateStatusBroadcast();
        autoUpdaterService.initialize(statusBroadcast);
        setTimeout(() => {
          void autoUpdaterService.checkForUpdatesAndNotify();
        }, 3000);
      })
      .catch((error) => {
        console.error('[App] Failed to initialize autoUpdaterService:', error);
      });
  } else {
    console.log('[AionUi] Auto-updater disabled via env/CI guard');
  }

  // Load the renderer: dev server URL in development, built HTML file in production
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const fallbackFile = path.join(__dirname, '../renderer/index.html');

  if (!app.isPackaged && rendererUrl) {
    console.log(`[AionUi] Loading renderer URL: ${rendererUrl}`);
    mainWindow.loadURL(rendererUrl).catch((error) => {
      console.error('[AionUi] loadURL failed, falling back to file:', error.message || error);
      mainWindow.loadFile(fallbackFile).catch((e2) => {
        console.error('[AionUi] loadFile fallback also failed:', e2.message || e2);
      });
    });
  } else {
    console.log(`[AionUi] Loading renderer file: ${fallbackFile}`);
    mainWindow.loadFile(fallbackFile).catch((error) => {
      console.error('[AionUi] loadFile failed:', error.message || error);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[AionUi] did-fail-load:', { errorCode, errorDescription, validatedURL, isMainFrame });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[AionUi] render-process-gone:', details);

    if (!mainWindow.isDestroyed()) {
      console.log('[AionUi] Attempting to recover from renderer crash by reloading...');

      if (!app.isPackaged && rendererUrl) {
        mainWindow.loadURL(rendererUrl).catch((error) => {
          console.error('[AionUi] Recovery loadURL failed:', error.message || error);
        });
      } else {
        mainWindow.loadFile(fallbackFile).catch((error) => {
          console.error('[AionUi] Recovery loadFile failed:', error.message || error);
        });
      }
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[AionUi] Renderer became unresponsive');
  });

  mainWindow.on('closed', () => {
    console.log('[AionUi] Main window closed');
  });

  mainWindow.webContents.on('devtools-opened', () => {
    ipcBridge.application.devToolsStateChanged.emit({ isOpen: true });
  });

  mainWindow.webContents.on('devtools-closed', () => {
    ipcBridge.application.devToolsStateChanged.emit({ isOpen: false });
  });

  // Close interception: hide window instead of closing when "close to tray" is enabled
  mainWindow.on('close', (event) => {
    if (mainWindow.isDestroyed()) return;
    if (getCloseToTrayEnabled() && !getIsQuitting()) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
};

const handleAppReady = async (): Promise<void> => {
  const t0 = performance.now();
  const mark = (label: string) => console.log(`[AionUi:ready] ${label} +${Math.round(performance.now() - t0)}ms`);
  mark('start');

  // CLI mode: print app version and exit immediately (used by CI smoke tests)
  if (isVersionMode) {
    console.log(app.getVersion());
    app.exit(0);
    return;
  }

  // Register aion-asset:// protocol handler
  protocol.handle(AION_ASSET_PROTOCOL, (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (process.platform === 'win32' && filePath.startsWith('/') && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }
    if (!fs.existsSync(filePath)) {
      console.warn(`[aion-asset] File not found: ${request.url} -> ${filePath}`);
    }
    return net.fetch(pathToFileURL(filePath).href);
  });

  // Set dock icon in development mode on macOS
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    try {
      const iconPath = path.join(process.cwd(), 'resources', 'app_dev.png');
      if (fs.existsSync(iconPath)) {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          app.dock.setIcon(icon);
        }
      }
    } catch {
      // Ignore dock icon errors in development
    }
  }

  try {
    await initializeProcess();
    mark('initializeProcess');
  } catch (error) {
    console.error('Failed to initialize process:', error);
    app.exit(1);
    return;
  }

  try {
    initializeZoomFactor(await ProcessConfig.get('ui.zoomFactor'));
    mark('initializeZoomFactor');
  } catch (error) {
    console.error('[AionUi] Failed to restore zoom factor:', error);
    initializeZoomFactor(undefined);
  }

  if (isResetPasswordMode) {
    try {
      const { resetPasswordCLI, resolveResetPasswordUsername } = await import('@process/utils/resetPasswordCLI');
      const username = resolveResetPasswordUsername(process.argv);
      await resetPasswordCLI(username);
      app.quit();
    } catch {
      app.exit(1);
    }
  } else if (isWebUIMode) {
    const userConfigInfo = loadUserWebUIConfig();
    if (userConfigInfo.exists && userConfigInfo.path) {
      // Config file loaded from user directory
    }
    const resolvedPort = resolveWebUIPort(userConfigInfo.config, getSwitchValue);
    const allowRemote = resolveRemoteAccess(userConfigInfo.config, isRemoteMode);
    try {
      await startWebServer(resolvedPort, allowRemote);
    } catch (err) {
      console.error(`[WebUI] Failed to start server on port ${resolvedPort}:`, err);
      app.exit(1);
      return;
    }

    // Keep the process alive in WebUI mode
    app.on('will-quit', (event) => {
      if (!isExplicitQuit) {
        event.preventDefault();
        console.warn('[WebUI] Prevented unexpected quit — server is still running');
      }
    });
  } else {
    createWindow();
    mark('createWindow');

    acpDetector.initialize()
      .then(() => mark('initializeAcpDetector'))
      .catch((error) => console.error('[ACP] Detection failed:', error));

    // Read language setting and initialize main process i18n, then refresh tray menu
    try {
      const savedLanguage = await ProcessConfig.get('language');
      await setInitialLanguage(savedLanguage);
      await refreshTrayMenu();
    } catch (error) {
      console.error('[main] Failed to initialize i18n language:', error);
    }

    // Initialize close-to-tray setting
    if (isE2ETestMode) {
      setCloseToTrayEnabled(false);
      destroyTray();
    } else {
      try {
        const savedCloseToTray = await ProcessConfig.get('system.closeToTray');
        setCloseToTrayEnabled(savedCloseToTray ?? false);
        if (getCloseToTrayEnabled()) {
          createOrUpdateTray();
        }
      } catch {
        // Ignore storage read errors, default to false
      }

      onCloseToTrayChanged((enabled) => {
        setCloseToTrayEnabled(enabled);
        if (enabled) {
          createOrUpdateTray();
        } else {
          destroyTray();
        }
      });
    }

    onLanguageChanged(() => {
      void refreshTrayMenu();
    });

    if (!isE2ETestMode) {
      restoreDesktopWebUIFromPreferences().catch((error) => {
        console.error('[WebUI] Failed to auto-restore:', error);
      });
    }

    // Flush pending deep-link URL (received before window was ready)
    const pendingUrl = getPendingDeepLinkUrl();
    if (pendingUrl) {
      clearPendingDeepLinkUrl();
      mainWindow.webContents.once('did-finish-load', () => {
        handleDeepLinkUrl(pendingUrl);
      });
    }
  }

  // WebUI mode also needs ACP detection for remote agent access
  if (isWebUIMode) {
    await acpDetector.initialize();
  }

  if (!isResetPasswordMode) {
    void loadShellEnvironmentAsync().then((shellEnv) => {
      if (shellEnv.PATH) {
        process.env.PATH = mergePaths(process.env.PATH, shellEnv.PATH);
      }
      for (const [key, value] of Object.entries(shellEnv)) {
        if (key !== 'PATH' && !process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }

  // Verify CDP is ready and log status
  const { cdpPort, verifyCdpReady } = await import('./utils/chromiumConfig');
  if (cdpPort) {
    const cdpReady = await verifyCdpReady(cdpPort);
    if (cdpReady) {
      console.log(`[CDP] Remote debugging server ready at http://127.0.0.1:${cdpPort}`);
      console.log(
        `[CDP] MCP chrome-devtools: npx chrome-devtools-mcp@0.16.0 --browser-url=http://127.0.0.1:${cdpPort}`
      );
    } else {
      console.warn(`[CDP] Warning: Remote debugging port ${cdpPort} not responding`);
    }
  }

  // Listen for system resume (wake from sleep/hibernate) to recover missed cron jobs
  powerMonitor.on('resume', () => {
    try {
      console.log('[App] System resumed from sleep, triggering cron recovery');
    } catch {
      // Console write may fail with EIO when PTY is broken after sleep
    }
    import('@server/services/cron/cronServiceSingleton')
      .then(({ cronService }) => {
        void cronService.handleSystemResume();
      })
      .catch(() => {
        // Cron recovery is best-effort after system resume
      });
  });
};

// ============ Protocol Registration ============
if (process.defaultApp) {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

// macOS: handle aionui:// URLs via the open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
  if (isWebUIMode || isResetPasswordMode || !app.isReady()) {
    return;
  }
  showOrCreateMainWindow({ mainWindow, createWindow });
});

void app
  .whenReady()
  .then(handleAppReady)
  .catch((_error) => {
    app.quit();
  });

app.on('window-all-closed', () => {
  if (getCloseToTrayEnabled()) {
    return;
  }
  if (!isWebUIMode && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!isWebUIMode && app.isReady()) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showAndFocusMainWindow(mainWindow);
      if (process.platform === 'darwin' && app.dock) {
        void app.dock.show();
      }
    } else {
      createWindow();
    }
  }
});

app.on('before-quit', async () => {
  console.log('[AionUi] before-quit');
  setIsQuitting(true);
  isExplicitQuit = true;
  destroyTray();
  workerTaskManager.clear();

  try {
    const { getChannelManager } = await import('@server/channels');
    await getChannelManager().shutdown();
  } catch (error) {
    console.error('[App] Failed to shutdown ChannelManager:', error);
  }
});

app.on('will-quit', () => {
  console.log('[AionUi] will-quit');
});

app.on('quit', (_event, exitCode) => {
  console.log(`[AionUi] quit (exitCode=${exitCode})`);
});
