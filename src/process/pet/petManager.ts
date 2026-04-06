/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { PetStateMachine } from './petStateMachine';
import { PetIdleTicker } from './petIdleTicker';
import { PetEventBridge } from './petEventBridge';
import { setPetNotifyHook } from '../../common/adapter/main';
import { createPetWindows, loadPetContent, destroyPetWindows } from './petWindowFactory';
import { registerPetIpcHandlers, unregisterPetIpcHandlers, clearDragTimer } from './petIpcHandlers';
import type { PetSize, PetState } from './petTypes';

let petWindow: BrowserWindow | null = null;
let petHitWindow: BrowserWindow | null = null;
let stateMachine: PetStateMachine | null = null;
let idleTicker: PetIdleTicker | null = null;
let eventBridge: PetEventBridge | null = null;
let currentSize: PetSize = 280;

/**
 * Create pet windows (rendering window + hit detection window)
 */
export function createPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    petWindow.focus();
    return;
  }

  const windows = createPetWindows(currentSize);
  petWindow = windows.petWindow;
  petHitWindow = windows.petHitWindow;

  // Initialize state machine, idle ticker, and event bridge
  stateMachine = new PetStateMachine();
  idleTicker = new PetIdleTicker(stateMachine);
  eventBridge = new PetEventBridge(stateMachine, idleTicker);

  // Register state change callback → send to renderer via IPC
  stateMachine.onStateChange((state: PetState) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:state-changed', state);
    }
  });

  // Register eye move callback
  idleTicker.onEyeMove((data) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:eye-move', data);
    }
  });

  // Set pet bounds for idle ticker
  idleTicker.setPetBounds(windows.initialX, windows.initialY, currentSize, currentSize);

  // Set pet notify hook for bridge events
  setPetNotifyHook((name: string, data: unknown) => {
    if (eventBridge) {
      eventBridge.handleBridgeMessage(name, data);
    }
  });

  // Start idle ticker
  idleTicker.start();

  // Register IPC handlers
  registerPetIpcHandlers({
    getPetWindow: () => petWindow,
    getPetHitWindow: () => petHitWindow,
    getStateMachine: () => stateMachine,
    getIdleTicker: () => idleTicker,
    getCurrentSize: () => currentSize,
    setCurrentSize: (size) => {
      currentSize = size;
    },
    hidePetWindow: () => hidePetWindow(),
  });

  // Load renderer HTML
  loadPetContent(petWindow, petHitWindow);

  // Clean up on window close
  petWindow.on('closed', () => {
    destroyPetWindow();
  });

  console.log('[Pet] Pet windows created');
}

/**
 * Destroy pet windows and clean up resources
 */
export function destroyPetWindow(): void {
  clearDragTimer();

  if (eventBridge) {
    eventBridge.dispose();
    eventBridge = null;
  }

  if (idleTicker) {
    idleTicker.stop();
    idleTicker = null;
  }

  if (stateMachine) {
    stateMachine.dispose();
    stateMachine = null;
  }

  setPetNotifyHook(null);
  unregisterPetIpcHandlers();
  destroyPetWindows(petWindow, petHitWindow);

  petHitWindow = null;
  petWindow = null;

  console.log('[Pet] Pet windows destroyed');
}

/**
 * Show pet windows
 */
export function showPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
  }
  if (petHitWindow && !petHitWindow.isDestroyed()) {
    petHitWindow.show();
  }
}

/**
 * Hide pet windows
 */
export function hidePetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
  if (petHitWindow && !petHitWindow.isDestroyed()) {
    petHitWindow.hide();
  }
}

/**
 * Get event bridge instance for external calls
 */
export function getEventBridge(): PetEventBridge | null {
  return eventBridge;
}
