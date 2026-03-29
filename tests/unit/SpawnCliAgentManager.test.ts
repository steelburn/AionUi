/**
 * Tests for SpawnCliAgentManager — verifies CLI arg assembly for claude and codex.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Stub child_process.spawn before importing the module ──────────────────────
const mockProc = {
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
  exitCode: null,
  once: vi.fn(),
};

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockProc),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}));

import { spawn } from 'node:child_process';
import { SpawnCliAgentManager } from '../../src/cli/agents/SpawnCliAgentManager';

function makeEmitter() {
  return { emitMessage: vi.fn(), emitConfirmationAdd: vi.fn(), emitConfirmationUpdate: vi.fn(), emitConfirmationRemove: vi.fn() };
}

// Helper: capture spawn call args, then immediately resolve the proc
function captureSpawnArgs(): string[] {
  let capturedArgs: string[] = [];
  (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_bin: string, args: string[]) => {
    capturedArgs = args;
    // simulate immediate 'close' so sendMessage resolves
    const proc = { ...mockProc, on: vi.fn((event: string, cb: (code: number) => void) => { if (event === 'close') cb(0); }), stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, once: vi.fn() };
    return proc;
  });
  return (capturedArgs as unknown as { get: () => string[] }).valueOf?.() ?? capturedArgs;
}

describe('SpawnCliAgentManager — buildArgs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('claude flavor', () => {
    it('first turn: --print + prompt', async () => {
      const emitter = makeEmitter();
      const mgr = new SpawnCliAgentManager('c1', { bin: 'claude', flavor: 'claude' }, emitter);

      let spawnArgs: string[] = [];
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_bin: string, args: string[]) => {
        spawnArgs = args;
        const p = { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn((e: string, cb: (n: number) => void) => { if (e === 'close') cb(0); }), once: vi.fn(), kill: vi.fn(), exitCode: null };
        return p;
      });

      await mgr.sendMessage({ content: 'hello world' });
      expect(spawnArgs).toEqual([
        '--print',
        '--dangerously-skip-permissions',
        '--no-session-persistence',
        'hello world',
      ]);
    });

    it('second turn: adds -c (continue) flag', async () => {
      const emitter = makeEmitter();
      const mgr = new SpawnCliAgentManager('c2', { bin: 'claude', flavor: 'claude' }, emitter);

      const mkProc = () => ({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn((e: string, cb: (n: number) => void) => { if (e === 'close') cb(0); }), once: vi.fn(), kill: vi.fn(), exitCode: null });
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_b: string, _a: string[]) => mkProc());

      await mgr.sendMessage({ content: 'first' });

      let secondArgs: string[] = [];
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_b: string, args: string[]) => {
        secondArgs = args;
        return mkProc();
      });

      await mgr.sendMessage({ content: 'follow up' });
      expect(secondArgs).toContain('-c');
      expect(secondArgs[0]).toBe('--print');
    });

    it('passes extraArgs between --print and prompt', async () => {
      const emitter = makeEmitter();
      const mgr = new SpawnCliAgentManager('c3', { bin: 'claude', flavor: 'claude', extraArgs: ['--model', 'sonnet'] }, emitter);

      let spawnArgs: string[] = [];
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_b: string, args: string[]) => {
        spawnArgs = args;
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn((e: string, cb: (n: number) => void) => { if (e === 'close') cb(0); }), once: vi.fn(), kill: vi.fn(), exitCode: null };
      });

      await mgr.sendMessage({ content: 'task' });
      expect(spawnArgs).toEqual([
        '--print',
        '--dangerously-skip-permissions',
        '--no-session-persistence',
        '--model',
        'sonnet',
        'task',
      ]);
    });

    it('injects --append-system-prompt before the prompt when systemPrompt is set', async () => {
      const emitter = makeEmitter();
      const mgr = new SpawnCliAgentManager(
        'c5',
        { bin: 'claude', flavor: 'claude', systemPrompt: 'You are a careful reviewer.' },
        emitter,
      );

      let spawnArgs: string[] = [];
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_b: string, args: string[]) => {
        spawnArgs = args;
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((e: string, cb: (n: number) => void) => {
            if (e === 'close') cb(0);
          }),
          once: vi.fn(),
          kill: vi.fn(),
          exitCode: null,
        };
      });

      await mgr.sendMessage({ content: 'review this' });
      // --append-system-prompt must appear BEFORE the prompt text
      const apIdx = spawnArgs.indexOf('--append-system-prompt');
      const promptIdx = spawnArgs.indexOf('review this');
      expect(apIdx).toBeGreaterThan(-1);
      expect(spawnArgs[apIdx + 1]).toBe('You are a careful reviewer.');
      expect(apIdx).toBeLessThan(promptIdx);
    });

    it('does NOT inject --append-system-prompt when systemPrompt is not set', async () => {
      const emitter = makeEmitter();
      const mgr = new SpawnCliAgentManager('c6', { bin: 'claude', flavor: 'claude' }, emitter);

      let spawnArgs: string[] = [];
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_b: string, args: string[]) => {
        spawnArgs = args;
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((e: string, cb: (n: number) => void) => {
            if (e === 'close') cb(0);
          }),
          once: vi.fn(),
          kill: vi.fn(),
          exitCode: null,
        };
      });

      await mgr.sendMessage({ content: 'hello' });
      expect(spawnArgs).not.toContain('--append-system-prompt');
    });
  });

  describe('codex flavor', () => {
    it('always includes --skip-git-repo-check', async () => {
      const emitter = makeEmitter();
      const mgr = new SpawnCliAgentManager('x1', { bin: 'codex', flavor: 'codex' }, emitter);

      let spawnArgs: string[] = [];
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_b: string, args: string[]) => {
        spawnArgs = args;
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn((e: string, cb: (n: number) => void) => { if (e === 'close') cb(0); }), once: vi.fn(), kill: vi.fn(), exitCode: null };
      });

      await mgr.sendMessage({ content: 'who are you' });
      expect(spawnArgs[0]).toBe('exec');
      expect(spawnArgs).toContain('--skip-git-repo-check');
    });

    it('second turn: still includes --skip-git-repo-check (stateless)', async () => {
      const emitter = makeEmitter();
      const mgr = new SpawnCliAgentManager('x2', { bin: 'codex', flavor: 'codex' }, emitter);

      const mkProc = () => ({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn((e: string, cb: (n: number) => void) => { if (e === 'close') cb(0); }), once: vi.fn(), kill: vi.fn(), exitCode: null });
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mkProc());
      await mgr.sendMessage({ content: 'first' });

      let secondArgs: string[] = [];
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_b: string, args: string[]) => {
        secondArgs = args;
        return mkProc();
      });
      await mgr.sendMessage({ content: 'second' });
      expect(secondArgs).toContain('--skip-git-repo-check');
    });

    it('prompt is the last argument', async () => {
      const emitter = makeEmitter();
      const mgr = new SpawnCliAgentManager('x3', { bin: 'codex', flavor: 'codex' }, emitter);

      let spawnArgs: string[] = [];
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_b: string, args: string[]) => {
        spawnArgs = args;
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn((e: string, cb: (n: number) => void) => { if (e === 'close') cb(0); }), once: vi.fn(), kill: vi.fn(), exitCode: null };
      });

      await mgr.sendMessage({ content: 'my prompt here' });
      expect(spawnArgs[spawnArgs.length - 1]).toBe('my prompt here');
    });

    it('passes extraArgs after --skip-git-repo-check', async () => {
      const emitter = makeEmitter();
      const mgr = new SpawnCliAgentManager('x4', { bin: 'codex', flavor: 'codex', extraArgs: ['--quiet'] }, emitter);

      let spawnArgs: string[] = [];
      (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce((_b: string, args: string[]) => {
        spawnArgs = args;
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn((e: string, cb: (n: number) => void) => { if (e === 'close') cb(0); }), once: vi.fn(), kill: vi.fn(), exitCode: null };
      });

      await mgr.sendMessage({ content: 'task' });
      expect(spawnArgs).toEqual(['exec', '--full-auto', '--skip-git-repo-check', '--quiet', 'task']);
    });
  });
});
