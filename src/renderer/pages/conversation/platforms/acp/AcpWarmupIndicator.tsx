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

const formatElapsedTime = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
};

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
  const { activityPhase, activityStartedAt, hasThinkingMessage, status } = runtimeDiagnostics;
  const isWaiting = isAcpRuntimeWaitingSnapshot(runtimeDiagnostics);
  const isWarmSessionWaiting = isAcpRuntimeWarmSessionWaitingSnapshot(runtimeDiagnostics);
  const isStreaming = activityPhase === 'streaming';
  const showIndicator = !hasThinkingMessage && ((isWaiting && !isWarmSessionWaiting) || isStreaming);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  React.useEffect(() => {
    if (!showIndicator || activityStartedAt === null || activityStartedAt === undefined) {
      setElapsedSeconds(0);
      return;
    }

    const syncElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - activityStartedAt) / 1000)));
    };

    syncElapsed();
    const timer = window.setInterval(syncElapsed, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activityStartedAt, showIndicator]);

  if (!showIndicator) {
    return null;
  }

  const displayName = agentName || backend || 'ACP';
  const logo = getAgentLogo(backend ?? agentName);
  const statusLabel = isStreaming
    ? t('acp.warmup.respondingInline', {
        agent: displayName,
        defaultValue: `${displayName} is responding...`,
      })
    : shouldDescribeAwaitingFirstResponse(status)
      ? t('acp.warmup.awaitingInline', {
          agent: displayName,
          defaultValue: `Waiting for ${displayName}...`,
        })
      : t('acp.warmup.connectingInline', {
          agent: displayName,
          defaultValue: `Connecting ${displayName}...`,
        });
  const elapsedLabel = elapsedSeconds > 0 ? formatElapsedTime(elapsedSeconds) : null;

  return (
    <div
      data-testid='acp-warmup-indicator'
      data-activity-phase={isStreaming ? 'streaming' : 'waiting'}
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
      {elapsedLabel ? (
        <span
          data-testid='acp-warmup-indicator-elapsed'
          className='shrink-0 whitespace-nowrap text-12px text-t-tertiary'
        >
          {elapsedLabel}
        </span>
      ) : null}
    </div>
  );
};

export default AcpWarmupIndicator;
