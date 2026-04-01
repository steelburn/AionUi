// Endpoint registry - type-safe map of all endpoint names to request/response types

import type { IBridgeResponse } from '../wire';
import type {
  ISendMessageParams,
  IConfirmMessageParams,
  ICreateConversationParams,
  IResetConversationParams,
  IResponseMessage,
  IConversationTurnCompletedEvent,
  IConversationListChangedEvent,
  ConversationSideQuestionResult,
} from './conversation';
import type { ICdpStatus, ICdpConfig } from './application';
import type { IDirOrFile, IFileMetadata } from './fs';
import type {
  IExtensionInfo,
  IExtensionPermissionSummary,
  IExtensionSettingsTab,
  IExtensionWebuiContribution,
  IExtensionAgentActivitySnapshot,
} from './extensions';
import type { INotificationOptions } from './notification';
import type { IWebUIStatus } from './webui';
import type { ICronJob, ICreateCronJobParams } from './cron';

// Protocol-internal imports
import type { TChatConversation, IProvider, IMcpServer, ICssTheme, TProviderWithModel } from '../config/storage';
import type { IConfirmation } from '../chat/chatLib';
import type { SlashCommandItem } from '../chat/slash/types';
import type { AcpBackend, AcpBackendAll, AcpModelInfo, PresetAgentType } from '../types/acpTypes';
import type { AcpSessionConfigOption } from '../types/acpTypes';
import type { PreviewHistoryTarget, PreviewSnapshotInfo, PreviewContentType } from '../types/preview';
import type {
  UpdateCheckRequest,
  UpdateCheckResult,
  UpdateDownloadProgressEvent,
  UpdateDownloadRequest,
  UpdateDownloadResult,
  AutoUpdateStatus,
} from '../types/update';
import type { ProtocolDetectionRequest, ProtocolDetectionResponse } from '../types/protocol';
import type { SpeechToTextRequest, SpeechToTextResult } from '../types/speech';
import type { DocumentConversionRequest, DocumentConversionResponse } from '../types/conversion';
import type { IMessageSearchResponse } from '../types/database';
import type { SnapshotInfo, CompareResult, FileChangeOperation } from '../types/fileSnapshot';
import type { IChannelPairingRequest, IChannelPluginStatus, IChannelSession, IChannelUser } from '../types/channel';
import type { RemoteAgentConfig, RemoteAgentInput } from '../types/remoteAgent';
// McpSource remains external - it's a process-layer type not part of the protocol
import type { McpSource } from '@process/services/mcpServices/McpProtocol';

/**
 * Type-safe map of all Provider endpoint names to { request, response } types.
 * Covers all ~200 bridge.buildProvider calls in ipcBridge.ts.
 */
export type EndpointMap = {
  // === Shell ===
  'open-file': { request: string; response: void };
  'show-item-in-folder': { request: string; response: void };
  'open-external': { request: string; response: void };

  // === Conversation ===
  'create-conversation': { request: ICreateConversationParams; response: TChatConversation };
  'create-conversation-with-conversation': {
    request: { conversation: TChatConversation; sourceConversationId?: string; migrateCron?: boolean };
    response: TChatConversation;
  };
  'get-conversation': { request: { id: string }; response: TChatConversation };
  'get-associated-conversation': { request: { conversation_id: string }; response: TChatConversation[] };
  'remove-conversation': { request: { id: string }; response: boolean };
  'update-conversation': {
    request: { id: string; updates: Partial<TChatConversation>; mergeExtra?: boolean };
    response: boolean;
  };
  'reset-conversation': { request: IResetConversationParams; response: void };
  'conversation.warmup': { request: { conversation_id: string }; response: void };
  'chat.stop.stream': { request: { conversation_id: string }; response: IBridgeResponse<{}> };
  'chat.send.message': { request: ISendMessageParams; response: IBridgeResponse<{}> };
  'conversation.get-slash-commands': {
    request: { conversation_id: string };
    response: IBridgeResponse<{ commands: SlashCommandItem[] }>;
  };
  'conversation.ask-side-question': {
    request: { conversation_id: string; question: string };
    response: IBridgeResponse<ConversationSideQuestionResult>;
  };
  'conversation.confirm.message': { request: IConfirmMessageParams; response: IBridgeResponse };
  'conversation.get-workspace': {
    request: { conversation_id: string; workspace: string; path: string; search?: string };
    response: IDirOrFile[];
  };
  'conversation.response.search.workspace': {
    request: { file: number; dir: number; match?: IDirOrFile };
    response: void;
  };
  'conversation.reload-context': { request: { conversation_id: string }; response: IBridgeResponse };
  'confirmation.confirm': {
    request: { conversation_id: string; msg_id: string; data: any; callId: string };
    response: IBridgeResponse;
  };
  'confirmation.list': { request: { conversation_id: string }; response: IConfirmation<any>[] };
  'approval.check': {
    request: { conversation_id: string; action: string; commandType?: string };
    response: boolean;
  };

  // === Gemini Conversation ===
  'input.confirm.message': { request: IConfirmMessageParams; response: IBridgeResponse };

  // === Application ===
  'restart-app': { request: void; response: void };
  'open-dev-tools': { request: void; response: boolean };
  'is-dev-tools-opened': { request: void; response: boolean };
  'system.info': {
    request: void;
    response: { cacheDir: string; workDir: string; logDir: string; platform: string; arch: string };
  };
  'app.get-path': { request: { name: 'desktop' | 'home' | 'downloads' }; response: string };
  'system.update-info': { request: { cacheDir: string; workDir: string }; response: IBridgeResponse };
  'app.get-zoom-factor': { request: void; response: number };
  'app.set-zoom-factor': { request: { factor: number }; response: number };
  'app.get-cdp-status': { request: void; response: IBridgeResponse<ICdpStatus> };
  'app.update-cdp-config': { request: Partial<ICdpConfig>; response: IBridgeResponse<ICdpConfig> };

  // === Update ===
  'update.check': { request: UpdateCheckRequest; response: IBridgeResponse<UpdateCheckResult> };
  'update.download': { request: UpdateDownloadRequest; response: IBridgeResponse<UpdateDownloadResult> };

  // === Auto-Update ===
  'auto-update.check': {
    request: { includePrerelease?: boolean };
    response: IBridgeResponse<{ updateInfo?: { version: string; releaseDate?: string; releaseNotes?: string } }>;
  };
  'auto-update.download': { request: void; response: IBridgeResponse };
  'auto-update.quit-and-install': { request: void; response: void };

  // === Star Office ===
  'star-office.detect-url': {
    request: { preferredUrl?: string; force?: boolean; timeoutMs?: number };
    response: IBridgeResponse<{ url: string | null }>;
  };

  // === Dialog ===
  'show-open': {
    request:
      | { defaultPath?: string; properties?: Array<string>; filters?: Array<{ name: string; extensions: string[] }> }
      | undefined;
    response: string[] | undefined;
  };

  // === Filesystem ===
  'get-file-by-dir': { request: { dir: string; root: string }; response: Array<IDirOrFile> };
  'get-image-base64': { request: { path: string }; response: string };
  'fetch-remote-image': { request: { url: string }; response: string };
  'read-file': { request: { path: string }; response: string };
  'read-file-buffer': { request: { path: string }; response: ArrayBuffer };
  'create-temp-file': { request: { fileName: string }; response: string };
  'write-file': { request: { path: string; data: Uint8Array | string }; response: boolean };
  'create-zip-file': {
    request: {
      path: string;
      requestId?: string;
      files: Array<{ name: string; content?: string | Uint8Array; sourcePath?: string }>;
    };
    response: boolean;
  };
  'cancel-zip-file': { request: { requestId: string }; response: boolean };
  'get-file-metadata': { request: { path: string }; response: IFileMetadata };
  'copy-files-to-workspace': {
    request: { filePaths: string[]; workspace: string; sourceRoot?: string };
    response: IBridgeResponse<{ copiedFiles: string[]; failedFiles?: Array<{ path: string; error: string }> }>;
  };
  'remove-entry': { request: { path: string }; response: IBridgeResponse };
  'rename-entry': { request: { path: string; newName: string }; response: IBridgeResponse<{ newPath: string }> };
  'read-builtin-rule': { request: { fileName: string }; response: string };
  'read-builtin-skill': { request: { fileName: string }; response: string };
  'read-assistant-rule': { request: { assistantId: string; locale?: string }; response: string };
  'write-assistant-rule': { request: { assistantId: string; content: string; locale?: string }; response: boolean };
  'delete-assistant-rule': { request: { assistantId: string }; response: boolean };
  'read-assistant-skill': { request: { assistantId: string; locale?: string }; response: string };
  'write-assistant-skill': { request: { assistantId: string; content: string; locale?: string }; response: boolean };
  'delete-assistant-skill': { request: { assistantId: string }; response: boolean };
  'list-available-skills': {
    request: void;
    response: Array<{ name: string; description: string; location: string; isCustom: boolean }>;
  };
  'read-skill-info': {
    request: { skillPath: string };
    response: IBridgeResponse<{ name: string; description: string }>;
  };
  'import-skill': { request: { skillPath: string }; response: IBridgeResponse<{ skillName: string }> };
  'scan-for-skills': {
    request: { folderPath: string };
    response: IBridgeResponse<Array<{ name: string; description: string; path: string }>>;
  };
  'detect-common-skill-paths': { request: void; response: IBridgeResponse<Array<{ name: string; path: string }>> };
  'detect-and-count-external-skills': {
    request: void;
    response: IBridgeResponse<
      Array<{
        name: string;
        path: string;
        source: string;
        skills: Array<{ name: string; description: string; path: string }>;
      }>
    >;
  };
  'import-skill-with-symlink': { request: { skillPath: string }; response: IBridgeResponse<{ skillName: string }> };
  'delete-skill': { request: { skillName: string }; response: IBridgeResponse };
  'get-skill-paths': { request: void; response: { userSkillsDir: string; builtinSkillsDir: string } };
  'export-skill-with-symlink': { request: { skillPath: string; targetDir: string }; response: IBridgeResponse };
  'get-custom-external-paths': { request: void; response: Array<{ name: string; path: string }> };
  'add-custom-external-path': { request: { name: string; path: string }; response: IBridgeResponse };
  'remove-custom-external-path': { request: { path: string }; response: IBridgeResponse };
  'enable-skills-market': { request: void; response: IBridgeResponse };
  'disable-skills-market': { request: void; response: IBridgeResponse };

  // === Speech To Text ===
  'speech-to-text.transcribe': { request: SpeechToTextRequest; response: SpeechToTextResult };

  // === File Watch ===
  'file-watch-start': { request: { filePath: string }; response: IBridgeResponse };
  'file-watch-stop': { request: { filePath: string }; response: IBridgeResponse };
  'file-watch-stop-all': { request: void; response: IBridgeResponse };

  // === Workspace Office Watch ===
  'workspace-office-watch-start': { request: { workspace: string }; response: IBridgeResponse };
  'workspace-office-watch-stop': { request: { workspace: string }; response: IBridgeResponse };

  // === File Snapshot ===
  'file-snapshot-init': { request: { workspace: string }; response: SnapshotInfo };
  'file-snapshot-compare': { request: { workspace: string }; response: CompareResult };
  'file-snapshot-baseline': { request: { workspace: string; filePath: string }; response: string | null };
  'file-snapshot-info': { request: { workspace: string }; response: SnapshotInfo };
  'file-snapshot-dispose': { request: { workspace: string }; response: void };
  'file-snapshot-stage-file': { request: { workspace: string; filePath: string }; response: void };
  'file-snapshot-stage-all': { request: { workspace: string }; response: void };
  'file-snapshot-unstage-file': { request: { workspace: string; filePath: string }; response: void };
  'file-snapshot-unstage-all': { request: { workspace: string }; response: void };
  'file-snapshot-discard-file': {
    request: { workspace: string; filePath: string; operation: FileChangeOperation };
    response: void;
  };
  'file-snapshot-reset-file': {
    request: { workspace: string; filePath: string; operation: FileChangeOperation };
    response: void;
  };
  'file-snapshot-get-branches': { request: { workspace: string }; response: string[] };

  // === Google Auth ===
  'google.auth.login': { request: { proxy?: string }; response: IBridgeResponse<{ account: string }> };
  'google.auth.logout': { request: {}; response: void };
  'google.auth.status': { request: { proxy?: string }; response: IBridgeResponse<{ account: string }> };

  // === Gemini ===
  'gemini.subscription-status': {
    request: { proxy?: string };
    response: IBridgeResponse<{ isSubscriber: boolean; tier?: string; lastChecked: number; message?: string }>;
  };

  // === Bedrock ===
  'bedrock.test-connection': {
    request: {
      bedrockConfig: {
        authMethod: 'accessKey' | 'profile';
        region: string;
        accessKeyId?: string;
        secretAccessKey?: string;
        profile?: string;
      };
    };
    response: IBridgeResponse<{ msg?: string }>;
  };

  // === Model ===
  'mode.get-model-list': {
    request: {
      base_url?: string;
      api_key: string;
      try_fix?: boolean;
      platform?: string;
      bedrockConfig?: {
        authMethod: 'accessKey' | 'profile';
        region: string;
        accessKeyId?: string;
        secretAccessKey?: string;
        profile?: string;
      };
    };
    response: IBridgeResponse<{ mode: Array<string | { id: string; name: string }>; fix_base_url?: string }>;
  };
  'mode.save-model-config': { request: IProvider[]; response: IBridgeResponse };
  'mode.get-model-config': { request: void; response: IProvider[] };
  'mode.detect-protocol': { request: ProtocolDetectionRequest; response: IBridgeResponse<ProtocolDetectionResponse> };

  // === ACP Conversation ===
  'acp.detect-cli-path': { request: { backend: AcpBackend }; response: IBridgeResponse<{ path?: string }> };
  'acp.get-available-agents': {
    request: void;
    response: IBridgeResponse<
      Array<{
        backend: AcpBackend;
        name: string;
        cliPath?: string;
        customAgentId?: string;
        isPreset?: boolean;
        context?: string;
        avatar?: string;
        presetAgentType?: PresetAgentType | string;
        supportedTransports?: string[];
        isExtension?: boolean;
        extensionName?: string;
      }>
    >;
  };
  'acp.check.env': { request: void; response: { env: Record<string, string> } };
  'acp.refresh-custom-agents': { request: void; response: IBridgeResponse };
  'acp.test-custom-agent': {
    request: { command: string; acpArgs?: string[]; env?: Record<string, string> };
    response: IBridgeResponse<{ step: 'cli_check' | 'acp_initialize'; error?: string }>;
  };
  'acp.check-agent-health': {
    request: { backend: AcpBackend };
    response: IBridgeResponse<{ available: boolean; latency?: number; error?: string }>;
  };
  'acp.set-mode': {
    request: { conversationId: string; mode: string };
    response: IBridgeResponse<{ mode: string }>;
  };
  'acp.get-mode': {
    request: { conversationId: string };
    response: IBridgeResponse<{ mode: string; initialized: boolean }>;
  };
  'acp.get-model-info': {
    request: { conversationId: string };
    response: IBridgeResponse<{ modelInfo: AcpModelInfo | null }>;
  };
  'acp.probe-model-info': {
    request: { backend: AcpBackend };
    response: IBridgeResponse<{ modelInfo: AcpModelInfo | null }>;
  };
  'acp.set-model': {
    request: { conversationId: string; modelId: string };
    response: IBridgeResponse<{ modelInfo: AcpModelInfo | null }>;
  };
  'acp.get-config-options': {
    request: { conversationId: string };
    response: IBridgeResponse<{ configOptions: AcpSessionConfigOption[] }>;
  };
  'acp.set-config-option': {
    request: { conversationId: string; configId: string; value: string };
    response: IBridgeResponse<{ configOptions: AcpSessionConfigOption[] }>;
  };

  // === MCP Service ===
  'mcp.get-agent-configs': {
    request: Array<{ backend: AcpBackend; name: string; cliPath?: string }>;
    response: IBridgeResponse<Array<{ source: McpSource; servers: IMcpServer[] }>>;
  };
  'mcp.test-connection': {
    request: IMcpServer;
    response: IBridgeResponse<{
      success: boolean;
      tools?: Array<{ name: string; description?: string }>;
      error?: string;
      needsAuth?: boolean;
      authMethod?: 'oauth' | 'basic';
      wwwAuthenticate?: string;
    }>;
  };
  'mcp.sync-to-agents': {
    request: { mcpServers: IMcpServer[]; agents: Array<{ backend: AcpBackend; name: string; cliPath?: string }> };
    response: IBridgeResponse<{
      success: boolean;
      results: Array<{ agent: string; success: boolean; error?: string }>;
    }>;
  };
  'mcp.remove-from-agents': {
    request: { mcpServerName: string; agents: Array<{ backend: AcpBackend; name: string; cliPath?: string }> };
    response: IBridgeResponse<{
      success: boolean;
      results: Array<{ agent: string; success: boolean; error?: string }>;
    }>;
  };
  'mcp.check-oauth-status': {
    request: IMcpServer;
    response: IBridgeResponse<{ isAuthenticated: boolean; needsLogin: boolean; error?: string }>;
  };
  'mcp.login-oauth': {
    request: { server: IMcpServer; config?: any };
    response: IBridgeResponse<{ success: boolean; error?: string }>;
  };
  'mcp.logout-oauth': { request: string; response: IBridgeResponse };
  'mcp.get-authenticated-servers': { request: void; response: IBridgeResponse<string[]> };

  // === OpenClaw Conversation ===
  'openclaw.get-runtime': {
    request: { conversation_id: string };
    response: IBridgeResponse<{
      conversationId: string;
      runtime: {
        workspace?: string;
        backend?: string;
        agentName?: string;
        cliPath?: string;
        model?: string;
        sessionKey?: string | null;
        isConnected?: boolean;
        hasActiveSession?: boolean;
        identityHash?: string | null;
      };
      expected?: {
        expectedWorkspace?: string;
        expectedBackend?: string;
        expectedAgentName?: string;
        expectedCliPath?: string;
        expectedModel?: string;
        expectedIdentityHash?: string | null;
        switchedAt?: number;
      };
    }>;
  };

  // === Remote Agent ===
  'remote-agent.list': { request: void; response: RemoteAgentConfig[] };
  'remote-agent.get': { request: { id: string }; response: RemoteAgentConfig | null };
  'remote-agent.create': { request: RemoteAgentInput; response: RemoteAgentConfig };
  'remote-agent.update': { request: { id: string; updates: Partial<RemoteAgentInput> }; response: boolean };
  'remote-agent.delete': { request: { id: string }; response: boolean };
  'remote-agent.test-connection': {
    request: { url: string; authType: string; authToken?: string; allowInsecure?: boolean };
    response: { success: boolean; error?: string };
  };
  'remote-agent.handshake': {
    request: { id: string };
    response: { status: 'ok' | 'pending_approval' | 'error'; error?: string };
  };

  // === Database ===
  'database.get-conversation-messages': {
    request: { conversation_id: string; page?: number; pageSize?: number };
    response: import('../chat/chatLib').TMessage[];
  };
  'database.get-user-conversations': {
    request: { page?: number; pageSize?: number };
    response: TChatConversation[];
  };
  'database.search-conversation-messages': {
    request: { keyword: string; page?: number; pageSize?: number };
    response: IMessageSearchResponse;
  };

  // === Preview History ===
  'preview-history.list': { request: { target: PreviewHistoryTarget }; response: PreviewSnapshotInfo[] };
  'preview-history.save': {
    request: { target: PreviewHistoryTarget; content: string };
    response: PreviewSnapshotInfo;
  };
  'preview-history.get-content': {
    request: { target: PreviewHistoryTarget; snapshotId: string };
    response: { snapshot: PreviewSnapshotInfo; content: string } | null;
  };

  // === Document ===
  'document.convert': { request: DocumentConversionRequest; response: DocumentConversionResponse };

  // === PPT/Word/Excel Preview ===
  'ppt-preview.start': { request: { filePath: string }; response: { url: string } };
  'ppt-preview.stop': { request: { filePath: string }; response: void };
  'word-preview.start': { request: { filePath: string }; response: { url: string } };
  'word-preview.stop': { request: { filePath: string }; response: void };
  'excel-preview.start': { request: { filePath: string }; response: { url: string } };
  'excel-preview.stop': { request: { filePath: string }; response: void };

  // === Window Controls ===
  'window-controls:minimize': { request: void; response: void };
  'window-controls:maximize': { request: void; response: void };
  'window-controls:unmaximize': { request: void; response: void };
  'window-controls:close': { request: void; response: void };
  'window-controls:is-maximized': { request: void; response: boolean };

  // === System Settings ===
  'system-settings:get-close-to-tray': { request: void; response: boolean };
  'system-settings:set-close-to-tray': { request: { enabled: boolean }; response: void };
  'system-settings:get-notification-enabled': { request: void; response: boolean };
  'system-settings:set-notification-enabled': { request: { enabled: boolean }; response: void };
  'system-settings:get-cron-notification-enabled': { request: void; response: boolean };
  'system-settings:set-cron-notification-enabled': { request: { enabled: boolean }; response: void };
  'system-settings:change-language': { request: { language: string }; response: void };

  // === Notification ===
  'notification.show': { request: INotificationOptions; response: void };

  // === Task ===
  'task.stop-all': { request: void; response: { success: boolean; count: number } };
  'task.get-running-count': { request: void; response: { success: boolean; count: number } };

  // === WebUI ===
  'webui.get-status': { request: void; response: IBridgeResponse<IWebUIStatus> };
  'webui.start': {
    request: { port?: number; allowRemote?: boolean };
    response: IBridgeResponse<{
      port: number;
      localUrl: string;
      networkUrl?: string;
      lanIP?: string;
      initialPassword?: string;
    }>;
  };
  'webui.stop': { request: void; response: IBridgeResponse };
  'webui.change-password': { request: { newPassword: string }; response: IBridgeResponse };
  'webui.change-username': { request: { newUsername: string }; response: IBridgeResponse<{ username: string }> };
  'webui.reset-password': { request: void; response: IBridgeResponse<{ newPassword: string }> };
  'webui.generate-qr-token': {
    request: void;
    response: IBridgeResponse<{ token: string; expiresAt: number; qrUrl: string }>;
  };
  'webui.verify-qr-token': {
    request: { qrToken: string };
    response: IBridgeResponse<{ sessionToken: string; username: string }>;
  };

  // === Cron ===
  'cron.list-jobs': { request: void; response: ICronJob[] };
  'cron.list-jobs-by-conversation': { request: { conversationId: string }; response: ICronJob[] };
  'cron.get-job': { request: { jobId: string }; response: ICronJob | null };
  'cron.add-job': { request: ICreateCronJobParams; response: ICronJob };
  'cron.update-job': { request: { jobId: string; updates: Partial<ICronJob> }; response: ICronJob };
  'cron.remove-job': { request: { jobId: string }; response: void };

  // === Extensions ===
  'extensions.get-themes': { request: void; response: ICssTheme[] };
  'extensions.get-loaded-extensions': { request: void; response: IExtensionInfo[] };
  'extensions.get-assistants': { request: void; response: Record<string, unknown>[] };
  'extensions.get-agents': { request: void; response: Record<string, unknown>[] };
  'extensions.get-acp-adapters': { request: void; response: Record<string, unknown>[] };
  'extensions.get-mcp-servers': { request: void; response: Record<string, unknown>[] };
  'extensions.get-skills': {
    request: void;
    response: Array<{ name: string; description: string; location: string }>;
  };
  'extensions.get-settings-tabs': { request: void; response: IExtensionSettingsTab[] };
  'extensions.get-webui-contributions': { request: void; response: IExtensionWebuiContribution[] };
  'extensions.get-agent-activity-snapshot': { request: void; response: IExtensionAgentActivitySnapshot };
  'extensions.get-ext-i18n-for-locale': { request: { locale: string }; response: Record<string, unknown> };
  'extensions.enable': { request: { name: string }; response: IBridgeResponse };
  'extensions.disable': { request: { name: string; reason?: string }; response: IBridgeResponse };
  'extensions.get-permissions': { request: { name: string }; response: IExtensionPermissionSummary[] };
  'extensions.get-risk-level': { request: { name: string }; response: string };

  // === Weixin (Electron WeChat login flow) ===
  'weixin.login-start': { request: void; response: { accountId: string; botToken: string } };

  // === Channel ===
  'channel.get-plugin-status': { request: void; response: IBridgeResponse<IChannelPluginStatus[]> };
  'channel.enable-plugin': {
    request: { pluginId: string; config: Record<string, unknown> };
    response: IBridgeResponse;
  };
  'channel.disable-plugin': { request: { pluginId: string }; response: IBridgeResponse };
  'channel.test-plugin': {
    request: { pluginId: string; token: string; extraConfig?: { appId?: string; appSecret?: string } };
    response: IBridgeResponse<{ success: boolean; botUsername?: string; error?: string }>;
  };
  'channel.get-pending-pairings': { request: void; response: IBridgeResponse<IChannelPairingRequest[]> };
  'channel.approve-pairing': { request: { code: string }; response: IBridgeResponse };
  'channel.reject-pairing': { request: { code: string }; response: IBridgeResponse };
  'channel.get-authorized-users': { request: void; response: IBridgeResponse<IChannelUser[]> };
  'channel.revoke-user': { request: { userId: string }; response: IBridgeResponse };
  'channel.get-active-sessions': { request: void; response: IBridgeResponse<IChannelSession[]> };
  'channel.sync-channel-settings': {
    request: {
      platform: string;
      agent: { backend: string; customAgentId?: string; name?: string };
      model?: { id: string; useModel: string };
    };
    response: IBridgeResponse;
  };
};

/**
 * Type-safe map of all Emitter event names to their payload types.
 * Covers all 33 bridge.buildEmitter calls in ipcBridge.ts.
 */
export type EventMap = {
  // === Conversation ===
  'chat.response.stream': IResponseMessage;
  'conversation.turn.completed': IConversationTurnCompletedEvent;
  'conversation.list-changed': IConversationListChangedEvent;
  'confirmation.add': IConfirmation<any> & { conversation_id: string };
  'confirmation.update': IConfirmation<any> & { conversation_id: string };
  'confirmation.remove': { conversation_id: string; id: string };

  // === Application ===
  'app.log-stream': { level: 'log' | 'warn' | 'error'; tag: string; message: string; data?: unknown };
  'app.devtools-state-changed': { isOpen: boolean };

  // === Update ===
  'update.open': { source?: 'menu' | 'about' };
  'update.download.progress': UpdateDownloadProgressEvent;

  // === Auto-Update ===
  'auto-update.status': AutoUpdateStatus;

  // === File Watch ===
  'file-changed': { filePath: string; eventType: string };

  // === Workspace Office Watch ===
  'workspace-office-file-added': { filePath: string; workspace: string };

  // === File Stream ===
  'file-stream-content-update': {
    filePath: string;
    content: string;
    workspace: string;
    relativePath: string;
    operation: 'write' | 'delete';
  };

  // === OpenClaw ===
  'openclaw.response.stream': IResponseMessage;

  // === Preview ===
  'preview.open': {
    content: string;
    contentType: PreviewContentType;
    metadata?: { title?: string; fileName?: string };
  };

  // === PPT/Word/Excel Preview ===
  'ppt-preview.status': { state: 'starting' | 'installing' | 'ready' | 'error'; message?: string };
  'word-preview.status': { state: 'starting' | 'installing' | 'ready' | 'error'; message?: string };
  'excel-preview.status': { state: 'starting' | 'installing' | 'ready' | 'error'; message?: string };

  // === Deep Link ===
  'deep-link.received': { action: string; params: Record<string, string> };

  // === Window Controls ===
  'window-controls:maximized-changed': { isMaximized: boolean };

  // === System Settings ===
  'system-settings:language-changed': { language: string };

  // === Notification ===
  'notification.clicked': { conversationId?: string };

  // === WebUI ===
  'webui.status-changed': { running: boolean; port?: number; localUrl?: string; networkUrl?: string };
  'webui.reset-password-result': { success: boolean; newPassword?: string; msg?: string };

  // === Cron ===
  'cron.job-created': ICronJob;
  'cron.job-updated': ICronJob;
  'cron.job-removed': { jobId: string };
  'cron.job-executed': { jobId: string; status: 'ok' | 'error' | 'skipped' | 'missed'; error?: string };

  // === Extensions ===
  'extensions.state-changed': { name: string; enabled: boolean; reason?: string };

  // === Weixin ===
  'weixin.login-qr': { qrcodeUrl: string };
  'weixin.login-scanned': Record<string, never>;
  'weixin.login-done': Record<string, never>;

  // === Channel ===
  'channel.pairing-requested': IChannelPairingRequest;
  'channel.plugin-status-changed': { pluginId: string; status: IChannelPluginStatus };
  'channel.user-authorized': IChannelUser;
};
