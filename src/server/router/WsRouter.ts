/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EndpointMap, EventMap } from '@aionui/protocol';
import type { BroadcastFn, EndpointHandler } from './types';

/**
 * WebSocket message router.
 *
 * Replaces the bridge.handle / bridge.emit pattern with a type-safe
 * request/response dispatcher backed by EndpointMap and EventMap.
 *
 * Supports both the new wire protocol ({ type, id, name, data })
 * and legacy format ({ name, data }) for backward compatibility.
 */
export class WsRouter {
  private handlers = new Map<string, EndpointHandler<any>>();
  private broadcaster: BroadcastFn | null = null;

  /**
   * Register a handler for a named endpoint.
   */
  handle<K extends keyof EndpointMap>(name: K, handler: EndpointHandler<K>): void {
    this.handlers.set(name as string, handler);
  }

  /**
   * Dispatch an incoming WebSocket message to the appropriate handler.
   * Returns a JSON response string, or null if no response is needed.
   */
  async dispatch(raw: string): Promise<string | null> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return JSON.stringify({
        type: 'response',
        id: null,
        error: 'Invalid JSON',
      });
    }

    // New protocol: { type: 'request', id, name, data }
    if (msg.type === 'request') {
      const id = msg.id as string;
      const name = msg.name as string;
      const handler = this.handlers.get(name);

      if (!handler) {
        return JSON.stringify({
          type: 'response',
          id,
          error: `Unknown endpoint: ${name}`,
        });
      }

      try {
        const result = await handler(msg.data);
        return JSON.stringify({ type: 'response', id, data: result });
      } catch (err) {
        return JSON.stringify({
          type: 'response',
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Legacy protocol: { name, data } — backward compat during transition
    if (typeof msg.name === 'string' && !msg.type) {
      const handler = this.handlers.get(msg.name);
      if (handler) {
        try {
          await handler(msg.data);
        } catch (err) {
          console.error(`[WsRouter] Legacy handler error for "${msg.name}":`, err);
        }
      }
      return null;
    }

    return null;
  }

  /**
   * Broadcast a typed event to all connected clients.
   */
  emit<K extends keyof EventMap>(name: K, data: EventMap[K]): void {
    if (this.broadcaster) {
      this.broadcaster(JSON.stringify({ type: 'event', name, data }));
    }
  }

  /**
   * Wire the WebSocket broadcast function.
   */
  setBroadcaster(fn: BroadcastFn): void {
    this.broadcaster = fn;
  }

  /**
   * Check if a handler is registered for the given endpoint name.
   */
  has(name: string): boolean {
    return this.handlers.has(name);
  }
}
