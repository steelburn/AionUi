# ⚠️ DEPRECATED (2026-03-29)

> **此设计已废弃。** 用户验收测试后决定废弃 Agent Profile 全页面方案，改为 AgentProfileSider 侧滑 Drawer 面板。
> 新设计见：`iterations/slack-redesign/ux-refinements-changelog.md` 的 "S4 Design Change Decision" 章节。
> 原 S4 已实现的代码 (commit e1a81c92) 将在后续清理中移除。

---

# [DEPRECATED] S4: Agent Profile + DM Chat Entry — Technical Design

## 1. File Change List

| #   | File                                                                       | Action     | Description                                                             |
| --- | -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| 1   | `src/renderer/pages/agent/index.tsx`                                       | **New**    | AgentProfile page entry point — detail view for a single agent          |
| 2   | `src/renderer/pages/agent/components/AgentProfileHeader.tsx`               | **New**    | Avatar + name + employee type badge + back nav                          |
| 3   | `src/renderer/pages/agent/components/AgentConfigSection.tsx`               | **New**    | Read-only config display (model, preset rules, workspace) + edit button |
| 4   | `src/renderer/pages/agent/components/AgentConversationList.tsx`            | **New**    | Time-sorted conversation history list for this agent                    |
| 5   | `src/renderer/pages/agent/types.ts`                                        | **New**    | Type definitions for AgentProfile page                                  |
| 6   | `src/renderer/pages/agent/hooks/useAgentProfile.ts`                        | **New**    | Hook to resolve agent data + filter conversations                       |
| 7   | `src/renderer/components/layout/Router.tsx`                                | **Modify** | Add `/agent/:agentId` route                                             |
| 8   | `src/renderer/pages/conversation/GroupedHistory/AgentDMGroup.tsx`          | **Modify** | Avatar click navigates to `/agent/:agentId`                             |
| 9   | `src/renderer/pages/conversation/dispatch/components/GroupMemberSider.tsx` | **Modify** | Member name click navigates to profile; add DM entry point              |

### Directory child count check

- `src/renderer/pages/` currently has 6 children (TestShowcase.tsx, conversation, cron, guid, login, settings). Adding `agent/` brings it to 7 — within the 10-child limit.
- `src/renderer/pages/agent/` will have 4 children (index.tsx, components/, hooks/, types.ts) — within limit.
- `src/renderer/pages/agent/components/` will have 3 children — within limit.

---

## 2. Type Definitions

### `src/renderer/pages/agent/types.ts`

```typescript
import type { TChatConversation } from '@/common/config/storage';
import type { AgentIdentity } from '@/renderer/utils/model/agentIdentity';

/** Resolved agent profile data for the profile page */
export type AgentProfileData = {
  /** Agent identity from registry (undefined if agent not found) */
  identity: AgentIdentity;
  /** All conversations with this agent, sorted by activity time desc */
  conversations: TChatConversation[];
  /** Agent logo path for CLI agents (SVG URL) */
  agentLogo?: string | null;
  /** Workspace paths associated with this agent's conversations */
  workspaces: string[];
};

/** Props for the AgentProfile page (params come from route) */
export type AgentProfilePageParams = {
  agentId: string;
};

/** Props for the AgentProfileHeader component */
export type AgentProfileHeaderProps = {
  identity: AgentIdentity;
  agentLogo?: string | null;
  onBack: () => void;
  onStartConversation: () => void;
};

/** Props for the AgentConfigSection component */
export type AgentConfigSectionProps = {
  identity: AgentIdentity;
  workspaces: string[];
  onEditConfig: () => void;
};

/** Props for the AgentConversationList component */
export type AgentConversationListProps = {
  conversations: TChatConversation[];
  onConversationClick: (conversation: TChatConversation) => void;
};
```

---

## 3. Component Hierarchy

```
/agent/:agentId (route)
  └── AgentProfilePage (index.tsx)
      ├── AgentProfileHeader
      │   ├── Back button (Left icon from @icon-park/react)
      │   ├── Agent avatar (emoji | logo img | letter fallback)
      │   ├── Agent name (h2)
      │   ├── Employee type badge (Tag from @arco-design — "Permanent" | "Temporary")
      │   ├── Source badge (Tag — "Preset" | "Custom" | "CLI" | "Dispatch Teammate")
      │   └── "Start new conversation" button (Button primary from @arco-design)
      │
      ├── AgentConfigSection
      │   ├── Section header "Configuration"
      │   ├── Config items (read-only Descriptions from @arco-design)
      │   │   ├── Backend type / model
      │   │   ├── Preset rules (truncated, expandable)
      │   │   ├── Description
      │   │   └── Associated workspaces
      │   └── "Edit config" button (visible only for permanent agents)
      │
      └── AgentConversationList
          ├── Section header "Conversations ({count})"
          └── List of conversation rows
              ├── Conversation title
              ├── Last activity time (relative)
              ├── Workspace path (if any)
              └── Status indicator (generating badge)
```

### Layout

The page uses a single-column centered layout (max-width 720px, auto margins) similar to settings pages. Sections are stacked vertically with 24px gaps. The entire page is scrollable.

---

## 4. Data Flow

```
Route params (:agentId)
       │
       ▼
useAgentProfile(agentId)
       │
       ├──► useAgentRegistry()       → Map<agentId, AgentIdentity>
       │    (already provided by ConversationHistoryProvider)
       │    Lookup: registry.get(agentId) → AgentIdentity
       │
       ├──► useConversationHistoryContext()
       │    → conversations: TChatConversation[]
       │    Filter: resolveAgentId(c) === agentId
       │    Sort: by updatedAt desc
       │
       └──► getAgentLogo(identity)   → string | null
            (from src/renderer/utils/model/agentLogo.ts, if applicable)
       │
       ▼
AgentProfileData
       │
       ├──► AgentProfileHeader (identity, agentLogo)
       ├──► AgentConfigSection (identity, workspaces)
       └──► AgentConversationList (conversations)
```

### Key data flow decisions

1. **No new IPC calls** — all data is already available via `useAgentRegistry()` (agent metadata) and `useConversationHistoryContext()` (conversation list). The profile page is purely a filtered view.

2. **Agent ID encoding** — the `:agentId` route param uses the same ID format as `resolveAgentId()` returns (e.g., `preset:word-creator`, `custom:abc123`, `claude`, `gemini`). The param is URL-encoded in navigation and decoded via `decodeURIComponent(useParams().agentId)`.

3. **"Start new conversation"** — navigates to `/guid` with state `{ prefillAgentId: agentId }`. The Guid page will need minimal changes to accept this (out of scope for S4 implementation, but the navigation intent is wired).

4. **"Edit config"** — for `custom:*` agents, navigates to `/settings/agent` (existing AgentSettings page). For `preset:*` agents, navigates to `/settings/assistants`. This reuses existing settings UIs.

---

## 5. Routing Design

### URL scheme

| Route             | Component          | Purpose           |
| ----------------- | ------------------ | ----------------- |
| `/agent/:agentId` | `AgentProfilePage` | Agent detail page |

The `:agentId` parameter is the full agent ID string (e.g., `preset:word-creator`, `custom:my-agent`, `claude`). Colons are valid in URL path segments but will be encoded by `encodeURIComponent` in navigation calls and decoded with `decodeURIComponent` on read.

### Router.tsx modification

```typescript
const AgentProfile = React.lazy(() => import('@renderer/pages/agent'));

// Inside <Routes>, within the ProtectedLayout:
<Route path='/agent/:agentId' element={withRouteFallback(AgentProfile)} />
```

### Navigation entry points

#### A. AgentDMGroup avatar click (sidebar DMs)

In `AgentDMGroup.tsx`, the avatar area (currently part of the header row) gets an `onClick` handler that stops propagation and navigates:

```typescript
// Inside renderAvatar(), wrap with a clickable container:
const handleAvatarClick = (e: React.MouseEvent) => {
  e.stopPropagation(); // Don't toggle expand/collapse
  navigate(`/agent/${encodeURIComponent(group.agentId)}`);
};
```

The component needs `useNavigate` from react-router-dom. The avatar `<span>` wrapping gets `onClick={handleAvatarClick}` and cursor-pointer styling.

#### B. GroupMemberSider member click (dispatch member sidebar)

In `GroupMemberSider.tsx` / `MemberCard.tsx`, clicking the member name (not the card itself) navigates to the agent profile. This requires:

1. Adding an `agentId` field to `GroupChatMemberVO` type (resolve from the child conversation's extra fields).
2. Adding `onNavigateToProfile?: (agentId: string) => void` to `MemberCardProps`.
3. The member name `<span>` gets an `onClick` that calls `onNavigateToProfile(member.agentId)`.

For members without a resolvable permanent agent ID (temporary teammates), the name click opens a DM instead — navigating to their most recent conversation via `/conversation/:id`.

---

## 6. Self-Debate

### Decision 1: Agent Profile as a separate route (`/agent/:agentId`) vs. a drawer/modal

**Choice**: Separate route (full page).

**Objections**:

1. **Objection: Navigation disrupts chat flow** — Users viewing a conversation must leave it to see an agent profile. A drawer would keep context.
   - **Counter**: The profile is an infrequent, information-dense view (config + full history). A drawer would be too cramped for the conversation list. Browser back button provides easy return. Slack also uses full-page profiles.

2. **Objection: Route adds complexity** — Another lazy-loaded route increases bundle split points and routing logic.
   - **Counter**: The cost is 3 lines in Router.tsx. The page itself is lightweight (no new IPC, reuses existing hooks). Consistent with existing page patterns (settings pages are also separate routes).

3. **Objection: Deep linking fragility** — Agent IDs contain colons (`preset:word-creator`) which may cause URL parsing issues.
   - **Counter**: Colons are valid in URL path segments per RFC 3986. We use `encodeURIComponent` / `decodeURIComponent` explicitly. HashRouter further isolates from server-side URL parsing.

### Decision 2: Reusing existing hooks (useAgentRegistry + useConversationHistoryContext) vs. dedicated IPC

**Choice**: Reuse existing hooks.

**Objections**:

1. **Objection: Performance with large conversation lists** — Filtering all conversations client-side for a single agent may be slow with 1000+ conversations.
   - **Counter**: `useConversationHistoryContext` already holds the full list in memory for the sidebar. The filter is O(n) with `resolveAgentId()` which is simple string extraction. For 1000 conversations this is sub-millisecond. The filtered result is memoized in `useAgentProfile`.

2. **Objection: Data staleness** — If the profile page is opened in a new window or outside the conversation layout, the context may not be available.
   - **Counter**: The `ConversationHistoryProvider` wraps the entire `ProtectedLayout` in the app. All authenticated routes have access. If not, the hook throws a clear error.

3. **Objection: Missing agent details** — `AgentIdentity` has limited config info (no preset rules, no full model config). The profile page needs richer data.
   - **Counter**: For custom agents, `ConfigStorage.get('acp.customAgents')` already returns the full config (available via SWR in `useAgentRegistry`). For presets, `ASSISTANT_PRESETS` has all metadata. We extend `useAgentProfile` to look up the full config from these sources. No new IPC needed.

### Decision 3: New `pages/agent/` directory vs. nested under `pages/conversation/`

**Choice**: New `pages/agent/` at the pages root level.

**Objections**:

1. **Objection: Fragmentation** — Agent profiles are closely related to conversations; separating them creates another top-level directory.
   - **Counter**: The conversation page directory already has 10 children (at the limit). Adding more would violate the directory size rule. Agent profiles are conceptually about agents, not conversations.

2. **Objection: Shared code duplication** — The profile page reuses avatar rendering, conversation row display, and agent identity resolution that live under `conversation/`.
   - **Counter**: Avatar rendering is simple (3 conditions, inline). Conversation rows in the profile are a simplified version (title + time only, no drag/drop/menu). Agent identity utils are in `src/renderer/utils/model/` (shared, not page-private). No duplication.

3. **Objection: Premature directory creation** — This is a single page; could live as `pages/AgentProfile.tsx` (single file).
   - **Counter**: The page has 3 sub-components + 1 hook + types — that justifies a directory. The architecture skill says "If a component needs a private sub-component or hook, convert to a directory."

---

## 7. Acceptance Criteria

### Routing

- [ ] AC-1: Navigating to `/#/agent/preset%3Aword-creator` renders the AgentProfile page without errors.
- [ ] AC-2: Navigating to `/#/agent/nonexistent-id` shows a "Agent not found" empty state with a back button.
- [ ] AC-3: The back button in AgentProfileHeader calls `navigate(-1)` and returns to the previous page.

### Agent Profile Header

- [ ] AC-4: The header displays the agent's avatar (emoji for presets, logo `<img>` for CLI agents, letter fallback otherwise).
- [ ] AC-5: The header shows the agent name as the primary heading.
- [ ] AC-6: A `<Tag>` badge shows "Permanent" (color=green) or "Temporary" (color=gray) based on `identity.employeeType`.
- [ ] AC-7: A second `<Tag>` badge shows the agent source (Preset / Custom / CLI Agent / Dispatch Teammate) using `identity.source`.
- [ ] AC-8: A "Start new conversation" `<Button type="primary">` is present and navigates to `/guid` with `state.prefillAgentId`.

### Agent Config Section

- [ ] AC-9: For permanent agents (`identity.employeeType === 'permanent'`), an "Edit config" button is visible.
- [ ] AC-10: For temporary agents, the "Edit config" button is hidden.
- [ ] AC-11: The config section displays: backend type, description (if present), and associated workspace paths.
- [ ] AC-12: Clicking "Edit config" for `custom:*` agents navigates to `/settings/agent`; for `preset:*` agents navigates to `/settings/assistants`.

### Agent Conversation List

- [ ] AC-13: All conversations where `resolveAgentId(conversation) === agentId` are listed.
- [ ] AC-14: Conversations are sorted by `updatedAt` descending (most recent first).
- [ ] AC-15: Each conversation row shows: title (or first message excerpt), relative time (e.g., "2 hours ago"), workspace path if present.
- [ ] AC-16: Clicking a conversation row navigates to `/conversation/:id`.
- [ ] AC-17: When no conversations exist for the agent, an empty state message is shown.

### Sidebar Navigation (AgentDMGroup)

- [ ] AC-18: Clicking the agent avatar in `AgentDMGroup` navigates to `/agent/:agentId` (URL-encoded).
- [ ] AC-19: The avatar click does NOT trigger the expand/collapse toggle (event propagation stopped).
- [ ] AC-20: The rest of the header row (name, chevron, count badge) still toggles expand/collapse as before.

### Member Sider Navigation (GroupMemberSider)

- [ ] AC-21: `GroupChatMemberVO` type has an optional `agentId?: string` field.
- [ ] AC-22: Clicking a member's name in MemberCard navigates to `/agent/:agentId` if `agentId` is present.
- [ ] AC-23: If `agentId` is absent (truly temporary member), clicking the name is a no-op (no navigation).

### General

- [ ] AC-24: All user-facing strings use i18n keys (no hardcoded text).
- [ ] AC-25: All interactive elements use `@arco-design/web-react` components (Button, Tag, Empty, etc.).
- [ ] AC-26: All icons use `@icon-park/react`.
- [ ] AC-27: The page uses UnoCSS utility classes; any complex styles use CSS Modules.
- [ ] AC-28: TypeScript strict mode — no `any`, all types defined with `type` keyword (not `interface`).
- [ ] AC-29: The page is lazy-loaded in Router.tsx via `React.lazy()`.

---

## Implementation Notes

### i18n keys to add (module: `agent` or extend `dispatch`)

- `agent.profile.title` — "Agent Profile"
- `agent.profile.back` — "Back"
- `agent.profile.startConversation` — "Start new conversation"
- `agent.profile.editConfig` — "Edit configuration"
- `agent.profile.configuration` — "Configuration"
- `agent.profile.conversations` — "Conversations"
- `agent.profile.noConversations` — "No conversations yet"
- `agent.profile.notFound` — "Agent not found"
- `agent.profile.permanent` — "Permanent"
- `agent.profile.temporary` — "Temporary"
- `agent.profile.backendType` — "Backend"
- `agent.profile.description` — "Description"
- `agent.profile.workspaces` — "Workspaces"

### useAgentProfile hook sketch

```typescript
export function useAgentProfile(agentId: string): AgentProfileData | null {
  const registry = useAgentRegistry();
  const { groupedHistory, conversations } = useConversationHistoryContext();

  return useMemo(() => {
    const identity = registry.get(agentId);
    if (!identity) return null;

    const agentConversations = conversations
      .filter((c) => resolveAgentId(c) === agentId)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    const workspaces = [
      ...new Set(
        agentConversations
          .map((c) => (c.extra as Record<string, unknown>)?.workspace)
          .filter((w): w is string => typeof w === 'string')
      ),
    ];

    return {
      identity,
      conversations: agentConversations,
      agentLogo: getAgentLogo(identity),
      workspaces,
    };
  }, [agentId, registry, conversations]);
}
```

[DONE]
