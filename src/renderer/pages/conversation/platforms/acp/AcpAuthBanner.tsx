import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import { Alert, Button, Space, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

type AcpAuthBannerProps = {
  agentName?: string;
  backend: string;
  authenticating?: boolean;
  onAuthenticate: () => void;
};

const AcpAuthBanner: React.FC<AcpAuthBannerProps> = ({
  agentName,
  backend,
  authenticating = false,
  onAuthenticate,
}) => {
  const { t } = useTranslation();

  const displayName =
    agentName ||
    ACP_BACKENDS_ALL[backend as keyof typeof ACP_BACKENDS_ALL]?.name ||
    backend.charAt(0).toUpperCase() + backend.slice(1);

  return (
    <Alert
      type='warning'
      closable={false}
      data-testid='acp-auth-banner'
      title={t('acp.status.auth_required', { agent: displayName })}
      content={
        <Space direction='vertical' size='small' style={{ width: '100%' }}>
          <Text>
            {authenticating
              ? t('acp.auth.authenticatingHint', { agent: displayName })
              : t('acp.auth.requiredHint', { agent: displayName })}
          </Text>
          <Space>
            <Button type='primary' size='mini' loading={authenticating} onClick={onAuthenticate}>
              {authenticating ? t('acp.auth.authenticating') : t('acp.auth.authenticate')}
            </Button>
          </Space>
        </Space>
      }
      style={{ marginBottom: 12 }}
    />
  );
};

export default AcpAuthBanner;
