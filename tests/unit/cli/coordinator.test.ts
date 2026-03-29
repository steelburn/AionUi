/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for CoordinatorSession.
 *
 * All agent I/O is simulated via a fake AgentManagerFactory —
 * no real network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoordinatorSession } from '@/cli/agents/coordinator';
import type { AgentManagerFactory } from '@process/task/orchestrator/SubTaskSession';
import type { IAgentEventEmitter, AgentMessageEvent } from '@process/task/IAgentEventEmitter';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IConfirmation } from '@/common/chat/chatLib';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fake IAgentManager that emits a scripted sequence of text + done. */
function makeFakeManager(response: string): IAgentManager {
  let emitter: IAgentEventEmitter | null = null;

  return {
    type: 'acp',
    status: undefined,
    workspace: '/',
    conversation_id: 'test',
    async sendMessage() {
      if (!emitter) return;
      // Emit text in one chunk
      emitter.emitMessage('test', {
        type: 'text',
        data: { content: response, msg_id: 'msg-1' },
      } as AgentMessageEvent);
      // Signal completion
      emitter.emitMessage('test', {
        type: 'status',
        data: { status: 'done' },
      } as AgentMessageEvent);
    },
    async stop() {},
    confirm() {},
    getConfirmations(): IConfirmation[] { return []; },
    kill() {},
  };
}

/**
 * Build a factory that returns a manager emitting the given response.
 * The emitter reference is captured via the factory closure.
 */
function makeFactory(response: string): AgentManagerFactory {
  return (_conversationId, _presetContext, emitter) => {
    const mgr = makeFakeManager(response);
    // Patch emitMessage to route through our capturer
    const origSend = mgr.sendMessage.bind(mgr);
    mgr.sendMessage = async (data) => {
      // Inject emitter into closure
      (mgr as unknown as { _emitter: IAgentEventEmitter })._emitter = emitter;
      const patchedMgr = makeFakeManagerWithEmitter(response, emitter);
      return patchedMgr.sendMessage(data);
    };
    return mgr;
  };
}

function makeFakeManagerWithEmitter(response: string, emitter: IAgentEventEmitter): IAgentManager {
  return {
    type: 'acp',
    status: undefined,
    workspace: '/',
    conversation_id: 'test',
    async sendMessage() {
      emitter.emitMessage('test', {
        type: 'text',
        data: { content: response, msg_id: 'msg-1' },
      } as AgentMessageEvent);
      emitter.emitMessage('test', {
        type: 'status',
        data: { status: 'done' },
      } as AgentMessageEvent);
    },
    async stop() {},
    confirm() {},
    getConfirmations(): IConfirmation[] { return []; },
    kill() {},
  };
}

/** Factory that always returns the same manager with the given response */
function simpleFactory(response: string): AgentManagerFactory {
  return (_cid, _ctx, emitter) => makeFakeManagerWithEmitter(response, emitter);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CoordinatorSession.plan()', () => {
  it('parses a valid parallel plan', async () => {
    const json = JSON.stringify({
      goal_analysis: 'Build a REST API',
      execution_mode: 'parallel',
      specialists: [
        { role: 'Architect', focus: 'Design the API structure', phase: 1 },
        { role: 'Developer', focus: 'Implement the endpoints', phase: 1 },
        { role: 'Tester', focus: 'Write integration tests', phase: 1 },
      ],
    });
    const session = new CoordinatorSession(simpleFactory(json));
    const plan = await session.plan('Build a REST API', 3);
    expect(plan).not.toBeNull();
    expect(plan!.execution_mode).toBe('parallel');
    expect(plan!.specialists).toHaveLength(3);
    expect(plan!.specialists[0]!.role).toBe('Architect');
  });

  it('parses a sequential plan with dependsOn', async () => {
    const json = JSON.stringify({
      goal_analysis: 'Needs sequential execution',
      execution_mode: 'sequential',
      specialists: [
        { role: 'Researcher', focus: 'Research the topic', phase: 1 },
        { role: 'Writer', focus: 'Write based on research', phase: 2, dependsOn: ['Researcher'] },
      ],
    });
    const session = new CoordinatorSession(simpleFactory(json));
    const plan = await session.plan('Write a report', 2);
    expect(plan!.execution_mode).toBe('sequential');
    expect(plan!.specialists[1]!.dependsOn).toEqual(['Researcher']);
  });

  it('pads specialists array to teamSize when coordinator returns fewer', async () => {
    const json = JSON.stringify({
      goal_analysis: 'Short plan',
      execution_mode: 'parallel',
      specialists: [{ role: 'Analyst', focus: 'Analyze', phase: 1 }],
    });
    const session = new CoordinatorSession(simpleFactory(json));
    const plan = await session.plan('Analyze something', 3);
    expect(plan!.specialists).toHaveLength(3);
  });

  it('trims specialists array to teamSize when coordinator returns more', async () => {
    const json = JSON.stringify({
      goal_analysis: 'Too many',
      execution_mode: 'parallel',
      specialists: [
        { role: 'A', focus: 'a', phase: 1 },
        { role: 'B', focus: 'b', phase: 1 },
        { role: 'C', focus: 'c', phase: 1 },
        { role: 'D', focus: 'd', phase: 1 },
      ],
    });
    const session = new CoordinatorSession(simpleFactory(json));
    const plan = await session.plan('Do something', 2);
    expect(plan!.specialists).toHaveLength(2);
  });

  it('returns null when response is not valid JSON', async () => {
    const session = new CoordinatorSession(simpleFactory('Sorry, I cannot help with that.'));
    const plan = await session.plan('Do something', 2);
    expect(plan).toBeNull();
  });

  it('defaults execution_mode to parallel for unknown values', async () => {
    const json = JSON.stringify({
      goal_analysis: 'test',
      execution_mode: 'unknown_mode',
      specialists: [
        { role: 'A', focus: 'a', phase: 1 },
        { role: 'B', focus: 'b', phase: 1 },
      ],
    });
    const session = new CoordinatorSession(simpleFactory(json));
    const plan = await session.plan('test', 2);
    expect(plan!.execution_mode).toBe('parallel');
  });

  it('returns null when aborted before sending', async () => {
    const controller = new AbortController();
    controller.abort();
    const session = new CoordinatorSession(simpleFactory('{}'));
    const plan = await session.plan('test', 2, controller.signal);
    expect(plan).toBeNull();
  });
});

describe('CoordinatorSession.review()', () => {
  it('parses a valid review plan with refinements', async () => {
    const json = JSON.stringify({
      needs_refinement: [
        { role: 'Developer', issue: 'Too brief', guidance: 'Add code examples' },
      ],
    });
    const session = new CoordinatorSession(simpleFactory(json));
    const plan = await session.review('Build API', [
      { role: 'Developer', output: 'short' },
      { role: 'Tester', output: 'some tests' },
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.needs_refinement).toHaveLength(1);
    expect(plan!.needs_refinement[0]!.role).toBe('Developer');
  });

  it('parses an empty refinement list (all outputs satisfactory)', async () => {
    const json = JSON.stringify({ needs_refinement: [] });
    const session = new CoordinatorSession(simpleFactory(json));
    const plan = await session.review('Build API', [
      { role: 'Developer', output: 'good output' },
    ]);
    expect(plan!.needs_refinement).toHaveLength(0);
  });

  it('returns null for empty results', async () => {
    const session = new CoordinatorSession(simpleFactory('{}'));
    const plan = await session.review('test', []);
    expect(plan).toBeNull();
  });

  it('returns null when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const session = new CoordinatorSession(simpleFactory('{}'));
    const plan = await session.review('test', [{ role: 'A', output: 'x' }], controller.signal);
    expect(plan).toBeNull();
  });
});

describe('CoordinatorSession.synthesize()', () => {
  it('streams text to onText callback', async () => {
    const chunks: string[] = [];
    const session = new CoordinatorSession(simpleFactory('Unified synthesis output'));
    await session.synthesize(
      'test goal',
      [
        { role: 'A', output: 'output A' },
        { role: 'B', output: 'output B' },
      ],
      (t) => chunks.push(t),
    );
    expect(chunks.join('')).toBe('Unified synthesis output');
  });

  it('skips synthesis when results array is empty', async () => {
    const onText = vi.fn();
    const session = new CoordinatorSession(simpleFactory('should not be called'));
    await session.synthesize('test goal', [], onText);
    expect(onText).not.toHaveBeenCalled();
  });

  it('skips synthesis when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const onText = vi.fn();
    const session = new CoordinatorSession(simpleFactory('should not be called'));
    await session.synthesize('test', [{ role: 'A', output: 'x' }], onText, controller.signal);
    expect(onText).not.toHaveBeenCalled();
  });
});
