/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EndpointMap, EventMap } from '@aionui/protocol';

/**
 * Type-safe handler function for an endpoint.
 * Receives the request payload and returns the response.
 */
export type EndpointHandler<K extends keyof EndpointMap> = (
  data: EndpointMap[K]['request'],
) => Promise<EndpointMap[K]['response']>;

/**
 * Broadcaster function that sends a serialized message to all connected clients.
 */
export type BroadcastFn = (message: string) => void;

/**
 * Parsed incoming WebSocket message (new protocol or legacy).
 */
export type IncomingMessage =
  | { type: 'request'; id: string; name: string; data: unknown }
  | { name: string; data: unknown };

/**
 * Keys of EventMap for type-safe event emission.
 */
export type EventName = keyof EventMap;

/**
 * Keys of EndpointMap for type-safe handler registration.
 */
export type EndpointName = keyof EndpointMap;
