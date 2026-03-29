/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tag } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentProfileHeaderProps } from '../types';

/** Resolve i18n key for agent source badge */
function getSourceLabel(source: string, t: (key: string) => string): string {
  switch (source) {
    case 'preset':
      return t('agent.profile.sourcePreset');
    case 'custom':
      return t('agent.profile.sourceCustom');
    case 'cli_agent':
      return t('agent.profile.sourceCli');
    case 'dispatch_teammate':
    case 'temporary_teammate':
      return t('agent.profile.sourceDispatch');
    default:
      return source;
  }
}

const AgentProfileHeader: React.FC<AgentProfileHeaderProps> = ({
  identity,
  agentLogo,
  onBack,
  onStartConversation,
}) => {
  const { t } = useTranslation();

  const renderAvatar = () => {
    if (identity.avatar && !identity.avatar.endsWith('.svg')) {
      return <span className='text-48px leading-none flex-shrink-0 flex-center w-72px h-72px'>{identity.avatar}</span>;
    }

    if (agentLogo) {
      return (
        <img
          src={agentLogo}
          alt={identity.name}
          className='w-72px h-72px rounded-50% flex-shrink-0 object-contain bg-fill-2 p-12px'
        />
      );
    }

    // Letter fallback
    return (
      <span className='w-72px h-72px rounded-50% flex-shrink-0 bg-fill-3 flex-center text-24px font-semibold text-t-secondary'>
        {identity.name.charAt(0).toUpperCase()}
      </span>
    );
  };

  const isPermanent = identity.employeeType === 'permanent';

  return (
    <div className='flex flex-col gap-16px'>
      {/* Back button row */}
      <div>
        <Button
          type='text'
          size='small'
          icon={<Left theme='outline' size='14' />}
          onClick={onBack}
          aria-label={t('agent.profile.back')}
        >
          {t('agent.profile.back')}
        </Button>
      </div>

      {/* Avatar + name + badges + action */}
      <div className='flex items-start gap-20px'>
        {renderAvatar()}

        <div className='flex flex-col gap-8px flex-1 min-w-0 pt-4px'>
          <h2 className='text-24px font-semibold text-t-primary m-0 truncate'>{identity.name}</h2>

          {/* Badges row */}
          <div className='flex items-center gap-8px flex-wrap'>
            <Tag color={isPermanent ? 'green' : 'gray'} size='small'>
              {isPermanent ? t('agent.profile.permanent') : t('agent.profile.temporary')}
            </Tag>
            <Tag color='arcoblue' size='small'>
              {getSourceLabel(identity.source, t)}
            </Tag>
          </div>

          {/* Start conversation button */}
          <div className='mt-4px'>
            <Button type='primary' size='small' onClick={onStartConversation}>
              {t('agent.profile.startConversation')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentProfileHeader;
