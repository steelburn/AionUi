/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { AgentIdentity } from '@/renderer/utils/model/agentIdentity';

/** Resolved agent profile data for the profile page */
export type AgentProfileData = {
  /** Agent identity from registry (undefined if agent not found) */
  identity: AgentIdentity;
  /** All conversations with this agent, sorted by activity time desc */
  conversations: TChatConversation[];
  /** Agent logo path for CLI agents (SVG URL) */
  agentLogo?: string | null;
  /** Workspace paths associated with this agent's conversations */
  workspaces: string[];
};

/** Props for the AgentProfile page (params come from route) */
export type AgentProfilePageParams = {
  agentId: string;
};

/** Props for the AgentProfileHeader component */
export type AgentProfileHeaderProps = {
  identity: AgentIdentity;
  agentLogo?: string | null;
  onBack: () => void;
  onStartConversation: () => void;
};

/** Props for the AgentConfigSection component */
export type AgentConfigSectionProps = {
  identity: AgentIdentity;
  workspaces: string[];
  onEditConfig: () => void;
};

/** Props for the AgentConversationList component */
export type AgentConversationListProps = {
  conversations: TChatConversation[];
  onConversationClick: (conversation: TChatConversation) => void;
};
