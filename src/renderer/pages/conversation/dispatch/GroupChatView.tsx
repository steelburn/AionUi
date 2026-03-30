/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import SendBox from '@/renderer/components/chat/sendbox';
import { Alert, Button, Drawer, Message, Tag } from '@arco-design/web-react';
import { Close, Info } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { emitter } from '@/renderer/utils/emitter';

import ChatLayout from '../components/ChatLayout';
import ChatSider from '../components/ChatSider';
import AddMemberModal from './components/AddMemberModal';
import CostPanel from './components/CostPanel';
import MemberBar from './components/MemberBar';
import MemberProfileDrawer from './components/MemberProfileDrawer';
import TeammateTabBar from './components/TeammateTabBar';
import TeammateTabView from './components/TeammateTabView';
import GroupChatTimeline from './GroupChatTimeline';
import { useGroupChatInfo } from './hooks/useGroupChatInfo';
import { useGroupChatMessages } from './hooks/useGroupChatMessages';
import { useGroupChatTabs } from './hooks/useGroupChatTabs';
import type { GroupChatViewProps } from './types';

const GroupChatView: React.FC<GroupChatViewProps> = ({ conversation }) => {
  const { t } = useTranslation();
  const { messages, isLoading: messagesLoading, appendUserMessage } = useGroupChatMessages(conversation.id);
  const {
    info,
    error: infoError,
    retry: retryInfo,
    refresh: refreshInfo,
  } = useGroupChatInfo(conversation.id, {
    autoRefreshInterval: 5_000,
  });
  const [sendBoxContent, setSendBoxContent] = useState('');
  const [sending, setSending] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const extra = conversation.extra as {
    groupChatName?: string;
    teammateConfig?: { avatar?: string };
    leaderAgentId?: string;
  };

  const dispatcherName = info?.dispatcherName || extra.groupChatName || conversation.name;
  const dispatcherAvatar = extra.teammateConfig?.avatar;

  const activeChildCount = useMemo(() => {
    if (!info?.children) return 0;
    return info.children.filter((c) => c.status === 'running' || c.status === 'pending').length;
  }, [info?.children]);

  const pendingCount = info?.pendingNotificationCount ?? 0;
  const showBanner = pendingCount > 0 && !bannerDismissed;

  // G3.3: Tab state (replaces memberSider + taskPanel state)
  const { members, tabs, activeTabKey, onTabChange, onTabClose } = useGroupChatTabs(conversation.id, info, {
    name: dispatcherName,
    avatar: dispatcherAvatar,
  });

  // G3.5: Member profile drawer
  const [profileTarget, setProfileTarget] = useState<string | null>(null);

  // G3.6: Add member modal
  const [addMemberVisible, setAddMemberVisible] = useState(false);

  // Settings drawer
  const [settingsVisible, setSettingsVisible] = useState(false);

  // F-2.5: Cancel child task handler
  const handleCancelChild = useCallback(
    async (childTaskId: string) => {
      try {
        const result = await ipcBridge.dispatch.cancelChildTask.invoke({
          conversationId: conversation.id,
          childSessionId: childTaskId,
        });
        if (!result || !result.success) {
          Message.error(t('dispatch.childTask.cancelFailed'));
        } else {
          refreshInfo();
        }
      } catch (err) {
        console.error('[GroupChatView] cancel failed:', err);
        Message.error(t('dispatch.childTask.cancelFailed'));
      }
    },
    [conversation.id, refreshInfo, t]
  );

  const handleSend = useCallback(
    async (message: string) => {
      if (!message.trim()) return;
      const msgId = uuid();
      setSending(true);
      setBannerDismissed(true);

      // Optimistic update: show user message immediately
      appendUserMessage(msgId, message);

      try {
        await ipcBridge.conversation.sendMessage.invoke({
          input: message,
          msg_id: msgId,
          conversation_id: conversation.id,
        });
        emitter.emit('chat.history.refresh');
        refreshInfo();
      } finally {
        setSending(false);
      }
    },
    [conversation.id, refreshInfo, appendUserMessage]
  );

  const headerExtra = useMemo(
    () => (
      <div className='flex items-center gap-8px'>
        {activeChildCount > 0 && (
          <Tag color='arcoblue'>{t('dispatch.header.taskCount', { count: activeChildCount })}</Tag>
        )}
      </div>
    ),
    [activeChildCount, t]
  );

  // CF-3: Error state for group chat info fetch failure
  if (infoError) {
    return (
      <ChatLayout
        workspaceEnabled={true}
        agentName={conversation.name}
        sider={<ChatSider conversation={conversation} />}
      siderTitle={<span className='text-16px font-bold text-t-primary'>{t('conversation.workspace.title')}</span>}
        conversationId={conversation.id}
        title={conversation.name}
      >
        <div className='flex-center flex-1 flex-col gap-12px'>
          <Alert type='error' content={t('dispatch.error.groupChatLoadFailed')} style={{ maxWidth: '400px' }} />
          <Button type='primary' onClick={retryInfo}>
            {t('dispatch.error.retry')}
          </Button>
        </div>
      </ChatLayout>
    );
  }

  return (
    <ChatLayout
      workspaceEnabled={true}
      agentName={dispatcherName}
      agentLogo={dispatcherAvatar}
      agentLogoIsEmoji={Boolean(dispatcherAvatar)}
      headerExtra={headerExtra}
      sider={<ChatSider conversation={conversation} />}
      siderTitle={<span className='text-16px font-bold text-t-primary'>{t('conversation.workspace.title')}</span>}
      conversationId={conversation.id}
      title={conversation.name}
    >
      {/* G3.3: MemberBar */}
      <MemberBar
        members={members}
        onMemberClick={(id) => setProfileTarget(id)}
        onAddMemberClick={() => setAddMemberVisible(true)}
      />

      {/* G3.3: TeammateTabBar */}
      <TeammateTabBar
        tabs={tabs}
        activeTabKey={activeTabKey}
        onTabChange={onTabChange}
        onTabClose={onTabClose}
        onSettingsClick={() => setSettingsVisible(true)}
      />

      {/* Active tab content */}
      <div className='flex-1 flex flex-col min-h-0'>
        {/* Group chat tab: timeline + sendbox (CSS display:none to preserve scroll) */}
        <div style={{ display: activeTabKey === 'group-chat' ? 'flex' : 'none' }} className='flex-1 flex-col min-h-0'>
          {showBanner && (
            <div
              className='mx-16px mt-8px px-16px py-12px rd-8px flex items-center justify-between'
              style={{
                backgroundColor: 'rgba(var(--primary-6), 0.08)',
                border: '1px solid rgba(var(--primary-6), 0.2)',
              }}
            >
              <div className='flex items-center gap-8px text-14px text-t-primary'>
                <Info theme='outline' size='16' fill='rgb(var(--primary-6))' />
                <span>{t('dispatch.notification.pendingTasks', { count: pendingCount })}</span>
              </div>
              <Button
                type='text'
                size='mini'
                icon={<Close theme='outline' size='14' />}
                onClick={() => setBannerDismissed(true)}
              />
            </div>
          )}

          <GroupChatTimeline
            messages={messages}
            isLoading={messagesLoading}
            dispatcherName={dispatcherName}
            dispatcherAvatar={dispatcherAvatar}
            onCancelChild={handleCancelChild}
            conversationId={conversation.id}
          />

          <div className='max-w-800px w-full mx-auto mb-16px px-20px'>
            <SendBox
              value={sendBoxContent}
              onChange={setSendBoxContent}
              loading={sending}
              placeholder={t('dispatch.timeline.sendPlaceholder', { name: dispatcherName })}
              onSend={handleSend}
              defaultMultiLine={true}
              lockMultiLine={true}
              className='z-10'
            />
          </div>
        </div>

        {/* G3.4: Teammate tabs (read-only conversation view) */}
        {tabs
          .filter((tab) => tab.key !== 'group-chat')
          .map((tab) => (
            <div
              key={tab.key}
              style={{ display: activeTabKey === tab.key ? 'flex' : 'none' }}
              className='flex-1 flex-col min-h-0'
            >
              <TeammateTabView childSessionId={tab.key} conversationId={conversation.id} />
            </div>
          ))}
      </div>

      {/* G3.5: Member Profile Drawer */}
      <MemberProfileDrawer
        visible={Boolean(profileTarget)}
        memberId={profileTarget}
        members={members}
        childrenInfo={info?.children || []}
        conversationId={conversation.id}
        onClose={() => setProfileTarget(null)}
        onModelChange={() => refreshInfo()}
        onRemoveMember={(_memberId) => {
          // TODO: Implement actual remove member IPC in G4
          setProfileTarget(null);
        }}
      />

      {/* G3.6: Add Member Modal */}
      <AddMemberModal
        visible={addMemberVisible}
        onClose={() => setAddMemberVisible(false)}
        conversationId={conversation.id}
        existingMemberIds={members.map((m) => m.agentId).filter((id): id is string => Boolean(id))}
        onMemberAdded={() => {
          refreshInfo();
          setAddMemberVisible(false);
        }}
      />

      {/* Settings Drawer */}
      <Drawer
        visible={settingsVisible}
        width={400}
        placement='right'
        title={t('dispatch.settings.title')}
        onCancel={() => setSettingsVisible(false)}
        footer={null}
      >
        <CostPanel conversationId={conversation.id} />
      </Drawer>
    </ChatLayout>
  );
};

export default GroupChatView;
