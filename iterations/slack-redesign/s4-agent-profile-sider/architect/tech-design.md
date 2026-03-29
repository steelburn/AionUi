# S4-Sider: AgentProfileSider (Drawer) -- Technical Design

> Replaces the deprecated S4 full-page Agent Profile (`/agent/:agentId`).
> The new design uses an Arco `Drawer` triggered from the conversation header agent name click.

---

## 1. File Change List

| #   | File                                                                                | Action     | Description                                                                   |
| --- | ----------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| 1   | `src/renderer/pages/conversation/components/AgentProfileDrawer/index.tsx`           | **New**    | Main Drawer component with Arco `Drawer`, orchestrates content by agent type  |
| 2   | `src/renderer/pages/conversation/components/AgentProfileDrawer/ProfileHeader.tsx`   | **New**    | Avatar + name display section (shared by both agent types)                    |
| 3   | `src/renderer/pages/conversation/components/AgentProfileDrawer/AssistantDetail.tsx` | **New**    | Assistant-specific sections: Rule, Skills, mounted agents                     |
| 4   | `src/renderer/pages/conversation/components/AgentProfileDrawer/GroupChatList.tsx`   | **New**    | "Dispatch group chats containing this agent" list (shared by both types)      |
| 5   | `src/renderer/pages/conversation/components/AgentProfileDrawer/types.ts`            | **New**    | Type definitions for the drawer and its sub-components                        |
| 6   | `src/renderer/pages/conversation/hooks/useAgentProfileDrawer.ts`                    | **New**    | Hook: resolves agent data, preset config, group chat membership               |
| 7   | `src/renderer/pages/conversation/components/ChatLayout/index.tsx`                   | **Modify** | Add `onAgentNameClick` prop threading; render `AgentProfileDrawer`            |
| 8   | `src/renderer/components/agent/AgentModeSelector.tsx`                               | **Modify** | Add `onAgentNameClick` callback prop; attach click handler to agent name span |
| 9   | `src/renderer/components/layout/Router.tsx`                                         | **Modify** | Remove `/agent/:agentId` route                                                |
| 10  | `src/renderer/pages/agent/index.tsx`                                                | **Delete** | Deprecated full-page AgentProfile entry                                       |
| 11  | `src/renderer/pages/agent/types.ts`                                                 | **Delete** | Deprecated types                                                              |
| 12  | `src/renderer/pages/agent/hooks/useAgentProfile.ts`                                 | **Delete** | Deprecated hook (logic migrated to `useAgentProfileDrawer`)                   |
| 13  | `src/renderer/pages/agent/components/AgentProfileHeader.tsx`                        | **Delete** | Deprecated header component                                                   |
| 14  | `src/renderer/pages/agent/components/AgentConfigSection.tsx`                        | **Delete** | Deprecated config section                                                     |
| 15  | `src/renderer/pages/agent/components/AgentConversationList.tsx`                     | **Delete** | Deprecated conversation list                                                  |
| 16  | `src/renderer/pages/conversation/dispatch/components/GroupMemberSider.tsx`          | **Modify** | Replace `navigate(/agent/...)` with `onAgentNameClick` callback (no routing)  |
| 17  | i18n JSON files (`agent` module, all locales)                                       | **Modify** | Add keys for drawer sections; deprecate old page keys                         |

### Directory child count check

- `src/renderer/pages/conversation/components/` -- adding `AgentProfileDrawer/` directory. Current children include `ChatLayout/`, `ChatConversation.tsx`, `ChatTitleEditor.tsx`, `ConversationTabs.tsx`, `ConversationTitleMinimap.tsx`, `SkillRuleGenerator.tsx`. Adding one more keeps it within the 10-child limit.
- `src/renderer/pages/conversation/components/AgentProfileDrawer/` will have 5 children (`index.tsx`, `ProfileHeader.tsx`, `AssistantDetail.tsx`, `GroupChatList.tsx`, `types.ts`) -- within limit.
- `src/renderer/pages/conversation/hooks/` -- adding one file. Within limit.
- `src/renderer/pages/agent/` -- entire directory deleted.

---

## 2. Type Definitions

### `src/renderer/pages/conversation/components/AgentProfileDrawer/types.ts`

```typescript
import type { AgentIdentity } from '@renderer/utils/model/agentIdentity';
import type { TChatConversation } from '@/common/config/storage';

/** Props for the AgentProfileDrawer entry component */
export type AgentProfileDrawerProps = {
  /** Whether the drawer is visible */
  visible: boolean;
  /** Agent ID to display (e.g. "preset:word-creator", "custom:abc", "claude") */
  agentId: string;
  /** Close callback */
  onClose: () => void;
  /** Navigate to a new conversation with this agent */
  onStartConversation: (agentId: string) => void;
  /** Navigate to a dispatch group chat */
  onNavigateToGroupChat: (conversationId: string) => void;
};

/** Resolved data for the drawer content */
export type AgentProfileDrawerData = {
  identity: AgentIdentity;
  /** For assistants (isPermanent): the system rule text (read-only) */
  rule?: string;
  /** For assistants: list of skill names */
  skills: string[];
  /** For assistants: mounted general agents (cli_agent identities) */
  mountedAgents: AgentIdentity[];
  /** Dispatch group chats that include this agent as a member */
  groupChats: GroupChatSummary[];
};

/** Minimal info about a group chat for display in the drawer */
export type GroupChatSummary = {
  conversationId: string;
  name: string;
  memberCount: number;
  lastActivityAt: number;
};

/** Props for ProfileHeader sub-component */
export type ProfileHeaderProps = {
  identity: AgentIdentity;
  onStartConversation: () => void;
};

/** Props for AssistantDetail sub-component */
export type AssistantDetailProps = {
  rule?: string;
  skills: string[];
  mountedAgents: AgentIdentity[];
};

/** Props for GroupChatList sub-component */
export type GroupChatListProps = {
  groupChats: GroupChatSummary[];
  onNavigate: (conversationId: string) => void;
};
```

### Changes to `AgentModeSelector` props

```typescript
// Add to existing AgentModeSelectorProps:
/** Callback when the agent name/logo area is clicked (opens profile drawer) */
onAgentNameClick?: () => void;
```

---

## 3. Component Hierarchy

```
ChatLayout
  +-- AgentModeSelector              (MODIFY: add onAgentNameClick handler)
  |     +-- agent name/logo area     (click -> onAgentNameClick if provided)
  |     +-- mode dropdown            (existing, unchanged)
  +-- AgentProfileDrawer             (NEW: rendered inside ChatLayout)
        +-- Arco Drawer (placement="right", width=360px)
              +-- ProfileHeader      (avatar + name + "Start Conversation" button)
              +-- AssistantDetail    (conditional: only when employeeType === 'permanent')
              |     +-- RuleSection  (read-only text display, collapsible)
              |     +-- SkillsList   (Tag list of skill names)
              |     +-- MountedAgentsList (avatar + name list of general agents)
              +-- GroupChatList      (list of dispatch group chats containing this agent)
```

### Rendering logic by agent type

```
if (identity.employeeType === 'permanent') {
  // Assistant view: ProfileHeader + AssistantDetail + GroupChatList
} else {
  // General Agent view: ProfileHeader + GroupChatList
}
```

---

## 4. Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ ChatLayout                                                   │
│                                                              │
│  state: { drawerVisible, drawerAgentId }                    │
│                                                              │
│  ┌─────────────────────┐    onAgentNameClick()              │
│  │ AgentModeSelector   │ ──────────────────────┐            │
│  │  (header area)      │                        │            │
│  └─────────────────────┘                        ▼            │
│                                    setDrawerVisible(true)    │
│                                    setDrawerAgentId(id)      │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ AgentProfileDrawer (visible={drawerVisible})          │   │
│  │                                                        │   │
│  │  useAgentProfileDrawer(agentId)                       │   │
│  │    ├── useAgentRegistry() → Map<id, AgentIdentity>    │   │
│  │    ├── lookup identity by agentId                      │   │
│  │    ├── if preset assistant:                            │   │
│  │    │     ├── ASSISTANT_PRESETS → ruleFiles, skills     │   │
│  │    │     └── presetAgentType → resolve mounted agent   │   │
│  │    ├── if custom assistant:                            │   │
│  │    │     └── ConfigStorage('acp.customAgents') → data  │   │
│  │    └── conversations.filter(type==='dispatch')         │   │
│  │         .filter(hasMember(agentId)) → groupChats       │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### How agentId flows from header click to drawer

1. `ChatConversation.tsx` already computes `agentName`, `agentLogo`, and passes them to `ChatLayout` as props.
2. `ChatLayout` passes them to `AgentModeSelector`. We add a new `onAgentNameClick` prop.
3. When clicked, `ChatLayout` sets `drawerVisible=true` and `drawerAgentId` to the resolved agent ID from the current conversation (via `resolveAgentId(conversation)`).
4. `AgentProfileDrawer` receives `visible` + `agentId` and renders.

### How to resolve "Rule" for assistants

- For **preset** assistants (`source === 'preset'`): Look up `ASSISTANT_PRESETS` by ID, then read the rule file content. The rule files are at paths like `src/process/resources/assistant/{id}/{ruleFile}`. Since renderer cannot read filesystem directly, we either:
  - (A) Call an IPC bridge to read the rule text from main process, or
  - (B) Use the existing `presetRules` field if it's already been resolved and stored in conversation extra.
  - **Decision**: Use IPC bridge to fetch rule content on demand (see Self-Debate D1).

- For **custom** agents (`source === 'custom'`): Read the `context` field from `acp.customAgents` config.

### How to resolve "Skills" for assistants

- For **preset** assistants: `ASSISTANT_PRESETS[id].defaultEnabledSkills` provides the skill name list.
- For **custom** agents: Check `enabledSkills` field in their config.

### How to resolve "Mounted General Agents" for assistants

- For **preset** assistants: `presetAgentType` field maps to a CLI backend (e.g., `'gemini'`). Look up that backend in `useAgentRegistry()` to get its `AgentIdentity`.
- For **custom** agents: `presetAgentType` or `backendType` from their config similarly maps to a CLI agent.

### How to resolve "Group chats containing this agent"

- Filter all conversations where `type === 'dispatch'`.
- For each dispatch conversation, check if any child member's `agentId` matches the target agent. This requires querying `get-group-chat-info` for each dispatch conversation, which could be expensive.
- **Optimization**: Use the existing `useConversationHistoryContext()` which holds all conversations. For dispatch conversations, the `extra` field may contain member info. If not, batch-fetch via IPC.
- **Practical approach**: Create an IPC call `getGroupChatsForAgent(agentId)` that iterates dispatch sessions server-side and returns matching group chat summaries. This avoids N+1 queries from the renderer.

---

## 5. Self-Debate

### D1: Where to fetch assistant rule text?

**Decision**: Add a new IPC call `getAssistantRuleContent(presetId, locale)` that reads the rule markdown file from the main process and returns the text.

| #   | Objection                                                                                              | Counter                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Adding IPC increases complexity; could embed rule text in `ASSISTANT_PRESETS` at build time.           | Rule files are large markdown files (some > 5KB). Embedding them in the bundle would bloat the renderer JS. On-demand IPC is lazy and keeps bundle small.                                             |
| 2   | The rule content is already available as `presetRules` in conversation extras -- just read from there. | `presetRules` is only set for conversations that have been initialized. The drawer should show rules even when browsing an agent with no active conversation. Also, the extra field may be truncated. |
| 3   | IPC call adds latency on every drawer open.                                                            | Cache the result in the hook using SWR with a stable key. After first fetch, subsequent opens are instant from cache. Typical rule file is < 10KB, sub-10ms read.                                     |

### D2: Drawer placement -- inside ChatLayout vs. top-level App?

**Decision**: Render `AgentProfileDrawer` inside `ChatLayout` (conversation-scoped).

| #   | Objection                                                                             | Counter                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | If rendered in ChatLayout, the drawer is destroyed on route change and state is lost. | This is acceptable. The drawer is transient -- it shows info about the current conversation's agent. There is no state to preserve across route changes.                      |
| 2   | Multiple ChatLayout instances (tabs) would each mount their own drawer.               | Only one ChatLayout is active at a time (tabs share a single rendered conversation). No duplication issue.                                                                    |
| 3   | Rendering at App level would allow opening the drawer from sidebar agent clicks too.  | The requirement explicitly states sidebar clicks do NOT trigger this panel. Scoping to ChatLayout enforces this constraint architecturally rather than relying on convention. |

### D3: New directory `AgentProfileDrawer/` vs. single file alongside existing components?

**Decision**: Create a new directory `src/renderer/pages/conversation/components/AgentProfileDrawer/` with sub-components.

| #   | Objection                                                                                | Counter                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The drawer is simple enough for a single file -- adding a directory is over-engineering. | The assistant variant has 3 distinct sections (Rule, Skills, MountedAgents) plus the shared GroupChatList. A single file would exceed 300 lines. Sub-components improve readability and testability.                  |
| 2   | Could reuse the existing `GroupMemberSider.tsx` pattern (single file, no directory).     | GroupMemberSider is simpler (one list of members). AgentProfileDrawer has conditional rendering by type, multiple data sources, and more complex layout. The directory pattern is justified by the higher complexity. |
| 3   | Adding a directory increases the child count of `components/`.                           | Current count is ~6-7 children. Adding one directory brings it to ~7-8, well within the 10-child limit.                                                                                                               |

---

## 6. Deprecated Files to Delete

The following files from the original S4 full-page implementation should be removed:

| File                                                            | Reason                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/renderer/pages/agent/index.tsx`                            | Full-page AgentProfile entry point -- replaced by drawer                                |
| `src/renderer/pages/agent/types.ts`                             | Type definitions for the full-page -- replaced by drawer types                          |
| `src/renderer/pages/agent/hooks/useAgentProfile.ts`             | Data hook -- logic migrated to `useAgentProfileDrawer`                                  |
| `src/renderer/pages/agent/components/AgentProfileHeader.tsx`    | Header component -- replaced by `ProfileHeader.tsx`                                     |
| `src/renderer/pages/agent/components/AgentConfigSection.tsx`    | Config section -- replaced by `AssistantDetail.tsx`                                     |
| `src/renderer/pages/agent/components/AgentConversationList.tsx` | Conversation list -- no longer needed (drawer shows group chats, not conversation list) |
| `tests/unit/agent/AgentProfile.dom.test.tsx`                    | Test for deprecated page                                                                |

After deletion, remove the entire `src/renderer/pages/agent/` directory.

Also remove from `Router.tsx`:

```typescript
// DELETE this line:
const AgentProfile = React.lazy(() => import('@renderer/pages/agent'));
// DELETE this route:
<Route path='/agent/:agentId' element={withRouteFallback(AgentProfile)} />
```

Also update `GroupMemberSider.tsx`:

- Remove the `handleNavigateToProfile` callback that calls `navigate(/agent/...)`.
- Replace with an `onAgentNameClick` prop that opens the drawer instead.

---

## 7. Acceptance Criteria

### Functional

- [ ] **AC-1**: Clicking the agent name/logo area in the conversation header opens a right-side Drawer panel (360px width).
- [ ] **AC-2**: Clicking the agent name in the sidebar does NOT open the drawer.
- [ ] **AC-3**: For general agents (`employeeType === 'temporary'`), the drawer shows: avatar, name, "Start New Conversation" button, and group chat list.
- [ ] **AC-4**: For assistants (`employeeType === 'permanent'`), the drawer shows: avatar, name, "Start New Conversation" button, Rule (read-only), Skills list, mounted general agents, and group chat list.
- [ ] **AC-5**: "Start New Conversation" button navigates to `/guid` with the agent pre-selected.
- [ ] **AC-6**: Clicking a group chat in the list navigates to that dispatch conversation.
- [ ] **AC-7**: The Rule section displays the assistant's system prompt text in a read-only, scrollable container.
- [ ] **AC-8**: The Skills section shows skill names as tags/chips.
- [ ] **AC-9**: The mounted agents section shows avatar + name of the underlying CLI agent(s).
- [ ] **AC-10**: The drawer closes when clicking outside, pressing Escape, or clicking the close button.

### Technical

- [ ] **AC-11**: All user-facing text uses i18n keys (no hardcoded strings).
- [ ] **AC-12**: Components use Arco Design `Drawer`, `Button`, `Tag`, `Typography` -- no raw HTML interactive elements.
- [ ] **AC-13**: Icons use `@icon-park/react`.
- [ ] **AC-14**: Styles use UnoCSS utilities; complex styles use CSS Modules.
- [ ] **AC-15**: All new types use `type` keyword (not `interface`).
- [ ] **AC-16**: Path aliases (`@/`, `@renderer/`) used consistently.
- [ ] **AC-17**: The deprecated `src/renderer/pages/agent/` directory and its route are fully removed.
- [ ] **AC-18**: No directory exceeds 10 direct children.
- [ ] **AC-19**: Rule content is fetched via IPC and cached with SWR (no filesystem access from renderer).
- [ ] **AC-20**: Group chat membership query is performed server-side via IPC to avoid N+1 renderer queries.
