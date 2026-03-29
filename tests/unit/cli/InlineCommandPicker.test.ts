/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for src/cli/ui/InlineCommandPicker.ts (pure logic portions)
 *
 * TTY-dependent rendering is skipped — process.stdout.isTTY is false in the
 * test environment, so all ANSI-write paths are no-ops.
 *
 * Verifies:
 * 1. AgentSelector — selectedIdx initialises to the active agent's index
 * 2. AgentSelector — selectedIdx is 0 when no agent is marked active
 * 3. AgentSelector — selectedIdx is 0 when the agents array is empty
 * 4. InlineCommandPicker — isActive() returns false before any attach()
 * 5. InlineCommandPicker — command list includes all required base commands
 * 6. InlineCommandPicker — agentKeys are turned into /model <key> entries
 * 7. InlineCommandPicker — empty agentKeys produces no extra /model entries
 * 8. InlineCommandPicker — /team command has inject field set to '/team '
 * 9. InlineCommandPicker — truncate helper correctly truncates ASCII
 * 10. InlineCommandPicker — truncate is Unicode-safe (uses Array.from)
 * 11. InlineCommandPicker — truncate returns string unchanged when short enough
 * 12. InlineCommandPicker — truncate appends '...' on truncation
 * 13. InlineCommandPicker — getMatchesFor returns all commands on empty filter
 * 14. InlineCommandPicker — getMatchesFor filters by prefix (case-insensitive)
 * 15. InlineCommandPicker — getMatchesFor returns [] for unknown prefix
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentSelector, InlineCommandPicker } from '../../../src/cli/ui/InlineCommandPicker';
import type { Interface as ReadlineInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// Suppress any process.stdout.write calls that may slip through
// ---------------------------------------------------------------------------

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Minimal readline stub — only the surface AgentSelector and InlineCommandPicker
// actually touch during construction / non-TTY paths.
// ---------------------------------------------------------------------------

function makeRlStub(): ReadlineInterface {
  return {
    line: '',
    history: [] as string[],
    write: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    clearLine: vi.fn(),
  } as unknown as ReadlineInterface;
}

// ---------------------------------------------------------------------------
// AgentSelector
// ---------------------------------------------------------------------------

describe('AgentSelector — selectedIdx initialisation', () => {
  it('sets selectedIdx to the index of the active agent', () => {
    const agents = [
      { key: 'claude', provider: 'anthropic', isActive: false },
      { key: 'codex', provider: 'openai', isActive: false },
      { key: 'gemini', provider: 'google', isActive: true },
    ];
    const selector = new AgentSelector(agents, makeRlStub(), vi.fn());
    const idx = (selector as unknown as { selectedIdx: number }).selectedIdx;
    expect(idx).toBe(2);
  });

  it('sets selectedIdx to 0 when no agent is marked active', () => {
    const agents = [
      { key: 'claude', provider: 'anthropic', isActive: false },
      { key: 'codex', provider: 'openai', isActive: false },
    ];
    const selector = new AgentSelector(agents, makeRlStub(), vi.fn());
    const idx = (selector as unknown as { selectedIdx: number }).selectedIdx;
    expect(idx).toBe(0);
  });

  it('sets selectedIdx to 0 when the agents array is empty', () => {
    const selector = new AgentSelector([], makeRlStub(), vi.fn());
    const idx = (selector as unknown as { selectedIdx: number }).selectedIdx;
    expect(idx).toBe(0);
  });

  it('sets selectedIdx to 0 when the first agent is the active one', () => {
    const agents = [
      { key: 'claude', provider: 'anthropic', isActive: true },
      { key: 'codex', provider: 'openai', isActive: false },
    ];
    const selector = new AgentSelector(agents, makeRlStub(), vi.fn());
    const idx = (selector as unknown as { selectedIdx: number }).selectedIdx;
    expect(idx).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// InlineCommandPicker — isActive()
// ---------------------------------------------------------------------------

describe('InlineCommandPicker — isActive', () => {
  it('returns false before attach() is called', () => {
    const picker = new InlineCommandPicker([]);
    const active = (picker as unknown as { active: boolean }).active;
    expect(active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// InlineCommandPicker — command registry
// ---------------------------------------------------------------------------

describe('InlineCommandPicker — command registry', () => {
  type CmdShape = { name: string; hint: string; description: string; inject?: string };

  function getCommands(picker: InlineCommandPicker): CmdShape[] {
    return (picker as unknown as { commands: CmdShape[] }).commands;
  }

  it('includes all required base commands', () => {
    const picker = new InlineCommandPicker([]);
    const names = getCommands(picker).map((c) => c.name);
    expect(names).toContain('/model');
    expect(names).toContain('/agents');
    expect(names).toContain('/team [goal]');
    expect(names).toContain('/clear');
    expect(names).toContain('/help');
    expect(names).toContain('/exit');
  });

  it('adds /model <key> entries for each agentKey', () => {
    const picker = new InlineCommandPicker(['claude', 'codex', 'gemini']);
    const names = getCommands(picker).map((c) => c.name);
    expect(names).toContain('/model claude');
    expect(names).toContain('/model codex');
    expect(names).toContain('/model gemini');
  });

  it('does not add extra /model entries when agentKeys is empty', () => {
    const picker = new InlineCommandPicker([]);
    const names = getCommands(picker).map((c) => c.name);
    const modelEntries = names.filter((n) => n.startsWith('/model '));
    expect(modelEntries).toHaveLength(0);
  });

  it('/team [goal] carries inject field of "/team "', () => {
    const picker = new InlineCommandPicker([]);
    const teamCmd = getCommands(picker).find((c) => c.name === '/team [goal]');
    expect(teamCmd).toBeDefined();
    expect(teamCmd!.inject).toBe('/team ');
  });

  it('base commands other than /team do not carry an inject field', () => {
    const picker = new InlineCommandPicker([]);
    const cmds = getCommands(picker).filter((c) => c.name !== '/team [goal]' && !c.name.startsWith('/model '));
    for (const cmd of cmds) {
      expect(cmd.inject, `${cmd.name} should not have inject`).toBeUndefined();
    }
  });

  it('all commands have non-empty hints and descriptions', () => {
    const picker = new InlineCommandPicker(['openai']);
    for (const cmd of getCommands(picker)) {
      expect(cmd.hint.length, `${cmd.name} missing hint`).toBeGreaterThan(0);
      expect(cmd.description.length, `${cmd.name} missing description`).toBeGreaterThan(0);
    }
  });

  it('per-agent command description references the agent key', () => {
    const picker = new InlineCommandPicker(['openai']);
    const cmd = getCommands(picker).find((c) => c.name === '/model openai');
    expect(cmd).toBeDefined();
    expect(cmd!.description).toContain('openai');
  });
});

// ---------------------------------------------------------------------------
// InlineCommandPicker — truncate (private, accessed via white-box cast)
// ---------------------------------------------------------------------------

describe('InlineCommandPicker — truncate helper', () => {
  type PickerWithTruncate = { truncate: (s: string, maxLen: number) => string };

  function truncate(str: string, maxLen: number): string {
    const picker = new InlineCommandPicker([]) as unknown as PickerWithTruncate;
    return picker.truncate(str, maxLen);
  }

  it('returns the string unchanged when it fits within maxLen', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns the string unchanged when length exactly equals maxLen', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates ASCII and appends "..."', () => {
    // maxLen=6 → keep 3 chars + '...' = 6
    expect(truncate('hello world', 6)).toBe('hel...');
  });

  it('truncates to a minimum suffix of "..." when maxLen is 3', () => {
    // maxLen=3 → keep 0 chars + '...'
    expect(truncate('abcdef', 3)).toBe('...');
  });

  it('is Unicode-safe — uses Array.from so surrogate pairs count as 1 char', () => {
    // U+1F600 GRINNING FACE is a surrogate pair in UTF-16 but one code point
    const emoji = '\u{1F600}';
    const str = `${emoji}${emoji}${emoji}${emoji}${emoji}`; // 5 code points
    expect(truncate(str, 5)).toBe(str); // exactly fits
    const truncated = truncate(str, 4); // 1 code point → '...' (4 - 3 = 1 char)
    expect(truncated).toBe(`${emoji}...`);
  });

  it('truncates a mixed Chinese + ASCII string correctly', () => {
    const str = '你好世界 hello';
    // Array.from gives code-point count = 9
    // maxLen=5 → keep 2 chars + '...' = '你好...'
    expect(truncate(str, 5)).toBe('你好...');
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// InlineCommandPicker — getMatchesFor (private, white-box)
// ---------------------------------------------------------------------------

describe('InlineCommandPicker — getMatchesFor filtering', () => {
  type PickerWithMatches = { getMatchesFor: (f: string) => { name: string }[] };

  function getMatchesFor(picker: InlineCommandPicker, filter: string): string[] {
    return (picker as unknown as PickerWithMatches).getMatchesFor(filter).map((c) => c.name);
  }

  it('returns all commands when filter is empty string', () => {
    const picker = new InlineCommandPicker(['claude']);
    const names = getMatchesFor(picker, '');
    expect(names).toContain('/model');
    expect(names).toContain('/agents');
    expect(names).toContain('/exit');
    expect(names).toContain('/model claude');
  });

  it('/m matches all /model* and no other commands', () => {
    const picker = new InlineCommandPicker(['claude', 'codex']);
    const names = getMatchesFor(picker, '/m');
    expect(names.every((n) => n.startsWith('/m'))).toBe(true);
    expect(names).toContain('/model');
    expect(names).toContain('/model claude');
    expect(names).toContain('/model codex');
    expect(names).not.toContain('/agents');
  });

  it('/e only matches /exit', () => {
    const picker = new InlineCommandPicker([]);
    const names = getMatchesFor(picker, '/e');
    expect(names).toContain('/exit');
    expect(names).not.toContain('/model');
  });

  it('/model cod matches /model codex only', () => {
    const picker = new InlineCommandPicker(['claude', 'codex']);
    const names = getMatchesFor(picker, '/model cod');
    expect(names).toEqual(['/model codex']);
  });

  it('is case-insensitive — /MODEL matches /model', () => {
    const picker = new InlineCommandPicker([]);
    const names = getMatchesFor(picker, '/MODEL');
    expect(names).toContain('/model');
  });

  it('returns empty array for an unknown prefix', () => {
    const picker = new InlineCommandPicker([]);
    const names = getMatchesFor(picker, '/zzz');
    expect(names).toHaveLength(0);
  });

  it('/agents matches only /agents', () => {
    const picker = new InlineCommandPicker([]);
    const names = getMatchesFor(picker, '/agents');
    expect(names).toEqual(['/agents']);
  });
});
