/**
 * Tests for the stop_child MCP tool (G2.3)
 *
 * Tests the tool schema shape and the handler dispatch logic.
 * DispatchMcpServer and DispatchToolHandler are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal types mirroring the real implementation
// ---------------------------------------------------------------------------

type ToolCallResult = {
  content?: string;
  isError?: boolean;
  session_id?: string;
  message?: string;
};

type DispatchToolHandler = {
  stopChild(sessionId: string, reason?: string): Promise<string>;
  askUser(params: { question: string; context?: string; options?: string[] }): Promise<string>;
};

// Inline the stop_child handler logic (extracted from DispatchMcpServer.handleToolCall)
async function handleStopChild(args: Record<string, unknown>, handler: DispatchToolHandler): Promise<ToolCallResult> {
  const sessionId = String(args.session_id ?? '');
  const reason = typeof args.reason === 'string' ? args.reason : undefined;

  if (!sessionId) {
    return { content: 'session_id is required', isError: true };
  }

  try {
    const result = await handler.stopChild(sessionId, reason);
    return { session_id: sessionId, message: result };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { content: `Failed to stop child: ${errMsg}`, isError: true };
  }
}

// ---------------------------------------------------------------------------
// stop_child schema definition (mirrors tech design)
// ---------------------------------------------------------------------------

const STOP_CHILD_SCHEMA = {
  name: 'stop_child',
  description:
    'Stop a running child task and clean up its resources (including worktree if any). ' +
    'The child process is killed immediately. Use read_transcript to see partial results.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'The session_id of the child task to stop.',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for stopping (logged and included in notification).',
      },
    },
    required: ['session_id'],
  },
};

// ---------------------------------------------------------------------------

describe('stop_child MCP tool — schema', () => {
  it('has the correct tool name', () => {
    expect(STOP_CHILD_SCHEMA.name).toBe('stop_child');
  });

  it('requires session_id in inputSchema', () => {
    expect(STOP_CHILD_SCHEMA.inputSchema.required).toContain('session_id');
  });

  it('defines session_id as a string property', () => {
    expect(STOP_CHILD_SCHEMA.inputSchema.properties.session_id.type).toBe('string');
  });

  it('defines reason as an optional string property', () => {
    expect(STOP_CHILD_SCHEMA.inputSchema.properties.reason.type).toBe('string');
    expect(STOP_CHILD_SCHEMA.inputSchema.required).not.toContain('reason');
  });

  it('has a non-empty description', () => {
    expect(STOP_CHILD_SCHEMA.description.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('stop_child MCP tool — handler dispatch', () => {
  let handler: DispatchToolHandler;

  beforeEach(() => {
    handler = {
      stopChild: vi.fn(),
      askUser: vi.fn(),
    };
  });

  it('calls handler.stopChild with session_id when valid args provided', async () => {
    (handler.stopChild as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'Stopped "Task A" (session-123). Use read_transcript to see partial results.'
    );

    await handleStopChild({ session_id: 'session-123' }, handler);

    expect(handler.stopChild).toHaveBeenCalledWith('session-123', undefined);
  });

  it('passes reason to handler.stopChild when provided', async () => {
    (handler.stopChild as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Stopped.');

    await handleStopChild({ session_id: 'session-123', reason: 'stuck' }, handler);

    expect(handler.stopChild).toHaveBeenCalledWith('session-123', 'stuck');
  });

  it('returns session_id and message on success', async () => {
    const successMsg = 'Stopped "Task A" (session-123).';
    (handler.stopChild as ReturnType<typeof vi.fn>).mockResolvedValueOnce(successMsg);

    const result = await handleStopChild({ session_id: 'session-123' }, handler);

    expect(result.session_id).toBe('session-123');
    expect(result.message).toBe(successMsg);
    expect(result.isError).toBeUndefined();
  });

  it('returns isError:true when session_id is missing', async () => {
    const result = await handleStopChild({}, handler);

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/session_id is required/);
    expect(handler.stopChild).not.toHaveBeenCalled();
  });

  it('returns isError:true when session_id is an empty string', async () => {
    const result = await handleStopChild({ session_id: '' }, handler);

    expect(result.isError).toBe(true);
  });

  it('returns isError:true with error message when handler.stopChild throws', async () => {
    (handler.stopChild as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Session not found'));

    const result = await handleStopChild({ session_id: 'bad-id' }, handler);

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/Session not found/);
  });

  it('handles non-Error exceptions gracefully', async () => {
    (handler.stopChild as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string error');

    const result = await handleStopChild({ session_id: 'bad-id' }, handler);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('string error');
  });
});
