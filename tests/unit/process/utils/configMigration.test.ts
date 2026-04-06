import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import type { IConfigStorageRefer } from '@/common/config/storage';
import type { ConfigStore } from '../../../../src/process/utils/configMigration';

// Helper: encode data the same way JsonFileBuilder does
const encodeConfig = (data: unknown): string =>
  Buffer.from(encodeURIComponent(JSON.stringify(data))).toString('base64');

function createMockConfigStore(initialStore: Partial<IConfigStorageRefer> = {}): {
  configStore: ConfigStore;
  setMock: ReturnType<typeof vi.fn>;
} {
  const store: Partial<IConfigStorageRefer> = { ...initialStore };
  const getMock = vi.fn(async (key: keyof IConfigStorageRefer) => {
    return store[key];
  });
  const setMock = vi.fn(
    async (key: keyof IConfigStorageRefer, value: IConfigStorageRefer[keyof IConfigStorageRefer]) => {
      store[key] = value;
      return value;
    }
  );

  return {
    configStore: {
      get: getMock as ConfigStore['get'],
      set: setMock as ConfigStore['set'],
    },
    setMock,
  };
}

function getWrittenConfigValue<K extends keyof IConfigStorageRefer>(
  setMock: ReturnType<typeof vi.fn>,
  key: K
): IConfigStorageRefer[K] | undefined {
  return setMock.mock.calls.find(([writtenKey]) => writtenKey === key)?.[1] as IConfigStorageRefer[K] | undefined;
}

describe('getElectronConfigCandidatePaths', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  it('returns both symlink candidates on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { getElectronConfigCandidatePaths } = await import('../../../../src/process/utils/configMigration');
    const home = os.homedir();
    const paths = getElectronConfigCandidatePaths();
    expect(paths).toContain(path.join(home, '.aionui-config', 'aionui-config.txt'));
    expect(paths).toContain(path.join(home, '.aionui-config-dev', 'aionui-config.txt'));
    expect(paths).toHaveLength(2);
  });

  it('returns both app-name candidates on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const appData = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.APPDATA = appData;
    const { getElectronConfigCandidatePaths } = await import('../../../../src/process/utils/configMigration');
    const paths = getElectronConfigCandidatePaths();
    expect(paths).toContain(path.join(appData, 'AionUi', 'config', 'aionui-config.txt'));
    expect(paths).toContain(path.join(appData, 'AionUi-Dev', 'config', 'aionui-config.txt'));
    expect(paths).toHaveLength(2);
  });

  it('returns both app-name candidates on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { getElectronConfigCandidatePaths } = await import('../../../../src/process/utils/configMigration');
    const home = os.homedir();
    const paths = getElectronConfigCandidatePaths();
    expect(paths).toContain(path.join(home, '.config', 'AionUi', 'config', 'aionui-config.txt'));
    expect(paths).toContain(path.join(home, '.config', 'AionUi-Dev', 'config', 'aionui-config.txt'));
    expect(paths).toHaveLength(2);
  });
});

describe('migrateFromElectronConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('skips migration when flag is already set', async () => {
    const { configStore, setMock } = createMockConfigStore({
      'migration.electronConfigImported': true,
    });
    const { migrateFromElectronConfig } = await import('../../../../src/process/utils/configMigration');
    await migrateFromElectronConfig(configStore);
    // set should never be called — migration was already done
    expect(setMock).not.toHaveBeenCalled();
  });

  it('skips migration when no Electron config file exists', async () => {
    const { configStore, setMock } = createMockConfigStore();
    // Explicitly mock existsSync to return false — do not rely on real filesystem
    // (CI machines might have ~/.aionui-config from a previous run)
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockReturnValue(''),
    }));
    const { migrateFromElectronConfig } = await import('../../../../src/process/utils/configMigration');
    await migrateFromElectronConfig(configStore);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('skips mcp.config write when all entries are builtin, but still sets flag', async () => {
    const sourceData = {
      'mcp.config': [
        {
          id: 'builtin-img',
          name: 'img',
          builtin: true,
          enabled: false,
          transport: { type: 'stdio', command: 'node', args: ['/path.js'] },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const encodedSource = encodeConfig(sourceData);
    const { configStore, setMock } = createMockConfigStore();
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(encodedSource),
    }));
    const { migrateFromElectronConfig } = await import('../../../../src/process/utils/configMigration');
    await migrateFromElectronConfig(configStore);
    expect(setMock).not.toHaveBeenCalledWith('mcp.config', expect.anything());
    expect(setMock).toHaveBeenCalledWith('migration.electronConfigImported', true);
  });

  it('does not set migration flag when source file decodes to {}', async () => {
    const { configStore, setMock } = createMockConfigStore();
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(''), // empty → decodes to {}
    }));
    const { migrateFromElectronConfig } = await import('../../../../src/process/utils/configMigration');
    await migrateFromElectronConfig(configStore);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('migrates whitelisted keys, skipping existing ones', async () => {
    const sourceData = {
      'model.config': [{ id: 'openai', name: 'OpenAI' }],
      'gemini.config': { authType: 'oauth', proxy: '' },
      language: 'zh-CN', // not whitelisted — should be ignored
    };
    const encodedSource = encodeConfig(sourceData);
    const { configStore, setMock } = createMockConfigStore();
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(encodedSource),
    }));
    const { migrateFromElectronConfig } = await import('../../../../src/process/utils/configMigration');
    await migrateFromElectronConfig(configStore);

    expect(setMock).toHaveBeenCalledWith('model.config', sourceData['model.config']);
    expect(setMock).toHaveBeenCalledWith('gemini.config', sourceData['gemini.config']);
    // language must NOT be migrated
    expect(setMock).not.toHaveBeenCalledWith('language', expect.anything());
    // migration flag must be set
    expect(setMock).toHaveBeenCalledWith('migration.electronConfigImported', true);
  });

  it('does not overwrite keys that already exist in server config', async () => {
    const sourceData = { 'model.config': [{ id: 'openai' }] };
    const encodedSource = encodeConfig(sourceData);
    const { configStore, setMock } = createMockConfigStore({
      'model.config': [{ id: 'existing-provider' }], // already configured
    });
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(encodedSource),
    }));
    const { migrateFromElectronConfig } = await import('../../../../src/process/utils/configMigration');
    await migrateFromElectronConfig(configStore);

    expect(setMock).not.toHaveBeenCalledWith('model.config', expect.anything());
    // flag is still set even though no keys were actually written
    expect(setMock).toHaveBeenCalledWith('migration.electronConfigImported', true);
  });

  it('filters builtin:true entries from mcp.config', async () => {
    const sourceData = {
      'mcp.config': [
        {
          id: 'builtin-img',
          name: 'img-gen',
          builtin: true,
          enabled: false,
          transport: { type: 'stdio', command: 'node', args: ['/abs/path.js'] },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'user-mcp',
          name: 'my-server',
          builtin: false,
          enabled: true,
          transport: { type: 'stdio', command: 'npx', args: ['some-mcp'] },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const encodedSource = encodeConfig(sourceData);
    const { configStore, setMock } = createMockConfigStore();
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(encodedSource),
    }));
    const { migrateFromElectronConfig } = await import('../../../../src/process/utils/configMigration');
    await migrateFromElectronConfig(configStore);

    const writtenMcp = getWrittenConfigValue(setMock, 'mcp.config');
    expect(writtenMcp).toHaveLength(1);
    expect(writtenMcp?.[0]?.id).toBe('user-mcp');
  });
});

describe('importConfigFromFile', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('skips import when file decodes to {}', async () => {
    const { configStore, setMock } = createMockConfigStore();
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockReturnValue(''),
    }));
    const { importConfigFromFile } = await import('../../../../src/process/utils/configMigration');
    await importConfigFromFile('/nonexistent/path.txt', false, configStore);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('skips existing keys when overwrite=false', async () => {
    const sourceData = { 'model.config': [{ id: 'new' }], 'gemini.config': { authType: 'oauth', proxy: '' } };
    const encodedSource = encodeConfig(sourceData);
    const { configStore, setMock } = createMockConfigStore({ 'model.config': [{ id: 'existing' }] });
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(encodedSource),
    }));
    const { importConfigFromFile } = await import('../../../../src/process/utils/configMigration');
    await importConfigFromFile('/path/aionui-config.txt', false, configStore);
    expect(setMock).not.toHaveBeenCalledWith('model.config', expect.anything());
    expect(setMock).toHaveBeenCalledWith('gemini.config', sourceData['gemini.config']);
  });

  it('overwrites existing keys when overwrite=true', async () => {
    const sourceData = { 'model.config': [{ id: 'new' }] };
    const encodedSource = encodeConfig(sourceData);
    const { configStore, setMock } = createMockConfigStore({ 'model.config': [{ id: 'existing' }] });
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(encodedSource),
    }));
    const { importConfigFromFile } = await import('../../../../src/process/utils/configMigration');
    await importConfigFromFile('/path/aionui-config.txt', true, configStore);
    expect(setMock).toHaveBeenCalledWith('model.config', sourceData['model.config']);
  });

  it('always filters builtin:true from mcp.config regardless of overwrite', async () => {
    const sourceData = {
      'mcp.config': [
        {
          id: 'builtin',
          builtin: true,
          name: 'b',
          enabled: false,
          transport: { type: 'stdio', command: 'node', args: [] },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'user',
          builtin: false,
          name: 'u',
          enabled: true,
          transport: { type: 'stdio', command: 'npx', args: ['mcp'] },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const encodedSource = encodeConfig(sourceData);
    const { configStore, setMock } = createMockConfigStore();
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(encodedSource),
    }));
    const { importConfigFromFile } = await import('../../../../src/process/utils/configMigration');
    await importConfigFromFile('/path/aionui-config.txt', true, configStore);
    const written = getWrittenConfigValue(setMock, 'mcp.config');
    expect(written).toHaveLength(1);
    expect(written?.[0]?.id).toBe('user');
  });

  it('resolves relative path and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { configStore } = createMockConfigStore();
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockReturnValue(''),
    }));
    const { importConfigFromFile } = await import('../../../../src/process/utils/configMigration');
    await importConfigFromFile('relative/path.txt', false, configStore);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('relative path'), expect.any(String));
    warnSpy.mockRestore();
  });
});
