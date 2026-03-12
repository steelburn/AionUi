/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { iconColors } from '@/renderer/theme/colors';
import { Button, Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { Down, Shield } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

interface CodexSandboxSelectorProps {
  compact?: boolean;
  showToast?: boolean;
}

const DEFAULT_SANDBOX_MODE: CodexSandboxMode = 'workspace-write';

const CodexSandboxSelector: React.FC<CodexSandboxSelectorProps> = ({ compact = false, showToast = false }) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = Boolean(layout?.isMobile);
  const [sandboxMode, setSandboxMode] = useState<CodexSandboxMode>(DEFAULT_SANDBOX_MODE);
  const [isSaving, setIsSaving] = useState(false);
  const [dropdownVisible, setDropdownVisible] = useState(false);

  const sandboxOptions = useMemo(
    () => [
      { value: 'read-only' as const, label: t('settings.codexSandboxReadOnly', { defaultValue: 'Read Only' }) },
      { value: 'workspace-write' as const, label: t('settings.codexSandboxDefaultAccess', { defaultValue: 'Default Access' }) },
      { value: 'danger-full-access' as const, label: t('settings.codexSandboxFullAccess', { defaultValue: 'Full Access' }) },
    ],
    [t]
  );

  const currentOption = sandboxOptions.find((option) => option.value === sandboxMode) || sandboxOptions[1];

  useEffect(() => {
    let cancelled = false;

    ipcBridge.codexConfig.getSandboxMode
      .invoke()
      .then((result) => {
        if (!cancelled && result.success && result.data) {
          setSandboxMode(result.data.sandboxMode);
        }
      })
      .catch((error) => {
        console.warn('[CodexSandboxSelector] Failed to load sandbox mode:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = (nextMode: CodexSandboxMode) => {
    if (nextMode === sandboxMode || isSaving) {
      setDropdownVisible(false);
      return;
    }

    setIsSaving(true);
    ipcBridge.codexConfig.setSandboxMode
      .invoke({ sandboxMode: nextMode })
      .then((result) => {
        if (result.success && result.data) {
          setSandboxMode(result.data.sandboxMode);
          if (showToast) {
            Message.success(t('settings.codexSandboxSaved', { defaultValue: 'Codex sandbox updated' }));
          }
        } else {
          Message.error(result.msg || t('settings.codexSandboxSaveFailed', { defaultValue: 'Failed to update Codex sandbox' }));
        }
      })
      .catch((error) => {
        console.error('[CodexSandboxSelector] Failed to save sandbox mode:', error);
        Message.error(t('settings.codexSandboxSaveFailed', { defaultValue: 'Failed to update Codex sandbox' }));
      })
      .finally(() => {
        setIsSaving(false);
        setDropdownVisible(false);
      });
  };

  const dropdownMenu = (
    <Menu onClickMenuItem={(key) => void handleSelect(key as CodexSandboxMode)}>
      <Menu.ItemGroup title={t('settings.codexSandbox', { defaultValue: 'Codex Sandbox' })}>
        {sandboxOptions.map((option) => (
          <Menu.Item key={option.value} className={sandboxMode === option.value ? '!bg-2' : ''}>
            <div className='flex items-center gap-8px'>
              {sandboxMode === option.value && <span className='text-primary'>*</span>}
              <span className={sandboxMode !== option.value ? 'ml-16px' : ''}>{option.label}</span>
            </div>
          </Menu.Item>
        ))}
      </Menu.ItemGroup>
    </Menu>
  );

  const compactLabel = isMobile ? currentOption.label : `${t('settings.codexSandbox', { defaultValue: 'Codex Sandbox' })} · ${currentOption.label}`;

  const compactButton = (
    <Button className='sendbox-model-btn' shape='round' size='small' style={{ opacity: isSaving ? 0.6 : 1 }}>
      <span className='flex items-center gap-6px min-w-0 leading-none'>
        <span className='shrink-0 inline-flex items-center'>
          <Shield theme='outline' size='14' fill={iconColors.secondary} />
        </span>
        <span className='block truncate leading-none'>{compactLabel}</span>
        <Down size={12} className='text-t-tertiary shrink-0' />
      </span>
    </Button>
  );

  if (compact) {
    return (
      <Tooltip content={t('settings.codexSandboxDesc', { defaultValue: 'Applies to new Codex sessions and syncs sandbox_mode to your Codex config.' })}>
        <Dropdown trigger='click' popupVisible={dropdownVisible} onVisibleChange={(visible) => !isSaving && setDropdownVisible(visible)} droplist={dropdownMenu}>
          {compactButton}
        </Dropdown>
      </Tooltip>
    );
  }

  return (
    <Dropdown trigger='click' popupVisible={dropdownVisible} onVisibleChange={(visible) => !isSaving && setDropdownVisible(visible)} droplist={dropdownMenu}>
      <Button shape='round' type='outline' style={{ opacity: isSaving ? 0.6 : 1 }}>
        <span className='flex items-center gap-8px'>
          <Shield theme='outline' size='14' fill={iconColors.secondary} />
          <span>{currentOption.label}</span>
          <Down size={12} className='text-t-tertiary' />
        </span>
      </Button>
    </Dropdown>
  );
};

export default CodexSandboxSelector;
