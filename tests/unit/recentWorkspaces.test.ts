import { describe, expect, it } from 'vitest';

import type { TChatConversation } from '@/common/storage';
import { collectRecentWorkspaces, sortRecentWorkspaces } from '@/renderer/utils/recentWorkspaces';

const createConversation = (workspace: string, modifyTime: number, customWorkspace = true): TChatConversation =>
  ({
    id: `conv-${workspace}-${modifyTime}`,
    role: 'assistant',
    type: 'gemini',
    name: 'test',
    createTime: modifyTime - 10,
    modifyTime,
    top: false,
    model: { id: 'm', name: 'n', useModel: 'u', platform: 'openai', baseUrl: '', apiKey: '' },
    extra: {
      workspace,
      customWorkspace,
    },
  }) as unknown as TChatConversation;

describe('recentWorkspaces utils', () => {
  it('collects and de-duplicates workspaces by identity', () => {
    const workspaces = collectRecentWorkspaces([
      createConversation('C:\\Work\\Demo', 100),
      createConversation('c:\\work\\demo\\', 200),
      createConversation('C:\\Work\\Other', 150),
    ]);

    expect(workspaces).toHaveLength(2);
    expect(workspaces[0].path.toLowerCase()).toContain('demo');
  });

  it('sorts current workspace to the top while keeping recency order', () => {
    const ordered = sortRecentWorkspaces(
      [
        { path: '/a', label: 'a', updatedAt: 10 },
        { path: '/b', label: 'b', updatedAt: 30 },
        { path: '/c', label: 'c', updatedAt: 20 },
      ],
      '/c/'
    );

    expect(ordered.map((item) => item.path)).toEqual(['/c', '/b', '/a']);
  });
});
