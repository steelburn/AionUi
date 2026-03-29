/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for createDedupStdin (src/cli/ui/stdinDedup.ts).
 *
 * Strategy:
 *   - Non-TTY path: verified by ensuring process.stdout.isTTY is falsy —
 *     the function returns process.stdin unchanged.
 *   - TTY path: we replace process.stdin with a controllable EventEmitter,
 *     set process.stdout.isTTY = true, then call the function and drive
 *     events manually. Module cache is invalidated between tests so that
 *     each call to the factory reads the current process.stdin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// ── Fake stdin factory ─────────────────────────────────────────────────────

type FakeStdin = EventEmitter & {
  isTTY: boolean | undefined;
  resume: ReturnType<typeof vi.fn>;
  setRawMode: ReturnType<typeof vi.fn> | undefined;
};

function makeFakeStdin(isTTY = true): FakeStdin {
  const ee = new EventEmitter() as FakeStdin;
  ee.isTTY = isTTY;
  ee.resume = vi.fn();
  ee.setRawMode = isTTY ? vi.fn() : undefined;
  return ee;
}

// ── State preserved across tests so we can restore it ─────────────────────

let origStdoutIsTTY: boolean | undefined;
let origStdin: NodeJS.ReadStream & { fd: 0 };

// ── Re-import helper ───────────────────────────────────────────────────────

/**
 * Reset the module registry and re-import the subject so that the factory
 * reads the current process.stdin at construction time.
 */
async function freshImport(): Promise<(typeof import('@/cli/ui/stdinDedup'))['createDedupStdin']> {
  vi.resetModules();
  const mod = await import('@/cli/ui/stdinDedup');
  return mod.createDedupStdin;
}

// ── Shared setup/teardown ──────────────────────────────────────────────────

beforeEach(() => {
  origStdoutIsTTY = process.stdout.isTTY;
  origStdin = process.stdin;
});

afterEach(() => {
  // Always restore real timers — prevents fake timer contamination across tests
  vi.useRealTimers();
  Object.defineProperty(process.stdout, 'isTTY', {
    value: origStdoutIsTTY,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(process, 'stdin', {
    value: origStdin,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
  // Ensure module cache is clean after each test
  vi.resetModules();
});

// ── Helpers ────────────────────────────────────────────────────────────────

function setStdoutTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  });
}

function setFakeStdin(fake: FakeStdin): void {
  Object.defineProperty(process, 'stdin', {
    value: fake,
    configurable: true,
    writable: true,
  });
}

/**
 * Attach a 'data' collector and switch the stream to flowing mode.
 * Note: the Duplex internal read cycle is asynchronous — callers must
 * await `drainMicrotasks()` before inspecting collected chunks.
 */
function collectChunks(stream: NodeJS.ReadableStream): string[] {
  const result: string[] = [];
  stream.on('data', (chunk: Buffer) => {
    result.push(chunk.toString());
  });
  (stream as NodeJS.ReadableStream & { resume(): void }).resume();
  return result;
}

/**
 * Flush the stream's internal read queue.
 * Uses process.nextTick which is not intercepted by vi.useFakeTimers().
 */
function drainMicrotasks(): Promise<void> {
  return new Promise((resolve) => process.nextTick(resolve));
}

// ── Non-TTY tests ──────────────────────────────────────────────────────────

describe('createDedupStdin — non-TTY environment', () => {
  it('returns process.stdin directly when stdout.isTTY is false', async () => {
    setStdoutTTY(false);
    const createDedupStdin = await freshImport();
    const result = createDedupStdin();
    expect(result).toBe(process.stdin);
  });

  it('returns process.stdin directly when stdout.isTTY is undefined', async () => {
    setStdoutTTY(undefined);
    const createDedupStdin = await freshImport();
    const result = createDedupStdin();
    expect(result).toBe(process.stdin);
  });
});

// ── TTY tests ──────────────────────────────────────────────────────────────

describe('createDedupStdin — TTY environment', () => {
  it('returns a stream different from process.stdin in TTY mode', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const result = createDedupStdin();

    expect(result).not.toBe(fake);
  });

  it('is a Readable stream', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const result = createDedupStdin();

    expect(result).toBeInstanceOf(Readable);
  });

  it('forwards isTTY=true from process.stdin onto the returned stream', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();

    expect((stream as unknown as { isTTY: boolean }).isTTY).toBe(true);
  });

  it('forwards isTTY=false when process.stdin.isTTY is false', async () => {
    const fake = makeFakeStdin(false);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();

    expect((stream as unknown as { isTTY: boolean }).isTTY).toBe(false);
  });

  it('passes through distinct ASCII chunks without dropping any', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();
    const chunks = collectChunks(stream);

    fake.emit('data', Buffer.from('a'));
    fake.emit('data', Buffer.from('b'));
    fake.emit('data', Buffer.from('c'));

    await drainMicrotasks();
    expect(chunks).toEqual(['a', 'b', 'c']);
  });

  it('never deduplicates identical ASCII input even if repeated rapidly', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();
    const chunks = collectChunks(stream);

    // Single-byte ASCII: /[\u0080-\uffff]/ does NOT match → all pass through
    fake.emit('data', Buffer.from('x'));
    fake.emit('data', Buffer.from('x'));
    fake.emit('data', Buffer.from('x'));

    await drainMicrotasks();
    expect(chunks).toEqual(['x', 'x', 'x']);
  });

  it('drops a duplicate CJK chunk within the 60ms dedup window', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();
    const chunks = collectChunks(stream);

    const cjk = Buffer.from('你好');

    // Both emitted synchronously (< 1ms apart) → second is dropped
    fake.emit('data', cjk);
    fake.emit('data', cjk);

    await drainMicrotasks();
    expect(chunks).toEqual(['你好']);
  });

  it('allows the same CJK chunk again after the 60ms window expires', async () => {
    // Use real timers so drainMicrotasks (setImmediate) works correctly.
    // Simulate elapsed time by manipulating Date.now via a spy instead.
    let fakeNow = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();
    const chunks = collectChunks(stream);

    const cjk = Buffer.from('你好');

    // First emit at t=0
    fake.emit('data', cjk);
    await drainMicrotasks();
    expect(chunks).toHaveLength(1);

    // Advance beyond the 60ms dedup window
    fakeNow = 61;

    // Second emit at t=61ms — should pass through
    fake.emit('data', cjk);
    await drainMicrotasks();

    vi.restoreAllMocks();
    expect(chunks).toEqual(['你好', '你好']);
  });

  it('does not drop CJK chunks when consecutive content differs', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();
    const chunks = collectChunks(stream);

    // Different CJK strings — neither should be dropped
    fake.emit('data', Buffer.from('你好'));
    fake.emit('data', Buffer.from('世界'));

    await drainMicrotasks();
    expect(chunks).toEqual(['你好', '世界']);
  });

  it('dedup resets after a different chunk is interleaved', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();
    const chunks = collectChunks(stream);

    const cjk = Buffer.from('测试');
    const other = Buffer.from('其他');

    fake.emit('data', cjk);   // passes: first occurrence
    fake.emit('data', other); // passes: different content, resets last
    fake.emit('data', cjk);   // passes: last was 'other', so '测试' is new

    await drainMicrotasks();
    expect(chunks).toEqual(['测试', '其他', '测试']);
  });

  it('propagates the end event from process.stdin', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();

    let ended = false;
    stream.on('end', () => {
      ended = true;
    });
    // Consume stream in flowing mode so 'end' is emitted
    stream.resume();

    fake.emit('end');

    await drainMicrotasks();
    expect(ended).toBe(true);
  });

  it('propagates errors from process.stdin', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();

    const error = new Error('read error');
    let caught: Error | null = null;
    stream.on('error', (e: Error) => {
      caught = e;
    });

    fake.emit('error', error);

    // Error events are synchronous on EventEmitter
    expect(caught).toBe(error);
  });

  it('calls process.stdin.resume() when _read is triggered by consuming data', async () => {
    const fake = makeFakeStdin(true);
    setStdoutTTY(true);
    setFakeStdin(fake);

    const createDedupStdin = await freshImport();
    const stream = createDedupStdin();

    // Entering flowing mode triggers _read which calls process.stdin.resume()
    stream.on('data', () => {});
    stream.resume();

    await drainMicrotasks();
    expect(fake.resume).toHaveBeenCalled();
  });
});
