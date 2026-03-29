/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tooltip } from '@arco-design/web-react';
import { Crown, DoubleLeft, DoubleRight, People } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupMemberSiderProps } from '../types';
import MemberCard from './MemberCard';
import styles from './MemberCard.module.css';

const GroupMemberSider: React.FC<GroupMemberSiderProps> = ({
  members,
  dispatcher,
  leaderAgentId,
  selectedMemberId,
  onSelectMember,
  onEditConfig,
  collapsed,
  onToggleCollapse,
  onDispatcherClick,
  onAgentNameClick,
}) => {
  const { t } = useTranslation();

  const totalCount = members.length + 1; // +1 for dispatcher

  return (
    <div
      className={classNames('flex flex-col border-l border-bd-primary flex-shrink-0 overflow-hidden transition-all', {
        'w-240px': !collapsed,
        'w-0px': collapsed,
      })}
      style={{ transition: 'width 0.2s ease' }}
      aria-label={t('dispatch.memberSider.title')}
    >
      {!collapsed && (
        <div className='flex flex-col h-full'>
          {/* Header */}
          <div className='flex items-center justify-between px-12px py-10px border-b border-bd-primary flex-shrink-0'>
            <span className='text-13px font-semibold text-t-primary'>
              {t('dispatch.memberSider.memberCount', { count: totalCount })}
            </span>
            <Tooltip content={t('dispatch.memberSider.collapse')}>
              <Button
                type='text'
                size='mini'
                icon={<DoubleRight theme='outline' size='14' />}
                onClick={onToggleCollapse}
                aria-label={t('dispatch.memberSider.collapse')}
              />
            </Tooltip>
          </div>

          {/* Scrollable member list */}
          <div className='flex-1 overflow-y-auto py-8px'>
            {/* Dispatcher row (leader pseudo-member) */}
            <div
              className='flex items-center gap-8px px-12px py-8px cursor-pointer rounded-6px mx-4px hover:bg-fill-2 transition-colors'
              onClick={onDispatcherClick}
              role='button'
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDispatcherClick();
                }
              }}
            >
              {/* Dispatcher avatar */}
              <div className={classNames(styles.avatar, styles.avatarDispatcher)}>
                {dispatcher.avatar ? <span>{dispatcher.avatar}</span> : <People theme='outline' size='18' />}
              </div>

              {/* Dispatcher name + badge */}
              <div className='flex-1 flex flex-col min-w-0 gap-2px'>
                <div className='flex items-center gap-4px'>
                  <span className='text-13px font-medium truncate flex-1 min-w-0'>{dispatcher.name}</span>
                  {leaderAgentId && (
                    <Tooltip content={t('dispatch.memberSider.leader')}>
                      <span className={styles.leaderBadge}>
                        <Crown theme='filled' size={14} />
                      </span>
                    </Tooltip>
                  )}
                </div>
                <span className='text-11px text-t-secondary'>
                  {leaderAgentId ? t('dispatch.memberSider.leader') : t('dispatch.memberSider.orchestrator')}
                </span>
              </div>
            </div>

            {/* Child member cards */}
            {members.length === 0 ? (
              <div className='px-12px py-16px text-12px text-t-secondary text-center'>
                {t('dispatch.memberSider.empty')}
              </div>
            ) : (
              <div className='mt-4px mx-4px'>
                {members.map((member) => (
                  <MemberCard
                    key={member.sessionId}
                    member={member}
                    isSelected={member.sessionId === selectedMemberId}
                    onClick={() => onSelectMember(member.sessionId)}
                    onEditConfig={() => onEditConfig(member.sessionId)}
                    onNavigateToProfile={onAgentNameClick}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Standalone toggle button rendered in GroupChatView header */
export const MemberSiderToggleButton: React.FC<{
  collapsed: boolean;
  onToggle: () => void;
}> = ({ collapsed, onToggle }) => {
  const { t } = useTranslation();
  return (
    <Tooltip content={collapsed ? t('dispatch.memberSider.expand') : t('dispatch.memberSider.collapse')}>
      <Button
        type='text'
        size='small'
        icon={collapsed ? <DoubleLeft theme='outline' size='16' /> : <DoubleRight theme='outline' size='16' />}
        onClick={onToggle}
        aria-label={collapsed ? t('dispatch.memberSider.expand') : t('dispatch.memberSider.collapse')}
      />
    </Tooltip>
  );
};

export default GroupMemberSider;
