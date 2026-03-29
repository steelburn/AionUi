/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Popover, Tag, Tooltip } from '@arco-design/web-react';
import { CheckOne, Crown, Edit, People, Timer } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { MemberCardProps } from '../types';
import styles from './MemberCard.module.css';

/** Format timestamp to relative time string */
const formatActivityTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(timestamp).toLocaleDateString();
};

/** Status color mapping for Tag */
const getStatusColor = (status: string): string => {
  switch (status) {
    case 'running':
      return 'arcoblue';
    case 'pending':
      return 'gold';
    case 'completed':
    case 'idle':
      return 'green';
    case 'failed':
      return 'red';
    case 'cancelled':
      return 'gray';
    default:
      return 'gray';
  }
};

const MemberCard: React.FC<MemberCardProps> = ({ member, isSelected, onClick, onEditConfig, onNavigateToProfile }) => {
  const { t } = useTranslation();

  const truncatedRules = member.presetRules
    ? member.presetRules.length > 100
      ? member.presetRules.slice(0, 100) + '...'
      : member.presetRules
    : null;

  const workspaceLabel = member.workspace ? member.workspace.split('/').pop() || member.workspace : null;

  const popoverContent = (
    <div className={styles.popoverContent}>
      <div className={styles.popoverRow}>
        <span className={styles.popoverLabel}>{t('dispatch.memberSider.model')}</span>
        <span className={styles.popoverValue}>{member.modelName || t('dispatch.memberSider.defaultModel')}</span>
      </div>
      {workspaceLabel && (
        <div className={styles.popoverRow}>
          <span className={styles.popoverLabel}>{t('dispatch.memberSider.workspace')}</span>
          <span className={styles.popoverValue}>{workspaceLabel}</span>
        </div>
      )}
      <div className={styles.popoverRow}>
        <span className={styles.popoverLabel}>{t('dispatch.memberSider.rules')}</span>
        <span className={styles.popoverValue}>{truncatedRules || t('dispatch.memberSider.rulesNone')}</span>
      </div>
    </div>
  );

  return (
    <Popover
      content={popoverContent}
      title={t('dispatch.memberSider.configSummary')}
      position='left'
      trigger='hover'
      triggerProps={{ mouseEnterDelay: 200 }}
    >
      <div
        className={classNames(styles.card, { [styles.cardSelected]: isSelected })}
        onClick={onClick}
        role='button'
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {/* Avatar */}
        <div className={styles.avatar}>
          {member.avatar ? <span>{member.avatar}</span> : <People theme='outline' size='16' />}
        </div>

        {/* Center: name + badges + status */}
        <div className='flex-1 flex flex-col min-w-0 gap-2px'>
          <div className={styles.badgesRow}>
            <span
              className={`text-13px font-medium truncate flex-1 min-w-0${member.agentId && onNavigateToProfile ? ' cursor-pointer hover:text-[var(--color-primary-6)]' : ''}`}
              onClick={
                member.agentId && onNavigateToProfile
                  ? (e) => {
                      e.stopPropagation();
                      const { agentId } = member;
                      if (agentId) onNavigateToProfile(agentId);
                    }
                  : undefined
              }
            >
              {member.name}
            </span>
            {member.isLeader && (
              <Tooltip content={t('dispatch.memberSider.leader')}>
                <span className={styles.leaderBadge}>
                  <Crown theme='filled' size={14} />
                </span>
              </Tooltip>
            )}
            {member.isPermanent ? (
              <Tooltip content={t('dispatch.memberSider.permanent')}>
                <span className={styles.permanentBadge}>
                  <CheckOne theme='filled' size={12} />
                </span>
              </Tooltip>
            ) : (
              <Tooltip content={t('dispatch.memberSider.temporary')}>
                <span className={styles.temporaryBadge}>
                  <Timer theme='outline' size={12} />
                </span>
              </Tooltip>
            )}
          </div>
          <div className='flex items-center gap-4px'>
            <Tag size='small' color={getStatusColor(member.status)} className='text-11px'>
              {t(`dispatch.taskPanel.status.${member.status}`)}
            </Tag>
          </div>
        </div>

        {/* Activity time */}
        <span className={styles.activityTime}>{formatActivityTime(member.lastActivityAt)}</span>

        {/* Edit button (visible on hover) */}
        <span className={styles.editBtn}>
          <Button
            type='text'
            size='mini'
            icon={<Edit theme='outline' size='12' />}
            onClick={(e) => {
              e.stopPropagation();
              onEditConfig();
            }}
            aria-label={t('dispatch.memberSider.editConfig')}
          />
        </span>
      </div>
    </Popover>
  );
};

export default MemberCard;
