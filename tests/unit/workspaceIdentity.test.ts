import { describe, expect, it } from 'vitest';

import {
  getWorkspaceIdentityKey,
  isSameWorkspacePath,
  normalizeWorkspacePath,
} from '@/renderer/utils/workspaceIdentity';

describe('workspace identity utils', () => {
  it('normalizes trailing separators and whitespace', () => {
    expect(normalizeWorkspacePath('  C:\\work\\demo\\  ')).toBe('C:\\work\\demo');
    expect(normalizeWorkspacePath('/Users/demo/project///')).toBe('/Users/demo/project');
  });

  it('builds case-insensitive identity keys', () => {
    expect(getWorkspaceIdentityKey('C:\\Work\\Demo')).toBe(getWorkspaceIdentityKey('c:\\work\\demo\\'));
  });

  it('compares workspace paths using normalized identity', () => {
    expect(isSameWorkspacePath('C:\\Work\\Demo', 'c:\\work\\demo\\')).toBe(true);
    expect(isSameWorkspacePath('/tmp/a', '/tmp/b')).toBe(false);
  });
});
