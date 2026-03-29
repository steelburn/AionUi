import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { ResultCollector } from '../../../src/process/task/orchestrator/ResultCollector';
import type { SubTaskSession } from '../../../src/process/task/orchestrator/SubTaskSession';

/** Create a fake SubTaskSession with controllable events */
function makeFakeSession(subTaskId: string, conversationId = `conv-${subTaskId}`): SubTaskSession & EventEmitter {
  const emitter = new EventEmitter() as SubTaskSession & EventEmitter;
  (emitter as unknown as Record<string, unknown>).subTaskId = subTaskId;
  (emitter as unknown as Record<string, unknown>).conversationId = conversationId;
  return emitter;
}

describe('ResultCollector', () => {
  it('collects a successful result when session emits done', async () => {
    const collector = new ResultCollector();
    const session = makeFakeSession('t1');
    collector.register(session);

    session.emit('text', 'Hello');
    session.emit('text', ' World');
    session.emit('done');

    const results = await collector.waitForAll();
    expect(results).toHaveLength(1);
    expect(results[0].subTaskId).toBe('t1');
    expect(results[0].outputText).toBe('Hello World');
  });

  it('handles failure when session emits error', async () => {
    const collector = new ResultCollector();
    const session = makeFakeSession('t2');
    collector.register(session);

    // Set up the waitForAll promise BEFORE triggering the error event so the
    // listener is registered before the 'allSettled' event fires.
    const pending = collector.waitForAll();
    session.emit('error', new Error('agent crashed'));

    // The real implementation rejects when all sub-tasks failed (no results).
    await expect(pending).rejects.toThrow('agent crashed');
  });

  it('waits for all sessions before resolving', async () => {
    const collector = new ResultCollector();
    const s1 = makeFakeSession('s1');
    const s2 = makeFakeSession('s2');
    collector.register(s1);
    collector.register(s2);

    let resolved = false;
    const p = collector.waitForAll().then((r) => { resolved = true; return r; });

    s1.emit('done');
    await new Promise(r => setTimeout(r, 10));
    expect(resolved).toBe(false); // s2 not yet done

    s2.emit('text', 'result');
    s2.emit('done');
    const results = await p;
    expect(results).toHaveLength(2);
  });

  it('getResult returns result for completed sub-task', () => {
    const collector = new ResultCollector();
    const session = makeFakeSession('t3');
    collector.register(session);
    session.emit('text', 'output');
    session.emit('done');
    const r = collector.getResult('t3');
    expect(r?.outputText).toBe('output');
  });

  it('isAllSettled returns true after all settle', async () => {
    const collector = new ResultCollector();
    const session = makeFakeSession('t4');
    collector.register(session);
    expect(collector.isAllSettled()).toBe(false);
    session.emit('done');
    await new Promise(r => setTimeout(r, 5));
    expect(collector.isAllSettled()).toBe(true);
  });
});

describe('ResultCollector — partial result support', () => {
  it('getPartialText returns empty string when no text has been emitted', () => {
    const collector = new ResultCollector();
    const session = makeFakeSession('p1');
    collector.register(session);
    expect(collector.getPartialText('p1')).toBe('');
    expect(collector.getPartialText('unknown')).toBe('');
  });

  it('getPartialText accumulates text emitted before done', () => {
    const collector = new ResultCollector();
    const session = makeFakeSession('p2');
    collector.register(session);

    session.emit('text', 'chunk one ');
    session.emit('text', 'chunk two');

    expect(collector.getPartialText('p2')).toBe('chunk one chunk two');
  });

  it('getPartialText continues accumulating after done', () => {
    const collector = new ResultCollector();
    const session = makeFakeSession('p3');
    collector.register(session);

    session.emit('text', 'before');
    session.emit('done');
    // Partial text should still be accessible after settling
    expect(collector.getPartialText('p3')).toBe('before');
  });

  it('injectPartialResult settles the slot so waitForAll resolves', async () => {
    const collector = new ResultCollector();
    const session = makeFakeSession('p4');
    collector.register(session);

    session.emit('text', 'partial output');

    const partialResult = {
      subTaskId: 'p4',
      conversationId: 'conv-p4',
      outputText: 'partial output',
      partialOutput: 'partial output',
      timedOut: true,
      completedAt: Date.now(),
    };

    const pending = collector.waitForAll();
    collector.injectPartialResult(partialResult);

    const results = await pending;
    expect(results).toHaveLength(1);
    expect(results[0].subTaskId).toBe('p4');
    expect(results[0].timedOut).toBe(true);
    expect(results[0].partialOutput).toBe('partial output');
  });

  it('injectPartialResult emits result event', () => {
    const collector = new ResultCollector();
    const session = makeFakeSession('p5');
    collector.register(session);

    const emittedResults: unknown[] = [];
    collector.on('result', (r) => emittedResults.push(r));

    const partialResult = {
      subTaskId: 'p5',
      conversationId: 'conv-p5',
      outputText: '[timed out]',
      timedOut: true,
      completedAt: Date.now(),
    };

    collector.injectPartialResult(partialResult);
    expect(emittedResults).toHaveLength(1);
    expect((emittedResults[0] as typeof partialResult).timedOut).toBe(true);
  });

  it('injectPartialResult + normal done: two tasks settle correctly', async () => {
    const collector = new ResultCollector();
    const s1 = makeFakeSession('q1');
    const s2 = makeFakeSession('q2');
    collector.register(s1);
    collector.register(s2);

    const pending = collector.waitForAll();

    // s1 times out → inject partial
    collector.injectPartialResult({
      subTaskId: 'q1',
      conversationId: 'conv-q1',
      outputText: 'partial',
      timedOut: true,
      completedAt: Date.now(),
    });

    // s2 completes normally
    s2.emit('text', 'done text');
    s2.emit('done');

    const results = await pending;
    expect(results).toHaveLength(2);
    const q1r = results.find((r) => r.subTaskId === 'q1');
    const q2r = results.find((r) => r.subTaskId === 'q2');
    expect(q1r?.timedOut).toBe(true);
    expect(q2r?.outputText).toBe('done text');
  });
});
