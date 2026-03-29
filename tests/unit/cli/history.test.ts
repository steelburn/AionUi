/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for src/cli/ui/history.ts
 *
 * Verifies:
 * 1. loadHistory() returns [] when the history file does not exist
 * 2. loadHistory() returns commands newest-first (reversed)
 * 3. loadHistory() correctly parses TSV format (timestamp\tcommand)
 * 4. loadHistory() caps results at MAX_HISTORY (1000) entries
 * 5. loadHistory() skips malformed lines that have no tab / empty command column
 * 6. appendHistory() creates the history file if it doesn't exist
 * 7. appendHistory() writes an ISO8601\tcommand\n line
 * 8. appendHistory() silently swallows fs errors (does not throw)
 * 9. appendHistory() is a no-op for empty / whitespace-only strings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// We mock 'node:fs' at the module level so every import of history.ts gets
// the mocked version. vi.mock is hoisted by Vitest automatically.
// ---------------------------------------------------------------------------
vi.mock('node:fs');
vi.mock('node:os', () => ({
  homedir: () => '/mock-home',
}));

import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Build N TSV lines where commands are cmd-0 … cmd-(n-1) (oldest → newest) */
function buildTsvLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `2024-01-01T00:00:0${i % 10}.000Z\tcmd-${i}`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// loadHistory
// ---------------------------------------------------------------------------
describe('loadHistory', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when the history file does not exist', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const { loadHistory } = await import('@/cli/ui/history');
    expect(loadHistory()).toEqual([]);
  });

  it('returns commands newest-first (array reversed)', async () => {
    // Three entries: cmd-0 (oldest) … cmd-2 (newest) in file order
    vi.mocked(fs.readFileSync).mockReturnValue(
      '2024-01-01T00:00:00.000Z\tcmd-0\n2024-01-01T00:00:01.000Z\tcmd-1\n2024-01-01T00:00:02.000Z\tcmd-2\n'
    );

    const { loadHistory } = await import('@/cli/ui/history');
    expect(loadHistory()).toEqual(['cmd-2', 'cmd-1', 'cmd-0']);
  });

  it('parses TSV format correctly — only extracts the command column', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('2024-06-15T12:34:56.789Z\techo hello world\n');

    const { loadHistory } = await import('@/cli/ui/history');
    const result = loadHistory();
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('echo hello world');
  });

  it('caps results at MAX_HISTORY (1000) entries', async () => {
    // Provide 1200 lines — only the last 1000 should be kept, then reversed
    vi.mocked(fs.readFileSync).mockReturnValue(buildTsvLines(1200));

    const { loadHistory } = await import('@/cli/ui/history');
    const result = loadHistory();
    expect(result).toHaveLength(1000);
    // The first element must be the newest of the 1000 retained entries (cmd-1199)
    expect(result[0]).toBe('cmd-1199');
    // The last element must be the oldest retained (cmd-200, since we sliced [-1000:])
    expect(result[999]).toBe('cmd-200');
  });

  it('skips malformed lines that have no tab (no command column)', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      'no-tab-line\n2024-01-01T00:00:00.000Z\tvalid-command\n\t\n'
    );

    const { loadHistory } = await import('@/cli/ui/history');
    const result = loadHistory();
    // 'no-tab-line' yields l.split('\t')[1] === undefined → filtered out
    // '\t' yields empty string → filtered out by .filter(Boolean)
    expect(result).toEqual(['valid-command']);
  });

  it('returns empty array when file exists but is empty', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('');

    const { loadHistory } = await import('@/cli/ui/history');
    expect(loadHistory()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// appendHistory
// ---------------------------------------------------------------------------
describe('appendHistory', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the directory (mkdirSync recursive) before appending', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined);

    const { appendHistory } = await import('@/cli/ui/history');
    appendHistory('git status');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/mock-home/.aion', { recursive: true });
  });

  it('appends a TSV line in ISO8601\\tcommand\\n format', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    let capturedContent = '';
    vi.mocked(fs.appendFileSync).mockImplementation((_path, data) => {
      capturedContent = data as string;
    });

    const before = Date.now();
    const { appendHistory } = await import('@/cli/ui/history');
    appendHistory('ls -la');
    const after = Date.now();

    // Must end with newline
    expect(capturedContent.endsWith('\n')).toBe(true);

    const parts = capturedContent.trimEnd().split('\t');
    expect(parts).toHaveLength(2);

    // First column must be a valid ISO8601 date within the test's time window
    const ts = new Date(parts[0]!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);

    // Second column is the command
    expect(parts[1]).toBe('ls -la');
  });

  it('encodes embedded newlines in the command as \\\\n', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    let capturedContent = '';
    vi.mocked(fs.appendFileSync).mockImplementation((_path, data) => {
      capturedContent = data as string;
    });

    const { appendHistory } = await import('@/cli/ui/history');
    appendHistory('line1\nline2');

    const command = capturedContent.trimEnd().split('\t')[1];
    expect(command).toBe('line1\\nline2');
  });

  it('silently fails when the directory is not writable — does not throw', async () => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });

    const { appendHistory } = await import('@/cli/ui/history');
    // Must not throw
    expect(() => appendHistory('some command')).not.toThrow();
  });

  it('silently fails when appendFileSync throws — does not throw', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.appendFileSync).mockImplementation(() => {
      throw new Error('disk full');
    });

    const { appendHistory } = await import('@/cli/ui/history');
    expect(() => appendHistory('some command')).not.toThrow();
  });

  it('does not append empty strings', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined);

    const { appendHistory } = await import('@/cli/ui/history');
    appendHistory('');

    expect(fs.appendFileSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it('does not append whitespace-only strings', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined);

    const { appendHistory } = await import('@/cli/ui/history');
    appendHistory('   \t  ');

    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('writes to ~/.aion/history.tsv', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined);

    const { appendHistory } = await import('@/cli/ui/history');
    appendHistory('pwd');

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      '/mock-home/.aion/history.tsv',
      expect.any(String),
      'utf8'
    );
  });
});

// ---------------------------------------------------------------------------
// getHistoryPath
// ---------------------------------------------------------------------------
describe('getHistoryPath', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns the path under the mocked home directory', async () => {
    const { getHistoryPath } = await import('@/cli/ui/history');
    expect(getHistoryPath()).toBe('/mock-home/.aion/history.tsv');
  });
});

// ---------------------------------------------------------------------------
// compressHistory
// ---------------------------------------------------------------------------
describe('compressHistory', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps exactly COMPRESS_THRESHOLD (500) lines when the file has more', async () => {
    // Build 600 non-empty lines
    const lines = Array.from({ length: 600 }, (_, i) => `2024-01-01T00:00:00.000Z\tcmd-${i}`);
    vi.mocked(fs.readFileSync).mockReturnValue(lines.join('\n') + '\n');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);

    const { compressHistory } = await import('@/cli/ui/history');
    compressHistory();

    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string;
    const writtenLines = writtenContent.split('\n').filter((l) => l.trim().length > 0);
    expect(writtenLines).toHaveLength(500);
    // Last 500 of 600 means cmd-100 … cmd-599
    expect(writtenLines[0]).toContain('cmd-100');
    expect(writtenLines[499]).toContain('cmd-599');
  });

  it('does nothing when the file has fewer than or equal to COMPRESS_THRESHOLD (500) lines', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `2024-01-01T00:00:00.000Z\tcmd-${i}`);
    vi.mocked(fs.readFileSync).mockReturnValue(lines.join('\n') + '\n');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const { compressHistory } = await import('@/cli/ui/history');
    compressHistory();

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('is silent when the history file does not exist — does not throw', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const { compressHistory } = await import('@/cli/ui/history');
    expect(() => compressHistory()).not.toThrow();
  });

  it('renames the tmp file to the history path after writing', async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `2024-01-01T00:00:00.000Z\tcmd-${i}`);
    vi.mocked(fs.readFileSync).mockReturnValue(lines.join('\n') + '\n');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);

    const { compressHistory } = await import('@/cli/ui/history');
    compressHistory();

    expect(fs.renameSync).toHaveBeenCalledOnce();
    const [tmpPath, destPath] = vi.mocked(fs.renameSync).mock.calls[0]!;
    expect(String(tmpPath)).toMatch(/history\.tsv\.tmp$/);
    expect(String(destPath)).toMatch(/history\.tsv$/);
  });
});
