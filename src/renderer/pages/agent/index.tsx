/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty } from '@arco-design/web-react';
import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { TChatConversation } from '@/common/config/storage';
import AgentConfigSection from './components/AgentConfigSection';
import AgentConversationList from './components/AgentConversationList';
import AgentProfileHeader from './components/AgentProfileHeader';
import { useAgentProfile } from './hooks/useAgentProfile';

const AgentProfilePage: React.FC = () => {
  const { agentId: rawAgentId } = useParams<{ agentId: string }>();
  const agentId = rawAgentId ? decodeURIComponent(rawAgentId) : '';
  const navigate = useNavigate();
  const { t } = useTranslation();

  const profileData = useAgentProfile(agentId);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const handleStartConversation = useCallback(() => {
    navigate('/guid', { state: { prefillAgentId: agentId } });
  }, [navigate, agentId]);

  const handleEditConfig = useCallback(() => {
    if (!profileData) return;
    const { identity } = profileData;
    if (identity.id.startsWith('custom:')) {
      navigate('/settings/agent');
    } else {
      navigate('/settings/assistants');
    }
  }, [navigate, profileData]);

  const handleConversationClick = useCallback(
    (conversation: TChatConversation) => {
      navigate(`/conversation/${conversation.id}`);
    },
    [navigate]
  );

  if (!profileData) {
    return (
      <div className='w-full h-full flex flex-col items-center justify-center gap-16px'>
        <Empty description={t('agent.profile.notFound')} />
        <Button onClick={handleBack}>{t('agent.profile.back')}</Button>
      </div>
    );
  }

  return (
    <div className='w-full h-full overflow-y-auto'>
      <div className='mx-auto max-w-720px px-24px py-32px flex flex-col gap-32px'>
        <AgentProfileHeader
          identity={profileData.identity}
          agentLogo={profileData.agentLogo}
          onBack={handleBack}
          onStartConversation={handleStartConversation}
        />

        <AgentConfigSection
          identity={profileData.identity}
          workspaces={profileData.workspaces}
          onEditConfig={handleEditConfig}
        />

        <AgentConversationList
          conversations={profileData.conversations}
          onConversationClick={handleConversationClick}
        />
      </div>
    </div>
  );
};

export default AgentProfilePage;
