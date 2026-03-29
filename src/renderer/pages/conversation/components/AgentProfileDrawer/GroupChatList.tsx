/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { People } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupChatListProps } from './types';

/** List of dispatch group chats containing this agent */
const GroupChatList: React.FC<GroupChatListProps> = ({ groupChats, onNavigate }) => {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col gap-8px px-16px pb-16px'>
      <span className='text-13px font-semibold text-t-primary'>{t('agent.drawer.groupChatsTitle')}</span>
      {groupChats.length > 0 ? (
        <div className='flex flex-col gap-4px'>
          {groupChats.map((chat) => (
            <Button
              type='text'
              key={chat.conversationId}
              className='!flex items-center gap-8px !py-8px !px-8px rounded-6px !h-auto w-full !justify-start'
              onClick={() => onNavigate(chat.conversationId)}
            >
              <div className='flex items-center justify-center w-28px h-28px rounded-6px bg-fill-2 shrink-0'>
                <People theme='outline' size='16' />
              </div>
              <div className='flex flex-col min-w-0 flex-1 text-left'>
                <span className='text-13px text-t-primary truncate'>{chat.name}</span>
                <span className='text-11px text-t-secondary'>
                  {t('agent.drawer.memberCount', { count: chat.memberCount })}
                </span>
              </div>
            </Button>
          ))}
        </div>
      ) : (
        <span className='text-12px text-t-secondary'>{t('agent.drawer.groupChatsEmpty')}</span>
      )}
    </div>
  );
};

export default GroupChatList;
