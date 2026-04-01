import { useApi } from '@renderer/api';
import { useCallback, useEffect, useState } from 'react';
import useSWR, { mutate } from 'swr';

/**
 * Manages available agent backends detection and
 * extension-contributed ACP adapters.
 */
export const useAssistantBackends = () => {
  const api = useApi();
  const [availableBackends, setAvailableBackends] = useState<Set<string>>(new Set(['gemini']));

  // Load extension-contributed ACP adapters so they appear in the main agent dropdown
  const { data: extensionAcpAdapters } = useSWR('extensions.acpAdapters', () =>
    api.request('extensions.get-acp-adapters', undefined).catch(() => [] as Record<string, unknown>[])
  );

  // Load available agent backends from ACP detector
  useEffect(() => {
    void (async () => {
      try {
        const resp = await api.request('acp.get-available-agents', undefined);
        if (resp.success && resp.data) {
          setAvailableBackends(new Set(resp.data.map((a) => a.backend)));
        }
      } catch {
        // fallback to default
      }
    })();
  }, []);

  const refreshAgentDetection = useCallback(async () => {
    try {
      await api.request('acp.refresh-custom-agents', undefined);
      await mutate('acp.agents.available');
    } catch {
      // ignore
    }
  }, []);

  return {
    availableBackends,
    extensionAcpAdapters,
    refreshAgentDetection,
  };
};
