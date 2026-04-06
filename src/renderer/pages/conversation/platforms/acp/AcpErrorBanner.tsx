import { Alert, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatAcpLogEntry } from './AcpLogsPanel';
import type { AcpLogEntry } from './acpRuntimeDiagnostics';

const { Text } = Typography;

type AcpErrorBannerProps = {
  entry: AcpLogEntry;
};

const AcpErrorBanner: React.FC<AcpErrorBannerProps> = ({ entry }) => {
  const { t } = useTranslation();
  const formattedEntry = formatAcpLogEntry(entry, t);

  return (
    <Alert
      type='error'
      closable={false}
      data-testid='acp-error-banner'
      title={formattedEntry.summary}
      content={formattedEntry.detail ? <Text>{formattedEntry.detail}</Text> : undefined}
      style={{ marginBottom: 12 }}
    />
  );
};

export default AcpErrorBanner;
