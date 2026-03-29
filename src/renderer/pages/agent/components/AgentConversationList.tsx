/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Empty } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentConversationListProps } from '../types';
import type { TChatConversation } from '@/common/config/storage';

/** Format timestamp to a relative time string */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}

function getWorkspaceDisplayName(conversation: TChatConversation): string | null {
  const extra = conversation.extra as Record<string, unknown> | undefined;
  if (!extra) return null;
  const workspace = extra.workspace;
  if (typeof workspace !== 'string' || !workspace) return null;
  const segments = workspace.split('/').filter(Boolean);
  if (segments.length <= 3) return workspace;
  return '…/' + segments.slice(-3).join('/');
}

const AgentConversationList: React.FC<AgentConversationListProps> = ({ conversations, onConversationClick }) => {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col gap-12px'>
      {/* Section header */}
      <h3 className='text-16px font-semibold text-t-primary m-0'>
        {t('agent.profile.conversations')}
        {conversations.length > 0 && (
          <span className='ml-8px text-14px font-normal text-t-secondary'>({conversations.length})</span>
        )}
      </h3>

      {/* Conversation list */}
      {conversations.length === 0 ? (
        <Empty description={t('agent.profile.noConversations')} className='py-32px' />
      ) : (
        <div className='flex flex-col gap-2px'>
          {conversations.map((conversation) => {
            const workspaceLabel = getWorkspaceDisplayName(conversation);
            const isGenerating = conversation.status === 'running';

            return (
              <div
                key={conversation.id}
                className='flex items-center gap-12px px-12px py-10px rd-8px cursor-pointer hover:bg-fill-2 transition-colors'
                onClick={() => onConversationClick(conversation)}
                role='button'
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onConversationClick(conversation);
                  }
                }}
              >
                {/* Conversation title */}
                <div className='flex-1 min-w-0 flex flex-col gap-2px'>
                  <span className='text-14px text-t-primary truncate'>
                    {conversation.name || `#${conversation.id.slice(0, 8)}`}
                  </span>
                  {workspaceLabel && <span className='text-12px text-t-secondary truncate'>{workspaceLabel}</span>}
                </div>

                {/* Right side: status + time */}
                <div className='flex items-center gap-8px flex-shrink-0'>
                  {isGenerating && (
                    <span className='text-11px text-arcoblue-6 bg-arcoblue-1 px-6px py-2px rd-full'>
                      {t('agent.profile.generating')}
                    </span>
                  )}
                  <span className='text-12px text-t-secondary'>{formatRelativeTime(conversation.modifyTime)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgentConversationList;
