/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import type { PetSize } from './petTypes';

export type PetWindows = {
  petWindow: BrowserWindow;
  petHitWindow: BrowserWindow;
  initialX: number;
  initialY: number;
};

/**
 * Create pet rendering window and hit detection window.
 */
export function createPetWindows(size: PetSize): PetWindows {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const margin = 20;
  const x = screenWidth - size - margin;
  const y = screenHeight - size - margin;

  // Rendering window (transparent, always on top, ignores mouse events)
  const petWindow = new BrowserWindow({
    width: size,
    height: size,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'petPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === 'darwin') {
    petWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    petWindow.setAlwaysOnTop(true, 'pop-up-menu');
  }

  petWindow.setIgnoreMouseEvents(true);

  // Hit detection window (body area only, 60% of pet size)
  const hitSize = Math.round(size * 0.6);
  const hitOffset = Math.round(size * 0.2);

  const petHitWindow = new BrowserWindow({
    width: hitSize,
    height: hitSize,
    x: x + hitOffset,
    y: y + hitOffset,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'petHitPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === 'darwin') {
    petHitWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    petHitWindow.setAlwaysOnTop(true, 'pop-up-menu');
  }

  petHitWindow.setIgnoreMouseEvents(false);

  return { petWindow, petHitWindow, initialX: x, initialY: y };
}

/**
 * Load renderer HTML into pet windows.
 */
export function loadPetContent(petWindow: BrowserWindow, petHitWindow: BrowserWindow): void {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];

  if (!app.isPackaged && rendererUrl) {
    petWindow.loadURL(`${rendererUrl}/pet/pet.html`).catch((error) => {
      console.error('[Pet] loadURL failed for pet window:', error);
    });

    petHitWindow.loadURL(`${rendererUrl}/pet/pet-hit.html`).catch((error) => {
      console.error('[Pet] loadURL failed for pet-hit window:', error);
    });
  } else {
    const petFile = path.join(__dirname, '..', '..', 'renderer', 'pet', 'pet.html');
    const petHitFile = path.join(__dirname, '..', '..', 'renderer', 'pet', 'pet-hit.html');

    petWindow.loadFile(petFile).catch((error) => {
      console.error('[Pet] loadFile failed for pet window:', error);
    });

    petHitWindow.loadFile(petHitFile).catch((error) => {
      console.error('[Pet] loadFile failed for pet-hit window:', error);
    });
  }
}

/**
 * Close and destroy pet windows.
 */
export function destroyPetWindows(petWindow: BrowserWindow | null, petHitWindow: BrowserWindow | null): void {
  if (petHitWindow && !petHitWindow.isDestroyed()) {
    petHitWindow.destroy();
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
  }
}
