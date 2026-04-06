import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AcpLogEntry } from './acpRuntimeDiagnostics';

const { Text } = Typography;

const getDisplayName = (entry: AcpLogEntry): string => {
  if (entry.agentName) {
    return entry.agentName;
  }

  if (entry.backend) {
    return (
      ACP_BACKENDS_ALL[entry.backend as keyof typeof ACP_BACKENDS_ALL]?.name ||
      entry.backend.charAt(0).toUpperCase() + entry.backend.slice(1)
    );
  }

  return 'ACP';
};

const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toISOString().slice(11, 19);
};

export const formatAcpLogEntry = (
  entry: AcpLogEntry,
  t: (key: string, options?: Record<string, unknown>) => string
): { summary: string; detail?: string } => {
  const displayName = getDisplayName(entry);
  const modelId = entry.modelId || 'unknown';
  const duration = entry.durationMs ?? 0;

  switch (entry.kind) {
    case 'request_started':
      return {
        summary: t('acp.logs.requestStarted', {
          backend: displayName,
          model: modelId,
        }),
      };
    case 'first_response':
      return {
        summary: t('acp.logs.firstResponse', {
          backend: displayName,
          model: modelId,
          duration,
        }),
      };
    case 'request_finished':
      return {
        summary: t('acp.logs.requestFinished', {
          backend: displayName,
          model: modelId,
          duration,
        }),
      };
    case 'request_error':
      return {
        summary: t('acp.logs.requestErrored', {
          backend: displayName,
          model: modelId,
          duration,
        }),
        detail:
          entry.detail ||
          (entry.disconnectCode !== undefined || entry.disconnectSignal !== undefined
            ? t('acp.logs.disconnectReason', {
                code: entry.disconnectCode ?? '-',
                signal: entry.disconnectSignal ?? '-',
              })
            : undefined),
      };
    case 'send_failed':
      return {
        summary: t('acp.logs.sendFailed', { agent: displayName }),
        detail: entry.detail,
      };
    case 'auth_requested':
      return {
        summary: t('acp.logs.authRequested', { agent: displayName }),
      };
    case 'auth_ready':
      return {
        summary: t('acp.logs.authReady', { agent: displayName }),
      };
    case 'auth_failed':
      return {
        summary: t('acp.logs.authFailed', { agent: displayName }),
        detail: entry.detail,
      };
    case 'retry_requested':
      return {
        summary: t('acp.logs.retryRequested', { agent: displayName }),
      };
    case 'retry_ready':
      return {
        summary: t('acp.logs.retryReady', { agent: displayName }),
      };
    case 'retry_failed':
      return {
        summary: t('acp.logs.retryFailed', { agent: displayName }),
        detail: entry.detail,
      };
    case 'send_now_requested':
      return {
        summary: t('acp.logs.sendNowRequested', { agent: displayName }),
      };
    case 'cancel_requested':
      return {
        summary: t('acp.logs.cancelRequested'),
      };
    case 'status':
      if (!entry.status) {
        return {
          summary: t('acp.status.unknown'),
        };
      }

      if (entry.status === 'error') {
        return {
          summary: t('acp.status.error'),
          detail:
            entry.detail ||
            (entry.disconnectCode !== undefined || entry.disconnectSignal !== undefined
              ? t('acp.logs.disconnectReason', {
                  code: entry.disconnectCode ?? '-',
                  signal: entry.disconnectSignal ?? '-',
                })
              : undefined),
        };
      }

      return {
        summary: t(`acp.status.${entry.status}`, { agent: displayName }),
        detail:
          entry.status === 'disconnected'
            ? t('acp.logs.disconnectReason', {
                code: entry.disconnectCode ?? '-',
                signal: entry.disconnectSignal ?? '-',
              })
            : undefined,
      };
  }
};

const AcpLogsPanel: React.FC<{
  entries: AcpLogEntry[];
  className?: string;
}> = ({ entries, className }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(false);

  if (entries.length === 0) {
    return null;
  }

  const latestEntry = entries[0];
  const latestSummary = formatAcpLogEntry(latestEntry, t);
  const tagColor =
    latestEntry.level === 'error'
      ? 'red'
      : latestEntry.level === 'success'
        ? 'green'
        : latestEntry.level === 'warning'
          ? 'orange'
          : undefined;

  return (
    <div
      data-testid='acp-logs-panel'
      className={`rounded-12px border border-[color:var(--color-border-2)] bg-1 px-12px py-10px ${className ?? 'mb-12px'}`}
    >
      <div className='flex items-start gap-8px'>
        <Tag color={tagColor}>{t('acp.logs.title')}</Tag>
        <div className='min-w-0 flex-1'>
          <div className='text-13px text-t-primary leading-20px'>{latestSummary.summary}</div>
          {latestSummary.detail && (
            <div className='text-12px text-t-secondary leading-18px'>{latestSummary.detail}</div>
          )}
        </div>
        <Button
          type='text'
          size='mini'
          data-testid='acp-logs-toggle'
          onClick={() => {
            setExpanded((currentExpanded) => !currentExpanded);
          }}
        >
          {expanded ? t('common.hide') : t('common.show')}
        </Button>
      </div>

      {expanded && (
        <div
          data-testid='acp-logs-list'
          className='mt-10px flex flex-col gap-8px border-t border-[color:var(--color-border-2)] pt-8px'
        >
          {entries.map((entry) => {
            const formattedEntry = formatAcpLogEntry(entry, t);

            return (
              <div key={entry.id} className='flex items-start gap-8px'>
                <Text className='w-64px flex-shrink-0 text-11px text-t-tertiary'>
                  {formatTimestamp(entry.timestamp)}
                </Text>
                <Space direction='vertical' size={2} className='min-w-0 flex-1'>
                  <Text className='text-12px leading-18px'>{formattedEntry.summary}</Text>
                  {formattedEntry.detail && <Text type='secondary'>{formattedEntry.detail}</Text>}
                </Space>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AcpLogsPanel;
