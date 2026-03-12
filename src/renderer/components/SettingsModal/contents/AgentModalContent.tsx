/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Collapse, Message } from '@arco-design/web-react';
import React from 'react';
import AssistantManagement from '@/renderer/pages/settings/AssistantManagement';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import CodexSandboxSelector from '@/renderer/components/CodexSandboxSelector';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';

const AgentModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [agentMessage, agentMessageContext] = Message.useMessage({ maxCount: 10 });
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  return (
    <div className='flex flex-col h-full w-full'>
      {agentMessageContext}

      <AionScrollArea className='flex-1 min-h-0 pb-16px scrollbar-hide' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          <div className='px-[12px] py-[24px] md:px-[32px] bg-2 rd-12px md:rd-16px border border-border-2'>
            <div className='flex flex-col gap-12px md:flex-row md:items-center md:justify-between'>
              <div className='min-w-0'>
                <div className='text-14px font-500 text-t-primary'>{t('settings.codexSandbox', { defaultValue: 'Codex Sandbox' })}</div>
                <div className='mt-4px text-13px text-t-secondary'>{t('settings.codexSandboxDesc', { defaultValue: 'Applies to new Codex sessions and syncs sandbox_mode to your Codex config.' })}</div>
              </div>
              <CodexSandboxSelector showToast />
            </div>
          </div>

          <Collapse defaultActiveKey={['smart-assistants']}>
            <AssistantManagement message={agentMessage} />
          </Collapse>
        </div>
      </AionScrollArea>
    </div>
  );
};

export default AgentModalContent;
