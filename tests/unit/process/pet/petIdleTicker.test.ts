import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PetIdleTicker } from '@process/pet/petIdleTicker';
import { PetStateMachine } from '@process/pet/petStateMachine';
import { screen } from 'electron';

// Mock electron screen
vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
  },
}));

describe('PetIdleTicker', () => {
  let sm: PetStateMachine;
  let ticker: PetIdleTicker;

  beforeEach(() => {
    vi.useFakeTimers();
    sm = new PetStateMachine();
    ticker = new PetIdleTicker(sm);
  });

  afterEach(() => {
    ticker.stop();
    sm.dispose();
    vi.useRealTimers();
  });

  it('does not trigger idle behaviors before 20s', async () => {
    ticker.start();
    await vi.advanceTimersByTimeAsync(19000);
    expect(sm.getCurrentState()).toBe('idle');
  });

  it('triggers random-look or random-read after 20s idle', async () => {
    ticker.start();
    await vi.advanceTimersByTimeAsync(21000);
    const state = sm.getCurrentState();
    expect(['random-look', 'random-read']).toContain(state);
  });

  it('triggers yawning after 60s idle', async () => {
    ticker.start();
    await vi.advanceTimersByTimeAsync(61000);
    expect(sm.getCurrentState()).toBe('yawning');
  });

  it('wakes on cursor movement during sleep states', async () => {
    ticker.start();
    // Get to dozing (60s + yawning auto-return 3.5s)
    await vi.advanceTimersByTimeAsync(65000);
    expect(['dozing', 'yawning']).toContain(sm.getCurrentState());

    // Move cursor
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 200, y: 200 });
    await vi.advanceTimersByTimeAsync(100);
    expect(sm.getCurrentState()).toBe('waking');
  });

  it('does not trigger idle during AI-driven states', async () => {
    sm.requestState('working');
    ticker.start();
    await vi.advanceTimersByTimeAsync(25000);
    expect(sm.getCurrentState()).toBe('working');
  });

  it('resetIdle prevents yawning', async () => {
    ticker.start();
    await vi.advanceTimersByTimeAsync(55000);
    ticker.resetIdle();
    await vi.advanceTimersByTimeAsync(10000); // 55+10=65 total but reset at 55
    expect(sm.getCurrentState()).toBe('idle');
  });
});
