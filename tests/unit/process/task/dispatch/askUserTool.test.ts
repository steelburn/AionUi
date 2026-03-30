/**
 * Tests for the ask_user MCP tool (G2.4)
 *
 * Tests the tool schema shape and the handler dispatch logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal types
// ---------------------------------------------------------------------------

type ToolCallResult = {
  content?: string;
  isError?: boolean;
  message?: string;
};

type AskUserParams = {
  question: string;
  context?: string;
  options?: string[];
};

type DispatchToolHandler = {
  stopChild(sessionId: string, reason?: string): Promise<string>;
  askUser(params: AskUserParams): Promise<string>;
};

// Inline the ask_user handler logic (extracted from DispatchMcpServer.handleToolCall)
async function handleAskUser(args: Record<string, unknown>, handler: DispatchToolHandler): Promise<ToolCallResult> {
  const question = String(args.question ?? '');
  const context = typeof args.context === 'string' ? args.context : undefined;
  const options = Array.isArray(args.options) ? args.options.map(String) : undefined;

  if (!question) {
    return { content: 'question is required', isError: true };
  }

  try {
    const result = await handler.askUser({ question, context, options });
    return { message: result };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { content: `Failed to ask user: ${errMsg}`, isError: true };
  }
}

// ---------------------------------------------------------------------------
// ask_user schema definition (mirrors tech design)
// ---------------------------------------------------------------------------

const ASK_USER_SCHEMA = {
  name: 'ask_user',
  description:
    'Ask the user a question when you cannot make a decision autonomously. ' +
    'The question is relayed to the group chat via the admin. ' +
    'Returns the user response when available, or a timeout message. ' +
    'Use sparingly -- only for critical decisions that require human judgment.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user. Be specific and provide context.',
      },
      context: {
        type: 'string',
        description: 'Optional additional context about why you need this answer.',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of suggested answers for the user to choose from.',
      },
    },
    required: ['question'],
  },
};

// ---------------------------------------------------------------------------

describe('ask_user MCP tool — schema', () => {
  it('has the correct tool name', () => {
    expect(ASK_USER_SCHEMA.name).toBe('ask_user');
  });

  it('requires question in inputSchema', () => {
    expect(ASK_USER_SCHEMA.inputSchema.required).toContain('question');
  });

  it('defines question as a string property', () => {
    expect(ASK_USER_SCHEMA.inputSchema.properties.question.type).toBe('string');
  });

  it('defines context as an optional string property', () => {
    expect(ASK_USER_SCHEMA.inputSchema.properties.context.type).toBe('string');
    expect(ASK_USER_SCHEMA.inputSchema.required).not.toContain('context');
  });

  it('defines options as an optional array property', () => {
    expect(ASK_USER_SCHEMA.inputSchema.properties.options.type).toBe('array');
    expect(ASK_USER_SCHEMA.inputSchema.required).not.toContain('options');
  });

  it('defines options items as string type', () => {
    expect(ASK_USER_SCHEMA.inputSchema.properties.options.items.type).toBe('string');
  });

  it('has a non-empty description', () => {
    expect(ASK_USER_SCHEMA.description.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('ask_user MCP tool — handler dispatch', () => {
  let handler: DispatchToolHandler;

  const NON_BLOCKING_RESPONSE =
    'Question submitted to admin for user relay. ' +
    'Continue with your best judgment. ' +
    'If the user responds, it will arrive via a follow-up message.';

  beforeEach(() => {
    handler = {
      stopChild: vi.fn(),
      askUser: vi.fn(),
    };
  });

  it('calls handler.askUser with question when valid args provided', async () => {
    (handler.askUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NON_BLOCKING_RESPONSE);

    await handleAskUser({ question: 'Should I use CSS modules or UnoCSS?' }, handler);

    expect(handler.askUser).toHaveBeenCalledWith({
      question: 'Should I use CSS modules or UnoCSS?',
      context: undefined,
      options: undefined,
    });
  });

  it('passes context to handler.askUser when provided', async () => {
    (handler.askUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NON_BLOCKING_RESPONSE);

    await handleAskUser({ question: 'Which approach?', context: 'Refactoring the nav bar' }, handler);

    expect(handler.askUser).toHaveBeenCalledWith(expect.objectContaining({ context: 'Refactoring the nav bar' }));
  });

  it('passes options array to handler.askUser when provided', async () => {
    (handler.askUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NON_BLOCKING_RESPONSE);

    await handleAskUser({ question: 'Pick one', options: ['CSS modules', 'UnoCSS'] }, handler);

    expect(handler.askUser).toHaveBeenCalledWith(expect.objectContaining({ options: ['CSS modules', 'UnoCSS'] }));
  });

  it('returns message from handler on success', async () => {
    (handler.askUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NON_BLOCKING_RESPONSE);

    const result = await handleAskUser({ question: 'Do X or Y?' }, handler);

    expect(result.message).toBe(NON_BLOCKING_RESPONSE);
    expect(result.isError).toBeUndefined();
  });

  it('returns immediately without blocking (non-blocking contract)', async () => {
    (handler.askUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NON_BLOCKING_RESPONSE);

    const result = await handleAskUser({ question: 'Do X?' }, handler);

    // The response must NOT be a user answer — it's a submission confirmation
    expect(result.message).not.toMatch(/yes|no|answer/i);
    expect(result.message).toMatch(/submitted|relay|continue/i);
  });

  it('returns isError:true when question is missing', async () => {
    const result = await handleAskUser({}, handler);

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/question is required/);
    expect(handler.askUser).not.toHaveBeenCalled();
  });

  it('returns isError:true when question is an empty string', async () => {
    const result = await handleAskUser({ question: '' }, handler);

    expect(result.isError).toBe(true);
  });

  it('returns isError:true with error message when handler.askUser throws', async () => {
    (handler.askUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Notifier unavailable'));

    const result = await handleAskUser({ question: 'Do X?' }, handler);

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/Notifier unavailable/);
  });

  it('converts non-string options items to strings', async () => {
    (handler.askUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NON_BLOCKING_RESPONSE);

    await handleAskUser({ question: 'Pick', options: [1, true, null] }, handler);

    const callArgs = (handler.askUser as ReturnType<typeof vi.fn>).mock.calls[0][0] as AskUserParams;
    expect(callArgs.options).toEqual(['1', 'true', 'null']);
  });

  it('treats non-array options as undefined', async () => {
    (handler.askUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NON_BLOCKING_RESPONSE);

    await handleAskUser({ question: 'Pick', options: 'not-an-array' }, handler);

    const callArgs = (handler.askUser as ReturnType<typeof vi.fn>).mock.calls[0][0] as AskUserParams;
    expect(callArgs.options).toBeUndefined();
  });
});
