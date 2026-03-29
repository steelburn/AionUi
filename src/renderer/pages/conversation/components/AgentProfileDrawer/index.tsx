/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Drawer } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentProfileDrawer } from '../../hooks/useAgentProfileDrawer';
import AssistantDetail from './AssistantDetail';
import GroupChatList from './GroupChatList';
import ProfileHeader from './ProfileHeader';
import type { AgentProfileDrawerProps } from './types';

/** Right-side drawer showing agent profile details */
const AgentProfileDrawer: React.FC<AgentProfileDrawerProps> = ({
  visible,
  agentId,
  onClose,
  onStartConversation,
  onNavigateToGroupChat,
}) => {
  const { t } = useTranslation();
  const data = useAgentProfileDrawer(agentId);

  if (!data) {
    return (
      <Drawer
        visible={visible}
        onCancel={onClose}
        title={t('agent.drawer.title')}
        placement='right'
        width={360}
        footer={null}
      >
        <div className='flex items-center justify-center h-200px text-t-secondary text-13px'>
          {t('agent.profile.notFound')}
        </div>
      </Drawer>
    );
  }

  const { identity, rule, skills, mountedAgents, groupChats } = data;
  const isAssistant = identity.employeeType === 'permanent';

  return (
    <Drawer
      visible={visible}
      onCancel={onClose}
      title={t('agent.drawer.title')}
      placement='right'
      width={360}
      footer={null}
    >
      <div className='flex flex-col gap-16px'>
        <ProfileHeader identity={identity} onStartConversation={() => onStartConversation(agentId)} />

        {/* Divider */}
        <div className='h-1px bg-bd-primary mx-16px' />

        {/* Assistant-specific sections */}
        {isAssistant && <AssistantDetail rule={rule} skills={skills} mountedAgents={mountedAgents} />}

        {/* Divider before group chats */}
        {isAssistant && groupChats.length > 0 && <div className='h-1px bg-bd-primary mx-16px' />}

        {/* Group chat list */}
        <GroupChatList groupChats={groupChats} onNavigate={onNavigateToGroupChat} />
      </div>
    </Drawer>
  );
};

export default AgentProfileDrawer;
