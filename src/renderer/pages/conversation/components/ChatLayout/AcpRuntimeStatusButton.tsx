import { Button, Popover, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import AcpLogsPanel from '@/renderer/pages/conversation/platforms/acp/AcpLogsPanel';
import {
  isAcpRuntimeWaitingSnapshot,
  useAcpRuntimeDiagnostics,
  type AcpLogEntry,
  type AcpRuntimeActivityPhase,
  type AcpRuntimeStatus,
  type AcpRuntimeStatusSource,
} from '@/renderer/pages/conversation/platforms/acp/acpRuntimeDiagnostics';

const { Text } = Typography;

const getStatusColor = (status: AcpRuntimeStatus | null): string => {
  switch (status) {
    case 'connecting':
      return 'rgb(var(--warning-6))';
    case 'connected':
    case 'authenticated':
    case 'session_active':
      return 'rgb(var(--success-6))';
    case 'auth_required':
      return 'rgb(var(--warning-6))';
    case 'disconnected':
    case 'error':
      return 'rgb(var(--danger-6))';
    default:
      return 'var(--color-text-4)';
  }
};

const isTerminalStatus = (status: AcpRuntimeStatus | null): boolean => {
  return status === 'auth_required' || status === 'disconnected' || status === 'error';
};

const shouldDemoteHydratedTerminalStatus = (
  status: AcpRuntimeStatus | null,
  statusSource: AcpRuntimeStatusSource | null
): boolean => {
  return statusSource === 'hydrated' && isTerminalStatus(status);
};

const getStatusLabel = (
  status: AcpRuntimeStatus | null,
  agentName: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  if (status === null) {
    return t('acp.status.unknown');
  }

  if (status === 'error') {
    return t('acp.status.error');
  }

  return t(`acp.status.${status}`, { agent: agentName });
};

const getButtonLabel = ({
  activityPhase,
  diagnosticsOnly,
  effectiveStatus,
  agentName,
  t,
}: {
  activityPhase: AcpRuntimeActivityPhase;
  diagnosticsOnly: boolean;
  effectiveStatus: AcpRuntimeStatus | null;
  agentName: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}): string => {
  if (activityPhase === 'waiting') {
    return t('conversation.chat.processing');
  }

  if (diagnosticsOnly) {
    return t('acp.logs.title');
  }

  return getStatusLabel(effectiveStatus, agentName, t);
};

const AcpRuntimeStatusButton: React.FC<{
  conversationId: string;
  backend?: string;
  agentName?: string;
}> = ({ conversationId, backend, agentName }) => {
  const { t } = useTranslation();
  const runtimeDiagnostics = useAcpRuntimeDiagnostics(conversationId);
  const { status, statusSource, activityPhase, logs } = runtimeDiagnostics;
  const [visible, setVisible] = React.useState(false);
  const displayName = agentName || backend || 'ACP';
  const diagnosticsOnly = shouldDemoteHydratedTerminalStatus(status, statusSource);
  const effectiveStatus = diagnosticsOnly ? null : status;
  const isWaiting = isAcpRuntimeWaitingSnapshot(runtimeDiagnostics);
  const statusLabel = getButtonLabel({
    activityPhase: isWaiting ? 'waiting' : activityPhase,
    diagnosticsOnly,
    effectiveStatus,
    agentName: displayName,
    t,
  });
  const color = isWaiting ? 'rgb(var(--primary-6))' : getStatusColor(effectiveStatus);

  const panelEntries = React.useMemo<AcpLogEntry[]>(() => {
    if (logs.length > 0) {
      return logs;
    }

    if (status === null) {
      return [];
    }

    return [
      {
        id: `${conversationId}-acp-runtime-status`,
        kind: 'status',
        level:
          status === 'auth_required' ? 'warning' : status === 'error' || status === 'disconnected' ? 'error' : 'info',
        timestamp: Date.now(),
        source: 'ui',
        backend,
        agentName,
        status,
      },
    ];
  }, [agentName, backend, conversationId, logs, status]);

  const popoverContent =
    panelEntries.length > 0 ? (
      <AcpLogsPanel entries={panelEntries} className='mb-0 min-w-280px max-w-360px shadow-none' />
    ) : (
      <div
        data-testid='acp-runtime-diagnostics-empty'
        className='min-w-220px max-w-320px rounded-12px border border-[color:var(--color-border-2)] bg-1 px-12px py-10px'
      >
        <div className='text-13px font-medium text-t-primary'>{t('acp.logs.title')}</div>
        <Text className='mt-6px block text-12px text-t-secondary'>{statusLabel}</Text>
      </div>
    );

  return (
    <Popover
      content={popoverContent}
      trigger='click'
      popupVisible={visible}
      onVisibleChange={setVisible}
      position='bottom'
    >
      <Button
        type='text'
        size='mini'
        data-testid='acp-runtime-status-button'
        aria-label={statusLabel}
        title={statusLabel}
        className='!min-w-18px !w-18px !h-18px !p-0 shrink-0 rounded-full hover:bg-[var(--color-fill-2)]'
      >
        <span
          data-testid='acp-runtime-status-dot'
          className={`block h-8px w-8px rounded-full shadow-[0_0_0_1px_var(--color-border-2)] ${
            isWaiting ? 'animate-pulse' : ''
          }`}
          style={{ backgroundColor: color }}
        />
      </Button>
    </Popover>
  );
};

export default AcpRuntimeStatusButton;
