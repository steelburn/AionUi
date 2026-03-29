/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TeamPanel — real-time terminal display of multi-agent team progress.
 *
 * Subscribes to OrchestratorEvent and renders a live status panel showing
 * each agent's label, status icon, and a rolling preview of streaming output.
 * Uses terminal escape codes to update in place (no external deps).
 */
import type { OrchestratorEvent } from '@process/task/orchestrator/types';
import { fmt, clearLines, hr, STATUS_ICONS } from './format';
import { stripMarkdown } from './markdown';

/** Calculate terminal display width — CJK, full-width chars, and emoji occupy 2 columns. */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      cp > 0xffff || // surrogate pairs / supplementary (most emoji)
      (cp >= 0x1f300 && cp <= 0x1faff) || // misc symbols, emoticons
      (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols
      (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
      (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals / Kangxi
      (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana, Katakana, CJK compat
      (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
      (cp >= 0xa000 && cp <= 0xa48f) || // Yi Syllables
      (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compat Ideographs
      (cp >= 0xfe10 && cp <= 0xfe19) || // Vertical forms
      (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compat Forms
      (cp >= 0xff01 && cp <= 0xff60) || // Fullwidth Forms
      (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth Signs
      (cp >= 0x20000 && cp <= 0x2a6df) // CJK Extension B
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Truncate string to at most `maxCols` terminal columns. */
function truncateToWidth(s: string, maxCols: number): string {
  let w = 0;
  let result = '';
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > maxCols) break;
    result += ch;
    w += cw;
  }
  return result;
}

type AgentState = {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  preview: string;
  startedAt?: number;
};

export class TeamPanel {
  private agents = new Map<string, AgentState>();
  private lastLineCount = 0;
  private goal = '';
  private spinnerFrame = 0;
  private readonly SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private renderTimer: NodeJS.Timeout | null = null;

  setGoal(goal: string): void {
    this.goal = goal;
  }

  setLabel(subTaskId: string, label: string): void {
    const agent = this.agents.get(subTaskId);
    if (agent) {
      agent.label = label;
    } else {
      this.agents.set(subTaskId, { label, status: 'pending', preview: '' });
    }
  }

  update(event: OrchestratorEvent): void {
    switch (event.type) {
      case 'subtask:started': {
        const existing = this.agents.get(event.subTaskId);
        this.agents.set(event.subTaskId, {
          label: existing?.label ?? event.subTaskId,
          status: 'running',
          preview: '',
          startedAt: Date.now(),
        });
        break;
      }
      case 'subtask:progress': {
        const agent = this.agents.get(event.subTaskId);
        if (agent) {
          // Strip markdown symbols so preview is clean plain text
          const cleaned = stripMarkdown(event.text).replace(/\n/g, ' ');
          const combined = (agent.preview + cleaned).replace(/\n/g, ' ');
          agent.preview = Array.from(combined).slice(-200).join('');
        }
        break;
      }
      case 'subtask:done': {
        const agent = this.agents.get(event.subTaskId);
        if (agent) agent.status = 'done';
        break;
      }
      case 'subtask:failed': {
        const agent = this.agents.get(event.subTaskId);
        if (agent) {
          agent.status = 'failed';
          agent.preview = event.error;
        }
        break;
      }
      case 'orchestrator:failed': {
        // Mark any still-running or pending agents as cancelled
        for (const agent of this.agents.values()) {
          if (agent.status === 'running' || agent.status === 'pending') {
            agent.status = 'cancelled';
          }
        }
        break;
      }
    }
    // Start throttled render timer (idempotent — only one timer runs at a time)
    if (!this.renderTimer) {
      this.renderTimer = setInterval(() => {
        this.spinnerFrame++;
        this.render();
      }, 100);
      this.renderTimer.unref();
    }
  }

  render(): void {
    if (this.lastLineCount > 0) {
      clearLines(this.lastLineCount);
    }

    const lines: string[] = [];

    if (this.goal) {
      lines.push(`${fmt.bold('Goal:')} ${fmt.cyan(this.goal)}`);
      lines.push(fmt.dim(hr()));
    }

    for (const [id, state] of this.agents) {
      const label = fmt.bold(state.label || id);

      let coloredIcon: string;
      let statusSuffix = '';

      if (state.status === 'running') {
        const spin = this.SPIN[this.spinnerFrame % this.SPIN.length]!;
        coloredIcon = fmt.cyan(spin);
        if (state.startedAt !== undefined) {
          const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
          statusSuffix = ' ' + fmt.dim(`${elapsed}s`);
        }
      } else if (state.status === 'done') {
        coloredIcon = fmt.green(STATUS_ICONS.done);
      } else if (state.status === 'failed') {
        coloredIcon = fmt.red(STATUS_ICONS.failed);
      } else if (state.status === 'cancelled') {
        coloredIcon = fmt.yellow(STATUS_ICONS.cancelled);
        statusSuffix = ' ' + fmt.dim('已取消');
      } else {
        coloredIcon = fmt.dim(STATUS_ICONS.pending);
        statusSuffix = ' ' + fmt.dim('等待中');
      }

      let preview = '';
      const cols = process.stdout.columns ?? 80;
      // Fixed prefix: "  X Label 00s " ≈ 2+1+1+labelWidth+6
      const labelWidth = displayWidth(state.label || id);
      const prefixCols = 2 + 1 + 1 + labelWidth + 6;
      const maxPreviewCols = Math.max(0, cols - prefixCols - 2);
      if (state.status === 'failed' && state.preview) {
        preview = fmt.red(' ' + truncateToWidth(state.preview.trim(), maxPreviewCols));
      } else if (state.preview) {
        preview = fmt.dim(' ' + truncateToWidth(state.preview.trim(), maxPreviewCols));
      }

      lines.push(`  ${coloredIcon} ${label}${statusSuffix}${preview}`);
    }

    if (lines.length > 0) {
      process.stdout.write(lines.join('\n') + '\n');
    }
    this.lastLineCount = lines.length;
  }

  clear(): void {
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
    if (this.lastLineCount > 0) {
      clearLines(this.lastLineCount);
      this.lastLineCount = 0;
    }
  }
}
