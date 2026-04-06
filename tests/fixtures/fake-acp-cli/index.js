#!/usr/bin/env node
/**
 * Fake ACP CLI for testing.
 *
 * Minimal ACP JSON-RPC 2.0 server communicating via stdin/stdout.
 * Supports: initialize, session/new, session/prompt (streaming chunks).
 *
 * Scenario controls are process-wide and configured via environment variables:
 * - FAKE_ACP_AUTH_MODE=none|required
 * - FAKE_ACP_PROMPT_MODE=default|delayed_first_response|late_chunk_after_cancel|exit_mid_stream|exit_mid_stream_once|silent_hang
 * - FAKE_ACP_STEP_DELAY_MS=40
 * - FAKE_ACP_EXIT_CODE=42
 * - FAKE_ACP_STATE_FILE=/tmp/fake-acp-state.json
 *
 * Legacy fallback for older tests:
 * - FAKE_ACP_SCENARIO=late_chunk_after_cancel|exit_mid_stream|auth_required|silent_hang
 * - FAKE_ACP_PROMPT_DELAY_MS=40
 */

const fs = require('fs');
const path = require('path');

const JSONRPC_VERSION = '2.0';
const DEFAULT_STEP_DELAY_MS = 40;
const DEFAULT_EXIT_CODE = 42;
const REMEMBER_CODEWORD_PATTERN = /^Remember codeword:\s*(.+)$/i;
const RECALL_CODEWORD_PATTERN = /What codeword did I ask you to remember\??/i;
const USER_REQUEST_MARKER = '[User Request]';

let sessionCounter = 0;
const activePrompts = new Map();
const localSessions = new Map();

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getLegacyScenario() {
  return process.env.FAKE_ACP_SCENARIO || 'default';
}

function getAuthMode() {
  if (process.env.FAKE_ACP_AUTH_MODE === 'required') {
    return 'required';
  }

  if (process.env.FAKE_ACP_AUTH_MODE === 'none') {
    return 'none';
  }

  return getLegacyScenario() === 'auth_required' ? 'required' : 'none';
}

function getPromptMode() {
  const configuredMode = process.env.FAKE_ACP_PROMPT_MODE;
  if (configuredMode) {
    return configuredMode;
  }

  const legacyScenario = getLegacyScenario();
  if (legacyScenario === 'late_chunk_after_cancel') {
    return 'late_chunk_after_cancel';
  }
  if (legacyScenario === 'exit_mid_stream') {
    return 'exit_mid_stream';
  }
  if (legacyScenario === 'silent_hang') {
    return 'silent_hang';
  }

  return 'default';
}

function getStateFilePath() {
  return process.env.FAKE_ACP_STATE_FILE || '';
}

function getStepDelayMs() {
  return parseNumber(process.env.FAKE_ACP_STEP_DELAY_MS || process.env.FAKE_ACP_PROMPT_DELAY_MS, DEFAULT_STEP_DELAY_MS);
}

function getExitCode() {
  return parseNumber(process.env.FAKE_ACP_EXIT_CODE, DEFAULT_EXIT_CODE);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSharedState() {
  const stateFile = getStateFilePath();
  if (!stateFile) {
    return {};
  }

  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeSharedState(state) {
  const stateFile = getStateFilePath();
  if (!stateFile) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
  } catch {
    // Best-effort state for tests only.
  }
}

function getPersistedSessions(state) {
  return isRecord(state.sessions) ? state.sessions : {};
}

function normalizeSessionState(value) {
  const record = isRecord(value) ? value : {};
  const history = Array.isArray(record.history)
    ? record.history
        .filter(
          (entry) => isRecord(entry) && typeof entry.promptText === 'string' && typeof entry.responseText === 'string'
        )
        .map((entry) => ({
          promptText: entry.promptText,
          responseText: entry.responseText,
        }))
    : [];
  const rememberedCodeword = typeof record.rememberedCodeword === 'string' ? record.rememberedCodeword : null;

  return { history, rememberedCodeword };
}

function hasSessionState(sessionId) {
  if (!sessionId) {
    return false;
  }

  if (localSessions.has(sessionId)) {
    return true;
  }

  const state = readSharedState();
  const sessions = getPersistedSessions(state);
  return isRecord(sessions[sessionId]);
}

function getSessionState(sessionId) {
  if (localSessions.has(sessionId)) {
    return localSessions.get(sessionId);
  }

  const state = readSharedState();
  const sessions = getPersistedSessions(state);
  const normalized = normalizeSessionState(sessions[sessionId]);
  localSessions.set(sessionId, normalized);
  return normalized;
}

function setSessionState(sessionId, sessionState) {
  const normalized = normalizeSessionState(sessionState);
  localSessions.set(sessionId, normalized);

  const stateFile = getStateFilePath();
  if (!stateFile) {
    return;
  }

  const state = readSharedState();
  const sessions = getPersistedSessions(state);
  writeSharedState({
    ...state,
    sessions: {
      ...sessions,
      [sessionId]: normalized,
    },
  });
}

function ensureSessionState(sessionId) {
  setSessionState(sessionId, getSessionState(sessionId));
}

function recordMethodCall(method, details = {}) {
  const state = readSharedState();
  const methodCalls = Array.isArray(state.methodCalls) ? state.methodCalls : [];
  writeSharedState({
    ...state,
    methodCalls: [...methodCalls, { method, pid: process.pid, ...details }],
  });
}

function nextSessionId() {
  const stateFile = getStateFilePath();
  if (!stateFile) {
    sessionCounter += 1;
    return `fake-session-${sessionCounter}`;
  }

  const state = readSharedState();
  const next = (Number.isInteger(state.sessionCounter) ? state.sessionCounter : 0) + 1;
  writeSharedState({
    ...state,
    sessionCounter: next,
  });
  return `fake-session-${next}`;
}

function getResumeSessionId(params) {
  if (!isRecord(params)) {
    return null;
  }

  if (typeof params.resumeSessionId === 'string' && params.resumeSessionId) {
    return params.resumeSessionId;
  }

  const meta = isRecord(params._meta) ? params._meta : null;
  const claudeCode = meta && isRecord(meta.claudeCode) ? meta.claudeCode : null;
  const options = claudeCode && isRecord(claudeCode.options) ? claudeCode.options : null;

  return typeof options?.resume === 'string' && options.resume ? options.resume : null;
}

function buildSessionResponse(sessionId) {
  return {
    sessionId,
    modes: [],
    configOptions: [],
    models: {
      currentModelId: 'fake-model-1',
      availableModels: [{ id: 'fake-model-1', name: 'Fake Model' }],
    },
  };
}

function buildSessionLoadResponse() {
  return {
    modes: [],
    configOptions: [],
    models: {
      currentModelId: 'fake-model-1',
      availableModels: [{ id: 'fake-model-1', name: 'Fake Model' }],
    },
  };
}

function bumpPromptRun(promptMode) {
  const state = readSharedState();
  const promptRuns =
    state && typeof state.promptRuns === 'object' && state.promptRuns !== null && !Array.isArray(state.promptRuns)
      ? state.promptRuns
      : {};
  const currentRuns = Number.isInteger(promptRuns[promptMode]) ? promptRuns[promptMode] : 0;

  writeSharedState({
    ...state,
    promptRuns: {
      ...promptRuns,
      [promptMode]: currentRuns + 1,
    },
  });

  return currentRuns;
}

let isAuthenticated = getAuthMode() !== 'required';

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, result });
  process.stdout.write(msg + '\n');
}

function sendError(id, code, message) {
  const msg = JSON.stringify({
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message },
  });
  process.stdout.write(msg + '\n');
}

function sendNotification(method, params) {
  const msg = JSON.stringify({ jsonrpc: JSONRPC_VERSION, method, params });
  process.stdout.write(msg + '\n');
}

function extractEffectivePromptText(promptText) {
  const markerIndex = promptText.lastIndexOf(USER_REQUEST_MARKER);
  if (markerIndex === -1) {
    return promptText.trim();
  }

  const extracted = promptText.slice(markerIndex + USER_REQUEST_MARKER.length).trim();
  return extracted || promptText.trim();
}

function buildPromptResponseText(sessionId, promptText) {
  const rememberMatch = promptText.match(REMEMBER_CODEWORD_PATTERN);
  if (rememberMatch) {
    return `Remembered codeword: ${rememberMatch[1].trim()}`;
  }

  if (RECALL_CODEWORD_PATTERN.test(promptText)) {
    const sessionState = getSessionState(sessionId);
    return sessionState.rememberedCodeword
      ? `Remembered codeword is: ${sessionState.rememberedCodeword}`
      : 'I do not know the codeword.';
  }

  return `Fake response to: ${promptText}`;
}

function buildPromptChunks(responseText) {
  return [responseText.slice(0, 10), responseText.slice(10) || ''];
}

function emitChunk(sessionId, text) {
  if (!text) return;

  sendNotification('session/update', {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  });
}

function buildUsage() {
  return {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  };
}

function persistPromptOutcome(sessionId, promptText, responseText) {
  const currentState = getSessionState(sessionId);
  const rememberMatch = promptText.match(REMEMBER_CODEWORD_PATTERN);

  setSessionState(sessionId, {
    history: [...currentState.history, { promptText, responseText }],
    rememberedCodeword: rememberMatch ? rememberMatch[1].trim() : currentState.rememberedCodeword,
  });
}

function clearPromptTimers(promptState) {
  for (const timer of promptState.timers) {
    clearTimeout(timer);
  }
  promptState.timers.clear();
}

function finishPrompt(promptState, stopReason = 'end_turn') {
  clearPromptTimers(promptState);
  if (
    stopReason === 'end_turn' &&
    typeof promptState.promptText === 'string' &&
    typeof promptState.responseText === 'string'
  ) {
    persistPromptOutcome(promptState.sessionId, promptState.promptText, promptState.responseText);
  }
  sendResponse(promptState.id, {
    stopReason,
    usage: buildUsage(),
  });
  activePrompts.delete(promptState.sessionId);
}

function schedulePrompt(promptState, callback, delayMs) {
  const timer = setTimeout(() => {
    promptState.timers.delete(timer);
    callback();
  }, delayMs);

  promptState.timers.add(timer);
}

function createPromptState(id, sessionId, promptMode) {
  const promptState = {
    id,
    sessionId,
    promptMode,
    canceled: false,
    promptText: null,
    responseText: null,
    timers: new Set(),
  };

  activePrompts.set(sessionId, promptState);
  return promptState;
}

function cleanupActivePrompts() {
  for (const promptState of activePrompts.values()) {
    clearPromptTimers(promptState);
  }
  activePrompts.clear();
}

function handleRequest(message) {
  const { id, method, params } = message;
  const authMode = getAuthMode();
  const promptMode = getPromptMode();

  switch (method) {
    case 'initialize': {
      recordMethodCall('initialize');
      const result = {
        protocolVersion: 1,
        serverCapabilities: {
          streaming: true,
          sessionManagement: true,
        },
        serverInfo: {
          name: 'fake-acp-cli',
          version: '1.0.0',
        },
      };

      if (authMode === 'required') {
        result.authMethods = [
          {
            type: 'device-login',
            id: 'fake-device-login',
          },
        ];
      }

      sendResponse(id, result);
      break;
    }

    case 'authenticate': {
      recordMethodCall('authenticate');
      isAuthenticated = true;
      sendResponse(id, { authenticated: true });
      break;
    }

    case 'session/new': {
      const resumeSessionId = getResumeSessionId(params);
      recordMethodCall('session/new', { resumeSessionId });
      if (authMode === 'required' && !isAuthenticated) {
        sendError(id, -32001, 'Authentication required');
        break;
      }

      const sessionId = resumeSessionId && hasSessionState(resumeSessionId) ? resumeSessionId : nextSessionId();
      ensureSessionState(sessionId);
      sendResponse(id, buildSessionResponse(sessionId));
      break;
    }

    case 'session/load': {
      const sessionId = isRecord(params) && typeof params.sessionId === 'string' ? params.sessionId : null;
      recordMethodCall('session/load', { sessionId });
      if (authMode === 'required' && !isAuthenticated) {
        sendError(id, -32001, 'Authentication required');
        break;
      }

      if (!sessionId || !hasSessionState(sessionId)) {
        sendError(id, -32004, 'Session not found');
        break;
      }

      ensureSessionState(sessionId);
      sendResponse(id, buildSessionLoadResponse());
      break;
    }

    case 'session/prompt': {
      const sessionId = params?.sessionId || 'unknown';
      const rawPromptText = Array.isArray(params?.prompt) && params.prompt[0]?.text ? params.prompt[0].text : 'unknown';
      const promptText = extractEffectivePromptText(rawPromptText);
      recordMethodCall('session/prompt', { sessionId, promptText });
      const responseText = buildPromptResponseText(sessionId, promptText);
      const chunks = buildPromptChunks(responseText);
      const shouldExitMidStreamOnce = promptMode === 'exit_mid_stream_once' && bumpPromptRun(promptMode) === 0;

      if (promptMode === 'silent_hang') {
        break;
      }

      if (promptMode === 'late_chunk_after_cancel') {
        const promptState = createPromptState(id, sessionId, promptMode);
        promptState.promptText = promptText;
        promptState.responseText = responseText;
        emitChunk(sessionId, chunks[0]);
        schedulePrompt(
          promptState,
          () => {
            if (promptState.canceled) {
              return;
            }

            emitChunk(sessionId, chunks[1]);
            finishPrompt(promptState);
          },
          getStepDelayMs()
        );
        break;
      }

      if (promptMode === 'delayed_first_response') {
        const promptState = createPromptState(id, sessionId, promptMode);
        promptState.promptText = promptText;
        promptState.responseText = responseText;
        schedulePrompt(
          promptState,
          () => {
            if (promptState.canceled) {
              return;
            }

            emitChunk(sessionId, chunks[0]);
            schedulePrompt(
              promptState,
              () => {
                if (promptState.canceled) {
                  return;
                }

                emitChunk(sessionId, chunks[1]);
                finishPrompt(promptState);
              },
              getStepDelayMs()
            );
          },
          getStepDelayMs()
        );
        break;
      }

      if (promptMode === 'exit_mid_stream' || shouldExitMidStreamOnce) {
        const promptState = createPromptState(id, sessionId, promptMode);
        promptState.promptText = promptText;
        promptState.responseText = responseText;
        emitChunk(sessionId, chunks[0]);
        schedulePrompt(
          promptState,
          () => {
            process.exit(getExitCode());
          },
          getStepDelayMs()
        );
        break;
      }

      const promptState = createPromptState(id, sessionId, promptMode);
      promptState.promptText = promptText;
      promptState.responseText = responseText;
      emitChunk(sessionId, chunks[0]);
      emitChunk(sessionId, chunks[1]);
      finishPrompt(promptState);
      break;
    }

    case 'session/cancel': {
      recordMethodCall('session/cancel', { sessionId: params?.sessionId || null });
      const promptState = activePrompts.get(params?.sessionId);
      if (promptState) {
        promptState.canceled = true;
        if (promptState.promptMode === 'late_chunk_after_cancel') {
          emitChunk(promptState.sessionId, '[late chunk after cancel]');
          finishPrompt(promptState, 'cancelled');
        }
      }
      break;
    }

    case 'session/set_mode':
    case 'session/set_model':
    case 'session/set_config_option': {
      recordMethodCall(method);
      sendResponse(id, {});
      break;
    }

    default: {
      if (id !== undefined) {
        const msg = JSON.stringify({
          jsonrpc: JSONRPC_VERSION,
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
        process.stdout.write(msg + '\n');
      }
      break;
    }
  }
}

// Read JSON-RPC messages from stdin, one per line

const stdin = require('readline').createInterface({ input: process.stdin, terminal: false });

stdin.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const message = JSON.parse(trimmed);
    handleRequest(message);
  } catch {
    // Ignore parse errors
  }
});

stdin.on('close', () => {
  cleanupActivePrompts();
  process.exit(0);
});

process.stdin.resume();
