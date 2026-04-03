import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PetStateMachine } from '@process/pet/petStateMachine';

describe('PetStateMachine', () => {
  let sm: PetStateMachine;

  beforeEach(() => {
    vi.useFakeTimers();
    sm = new PetStateMachine();
  });

  afterEach(() => {
    sm.dispose();
    vi.useRealTimers();
  });

  it('starts in idle state', () => {
    expect(sm.getCurrentState()).toBe('idle');
  });

  it('accepts higher priority state', () => {
    const result = sm.requestState('working');
    expect(result).toBe('working');
    expect(sm.getCurrentState()).toBe('working');
  });

  it('rejects lower priority state', () => {
    sm.requestState('working'); // priority 3
    const result = sm.requestState('idle'); // priority 1
    expect(result).toBeNull();
    expect(sm.getCurrentState()).toBe('working');
  });

  it('respects min display time for lower priority', () => {
    sm.requestState('happy'); // priority 5, min 3000ms
    const result = sm.requestState('working'); // priority 3 < 5, rejected
    expect(result).toBeNull();
  });

  it('allows equal priority after min display elapsed', () => {
    sm.requestState('attention'); // priority 5, min 3000ms
    vi.advanceTimersByTime(3100);
    const result = sm.requestState('happy'); // priority 5
    expect(result).toBe('happy');
  });

  it('queues equal priority during min display', () => {
    sm.requestState('happy'); // priority 5, min 3000ms
    sm.requestState('attention'); // priority 5, queued
    expect(sm.getCurrentState()).toBe('happy');
    vi.advanceTimersByTime(3100);
    expect(sm.getCurrentState()).toBe('attention');
  });

  it('auto-returns to target state', () => {
    sm.requestState('happy'); // auto-return to idle in 4000ms
    vi.advanceTimersByTime(4100);
    expect(sm.getCurrentState()).toBe('idle');
  });

  it('yawning auto-returns to dozing', () => {
    sm.forceState('yawning'); // Force low-priority state, auto-return to dozing in 3500ms
    vi.advanceTimersByTime(3600);
    expect(sm.getCurrentState()).toBe('dozing');
  });

  it('forceState bypasses priority and min display', () => {
    sm.requestState('error'); // priority 8, min 5000ms
    sm.forceState('idle');
    expect(sm.getCurrentState()).toBe('idle');
  });

  it('fires onStateChange callback', () => {
    const cb = vi.fn();
    sm.onStateChange(cb);
    sm.requestState('thinking');
    expect(cb).toHaveBeenCalledWith('thinking', 'idle');
  });

  it('does not fire callback for same state', () => {
    sm.requestState('thinking');
    const cb = vi.fn();
    sm.onStateChange(cb);
    sm.requestState('thinking');
    expect(cb).not.toHaveBeenCalled();
  });

  it('higher priority interrupts during min display', () => {
    sm.requestState('working'); // priority 3
    const result = sm.requestState('error'); // priority 8
    expect(result).toBe('error');
  });

  it('DND mode rejects all except dragging', () => {
    sm.setDnd(true);
    expect(sm.requestState('working')).toBeNull();
    expect(sm.requestState('dragging')).toBe('dragging');
  });
});
