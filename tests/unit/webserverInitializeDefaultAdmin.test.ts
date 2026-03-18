/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockSystemUser = {
  id: string;
  username: string;
  password_hash: string;
  jwt_secret: string | null;
  created_at: number;
  updated_at: number;
  last_login: number | null;
};

const makeSystemUser = (overrides?: Partial<MockSystemUser>): MockSystemUser => ({
  id: 'system_default_user',
  username: 'system_default_user',
  password_hash: '',
  jwt_secret: null,
  created_at: 0,
  updated_at: 0,
  last_login: null,
  ...overrides,
});

const mockWebServerModuleDeps = () => {
  vi.doMock('express', () => ({
    default: vi.fn(() => ({})),
  }));
  vi.doMock('http', () => ({
    createServer: vi.fn(() => ({
      listen: vi.fn(),
      on: vi.fn(),
    })),
  }));
  vi.doMock('ws', () => ({
    WebSocketServer: vi.fn(),
  }));
  vi.doMock('child_process', () => ({
    execSync: vi.fn(),
  }));
  vi.doMock('os', () => ({
    networkInterfaces: vi.fn(() => ({})),
  }));
  vi.doMock('@/webserver/config/constants', () => ({
    AUTH_CONFIG: {
      DEFAULT_USER: {
        USERNAME: 'admin',
      },
    },
    SERVER_CONFIG: {
      DEFAULT_PORT: 3000,
      DEFAULT_HOST: '127.0.0.1',
      REMOTE_HOST: '0.0.0.0',
      setServerConfig: vi.fn(),
    },
  }));
  vi.doMock('@/webserver/adapter', () => ({
    initWebAdapter: vi.fn(),
  }));
  vi.doMock('@/webserver/setup', () => ({
    setupBasicMiddleware: vi.fn(),
    setupCors: vi.fn(),
    setupErrorHandler: vi.fn(),
  }));
  vi.doMock('@/webserver/routes/authRoutes', () => ({
    registerAuthRoutes: vi.fn(),
  }));
  vi.doMock('@/webserver/routes/apiRoutes', () => ({
    registerApiRoutes: vi.fn(),
  }));
  vi.doMock('@/webserver/routes/staticRoutes', () => ({
    registerStaticRoutes: vi.fn(),
  }));
  vi.doMock('@/process/bridge/webuiBridge', () => ({
    generateQRLoginUrlDirect: vi.fn(() => ({
      qrUrl: 'http://localhost:3000/qr-login?token=test',
      expiresAt: 0,
    })),
  }));
  vi.doMock('@process/services/ApiCallbackManager', () => ({
    ApiCallbackManager: {
      getInstance: vi.fn(),
    },
  }));
};

describe('initializeDefaultAdmin', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('skips reinitialization when the renamed system user already has a password', async () => {
    mockWebServerModuleDeps();

    const setSystemUserCredentialsMock = vi.fn();
    const createUserMock = vi.fn();
    const generateRandomPasswordMock = vi.fn(() => 'generated-password');
    const hashPasswordMock = vi.fn(async () => 'hashed-password');

    vi.doMock('@/webserver/auth/repository/UserRepository', () => ({
      UserRepository: {
        getSystemUser: vi.fn(() => makeSystemUser({ username: 'renamed-admin', password_hash: 'existing-hash' })),
        setSystemUserCredentials: setSystemUserCredentialsMock,
        createUser: createUserMock,
      },
    }));
    vi.doMock('@/webserver/auth/service/AuthService', () => ({
      AuthService: {
        generateRandomPassword: generateRandomPasswordMock,
        hashPassword: hashPasswordMock,
      },
    }));

    const { initializeDefaultAdmin } = await import('@/webserver/index');
    await expect(initializeDefaultAdmin()).resolves.toBeNull();

    expect(generateRandomPasswordMock).not.toHaveBeenCalled();
    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(setSystemUserCredentialsMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('preserves a custom system username when bootstrapping a missing password', async () => {
    mockWebServerModuleDeps();

    const setSystemUserCredentialsMock = vi.fn();
    const createUserMock = vi.fn();

    vi.doMock('@/webserver/auth/repository/UserRepository', () => ({
      UserRepository: {
        getSystemUser: vi.fn(() => makeSystemUser({ username: 'renamed-admin', password_hash: '' })),
        setSystemUserCredentials: setSystemUserCredentialsMock,
        createUser: createUserMock,
      },
    }));
    vi.doMock('@/webserver/auth/service/AuthService', () => ({
      AuthService: {
        generateRandomPassword: vi.fn(() => 'generated-password'),
        hashPassword: vi.fn(async () => 'hashed-password'),
      },
    }));

    const { initializeDefaultAdmin } = await import('@/webserver/index');
    await expect(initializeDefaultAdmin()).resolves.toEqual({
      username: 'renamed-admin',
      password: 'generated-password',
    });

    expect(setSystemUserCredentialsMock).toHaveBeenCalledWith('renamed-admin', 'hashed-password');
    expect(createUserMock).not.toHaveBeenCalled();
  });
});
