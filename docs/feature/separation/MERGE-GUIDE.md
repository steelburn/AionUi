# Frontend-Backend Separation: Merge Conflict Resolution Guide

> This document serves as a reference when rebasing/merging `zynx/feat/frontend-backend-separation` onto a newer `main`.
> Last updated: 2026-04-02 | 1126 files changed, 16040 insertions, 2643 deletions

## Quick Summary

This branch does three fundamental things:

1. **Extracts shared types** into `packages/protocol/` (new npm workspace)
2. **Replaces IPC bridge** with WebSocket-based `ApiClient` (frontend) + `WsRouter` (backend)
3. **Reorganizes directories**: `src/process/` → `src/server/` + `src/electron/`

---

## 1. Directory Moves (683 renames)

This is the **primary source of conflicts**. Almost every file under `src/process/` has moved.

### Move Map

| Old Path | New Path | Notes |
|----------|----------|-------|
| `src/process/agent/` | `src/server/agent/` | All agent code |
| `src/process/bridge/` | `src/server/bridge/` | All bridge files |
| `src/process/services/` | `src/server/services/` | database, cron, mcp, etc. |
| `src/process/channels/` | `src/server/channels/` | telegram, lark, dingtalk, weixin |
| `src/process/extensions/` | `src/server/extensions/` | Extension system |
| `src/process/worker/` | `src/server/worker/` | Fork workers |
| `src/process/resources/` | `src/server/resources/` | skills, assistant, builtinMcp |
| `src/process/task/` | `src/server/task/` | Task management |
| `src/process/utils/` | `src/server/utils/` | Most utils |
| `src/process/utils/tray.ts` | `src/electron/lifecycle/tray.ts` | Electron-only |
| `src/process/utils/appMenu.ts` | `src/electron/lifecycle/appMenu.ts` | Electron-only |
| `src/process/utils/deepLink.ts` | `src/electron/lifecycle/deepLink.ts` | Electron-only |
| `src/process/utils/chromiumConfig.ts` | `src/electron/utils/chromiumConfig.ts` | Electron-only |
| `src/process/utils/zoom.ts` | `src/electron/utils/zoom.ts` | Electron-only |
| `src/process/utils/webuiConfig.ts` | `src/electron/utils/webuiConfig.ts` | Electron-only |
| `src/process/utils/mainWindowLifecycle.ts` | `src/electron/utils/mainWindowLifecycle.ts` | Electron-only |
| `src/process/utils/configureConsoleLog.ts` | `src/electron/utils/configureConsoleLog.ts` | Electron-only |
| `src/process/bridge/dialogBridge.ts` | `src/electron/handlers/dialog.ts` | Electron handler |
| `src/process/bridge/shellBridge.ts` | `src/electron/handlers/shell.ts` | Electron handler |
| `src/process/bridge/updateBridge.ts` | `src/electron/handlers/update.ts` | Electron handler |
| `src/process/bridge/windowControlsBridge.ts` | `src/electron/handlers/windowControls.ts` | Electron handler |
| `src/process/init/index.ts` | `src/electron/init/initProcess.ts` | Electron init |
| `src/index.ts` | `src/electron/main.ts` | Electron entry point |
| `src/preload.ts` | `src/electron/preload.ts` | Completely rewritten |

### Conflict Resolution Rule

> **If main modified a file under `src/process/`, apply the same change to the corresponding file under `src/server/` or `src/electron/`.**

Steps:
1. When git reports a conflict on `src/process/foo.ts` (deleted by us), check if main's change is a content modification
2. Find the new location using the table above (or `git log --follow -- src/server/foo.ts`)
3. Apply main's change to the new location manually
4. Mark the old file as resolved (accept "deleted by us")

## 2. Deleted Files

| File | Reason |
|------|--------|
| `src/preload.ts` | Replaced by `src/electron/preload.ts` (completely rewritten, minimal) |
| `src/process/utils/initBridgeStandalone.ts` | Bridge init no longer needed; server uses WsRouter |

If main modified these files, the changes should be discarded — the functionality is handled differently now.

## 3. New Directories & Files

### `packages/protocol/` (new npm workspace)

Contains shared types and wire protocol definitions. **If main added new types to `src/common/types/` or `src/common/chat/`**, check if they should also be exported from `packages/protocol/`.

Key files:
- `packages/protocol/src/wire.ts` — WsRequest, WsResponse, WsEvent types
- `packages/protocol/src/endpoints/` — endpoint type registry (one file per domain)
- `packages/protocol/src/types/` — shared types moved from `src/common/types/`
- `packages/protocol/src/chat/` — chat types moved from `src/common/chat/`
- `packages/protocol/src/config/` — storage types, i18n-config

### `src/renderer/api/` (new API layer)

Replaces `ipcBridge` usage in the renderer:
- `client.ts` — ApiClient (WebSocket-based)
- `hooks.ts` — React hooks (`useApiRequest`, `useApiEvent`, etc.)
- `types.ts` — API layer types
- `index.ts` — re-exports

### `src/electron/` (new Electron shell)

- `main.ts` — entry point (was `src/index.ts`)
- `preload.ts` — minimal preload (exposes `serverUrl` only)
- `handlers/` — Electron-specific IPC handlers (dialog, shell, update, windowControls)
- `lifecycle/` — tray, appMenu, deepLink, singleInstance
- `utils/` — chromiumConfig, zoom, webuiConfig, mainWindowLifecycle, configureConsoleLog
- `init/initProcess.ts` — server process initialization

### `src/server/handlers/` (new WsRouter handlers)

Each bridge has been converted to a WsRouter handler. If main added a new bridge method, it needs a corresponding handler here.

## 4. Path Alias Changes

| Old Alias | New Alias | Scope |
|-----------|-----------|-------|
| `@process/*` | `@server/*` | Backend code |
| — | `@electron/*` | Electron shell code |
| `@worker/*` = `src/process/worker/*` | `@worker/*` = `src/server/worker/*` | Same alias, different path |
| — | `@aionui/protocol` | Shared protocol package |

### Affected Config Files

These files all contain alias definitions — conflicts here are common:

- `tsconfig.json`
- `electron.vite.config.ts` (two alias blocks: `mainAliases` + renderer `resolve.alias`)
- `vitest.config.ts`
- `vite.renderer.config.ts`

**Resolution**: Accept our version of the alias config, then check if main added any new aliases that need to be preserved.

## 5. Import Path Changes

### Renderer files (338 modified)

Almost every renderer file had imports updated:

| Old Import | New Import |
|------------|------------|
| `import { xxx } from '@/common/adapter/ipcBridge'` | `import { useApiRequest } from '@renderer/api'` |
| `import { xxx } from '@/common/types/...'` | `import type { xxx } from '@aionui/protocol/types'` |
| `import { xxx } from '@/common/chat/...'` | `import type { xxx } from '@aionui/protocol/chat'` |
| `import { xxx } from '@/common/config/storage'` | `import type { xxx } from '@aionui/protocol/config'` |
| `window.electronAPI.xxx()` | `platformAdapter.xxx()` or `apiClient.request(...)` |

**If main added new renderer code that imports from `ipcBridge`**: Convert to use `ApiClient`/`useApiRequest` instead.

### Server/Process files

| Old Import | New Import |
|------------|------------|
| `import { xxx } from '@process/...'` | `import { xxx } from '@server/...'` |
| `import { xxx } from '@/process/...'` | `import { xxx } from '@/server/...'` or `import { xxx } from '@server/...'` |

## 6. `package.json` Scripts Cleanup (37 → 25)

Many scripts were consolidated or renamed:

| Old Script | New Script | Notes |
|------------|------------|-------|
| `start` | `dev` | Electron dev mode |
| `cli` | `dev` | Merged |
| `webui` | `dev:server` | Standalone server |
| `package` / `make` | `build` | Unified |
| `build-mac`, `build-win`, etc. | Removed | Use `dist:mac`, `dist:win` |
| Various `server:start:*` variants | Simplified to 3 | `server:start`, `server:start:remote`, `server:resetpass` |

**If main added new scripts**, they should still work — just verify they don't reference old paths.

## 7. `ipcBridge.ts` Changes

`src/common/adapter/ipcBridge.ts` is still present but the renderer no longer imports from it. If main added new Provider/Emitter endpoints to `ipcBridge`, you need to:

1. Add the endpoint type to `packages/protocol/src/endpoints/<domain>.ts`
2. Add a handler in `src/server/handlers/<domain>/`
3. The renderer should use `apiClient.request()` instead of `ipcBridge.xxxProvider()`

## 8. Test File Changes

Most test files had import path updates (`@process/` → `@server/`). If main modified test files:

- Accept our import path changes
- Apply main's test logic changes on top

## 9. High-Risk Conflict Areas

These files/areas are most likely to have conflicts due to active development on main:

| Area | Why | Resolution Strategy |
|------|-----|---------------------|
| `src/renderer/hooks/` | Frequently modified | Accept ours for import changes, merge main's logic |
| `src/server/bridge/conversationBridge.ts` | Core functionality | Carefully merge — handler registration changed |
| `src/server/bridge/acpConversationBridge.ts` | Active development | Same as above |
| `src/server/agent/acp/` | Active development | Accept renames, merge main's logic |
| `package.json` | Scripts + deps | Merge deps from main, keep our script changes |
| `electron.vite.config.ts` | Build config | Keep our structure, merge main's plugin/dep changes |
| `src/renderer/main.tsx` | App initialization | Now includes ApiClient setup |

## 10. Conflict Resolution Checklist

When resolving conflicts after rebase/merge:

- [ ] **Directory renames**: For each `src/process/` conflict, find the new path and apply main's change there
- [ ] **Import paths**: All `@process/` → `@server/`, `@/common/types/` → `@aionui/protocol/types`
- [ ] **New bridge methods**: If main added bridge endpoints, add corresponding WsRouter handlers
- [ ] **Config files**: tsconfig.json, electron.vite.config.ts, vitest.config.ts — keep our aliases
- [ ] **package.json**: Keep our `workspaces` field and script cleanup; merge main's dependency changes
- [ ] **Tests pass**: `bun run test` after resolving all conflicts
- [ ] **Type check**: `bunx tsc --noEmit` after resolving all conflicts
- [ ] **Build**: `bun run build` to verify everything compiles

## Appendix: Quick Command Reference

```bash
# See what main changed in a file that we renamed
git log main --oneline -- src/process/bridge/conversationBridge.ts

# Find where a file moved to
git log --follow --diff-filter=R --summary -- src/server/bridge/conversationBridge.ts

# Compare our version with main's version of a renamed file
git diff main:src/process/bridge/conversationBridge.ts HEAD:src/server/bridge/conversationBridge.ts

# List all conflicts during rebase
git diff --name-only --diff-filter=U

# After resolving, verify no stale @process imports remain
grep -r '@process/' src/ --include='*.ts' --include='*.tsx'
```
