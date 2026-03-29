/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tag, Typography } from '@arco-design/web-react';
import { Down, People, Up } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AssistantDetailProps } from './types';

/** Assistant-specific sections: Rule, Skills, Mounted Agents */
const AssistantDetail: React.FC<AssistantDetailProps> = ({ rule, skills, mountedAgents }) => {
  const { t } = useTranslation();
  const [ruleExpanded, setRuleExpanded] = useState(false);

  return (
    <div className='flex flex-col gap-16px px-16px'>
      {/* Rule section */}
      <div className='flex flex-col gap-8px'>
        <Button
          type='text'
          size='mini'
          className='!flex items-center justify-between w-full !px-0'
          onClick={() => setRuleExpanded(!ruleExpanded)}
        >
          <span className='text-13px font-semibold text-t-primary'>{t('agent.drawer.ruleTitle')}</span>
          {ruleExpanded ? (
            <Up theme='outline' size='12' className='text-t-tertiary' />
          ) : (
            <Down theme='outline' size='12' className='text-t-tertiary' />
          )}
        </Button>
        {ruleExpanded && (
          <div className='max-h-200px overflow-y-auto rounded-8px bg-fill-1 p-12px'>
            <Typography.Paragraph className='text-12px text-t-secondary !mb-0 whitespace-pre-wrap'>
              {rule || t('agent.drawer.ruleEmpty')}
            </Typography.Paragraph>
          </div>
        )}
      </div>

      {/* Skills section */}
      <div className='flex flex-col gap-8px'>
        <span className='text-13px font-semibold text-t-primary'>{t('agent.drawer.skillsTitle')}</span>
        {skills.length > 0 ? (
          <div className='flex flex-wrap gap-6px'>
            {skills.map((skill) => (
              <Tag key={skill} size='small' color='arcoblue'>
                {skill}
              </Tag>
            ))}
          </div>
        ) : (
          <span className='text-12px text-t-secondary'>{t('agent.drawer.skillsEmpty')}</span>
        )}
      </div>

      {/* Mounted agents section */}
      <div className='flex flex-col gap-8px'>
        <span className='text-13px font-semibold text-t-primary'>{t('agent.drawer.mountedAgentsTitle')}</span>
        {mountedAgents.length > 0 ? (
          <div className='flex flex-col gap-6px'>
            {mountedAgents.map((agent) => (
              <div key={agent.id} className='flex items-center gap-8px py-4px'>
                <div className='flex items-center justify-center w-24px h-24px rounded-full bg-fill-2'>
                  {agent.avatar ? (
                    <span className='text-12px'>{agent.avatar}</span>
                  ) : (
                    <People theme='outline' size='14' />
                  )}
                </div>
                <span className='text-13px text-t-primary'>{agent.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <span className='text-12px text-t-secondary'>{t('agent.drawer.mountedAgentsEmpty')}</span>
        )}
      </div>
    </div>
  );
};

export default AssistantDetail;
