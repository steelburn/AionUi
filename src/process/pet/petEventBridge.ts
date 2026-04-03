/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PetStateMachine } from './petStateMachine';
import type { PetIdleTicker } from './petIdleTicker';

const STREAM_CHANNELS = new Set(['chat.response.stream', 'openclaw.response.stream']);

type StreamMessage = {
  type?: string;
};

export class PetEventBridge {
  private taskPollInterval: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private sm: PetStateMachine,
    private ticker: PetIdleTicker
  ) {}

  handleBridgeMessage(channelName: string, data: unknown): void {
    if (this.disposed) return;
    if (!STREAM_CHANNELS.has(channelName)) return;

    const msg = data as StreamMessage | undefined;
    if (!msg?.type) return;

    let targetState: Parameters<PetStateMachine['requestState']>[0] | null = null;

    switch (msg.type) {
      case 'thinking':
      case 'thought':
        targetState = 'thinking';
        break;
      case 'text':
      case 'content':
        targetState = 'working';
        break;
      case 'finish':
        targetState = 'happy';
        break;
      case 'error':
        targetState = 'error';
        break;
    }

    if (targetState) {
      this.ticker.resetIdle();
      this.sm.requestState(targetState);
    }
  }

  handleUserSendMessage(): void {
    if (this.disposed) return;
    this.ticker.resetIdle();
    this.sm.requestState('thinking');
  }

  handleTurnCompleted(): void {
    if (this.disposed) return;
    this.ticker.resetIdle();
    this.sm.requestState('happy');
  }

  handleConfirmationAdd(): void {
    if (this.disposed) return;
    this.ticker.resetIdle();
    this.sm.requestState('notification');
  }

  startTaskPolling(getTaskCount: () => number): void {
    this.taskPollInterval = setInterval(() => {
      if (this.disposed) return;
      const count = getTaskCount();
      if (count >= 3) {
        this.sm.requestState('building');
      } else if (count >= 2) {
        this.sm.requestState('juggling');
      }
    }, 5000);
  }

  dispose(): void {
    this.disposed = true;
    if (this.taskPollInterval) {
      clearInterval(this.taskPollInterval);
      this.taskPollInterval = null;
    }
  }
}
