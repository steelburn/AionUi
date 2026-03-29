/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';

/** Renderer-side group chat message for timeline rendering */
export type GroupChatTimelineMessage = {
  /** Unique ID for React key */
  id: string;
  /** Source session ID */
  sourceSessionId: string;
  /** Source role */
  sourceRole: 'dispatcher' | 'child' | 'user';
  /** Display name for the message sender */
  displayName: string;
  /** Message content (text or progress summary) */
  content: string;
  /** Determines rendering style */
  messageType:
    | 'text'
    | 'system'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'task_progress'
    | 'task_cancelled';
  /** Unix timestamp ms */
  timestamp: number;
  /** Associated child task session ID (for status cards) */
  childTaskId?: string;
  /** Avatar emoji or URL */
  avatar?: string;
  /** Progress summary for task_progress (CF-2), separate from content */
  progressSummary?: string;
};

/** Child task info returned by get-group-chat-info */
export type ChildTaskInfoVO = {
  sessionId: string;
  title: string;
  status: 'pending' | 'running' | 'idle' | 'completed' | 'failed' | 'cancelled';
  teammateName?: string;
  teammateAvatar?: string;
  createdAt: number;
  lastActivityAt: number;
  /** F-4.2: Model name if child uses a non-default model */
  modelName?: string;
  /** F-6.1: Working directory for this child */
  workspace?: string;
  /** S3: Preset rules for hover config summary */
  presetRules?: string;
  /** S3: Whether this child uses a saved (permanent) assistant config */
  isPermanent?: boolean;
};

/** Member info for the group chat member sidebar (S3) */
export type GroupChatMemberVO = {
  /** Child session ID */
  sessionId: string;
  /** Display name */
  name: string;
  /** Avatar emoji or URL */
  avatar?: string;
  /** Agent status */
  status: 'pending' | 'running' | 'idle' | 'completed' | 'failed' | 'cancelled';
  /** Whether this member is the leader (dispatcher) */
  isLeader: boolean;
  /** Whether this member is a permanent (saved) assistant vs temporary */
  isPermanent: boolean;
  /** Model name if non-default */
  modelName?: string;
  /** Working directory */
  workspace?: string;
  /** Preset rules (first 100 chars shown on hover) */
  presetRules?: string;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Creation timestamp */
  createdAt: number;
  /** S4: Agent registry ID for navigation to agent profile (e.g. "custom:abc123", "preset:word-creator") */
  agentId?: string;
};

/** Props for the GroupMemberSider component (S3) */
export type GroupMemberSiderProps = {
  /** List of members derived from GroupChatInfoVO.children */
  members: GroupChatMemberVO[];
  /** Dispatcher info (rendered as leader pseudo-member) */
  dispatcher: {
    name: string;
    avatar?: string;
  };
  /** Leader agent ID (to match against saved agents) */
  leaderAgentId?: string;
  /** Currently selected member session ID (for highlight) */
  selectedMemberId?: string | null;
  /** Callback when a member card is clicked */
  onSelectMember: (sessionId: string) => void;
  /** Callback to open config edit modal for a member */
  onEditConfig: (sessionId: string) => void;
  /** Whether the sider is collapsed */
  collapsed: boolean;
  /** Toggle collapse callback */
  onToggleCollapse: () => void;
  /** Callback when dispatcher row is clicked (opens settings) */
  onDispatcherClick: () => void;
};

/** Props for the MemberCard component (S3) */
export type MemberCardProps = {
  /** Member data */
  member: GroupChatMemberVO;
  /** Whether this card is currently selected/highlighted */
  isSelected: boolean;
  /** Click handler — selects member and opens TaskPanel */
  onClick: () => void;
  /** Double-click or edit-icon click — opens config edit modal */
  onEditConfig: () => void;
  /** S4: Navigate to agent profile page for this member */
  onNavigateToProfile?: (agentId: string) => void;
};

/** Group chat info returned by get-group-chat-info */
export type GroupChatInfoVO = {
  dispatcherId: string;
  dispatcherName: string;
  children: ChildTaskInfoVO[];
  pendingNotificationCount: number;
  /** F-4.3: Current leader agent ID */
  leaderAgentId?: string;
  /** F-4.3: Current seed messages */
  seedMessages?: string;
  /** F-6.2: Max concurrent children limit */
  maxConcurrentChildren?: number;
};

/** Props for the main GroupChatView component */
export type GroupChatViewProps = {
  conversation: Extract<TChatConversation, { type: 'dispatch' }>;
};

/** Props for the GroupChatTimeline component */
export type GroupChatTimelineProps = {
  messages: GroupChatTimelineMessage[];
  isLoading: boolean;
  dispatcherName: string;
  dispatcherAvatar?: string;
  /** Cancel callback for child tasks (F-2.5) */
  onCancelChild?: (childTaskId: string) => void;
  /** Conversation ID for cancel IPC */
  conversationId?: string;
  /** Callback when "View Details" is clicked on a ChildTaskCard */
  onViewDetail?: (childTaskId: string) => void;
  /** Currently selected child task ID (for highlight) */
  selectedChildTaskId?: string | null;
  /** F-3.1: Save teammate callback */
  onSaveTeammate?: (childTaskId: string) => void;
  /** F-3.1: Set of teammate names that have been saved */
  savedTeammateNames?: Set<string>;
};

/** Props for the ChildTaskCard component */
export type ChildTaskCardProps = {
  message: GroupChatTimelineMessage;
  /** Cancel callback for running/pending tasks */
  onCancel?: (childTaskId: string) => void;
  /** Conversation ID (needed for cancel IPC) */
  conversationId?: string;
  /** Callback when "View Details" is clicked, opens TaskPanel */
  onViewDetail?: (childTaskId: string) => void;
  /** Whether this card is currently selected (highlighted) */
  isSelected?: boolean;
  /** Save callback for teammate */
  onSave?: (childTaskId: string) => void;
  /** Whether this teammate has already been saved */
  isSaved?: boolean;
};

/** Props for the GroupChatCreationModal component */
export type GroupChatCreationModalProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
};

/** Props for the TaskPanel component */
export type TaskPanelProps = {
  /** Currently selected child task ID */
  childTaskId: string;
  /** Child task basic info (from GroupChatInfoVO.children) */
  childInfo: ChildTaskInfoVO;
  /** Parent conversation ID (for cancel operation) */
  conversationId: string;
  /** Close panel callback */
  onClose: () => void;
  /** Cancel child task callback */
  onCancel: (childTaskId: string) => void;
  /** F-3.1: Notify parent when teammate is saved from TaskPanel */
  onTeammateSaved?: (teammateName: string) => void;
};

/** Props for the SaveTeammateModal component */
export type SaveTeammateModalProps = {
  visible: boolean;
  childSessionId: string;
  /** Pre-filled values from useGroupChatInfo (avoids IPC if already known) */
  initialName?: string;
  initialAvatar?: string;
  onClose: () => void;
  onSaved: (assistantId: string) => void;
};

/** Props for the TaskOverview component */
export type TaskOverviewProps = {
  dispatcherName: string;
  dispatcherAvatar?: string;
  children: ChildTaskInfoVO[];
  selectedChildTaskId?: string | null;
  onSelectChild: (childTaskId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

/** TaskPanel transcript message */
export type TranscriptMessage = {
  role: string;
  content: string;
  timestamp: number;
};

/** useTaskPanelTranscript hook return value */
export type UseTaskPanelTranscriptResult = {
  transcript: TranscriptMessage[];
  status: ChildTaskInfoVO['status'];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

/** F-4.3: Props for the GroupChatSettingsDrawer component */
export type GroupChatSettingsDrawerProps = {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  /** Current settings pre-filled from conversation extra */
  currentSettings: {
    groupChatName?: string;
    leaderAgentId?: string;
    seedMessages?: string;
    /** F-6.2: Max concurrent children */
    maxConcurrentChildren?: number;
  };
  /** Callback after successful save */
  onSaved: () => void;
};

/** Backend GroupChatMessage shape (matches dispatchTypes.ts without importing from process layer) */
export type GroupChatMessageData = {
  sourceSessionId: string;
  sourceRole: 'dispatcher' | 'child' | 'user';
  displayName: string;
  content: string;
  messageType:
    | 'text'
    | 'system'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'task_progress'
    | 'task_cancelled';
  timestamp: number;
  childTaskId?: string;
  avatar?: string;
  progressSummary?: string;
};
