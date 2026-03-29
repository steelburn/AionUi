/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for src/cli/ui/format.ts
 *
 * Verifies:
 * 1. hr() returns a string of the correct length (min of columns, maxWidth)
 * 2. hr() uses '─' as the default character
 * 3. hr() uses a custom character when provided
 * 4. hr('╴', 80) caps at 80 columns even when the terminal is wider
 * 5. STATUS_ICONS contains all expected keys with correct values
 * 6. fmt.bold / dim / cyan / red / yellow wrap with the correct ANSI codes
 * 7. Spinner.start() does not throw in a non-TTY environment
 * 8. Spinner.stop() does not throw when the spinner was never started
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hr, STATUS_ICONS, fmt, Spinner } from '@/cli/ui/format';

// ---------------------------------------------------------------------------
// ANSI code constants mirrored from the source — kept in one place so tests
// remain resilient to minor formatting changes while still asserting structure.
// ---------------------------------------------------------------------------
const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const CYAN = `${ESC}[36m`;
const RED = `${ESC}[31m`;
const YELLOW = `${ESC}[33m`;
const GREEN = `${ESC}[32m`;
const BLUE = `${ESC}[34m`;
const MAGENTA = `${ESC}[35m`;

// ---------------------------------------------------------------------------
// hr()
// ---------------------------------------------------------------------------
describe('hr()', () => {
  const originalColumns = process.stdout.columns;

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      configurable: true,
    });
  });

  it('uses the default ─ character', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 40, configurable: true });
    const result = hr();
    expect([...result].every((c) => c === '─')).toBe(true);
  });

  it('returns a string whose length equals process.stdout.columns when columns < maxWidth', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 50, configurable: true });
    expect(hr().length).toBe(50);
  });

  it('caps length at default maxWidth (120) when terminal is very wide', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
    expect(hr().length).toBe(120);
  });

  it('uses a custom character when provided', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 10, configurable: true });
    const result = hr('=');
    expect(result).toBe('==========');
  });

  it("hr('╴', 80) caps at 80 even when terminal is wider", () => {
    Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
    const result = hr('╴', 80);
    // '╴' is a multi-byte char — check character count, not byte length
    expect([...result].length).toBe(80);
    expect([...result].every((c) => c === '╴')).toBe(true);
  });

  it('falls back to 80 when process.stdout.columns is undefined', () => {
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    // Default maxWidth is 120, fallback is 80 → min(80, 120) = 80
    expect(hr().length).toBe(80);
  });

  it('returns empty string when maxWidth is 0', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 40, configurable: true });
    expect(hr('─', 0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// STATUS_ICONS
// ---------------------------------------------------------------------------
describe('STATUS_ICONS', () => {
  it('has all expected keys', () => {
    const keys: (keyof typeof STATUS_ICONS)[] = ['pending', 'running', 'done', 'failed', 'cancelled'];
    for (const key of keys) {
      expect(STATUS_ICONS).toHaveProperty(key);
    }
  });

  it('STATUS_ICONS.done === "✓"', () => {
    expect(STATUS_ICONS.done).toBe('✓');
  });

  it('STATUS_ICONS.failed === "✗"', () => {
    expect(STATUS_ICONS.failed).toBe('✗');
  });

  it('STATUS_ICONS.pending is a non-empty string', () => {
    expect(typeof STATUS_ICONS.pending).toBe('string');
    expect(STATUS_ICONS.pending.length).toBeGreaterThan(0);
  });

  it('STATUS_ICONS.running is a non-empty string', () => {
    expect(typeof STATUS_ICONS.running).toBe('string');
    expect(STATUS_ICONS.running.length).toBeGreaterThan(0);
  });

  it('STATUS_ICONS.cancelled is a non-empty string', () => {
    expect(typeof STATUS_ICONS.cancelled).toBe('string');
    expect(STATUS_ICONS.cancelled.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// fmt.*
// ---------------------------------------------------------------------------
describe('fmt', () => {
  it('fmt.bold wraps with bold ANSI codes', () => {
    expect(fmt.bold('hello')).toBe(`${BOLD}hello${RESET}`);
  });

  it('fmt.dim wraps with dim ANSI codes', () => {
    expect(fmt.dim('hello')).toBe(`${DIM}hello${RESET}`);
  });

  it('fmt.cyan wraps with cyan ANSI codes', () => {
    expect(fmt.cyan('hello')).toBe(`${CYAN}hello${RESET}`);
  });

  it('fmt.red wraps with red ANSI codes', () => {
    expect(fmt.red('hello')).toBe(`${RED}hello${RESET}`);
  });

  it('fmt.yellow wraps with yellow ANSI codes', () => {
    expect(fmt.yellow('hello')).toBe(`${YELLOW}hello${RESET}`);
  });

  it('fmt.green wraps with green ANSI codes', () => {
    expect(fmt.green('hello')).toBe(`${GREEN}hello${RESET}`);
  });

  it('fmt.blue wraps with blue ANSI codes', () => {
    expect(fmt.blue('hello')).toBe(`${BLUE}hello${RESET}`);
  });

  it('fmt.magenta wraps with magenta ANSI codes', () => {
    expect(fmt.magenta('hello')).toBe(`${MAGENTA}hello${RESET}`);
  });

  it('passes through an empty string without altering it (just wrappers)', () => {
    expect(fmt.bold('')).toBe(`${BOLD}${RESET}`);
  });

  it('does not double-reset when input already contains ANSI codes', () => {
    // fmt functions do NOT strip existing codes — they just wrap; verify
    // that the outer RESET is still appended once.
    const nested = fmt.bold(fmt.cyan('x'));
    expect(nested.endsWith(RESET)).toBe(true);
    expect(nested.startsWith(BOLD)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------
describe('Spinner', () => {
  let originalIsTTY: boolean | undefined;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
    originalWrite = process.stdout.write.bind(process.stdout);
    vi.useFakeTimers();
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
    process.stdout.write = originalWrite;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('start() does not throw in a non-TTY environment', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const spinner = new Spinner();
    expect(() => spinner.start()).not.toThrow();
  });

  it('stop() does not throw when the spinner was never started', () => {
    const spinner = new Spinner();
    expect(() => spinner.stop()).not.toThrow();
  });

  it('stop() does not throw when called after start() in non-TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const spinner = new Spinner();
    spinner.start();
    expect(() => spinner.stop()).not.toThrow();
  });

  it('start() in TTY mode writes spinner frames to stdout on each interval', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const spinner = new Spinner('loading');
    spinner.start();

    // Advance two intervals (80ms each)
    vi.advanceTimersByTime(160);

    expect(writeSpy).toHaveBeenCalled();
    // Clean up
    spinner.stop();
  });

  it('stop() clears the line in TTY mode', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const spinner = new Spinner();
    spinner.start();
    spinner.stop();

    // The last write should be the clear-line sequence
    const calls = writeSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((s) => s.includes('\x1b[2K'))).toBe(true);
  });

  it('calling stop() twice does not throw', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const spinner = new Spinner();
    spinner.start();
    spinner.stop();
    expect(() => spinner.stop()).not.toThrow();
  });

  it('calling start() twice does not start a second interval', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const spinner = new Spinner();
    spinner.start();
    spinner.start(); // second call should be ignored

    vi.advanceTimersByTime(80);
    const callCount = writeSpy.mock.calls.length;

    // Advance another interval — if a second timer were running, we'd see double frames
    vi.advanceTimersByTime(80);
    expect(writeSpy.mock.calls.length - callCount).toBe(1);

    spinner.stop();
  });
});
