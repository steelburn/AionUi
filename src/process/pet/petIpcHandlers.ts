/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { ipcMain, Menu, screen } from 'electron';
import type { PetStateMachine } from './petStateMachine';
import type { PetIdleTicker } from './petIdleTicker';
import type { PetSize } from './petTypes';

export type PetIpcContext = {
  getPetWindow: () => BrowserWindow | null;
  getPetHitWindow: () => BrowserWindow | null;
  getStateMachine: () => PetStateMachine | null;
  getIdleTicker: () => PetIdleTicker | null;
  getCurrentSize: () => PetSize;
  setCurrentSize: (size: PetSize) => void;
  hidePetWindow: () => void;
};

let dragTimer: ReturnType<typeof setInterval> | null = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

/**
 * Register IPC handlers for pet interactions (drag, click, context menu).
 */
export function registerPetIpcHandlers(ctx: PetIpcContext): void {
  ipcMain.on('pet:drag-start', () => {
    const petWindow = ctx.getPetWindow();
    const petHitWindow = ctx.getPetHitWindow();
    if (!petWindow || petWindow.isDestroyed() || !petHitWindow || petHitWindow.isDestroyed()) return;

    const cursor = screen.getCursorScreenPoint();
    const windowPos = petWindow.getPosition();
    dragOffsetX = cursor.x - windowPos[0];
    dragOffsetY = cursor.y - windowPos[1];

    ctx.getStateMachine()?.forceState('dragging');

    // 16ms drag interval (60 FPS)
    dragTimer = setInterval(() => {
      const pw = ctx.getPetWindow();
      const phw = ctx.getPetHitWindow();
      if (!pw || pw.isDestroyed() || !phw || phw.isDestroyed()) {
        clearDragTimer();
        return;
      }

      const cursor = screen.getCursorScreenPoint();
      const newX = cursor.x - dragOffsetX;
      const newY = cursor.y - dragOffsetY;

      pw.setPosition(newX, newY, false);

      const hitOffset = Math.round(ctx.getCurrentSize() * 0.2);
      phw.setPosition(newX + hitOffset, newY + hitOffset, false);

      const ticker = ctx.getIdleTicker();
      if (ticker) {
        const size = ctx.getCurrentSize();
        ticker.setPetBounds(newX, newY, size, size);
      }
    }, 16);
  });

  ipcMain.on('pet:drag-end', () => {
    clearDragTimer();
    ctx.getStateMachine()?.forceState('idle');
    ctx.getIdleTicker()?.resetIdle();
  });

  ipcMain.on('pet:click', (_event, data: { side: string; count: number }) => {
    const sm = ctx.getStateMachine();
    const ticker = ctx.getIdleTicker();
    if (!sm || !ticker) return;

    ticker.resetIdle();

    if (data.count >= 3) {
      sm.requestState('error');
    } else if (data.count === 2) {
      sm.requestState(data.side === 'left' ? 'poke-left' : 'poke-right');
    } else if (data.count === 1) {
      sm.requestState('attention');
    }
  });

  ipcMain.on('pet:context-menu', () => {
    const petHitWindow = ctx.getPetHitWindow();
    if (!petHitWindow || petHitWindow.isDestroyed()) return;

    const menu = Menu.buildFromTemplate([
      {
        label: 'Pat',
        click: () => {
          const sm = ctx.getStateMachine();
          const ticker = ctx.getIdleTicker();
          if (sm && ticker) {
            ticker.resetIdle();
            sm.requestState('happy');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Size',
        submenu: ([200, 280, 360] as PetSize[]).map((size) => ({
          label: `${size === 200 ? 'Small' : size === 280 ? 'Medium' : 'Large'} (${size}px)`,
          type: 'radio' as const,
          checked: ctx.getCurrentSize() === size,
          click: () => resizePet(ctx, size),
        })),
      },
      { type: 'separator' },
      {
        label: 'Do Not Disturb',
        type: 'checkbox',
        checked: ctx.getStateMachine()?.getDnd() ?? false,
        click: (menuItem) => {
          ctx.getStateMachine()?.setDnd(menuItem.checked);
        },
      },
      { type: 'separator' },
      {
        label: 'Reset Position',
        click: () => resetPosition(ctx),
      },
      {
        label: 'Hide',
        click: () => {
          ctx.hidePetWindow();
        },
      },
    ]);

    menu.popup({ window: petHitWindow });
  });
}

/**
 * Unregister all pet IPC handlers.
 */
export function unregisterPetIpcHandlers(): void {
  ipcMain.removeAllListeners('pet:drag-start');
  ipcMain.removeAllListeners('pet:drag-end');
  ipcMain.removeAllListeners('pet:click');
  ipcMain.removeAllListeners('pet:context-menu');
}

/**
 * Clear any active drag polling timer.
 */
export function clearDragTimer(): void {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
}

function resizePet(ctx: PetIpcContext, size: PetSize): void {
  const petWindow = ctx.getPetWindow();
  const petHitWindow = ctx.getPetHitWindow();
  if (!petWindow || petWindow.isDestroyed() || !petHitWindow || petHitWindow.isDestroyed()) return;

  ctx.setCurrentSize(size);

  const [x, y] = petWindow.getPosition();

  petWindow.setSize(size, size, false);

  const hitSize = Math.round(size * 0.6);
  const hitOffset = Math.round(size * 0.2);
  petHitWindow.setSize(hitSize, hitSize, false);
  petHitWindow.setPosition(x + hitOffset, y + hitOffset, false);

  const ticker = ctx.getIdleTicker();
  if (ticker) {
    ticker.setPetBounds(x, y, size, size);
  }

  if (!petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:resize', size);
  }
}

function resetPosition(ctx: PetIpcContext): void {
  const petWindow = ctx.getPetWindow();
  const petHitWindow = ctx.getPetHitWindow();
  if (!petWindow || petWindow.isDestroyed() || !petHitWindow || petHitWindow.isDestroyed()) return;

  const size = ctx.getCurrentSize();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const margin = 20;
  const x = screenWidth - size - margin;
  const y = screenHeight - size - margin;

  petWindow.setPosition(x, y, false);

  const hitOffset = Math.round(size * 0.2);
  petHitWindow.setPosition(x + hitOffset, y + hitOffset, false);

  const ticker = ctx.getIdleTicker();
  if (ticker) {
    ticker.setPetBounds(x, y, size, size);
  }
}
