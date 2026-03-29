/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentIdentity } from '@renderer/utils/model/agentIdentity';

/** Props for the AgentProfileDrawer entry component */
export type AgentProfileDrawerProps = {
  /** Whether the drawer is visible */
  visible: boolean;
  /** Agent ID to display (e.g. "preset:word-creator", "custom:abc", "claude") */
  agentId: string;
  /** Close callback */
  onClose: () => void;
  /** Navigate to a new conversation with this agent */
  onStartConversation: (agentId: string) => void;
  /** Navigate to a dispatch group chat */
  onNavigateToGroupChat: (conversationId: string) => void;
};

/** Resolved data for the drawer content */
export type AgentProfileDrawerData = {
  identity: AgentIdentity;
  /** For assistants (isPermanent): the system rule text (read-only) */
  rule?: string;
  /** For assistants: list of skill names */
  skills: string[];
  /** For assistants: mounted general agents (cli_agent identities) */
  mountedAgents: AgentIdentity[];
  /** Dispatch group chats that include this agent as a member */
  groupChats: GroupChatSummary[];
};

/** Minimal info about a group chat for display in the drawer */
export type GroupChatSummary = {
  conversationId: string;
  name: string;
  memberCount: number;
  lastActivityAt: number;
};

/** Props for ProfileHeader sub-component */
export type ProfileHeaderProps = {
  identity: AgentIdentity;
  onStartConversation: () => void;
};

/** Props for AssistantDetail sub-component */
export type AssistantDetailProps = {
  rule?: string;
  skills: string[];
  mountedAgents: AgentIdentity[];
};

/** Props for GroupChatList sub-component */
export type GroupChatListProps = {
  groupChats: GroupChatSummary[];
  onNavigate: (conversationId: string) => void;
};
