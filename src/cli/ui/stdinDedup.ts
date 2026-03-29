/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Returns a deduplicated stdin stream for TTY environments.
 *
 * macOS CJK IMEs send the same UTF-8 sequence twice within ~20ms
 * (composition commit + readline echo), causing doubled characters.
 * This Duplex wrapper drops the duplicate chunk.
 *
 * In non-TTY environments (pipes, CI) returns process.stdin unchanged.
 */

import { Duplex } from 'node:stream';

export function createDedupStdin(): NodeJS.ReadableStream {
  if (!process.stdout.isTTY) return process.stdin;

  class IMEDedupStream extends Duplex {
    private _lastChunk = '';
    private _lastTime = 0;
    constructor() {
      super({ allowHalfOpen: false });
      (this as unknown as { isTTY: boolean }).isTTY = process.stdin.isTTY ?? false;
      (this as unknown as { setRawMode: typeof process.stdin.setRawMode }).setRawMode =
        process.stdin.setRawMode?.bind(process.stdin);
      process.stdin.on('data', (chunk: Buffer) => {
        const str = chunk.toString();
        const now = Date.now();
        if (/[\u0080-\uffff]/.test(str) && str === this._lastChunk && now - this._lastTime < 60) {
          return; // drop duplicate IME commit
        }
        this._lastChunk = str;
        this._lastTime = now;
        this.push(chunk);
      });
      process.stdin.on('end', () => this.push(null));
      process.stdin.on('error', (e: Error) => this.emit('error', e));
    }
    _read() {
      process.stdin.resume();
    }
    _write(_c: Buffer, _e: BufferEncoding, cb: () => void) {
      cb();
    }
  }

  return new IMEDedupStream();
}
