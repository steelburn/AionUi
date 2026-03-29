/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tag } from '@arco-design/web-react';
import { AddOne, People } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { ProfileHeaderProps } from './types';

/** Avatar + name + employee type badge + "Start Conversation" button */
const ProfileHeader: React.FC<ProfileHeaderProps> = ({ identity, onStartConversation }) => {
  const { t } = useTranslation();

  const isPermanent = identity.employeeType === 'permanent';

  return (
    <div className='flex flex-col items-center gap-16px py-24px px-16px'>
      {/* Avatar */}
      <div className='flex items-center justify-center w-64px h-64px rounded-full bg-fill-2 text-32px'>
        {identity.avatar ? <span>{identity.avatar}</span> : <People theme='outline' size='32' />}
      </div>

      {/* Name */}
      <div className='flex flex-col items-center gap-8px'>
        <span className='text-18px font-semibold text-t-primary'>{identity.name}</span>
        <Tag color={isPermanent ? 'arcoblue' : 'gray'} size='small'>
          {isPermanent ? t('agent.profile.permanent') : t('agent.profile.temporary')}
        </Tag>
        {identity.description && (
          <span className='text-13px text-t-secondary text-center max-w-280px'>{identity.description}</span>
        )}
      </div>

      {/* Start conversation button */}
      <Button type='primary' icon={<AddOne theme='outline' size='14' />} onClick={onStartConversation}>
        {t('agent.profile.startConversation')}
      </Button>
    </div>
  );
};

export default ProfileHeader;
