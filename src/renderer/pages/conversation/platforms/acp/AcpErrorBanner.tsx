import { copyText } from '@/renderer/utils/ui/clipboard';
import { Alert, Button, Message, Space, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatAcpLogEntry } from './AcpLogsPanel';
import type { AcpLogEntry } from './acpRuntimeDiagnostics';

const { Text } = Typography;

type AcpErrorBannerProps = {
  entry: AcpLogEntry;
  onDismiss: () => void;
};

const AcpErrorBanner: React.FC<AcpErrorBannerProps> = ({ entry, onDismiss }) => {
  const { t } = useTranslation();
  const formattedEntry = formatAcpLogEntry(entry, t);
  const copyPayload = formattedEntry.detail
    ? `${formattedEntry.summary}\n\n${formattedEntry.detail}`
    : formattedEntry.summary;

  const handleCopy = React.useCallback(() => {
    void copyText(copyPayload)
      .then(() => {
        Message.success(t('common.copySuccess'));
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  }, [copyPayload, t]);

  return (
    <Alert
      type='error'
      closable={false}
      data-testid='acp-error-banner'
      title={formattedEntry.summary}
      content={
        <Space direction='vertical' size='small' style={{ width: '100%' }}>
          {formattedEntry.detail ? <Text>{formattedEntry.detail}</Text> : null}
          <Space>
            <Button type='secondary' size='mini' data-testid='acp-error-banner-copy' onClick={handleCopy}>
              {t('common.copy')}
            </Button>
            <Button type='secondary' size='mini' data-testid='acp-error-banner-dismiss' onClick={onDismiss}>
              {t('common.close')}
            </Button>
          </Space>
        </Space>
      }
      style={{ marginBottom: 12 }}
    />
  );
};

export default AcpErrorBanner;
