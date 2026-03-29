/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * InlineCommandPicker — Claude-CLI-style floating slash command menu.
 *
 * Draws a filtered list of commands BELOW the current readline prompt
 * using ANSI cursor-save/restore. No raw mode, no new dependencies.
 * Works in Warp and all standard terminals.
 *
 * Lifecycle:
 *   1. Attach to a readline Interface via attach()
 *   2. Listens to stdin keypress events
 *   3. When input starts with '/', draws menu below cursor
 *   4. Arrow ↑/↓ → navigate; Enter → inject selection; Esc → dismiss
 *   5. Any other key → filter/redraw
 *   6. detach() cleans up all listeners
 */
import type { Interface as ReadlineInterface} from 'node:readline';
import { emitKeypressEvents } from 'node:readline';
import { fmt } from './format';

type KeypressKey = {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

// ── ANSI primitives ────────────────────────────────────────────────────────

const ESC = '\x1b';
const SAVE    = `${ESC}7`;       // DEC save cursor (better compat than ESC[s)
const RESTORE = `${ESC}8`;       // DEC restore cursor
const DOWN1   = `${ESC}[1B`;     // cursor down 1 line
const ERASE   = `${ESC}[2K`;     // erase whole line
const COL1    = `${ESC}[1G`;     // move to column 1
const HIDE    = `${ESC}[?25l`;   // hide cursor (reduce flicker)
const SHOW    = `${ESC}[?25h`;   // show cursor

// ── Command registry ───────────────────────────────────────────────────────

type Cmd = { name: string; hint: string; description: string; inject?: string };

function buildCommands(agentKeys: string[]): Cmd[] {
  const base: Cmd[] = [
    {
      name: '/model',
      hint: '切换 Agent',
      description: '打开内联选择器，↑↓ 浏览已配置的 Agent，Enter 确认切换，新会话立即生效',
    },
    {
      name: '/agents',
      hint: '查看 Agent 列表',
      description: '列出所有已配置的 Agent 及其 provider 和当前状态，支持 /model <名称> 直接切换',
    },
    {
      name: '/team [目标]',
      hint: '启动多 Agent 团队',
      description: '并行调度多个 Agent 分工协作，自动推断 UX/架构/审查等角色，输入目标描述后执行',
      inject: '/team ',
    },
    {
      name: '/clear',
      hint: '清屏',
      description: '清空终端屏幕，保留当前会话上下文，对话历史不受影响',
    },
    {
      name: '/help',
      hint: '显示帮助',
      description: '查看所有可用命令及用法说明，包含 team 模式、model 切换等完整参考',
    },
    {
      name: '/exit',
      hint: '退出',
      description: '结束当前会话，退出 Aion，等同于 Ctrl+D',
    },
  ];
  // Add per-agent shortcuts after /model
  const modelEntries: Cmd[] = agentKeys.map((k) => ({
    name: `/model ${k}`,
    hint: `切换到 ${k}`,
    description: `直接切换到 ${k}，立即对当前会话生效`,
  }));
  return [...base, ...modelEntries];
}

// ── Agent selector ─────────────────────────────────────────────────────────

type AgentEntry = { key: string; provider: string; isActive: boolean };

/**
 * AgentSelector — inline ↑/↓ picker for `/model` (no-arg).
 *
 * Renders a list of configured agents below the current cursor using the same
 * ESC7/ESC8 + DOWN1 + ERASE mechanism as InlineCommandPicker.  Ownership of
 * the keypress listener is taken on show() and released on hide().
 */
export class AgentSelector {
  private agents: AgentEntry[];
  private rl: ReadlineInterface;
  private onSelect: (key: string | null) => void;
  private selectedIdx: number;
  private visibleCount = 0;
  private keypressListener: ((ch: string | undefined, key: KeypressKey) => void) | null = null;

  constructor(
    agents: AgentEntry[],
    rl: ReadlineInterface,
    onSelect: (key: string | null) => void,
  ) {
    this.agents = agents;
    this.rl = rl;
    this.onSelect = onSelect;
    this.selectedIdx = Math.max(0, agents.findIndex((a) => a.isActive));
  }

  /** Display the selector and start listening for keypresses. */
  show(): void {
    if (!process.stdout.isTTY) return;
    this.redraw();
    this.keypressListener = this.onKeypress.bind(this);
    process.stdin.on('keypress', this.keypressListener);
  }

  /** Clear the rendered rows and detach the listener. */
  hide(): void {
    if (this.keypressListener) {
      process.stdin.off('keypress', this.keypressListener);
      this.keypressListener = null;
    }
    this.clear();
  }

  private onKeypress(_ch: string | undefined, key: KeypressKey | undefined): void {
    if (!key) return;

    if (key.name === 'escape') {
      this.hide();
      this.onSelect(null);
      return;
    }

    if (key.name === 'up') {
      this.selectedIdx = Math.max(0, this.selectedIdx - 1);
      this.redraw();
      return;
    }

    if (key.name === 'down') {
      this.selectedIdx = Math.min(this.agents.length - 1, this.selectedIdx + 1);
      this.redraw();
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      const selected = this.agents[this.selectedIdx];
      this.hide();
      if (selected) this.onSelect(selected.key);
      return;
    }
  }

  private redraw(): void {
    if (!process.stdout.isTTY) return;
    const cols = process.stdout.columns ?? 80;

    const header = `  ${fmt.bold('选择 Agent：')}`;
    const rows: string[] = this.agents.map((agent, i) => {
      const isSelected = i === this.selectedIdx;
      const dot = agent.isActive ? fmt.green('●') : fmt.dim('○');
      const nameStr = isSelected ? fmt.bold(fmt.cyan(agent.key)) : fmt.cyan(agent.key);
      const providerStr = fmt.dim(agent.provider);
      const activeLabel = agent.isActive ? fmt.dim('  ← 当前') : '';
      const prefix = isSelected ? fmt.cyan('❯ ') : '  ';
      const rawLen = `${isSelected ? '❯ ' : '  '}${dot}  ${agent.key}  ${agent.provider}${agent.isActive ? '  ← 当前' : ''}`.length;
      const padLen = Math.max(0, cols - rawLen - 2);
      const bg = isSelected ? '\x1b[7m' : '';
      const reset = isSelected ? '\x1b[0m' : '';
      return `${bg}${prefix}${dot} ${nameStr}  ${providerStr}${activeLabel}${' '.repeat(padLen)}${reset}`;
    });
    const hint = fmt.dim('  ↑↓ 切换  Enter 确认  Esc 取消');

    const totalLines = 1 + rows.length + 1; // header + rows + hint
    let out = HIDE + SAVE;

    // Clear previously rendered lines
    for (let i = 0; i < this.visibleCount; i++) {
      out += DOWN1 + COL1 + ERASE;
    }

    out += RESTORE + SAVE;

    // Write header
    out += DOWN1 + COL1 + ERASE + header;
    // Write agent rows
    for (const row of rows) {
      out += DOWN1 + COL1 + ERASE + row;
    }
    // Write hint
    out += DOWN1 + COL1 + ERASE + hint;

    out += RESTORE + SHOW;

    this.visibleCount = totalLines;
    process.stdout.write(out);
  }

  private clear(): void {
    if (!process.stdout.isTTY || this.visibleCount === 0) return;
    let out = HIDE + SAVE;
    for (let i = 0; i < this.visibleCount; i++) {
      out += DOWN1 + COL1 + ERASE;
    }
    out += RESTORE + SHOW;
    process.stdout.write(out);
    this.visibleCount = 0;
  }
}

// ── Picker state ───────────────────────────────────────────────────────────

export class InlineCommandPicker {
  private commands: Cmd[];
  private rl: ReadlineInterface | null = null;
  private active = false;
  private filter = '';
  private selectedIdx = 0;
  private visibleCount = 0;
  private keypressListener: ((ch: string | undefined, key: KeypressKey) => void) | null = null;

  constructor(agentKeys: string[] = []) {
    this.commands = buildCommands(agentKeys);
  }

  /** Attach to a readline interface. Must be called before any input. */
  attach(rl: ReadlineInterface): void {
    this.rl = rl;

    // Enable keypress events on stdin (safe to call multiple times)
    emitKeypressEvents(process.stdin, rl);

    this.keypressListener = this.onKeypress.bind(this);
    process.stdin.on('keypress', this.keypressListener);
  }

  detach(): void {
    if (this.keypressListener) {
      process.stdin.off('keypress', this.keypressListener);
      this.keypressListener = null;
    }
    if (this.active) this.hidePicker();
    this.rl = null;
  }

  /**
   * Launch an AgentSelector overlay using this picker's attached readline
   * interface.  The picker's own keypress listener is temporarily paused
   * while the selector is active to avoid double-handling.
   *
   * @param agents   - list of agents to display
   * @param onSelect - called with the chosen key, or null if cancelled
   */
  showAgentSelector(agents: AgentEntry[], onSelect: (key: string | null) => Promise<void> | void): void {
    if (!this.rl) return;

    // Pause picker's own listener while selector is active
    if (this.keypressListener) {
      process.stdin.off('keypress', this.keypressListener);
    }
    if (this.active) this.hidePicker();

    const restoreListener = (): void => {
      if (this.keypressListener) {
        process.stdin.on('keypress', this.keypressListener);
      }
    };

    const selector = new AgentSelector(agents, this.rl, (key) => {
      const result = onSelect(key);
      if (result && typeof result.then === 'function') {
        result.then(restoreListener).catch(restoreListener);
      } else {
        restoreListener();
      }
    });
    selector.show();
  }

  // ── Key handler ────────────────────────────────────────────────────────

  private onKeypress(_ch: string | undefined, key: KeypressKey | undefined): void {
    if (!key || !this.rl) return;

    // Get current readline line buffer
    const line: string = (this.rl as unknown as { line: string }).line ?? '';

    if (!this.active) {
      // Activate on '/' — key.name is undefined for printable chars, check sequence
      // Note: rl.line is already "/" at keypress time, so do NOT guard with !line
      if (key.sequence === '/') {
        setImmediate(() => {
          const current: string = (this.rl as unknown as { line: string })?.line ?? '';
          this.activate(current.startsWith('/') ? current : '/');
        });
      }
      return;
    }

    // Already active — handle navigation keys
    if (key.name === 'escape') {
      this.hidePicker();
      return;
    }

    if (key.name === 'up') {
      this.selectedIdx = Math.max(0, this.selectedIdx - 1);
      this.redraw();
      return;
    }

    if (key.name === 'down') {
      const matches = this.getMatches();
      this.selectedIdx = Math.min(matches.length - 1, this.selectedIdx + 1);
      this.redraw();
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      const matches = this.getMatches();
      const selected = matches[this.selectedIdx];
      if (selected) this.selectCommand(selected.name);
      return;
    }

    if (key.name === 'tab') {
      const matches = this.getMatches();
      const selected = matches[this.selectedIdx];
      if (selected) this.selectCommand(selected.name);
      return;
    }

    // Any other key (printable character): optimistic update to prevent fast-typing misses
    if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
      const optimistic = this.filter + key.sequence;
      const matches = this.getMatchesFor(optimistic);
      if (matches.length > 0) {
        this.filter = optimistic;
        this.selectedIdx = Math.min(this.selectedIdx, matches.length - 1);
        this.redraw();
      }
    }

    // Then sync precisely with readline's buffer on next tick
    setImmediate(() => {
      if (!this.rl) return;
      const current: string = (this.rl as unknown as { line: string })?.line ?? '';
      if (!current.startsWith('/')) {
        this.hidePicker();
      } else {
        this.activate(current);
      }
    });
  }

  // ── Activation / selection ─────────────────────────────────────────────

  private activate(currentLine: string): void {
    const prev = this.filter;
    this.filter = currentLine;

    const matches = this.getMatches();
    if (matches.length === 0) {
      if (this.active) this.hidePicker();
      return;
    }

    // Reset selection if filter changed substantially
    if (!prev.startsWith(this.filter.slice(0, -1))) {
      this.selectedIdx = 0;
    }
    this.selectedIdx = Math.min(this.selectedIdx, matches.length - 1);

    this.active = true;
    this.redraw();
  }

  private selectCommand(name: string): void {
    this.hidePicker();
    if (!this.rl) return;

    // Clear current readline input and inject the selected command + space
    (this.rl as unknown as { clearLine: () => void }).clearLine?.();
    // Use write to inject text into readline's line buffer
    this.rl.write(null as unknown as string, { ctrl: true, name: 'u' }); // clear line
    const cmd = this.commands.find((c) => c.name === name);
    const toInject = cmd?.inject ?? (name.endsWith('>') ? name.slice(0, -1).trim() : name + ' ');
    this.rl.write(toInject);
    // Remove the injected text from history to avoid duplicate entry
    const history = (this.rl as unknown as { history: string[] }).history;
    if (history && history[0] === toInject.trim()) {
      history.shift();
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  private getMatchesFor(filter: string): Cmd[] {
    if (!filter) return this.commands;
    const lower = filter.toLowerCase();
    return this.commands.filter((c) => c.name.startsWith(lower));
  }

  private getMatches(): Cmd[] {
    return this.getMatchesFor(this.filter);
  }

  /**
   * Truncate a string to maxLen visible characters (Unicode-safe).
   * Appends '...' if truncated.
   */
  private truncate(str: string, maxLen: number): string {
    const chars = Array.from(str);
    if (chars.length <= maxLen) return str;
    return chars.slice(0, maxLen - 3).join('') + '...';
  }

  private redraw(): void {
    if (!process.stdout.isTTY) return;

    const matches = this.getMatches();
    // Each command takes 2 rows; max 4 commands visible (= 8 rows total)
    const maxVisible = Math.min(matches.length, 4);
    const cols = process.stdout.columns ?? 80;
    const descMaxLen = Math.max(0, cols - 8);

    const visibleMatches = matches.slice(0, maxVisible);

    // Compute aligned column width for command names
    const maxNameLen =
      visibleMatches.length > 0 ? Math.max(...visibleMatches.map((c) => c.name.length)) : 0;

    // Build two-row entries per command
    const rows: string[] = [];
    for (const [i, cmd] of visibleMatches.entries()) {
      const isSelected = i === this.selectedIdx;
      const bg = isSelected ? '\x1b[7m' : '';
      const reset = isSelected ? '\x1b[0m' : '';

      // Row 1: prefix + name (padded to maxNameLen) + hint
      const prefix = isSelected ? fmt.cyan('❯ ') : '  ';
      const nameStr = isSelected ? fmt.bold(fmt.cyan(cmd.name)) : fmt.cyan(cmd.name);
      const pad = ' '.repeat(Math.max(0, maxNameLen - cmd.name.length));
      const hintStr = fmt.dim(cmd.hint);
      const row1Visible = `${isSelected ? '❯ ' : '  '}${cmd.name}${pad}  ${cmd.hint}`;
      const row1Pad = ' '.repeat(Math.max(0, cols - row1Visible.length - 1));
      rows.push(`${bg}${prefix}${nameStr}${pad}  ${hintStr}${row1Pad}${reset}`);

      // Row 2: description (indented 4 spaces, dim, terminal-width-safe)
      const desc = this.truncate(cmd.description, descMaxLen);
      const descStr = fmt.dim(desc);
      const row2Visible = `    ${desc}`;
      const row2Pad = ' '.repeat(Math.max(0, cols - row2Visible.length - 1));
      rows.push(`${bg}    ${descStr}${row2Pad}${reset}`);
    }

    // Draw: save cursor, jump below, write rows, restore
    let out = HIDE + SAVE;

    // Clear previous rows first
    for (let i = 0; i < this.visibleCount; i++) {
      out += DOWN1 + COL1 + ERASE;
    }

    // Reset to prompt line, then go down
    out += RESTORE + SAVE;
    for (const row of rows) {
      out += DOWN1 + COL1 + ERASE + row;
    }

    out += RESTORE + SHOW;

    this.visibleCount = rows.length;
    process.stdout.write(out);
  }

  private hidePicker(): void {
    if (!process.stdout.isTTY || !this.active) return;

    // Clear all drawn rows
    let out = HIDE + SAVE;
    for (let i = 0; i < this.visibleCount; i++) {
      out += DOWN1 + COL1 + ERASE;
    }
    out += RESTORE + SHOW;

    process.stdout.write(out);
    this.active = false;
    this.filter = '';
    this.selectedIdx = 0;
    this.visibleCount = 0;
  }
}
