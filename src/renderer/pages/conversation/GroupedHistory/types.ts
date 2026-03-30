/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';

import type { TChatConversation } from '@/common/config/storage';

export type WorkspaceGroup = {
  workspace: string;
  displayName: string;
  conversations: TChatConversation[];
};

export type TimelineItem = {
  type: 'workspace' | 'conversation';
  time: number;
  workspaceGroup?: WorkspaceGroup;
  conversation?: TChatConversation;
};

export type TimelineSection = {
  timeline: string;
  items: TimelineItem[];
};

/** Workspace sub-group within an agent DM group */
export type WorkspaceSubGroupData = {
  workspacePath: string;
  displayName: string;
  conversations: TChatConversation[];
  latestActivityTime: number;
};

/** Agent-based DM group (Slack-like: conversations grouped by agent person) */
export type AgentDMGroupData = {
  /** Agent ID (resolved from conversation extra) */
  agentId: string;
  /** Agent display name */
  agentName: string;
  /** Agent avatar (emoji, SVG path, or undefined) */
  agentAvatar?: string;
  /** Agent logo path for CLI agents (from agentLogo.ts) */
  agentLogo?: string | null;
  /** Whether agent is a permanent employee (saved assistant/preset) */
  isPermanent: boolean;
  /** All conversations with this agent, sorted by activity time desc */
  conversations: TChatConversation[];
  /** Most recent conversation's activity time */
  latestActivityTime: number;
  /** Whether any conversation is currently generating */
  hasActiveConversation: boolean;
  /** Conversations without a custom workspace (temporary / no workspace) */
  ungroupedConversations: TChatConversation[];
  /** Conversations grouped by custom workspace */
  workspaceSubGroups: WorkspaceSubGroupData[];
  /** Display mode based on workspace distribution */
  displayMode: 'flat' | 'subtitle' | 'grouped';
  /** Display name when displayMode is 'subtitle' (single workspace) */
  singleWorkspaceDisplayName?: string;
  /** Workspace path when displayMode is 'subtitle' (single workspace) */
  singleWorkspacePath?: string;
};

export type GroupedHistoryResult = {
  pinnedConversations: TChatConversation[];
  dispatchConversations: TChatConversation[];
  timelineSections: TimelineSection[];
  /** Slack-like DM groups: conversations grouped by agent */
  agentDMGroups: AgentDMGroupData[];
};

export type ExportZipFile = {
  name: string;
  content?: string;
  sourcePath?: string;
};

export type ExportTask =
  | { mode: 'single'; conversation: TChatConversation }
  | { mode: 'batch'; conversationIds: string[] }
  | null;

export type ConversationRowProps = {
  conversation: TChatConversation;
  isGenerating: boolean;
  hasCompletionUnread: boolean;
  collapsed: boolean;
  tooltipEnabled: boolean;
  batchMode: boolean;
  checked: boolean;
  selected: boolean;
  menuVisible: boolean;
  /** Active child task count for dispatch conversations */
  childTaskCount?: number;
  /** Force chat bubble icon instead of agent logo (for nested DM conversations) */
  useBubbleIcon?: boolean;
  onToggleChecked: (conversation: TChatConversation) => void;
  onConversationClick: (conversation: TChatConversation) => void;
  onOpenMenu: (conversation: TChatConversation) => void;
  onMenuVisibleChange: (conversationId: string, visible: boolean) => void;
  onEditStart: (conversation: TChatConversation) => void;
  onDelete: (conversationId: string) => void;
  onExport: (conversation: TChatConversation) => void;
  onTogglePin: (conversation: TChatConversation) => void;
  /** F-6.3: Fork conversation to a dispatch session */
  onForkToDispatch: (conversation: TChatConversation) => void;
  getJobStatus: (conversationId: string) => 'none' | 'active' | 'paused' | 'error' | 'unread';
};

export type WorkspaceGroupedHistoryProps = {
  onSessionClick?: () => void;
  collapsed?: boolean;
  tooltipEnabled?: boolean;
  batchMode?: boolean;
  onBatchModeChange?: (value: boolean) => void;
};

export type DragItemType = 'conversation' | 'workspace';

export type DragItem = {
  type: DragItemType;
  id: string;
  conversation?: TChatConversation;
  workspaceGroup?: WorkspaceGroup;
  sourceSection: 'pinned' | string;
  sourceWorkspace?: string;
};

/** Props for the ChannelSection component */
export type ChannelSectionProps = {
  /** Dispatch conversations to render as channels */
  conversations: TChatConversation[];
  /** Whether the sidebar is collapsed */
  collapsed: boolean;
  /** Callback to open the create group chat modal */
  onCreateChannel: () => void;
  /** Render function for individual conversation rows (reuses existing getConversationRowProps pattern) */
  renderConversation: (conversation: TChatConversation) => React.ReactNode;
};
