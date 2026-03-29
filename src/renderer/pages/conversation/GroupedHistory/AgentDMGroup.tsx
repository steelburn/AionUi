/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { Tooltip } from '@arco-design/web-react';
import { Down, Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { AgentDMGroupData } from './types';
import WorkspaceSubGroup from './WorkspaceSubGroup';

type AgentDMGroupProps = {
  group: AgentDMGroupData;
  collapsed: boolean;
  selectedConversationId?: string;
  renderConversation: (conversation: TChatConversation) => React.ReactNode;
};

const AgentDMGroup: React.FC<AgentDMGroupProps> = ({
  group,
  collapsed,
  selectedConversationId,
  renderConversation,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const isActive = group.hasActiveConversation;
  const latestConversation = group.conversations[0];
  const conversationCount = group.conversations.length;

  // Auto-expand if the selected conversation belongs to this group
  const hasSelectedConversation = selectedConversationId
    ? group.conversations.some((c) => c.id === selectedConversationId)
    : false;

  const isExpanded = expanded || hasSelectedConversation;

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleAvatarClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigate(`/agent/${encodeURIComponent(group.agentId)}`);
    },
    [navigate, group.agentId]
  );

  const renderAvatar = () => {
    if (group.agentAvatar) {
      return <span className='text-18px leading-none flex-shrink-0'>{group.agentAvatar}</span>;
    }

    if (group.agentLogo) {
      return <img src={group.agentLogo} alt={group.agentName} className='w-20px h-20px rounded-50% flex-shrink-0' />;
    }

    // Fallback: first letter avatar
    return (
      <span className='w-20px h-20px rounded-50% flex-shrink-0 bg-fill-3 flex-center text-11px font-medium text-t-secondary'>
        {group.agentName.charAt(0).toUpperCase()}
      </span>
    );
  };

  const renderAgentNameArea = () => {
    if (group.displayMode === 'subtitle') {
      return (
        <FlexFullContainer className='min-w-0 flex-1'>
          <div className='flex flex-col min-w-0'>
            <div className='flex items-center gap-4px min-w-0'>
              <span className='text-14px text-t-primary truncate min-w-0 font-medium'>{group.agentName}</span>
            </div>
            <Tooltip content={group.singleWorkspacePath} position='right'>
              <span className='text-12px text-t-secondary truncate lh-16px'>{group.singleWorkspaceDisplayName}</span>
            </Tooltip>
          </div>
        </FlexFullContainer>
      );
    }

    // flat / grouped: original layout
    return (
      <FlexFullContainer className='h-20px min-w-0 flex-1'>
        <div className='flex items-center gap-4px min-w-0'>
          <span className='text-14px text-t-primary truncate min-w-0 font-medium'>{group.agentName}</span>
        </div>
      </FlexFullContainer>
    );
  };

  const renderExpandedContent = () => {
    if (group.displayMode === 'grouped') {
      const hasUngrouped = group.ungroupedConversations.length > 0;
      const hasSubGroups = group.workspaceSubGroups.length > 0;

      return (
        <div className='ml-20px'>
          {hasUngrouped && group.ungroupedConversations.map((conversation) => renderConversation(conversation))}
          {hasUngrouped && hasSubGroups && <div className='mt-4px' />}
          {hasSubGroups &&
            group.workspaceSubGroups.map((subGroup) => (
              <WorkspaceSubGroup
                key={subGroup.workspacePath}
                workspacePath={subGroup.workspacePath}
                displayName={subGroup.displayName}
                conversations={subGroup.conversations}
                selectedConversationId={selectedConversationId}
                renderConversation={renderConversation}
              />
            ))}
        </div>
      );
    }

    // flat / subtitle: render all conversations flat
    return <div className='ml-20px'>{group.conversations.map((conversation) => renderConversation(conversation))}</div>;
  };

  if (collapsed) {
    // In collapsed sidebar, show just the avatar
    return (
      <div className='flex-center py-4px cursor-pointer' onClick={handleToggle}>
        <span className='relative'>
          {renderAvatar()}
          {isActive && (
            <span className='absolute -right-1px -bottom-1px w-6px h-6px rounded-full bg-green-500 border border-solid border-[var(--color-bg-1)]' />
          )}
        </span>
      </div>
    );
  }

  return (
    <div className='min-w-0'>
      {/* Agent row header */}
      <div
        className={classNames(
          'px-12px py-8px rd-8px flex items-center gap-8px cursor-pointer transition-colors min-w-0',
          'hover:bg-[rgba(var(--primary-6),0.08)]'
        )}
        onClick={handleToggle}
      >
        {/* Avatar with online indicator */}
        <span className='relative flex-shrink-0'>
          {renderAvatar()}
          {isActive && (
            <span className='absolute -right-1px -bottom-1px w-6px h-6px rounded-full bg-green-500 border border-solid border-[var(--color-bg-1)]' />
          )}
        </span>

        {/* Agent name + optional subtitle */}
        {renderAgentNameArea()}

        {/* Conversation count badge */}
        {conversationCount > 0 && (
          <span className='text-11px text-t-secondary bg-fill-2 px-4px py-1px rd-full flex-shrink-0'>
            {conversationCount}
          </span>
        )}
      </div>

      {/* Expanded conversation list */}
      {isExpanded && renderExpandedContent()}
    </div>
  );
};

export default AgentDMGroup;
