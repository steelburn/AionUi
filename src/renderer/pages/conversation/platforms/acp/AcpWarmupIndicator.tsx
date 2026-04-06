import { Robot } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import {
  isAcpRuntimeWaitingSnapshot,
  isAcpRuntimeWarmSessionWaitingSnapshot,
  useAcpRuntimeDiagnostics,
  type AcpRuntimeStatus,
} from './acpRuntimeDiagnostics';

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
  const showIndicator =
    isAcpRuntimeWaitingSnapshot(runtimeDiagnostics) &&
    !isAcpRuntimeWarmSessionWaitingSnapshot(runtimeDiagnostics) &&
    !hasThinkingMessage;

  if (!showIndicator) {
    return null;
  }

  const displayName = agentName || backend || 'ACP';
  const logo = getAgentLogo(backend ?? agentName);
  const statusLabel = shouldDescribeAwaitingFirstResponse(status)
    ? t('acp.warmup.awaitingInline', {
        agent: displayName,
        defaultValue: `Waiting for ${displayName}...`,
      })
    : t('acp.warmup.connectingInline', {
        agent: displayName,
        defaultValue: `Connecting ${displayName}...`,
      });

  return (
    <div
      data-testid='acp-warmup-indicator'
      className='mb-8px flex w-full max-w-800px items-center gap-10px rounded-12px border border-[color:var(--color-border-2)] bg-1 px-12px py-10px text-13px text-t-secondary mx-auto'
    >
      <span
        data-testid='acp-warmup-agent-icon'
        aria-hidden='true'
        className='inline-flex h-18px w-18px shrink-0 items-center justify-center rounded-full bg-[var(--brand-light)] animate-spin'
      >
        {logo ? (
          <img src={logo} alt='' className='block h-12px w-12px object-contain' />
        ) : (
          <Robot theme='outline' size={12} fill='var(--brand)' />
        )}
      </span>
      <span className='min-w-0 flex-1 truncate'>{statusLabel}</span>
    </div>
  );
};

export default AcpWarmupIndicator;
