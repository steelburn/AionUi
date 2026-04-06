import { Spin, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAcpRuntimeDiagnostics, type AcpRuntimeStatus } from './acpRuntimeDiagnostics';

const { Text } = Typography;

const formatElapsedTime = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
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
  const { activityPhase, hasThinkingMessage, status } = useAcpRuntimeDiagnostics(conversationId);
  const [elapsedTime, setElapsedTime] = React.useState(0);
  const startTimeRef = React.useRef<number>(Date.now());

  const showIndicator = activityPhase === 'waiting' && !hasThinkingMessage;

  React.useEffect(() => {
    if (!showIndicator) {
      setElapsedTime(0);
      return;
    }

    startTimeRef.current = Date.now();
    setElapsedTime(0);

    const timer = window.setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [showIndicator]);

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

  return (
    <div
      data-testid='acp-warmup-indicator'
      className='mx-auto mb-12px flex w-full max-w-780px items-center gap-10px rounded-12px border border-[color:var(--color-border-2)] bg-[var(--color-fill-1)] px-12px py-10px'
    >
      <Spin size={14} />
      <div className='min-w-0 flex-1'>
        <div className='text-13px font-medium text-t-primary'>{t('conversation.chat.processing')}</div>
        <Text className='mt-2px block text-12px text-t-secondary'>{subtitle}</Text>
      </div>
      <Text className='text-12px whitespace-nowrap text-t-tertiary'>{formatElapsedTime(elapsedTime)}</Text>
    </div>
  );
};

export default AcpWarmupIndicator;
