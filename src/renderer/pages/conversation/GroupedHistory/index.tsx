/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import DirectorySelectionModal from '@/renderer/components/settings/DirectorySelectionModal';
import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { CronJobIndicator, useCronJobsMap } from '@/renderer/pages/cron';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Empty, Input, Modal } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import WorkspaceCollapse from '../components/WorkspaceCollapse';
import CreateGroupChatModal from '../dispatch/CreateGroupChatModal';
import AgentDMGroup from './AgentDMGroup';
import ChannelSection from './ChannelSection';
import DragOverlayContent from './components/DragOverlayContent';
import ConversationRow from './ConversationRow';
import SortableConversationRow from './SortableConversationRow';
import { useBatchSelection } from './hooks/useBatchSelection';
import { useConversationActions } from './hooks/useConversationActions';
import { useConversations } from './hooks/useConversations';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useExport } from './hooks/useExport';
import type { ConversationRowProps, WorkspaceGroupedHistoryProps } from './types';

const WorkspaceGroupedHistory: React.FC<WorkspaceGroupedHistoryProps> = ({
  onSessionClick,
  collapsed = false,
  tooltipEnabled = false,
  batchMode = false,
  onBatchModeChange,
}) => {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getJobStatus, markAsRead, setActiveConversation } = useCronJobsMap();

  // Sync active conversation ref when route changes (for URL navigation)
  // This doesn't trigger state update, avoiding double render
  useEffect(() => {
    if (id) {
      setActiveConversation(id);
    }
  }, [id, setActiveConversation]);

  const {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    expandedWorkspaces,
    pinnedConversations,
    dispatchConversations,
    dispatchChildCounts,
    timelineSections,
    agentDMGroups,
    handleToggleWorkspace,
  } = useConversations();

  const [createGroupChatVisible, setCreateGroupChatVisible] = useState(false);

  const {
    selectedConversationIds,
    setSelectedConversationIds,
    selectedCount,
    allSelected,
    toggleSelectedConversation,
    handleToggleSelectAll,
  } = useBatchSelection(batchMode, conversations);

  const {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleDeleteClick,
    handleBatchDelete,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleForkToDispatch,
    handleMenuVisibleChange,
    handleOpenMenu,
  } = useConversationActions({
    batchMode,
    onSessionClick,
    onBatchModeChange,
    selectedConversationIds,
    setSelectedConversationIds,
    toggleSelectedConversation,
    markAsRead,
  });

  const {
    exportTask,
    exportModalVisible,
    exportTargetPath,
    exportModalLoading,
    showExportDirectorySelector,
    setShowExportDirectorySelector,
    closeExportModal,
    handleSelectExportDirectoryFromModal,
    handleSelectExportFolder,
    handleExportConversation,
    handleBatchExport,
    handleConfirmExport,
  } = useExport({
    conversations,
    selectedConversationIds,
    setSelectedConversationIds,
    onBatchModeChange,
  });

  const { sensors, activeId, activeConversation, handleDragStart, handleDragEnd, handleDragCancel, isDragEnabled } =
    useDragAndDrop({
      pinnedConversations,
      batchMode,
      collapsed,
    });

  const getConversationRowProps = useCallback(
    (conversation: TChatConversation): ConversationRowProps => ({
      conversation,
      isGenerating: isConversationGenerating(conversation.id),
      hasCompletionUnread: hasCompletionUnread(conversation.id),
      collapsed,
      tooltipEnabled,
      batchMode,
      checked: selectedConversationIds.has(conversation.id),
      selected: id === conversation.id,
      menuVisible: dropdownVisibleId === conversation.id,
      childTaskCount: conversation.type === 'dispatch' ? dispatchChildCounts.get(conversation.id) : undefined,
      onToggleChecked: toggleSelectedConversation,
      onConversationClick: handleConversationClick,
      onOpenMenu: handleOpenMenu,
      onMenuVisibleChange: handleMenuVisibleChange,
      onEditStart: handleEditStart,
      onDelete: handleDeleteClick,
      onExport: handleExportConversation,
      onTogglePin: handleTogglePin,
      onForkToDispatch: handleForkToDispatch,
      getJobStatus,
    }),
    [
      collapsed,
      tooltipEnabled,
      batchMode,
      isConversationGenerating,
      hasCompletionUnread,
      selectedConversationIds,
      id,
      dropdownVisibleId,
      dispatchChildCounts,
      toggleSelectedConversation,
      handleConversationClick,
      handleOpenMenu,
      handleMenuVisibleChange,
      handleEditStart,
      handleDeleteClick,
      handleExportConversation,
      handleTogglePin,
      handleForkToDispatch,
      getJobStatus,
    ]
  );

  const renderConversation = useCallback(
    (conversation: TChatConversation) => {
      const rowProps = getConversationRowProps(conversation);
      return <ConversationRow key={conversation.id} {...rowProps} />;
    },
    [getConversationRowProps]
  );

  // DM conversations nested under AgentDMGroup use bubble icon — agent identity is already shown in the parent row
  const renderDMConversation = useCallback(
    (conversation: TChatConversation) => {
      const rowProps = getConversationRowProps(conversation);
      return <ConversationRow key={conversation.id} {...rowProps} useBubbleIcon />;
    },
    [getConversationRowProps]
  );

  // Collect all sortable IDs for the pinned section
  const pinnedIds = useMemo(() => pinnedConversations.map((c) => c.id), [pinnedConversations]);

  const handleGroupChatCreated = useCallback(
    (_conversationId: string) => {
      setCreateGroupChatVisible(false);
      if (onSessionClick) onSessionClick();
    },
    [onSessionClick]
  );

  const hasDMGroups = agentDMGroups.length > 0;

  if (
    timelineSections.length === 0 &&
    pinnedConversations.length === 0 &&
    dispatchConversations.length === 0 &&
    !hasDMGroups &&
    collapsed
  ) {
    return (
      <FlexFullContainer>
        <div className='flex-center'>
          <Empty description={t('conversation.history.noHistory')} />
        </div>
      </FlexFullContainer>
    );
  }

  return (
    <FlexFullContainer>
      <Modal
        title={t('conversation.history.renameTitle')}
        visible={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={handleRenameCancel}
        okText={t('conversation.history.saveName')}
        cancelText={t('conversation.history.cancelEdit')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameModalName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameModalName}
          onChange={setRenameModalName}
          onPressEnter={handleRenameConfirm}
          placeholder={t('conversation.history.renamePlaceholder')}
          allowClear
        />
      </Modal>

      <Modal
        visible={exportModalVisible}
        title={t('conversation.history.exportDialogTitle')}
        onCancel={closeExportModal}
        footer={null}
        style={{ borderRadius: '12px' }}
        className='conversation-export-modal'
        alignCenter
        getPopupContainer={() => document.body}
      >
        <div className='py-8px'>
          <div className='text-14px mb-16px text-t-secondary'>
            {exportTask?.mode === 'batch'
              ? t('conversation.history.exportDialogBatchDescription', { count: exportTask.conversationIds.length })
              : t('conversation.history.exportDialogSingleDescription')}
          </div>

          <div className='mb-16px p-16px rounded-12px bg-fill-1'>
            <div className='text-14px mb-8px text-t-primary'>{t('conversation.history.exportTargetFolder')}</div>
            <div
              className='flex items-center justify-between px-12px py-10px rounded-8px transition-colors'
              style={{
                backgroundColor: 'var(--color-bg-1)',
                border: '1px solid var(--color-border-2)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
                opacity: exportModalLoading ? 0.55 : 1,
              }}
              onClick={() => {
                void handleSelectExportFolder();
              }}
            >
              <span
                className='text-14px overflow-hidden text-ellipsis whitespace-nowrap'
                style={{ color: exportTargetPath ? 'var(--color-text-1)' : 'var(--color-text-3)' }}
              >
                {exportTargetPath || t('conversation.history.exportSelectFolder')}
              </span>
              <FolderOpen theme='outline' size='18' fill='var(--color-text-3)' />
            </div>
          </div>

          <div className='flex items-center gap-8px mb-20px text-14px text-t-secondary'>
            <span>💡</span>
            <span>{t('conversation.history.exportDialogHint')}</span>
          </div>

          <div className='flex gap-12px justify-end'>
            <button
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: '1px solid var(--color-border-2)',
                backgroundColor: 'var(--color-fill-2)',
                color: 'var(--color-text-1)',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = 'var(--color-fill-3)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
              }}
              onClick={closeExportModal}
            >
              {t('common.cancel')}
            </button>
            <button
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: 'none',
                backgroundColor: exportModalLoading ? 'var(--color-fill-3)' : 'var(--color-text-1)',
                color: 'var(--color-bg-1)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(event) => {
                if (!exportModalLoading) {
                  event.currentTarget.style.opacity = '0.85';
                }
              }}
              onMouseLeave={(event) => {
                if (!exportModalLoading) {
                  event.currentTarget.style.opacity = '1';
                }
              }}
              onClick={() => {
                void handleConfirmExport();
              }}
              disabled={exportModalLoading}
            >
              {exportModalLoading ? t('conversation.history.exporting') : t('common.confirm')}
            </button>
          </div>
        </div>
      </Modal>

      <DirectorySelectionModal
        visible={showExportDirectorySelector}
        onConfirm={handleSelectExportDirectoryFromModal}
        onCancel={() => setShowExportDirectorySelector(false)}
      />

      <CreateGroupChatModal
        visible={createGroupChatVisible}
        onClose={() => setCreateGroupChatVisible(false)}
        onCreated={handleGroupChatCreated}
      />

      {batchMode && !collapsed && (
        <div className='px-12px pb-8px'>
          <div className='rd-8px bg-fill-1 p-10px flex flex-col gap-8px border border-solid border-[rgba(var(--primary-6),0.08)]'>
            <div className='text-12px leading-18px text-t-secondary'>
              {t('conversation.history.selectedCount', { count: selectedCount })}
            </div>
            <div className='grid grid-cols-2 gap-6px'>
              <Button
                className='!col-span-2 !w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                type='secondary'
                onClick={handleToggleSelectAll}
              >
                {allSelected ? t('common.cancel') : t('conversation.history.selectAll')}
              </Button>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                type='secondary'
                onClick={handleBatchExport}
              >
                {t('conversation.history.batchExport')}
              </Button>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                status='warning'
                onClick={handleBatchDelete}
              >
                {t('conversation.history.batchDelete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className='size-full overflow-y-auto overflow-x-hidden'>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {pinnedConversations.length > 0 && (
            <div className='mb-8px min-w-0'>
              {!collapsed && (
                <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold'>
                  {t('conversation.history.pinnedSection')}
                </div>
              )}
              <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                <div className='min-w-0'>
                  {pinnedConversations.map((conversation) => {
                    const props = getConversationRowProps(conversation);
                    return isDragEnabled ? (
                      <SortableConversationRow key={conversation.id} {...props} />
                    ) : (
                      <ConversationRow key={conversation.id} {...props} />
                    );
                  })}
                </div>
              </SortableContext>
            </div>
          )}

          <DragOverlay dropAnimation={null}>
            {activeId && activeConversation ? <DragOverlayContent conversation={activeConversation} /> : null}
          </DragOverlay>
        </DndContext>

        {/* Channels section (dispatch group chats) */}
        <div className='mb-8px min-w-0'>
          <ChannelSection
            conversations={dispatchConversations}
            collapsed={collapsed}
            onCreateChannel={() => setCreateGroupChatVisible(true)}
            renderConversation={renderConversation}
          />
        </div>

        {/* Section separator (collapsed mode) */}
        {collapsed && dispatchConversations.length > 0 && agentDMGroups.length > 0 && (
          <div className='mx-8px mb-8px border-b border-b-solid border-b-[var(--color-border-2)]' />
        )}

        {/* Direct Messages section (unified — replaces General Agents + Assistants) */}
        <div className='mb-8px min-w-0'>
          {!collapsed && (
            <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold'>
              <span>{t('dispatch.sidebar.directMessagesSection')}</span>
            </div>
          )}
          {agentDMGroups.length > 0 ? (
            <div className='min-w-0'>
              {agentDMGroups.map((group) => (
                <AgentDMGroup
                  key={group.agentId}
                  group={group}
                  collapsed={collapsed}
                  selectedConversationId={id}
                  renderConversation={renderDMConversation}
                />
              ))}
            </div>
          ) : !collapsed ? (
            <div className='px-12px py-4px text-12px text-t-secondary'>{t('dispatch.sidebar.noDirectMessages')}</div>
          ) : null}
        </div>

        {/* Timeline sections (workspace-grouped conversations — fallback view) */}
        {!hasDMGroups &&
          timelineSections.map((section) => (
            <div key={section.timeline} className='mb-8px min-w-0'>
              {!collapsed && (
                <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold'>
                  {section.timeline}
                </div>
              )}

              {section.items.map((item) => {
                if (item.type === 'workspace' && item.workspaceGroup) {
                  const group = item.workspaceGroup;
                  return (
                    <div key={group.workspace} className={classNames('min-w-0', { 'px-8px': !collapsed })}>
                      <WorkspaceCollapse
                        expanded={expandedWorkspaces.includes(group.workspace)}
                        onToggle={() => handleToggleWorkspace(group.workspace)}
                        siderCollapsed={collapsed}
                        header={
                          <div className='flex items-center gap-8px text-14px min-w-0'>
                            <span className='font-medium truncate flex-1 text-t-primary min-w-0'>
                              {group.displayName}
                            </span>
                          </div>
                        }
                      >
                        <div className={classNames('flex flex-col gap-2px min-w-0', { 'mt-4px': !collapsed })}>
                          {group.conversations.map((conversation) => renderConversation(conversation))}
                        </div>
                      </WorkspaceCollapse>
                    </div>
                  );
                }

                if (item.type === 'conversation' && item.conversation) {
                  return renderConversation(item.conversation);
                }

                return null;
              })}
            </div>
          ))}
      </div>
    </FlexFullContainer>
  );
};

export default WorkspaceGroupedHistory;
