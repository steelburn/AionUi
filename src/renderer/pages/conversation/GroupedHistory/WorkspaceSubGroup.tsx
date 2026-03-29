/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { Down, FolderOpen, Right } from '@icon-park/react';
import { Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useState } from 'react';

type WorkspaceSubGroupProps = {
  workspacePath: string;
  displayName: string;
  conversations: TChatConversation[];
  selectedConversationId?: string;
  renderConversation: (conversation: TChatConversation) => React.ReactNode;
};

const WorkspaceSubGroup: React.FC<WorkspaceSubGroupProps> = ({
  workspacePath,
  displayName,
  conversations,
  selectedConversationId,
  renderConversation,
}) => {
  const [expanded, setExpanded] = useState(true);

  const hasSelectedConversation = selectedConversationId
    ? conversations.some((c) => c.id === selectedConversationId)
    : false;

  const isExpanded = expanded || hasSelectedConversation;

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className='min-w-0'>
      {/* Workspace folder row */}
      <Tooltip content={workspacePath} position='top' mini>
        <div
          className={classNames(
            'h-32px pl-8px pr-12px py-4px rd-4px flex items-center gap-6px cursor-pointer transition-colors min-w-0',
            'hover:bg-[rgba(var(--primary-6),0.08)]'
          )}
          onClick={handleToggle}
        >
          {/* Expand/Collapse chevron */}
          <span className='flex-shrink-0 text-t-secondary flex-center'>
            {isExpanded ? <Down theme='outline' size='10' /> : <Right theme='outline' size='10' />}
          </span>

          {/* Folder icon */}
          <FolderOpen theme='outline' size='16' className='flex-shrink-0 text-t-secondary line-height-0' />

          {/* Directory name */}
          <span className='text-13px text-t-primary truncate flex-1 min-w-0'>{displayName}</span>

          {/* Conversation count badge */}
          <span className='text-11px text-t-secondary bg-fill-2 px-4px py-1px rd-full flex-shrink-0'>
            {conversations.length}
          </span>
        </div>
      </Tooltip>

      {/* Expanded conversation list */}
      {isExpanded && (
        <div className='ml-8px'>{conversations.map((conversation) => renderConversation(conversation))}</div>
      )}
    </div>
  );
};

export default WorkspaceSubGroup;
