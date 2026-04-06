import React from 'react';
import { useTranslation } from 'react-i18next';
import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import { isAcpRuntimeWaitingSnapshot, useAcpRuntimeDiagnostics, type AcpRuntimeStatus } from './acpRuntimeDiagnostics';

const shouldDescribeAwaitingFirstResponse = (status: AcpRuntimeStatus | null): boolean => {
  return status === 'connected' || status === 'authenticated' || status === 'session_active';
};

const AcpWarmupIndicator: React.FC<{
  conversationId: string;
  backend?: string;
  agentName?: string;
}> = ({ conversationId, backend, agentName }) => {
  const { t } = useTranslation();
  const runtimeDiagnostics = useAcpRuntimeDiagnostics(conversationId);
  const { hasThinkingMessage, status } = runtimeDiagnostics;
  const showIndicator = isAcpRuntimeWaitingSnapshot(runtimeDiagnostics) && !hasThinkingMessage;

  if (!showIndicator) {
    return null;
  }

  const displayName = agentName || backend || 'ACP';
  const subtitle = shouldDescribeAwaitingFirstResponse(status)
    ? t('acp.warmup.awaitingFirstResponse', {
        agent: displayName,
        defaultValue: `Waiting for the first response from ${displayName}...`,
      })
    : t('acp.status.connecting', {
        agent: displayName,
        defaultValue: `Connecting to ${displayName}...`,
      });

  return <ThoughtDisplay running subtitle={subtitle} testId='acp-warmup-indicator' />;
};

export default AcpWarmupIndicator;
