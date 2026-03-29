/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Descriptions } from '@arco-design/web-react';
import { Edit } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentConfigSectionProps } from '../types';

const AgentConfigSection: React.FC<AgentConfigSectionProps> = ({ identity, workspaces, onEditConfig }) => {
  const { t } = useTranslation();

  const isPermanent = identity.employeeType === 'permanent';

  const descriptionData = [];

  if (identity.backendType) {
    descriptionData.push({ label: t('agent.profile.backendType'), value: identity.backendType });
  }

  if (identity.description) {
    descriptionData.push({ label: t('agent.profile.description'), value: identity.description });
  }

  if (workspaces.length > 0) {
    descriptionData.push({
      label: t('agent.profile.workspaces'),
      value: workspaces.join(', '),
    });
  }

  return (
    <div className='flex flex-col gap-12px'>
      {/* Section header */}
      <div className='flex items-center justify-between'>
        <h3 className='text-16px font-semibold text-t-primary m-0'>{t('agent.profile.configuration')}</h3>
        {isPermanent && (
          <Button
            type='secondary'
            size='small'
            icon={<Edit theme='outline' size='14' />}
            onClick={onEditConfig}
            aria-label={t('agent.profile.editConfig')}
          >
            {t('agent.profile.editConfig')}
          </Button>
        )}
      </div>

      {/* Config items */}
      {descriptionData.length > 0 ? (
        <Descriptions
          column={1}
          data={descriptionData.map((item) => ({ label: item.label, value: item.value }))}
          size='small'
          className='w-full'
        />
      ) : (
        <div className='text-14px text-t-secondary'>—</div>
      )}
    </div>
  );
};

export default AgentConfigSection;
