# Post-S5 UX Refinements Changelog

**Date**: 2026-03-29
**Trigger**: User acceptance testing after S1-S5 implementation

---

## 1. Collapsed Preview Leak

**Problem**: 折叠状态下最新会话的标题"泄露"显示在 agent 行下方，视觉干扰。
**Fix**: 移除 `AgentDMGroup.tsx` 中 `!isExpanded && latestConversation` 预览区块。

## 2. Expand/Collapse Chevron Removal

**Problem**: 展开/收起箭头 (Down/Right) 占用空间且冗余，count badge 已足够表意。
**Fix**: 从 `AgentDMGroup.tsx` 移除 `Down`、`Right` 图标 import 及渲染。

## 3. Count Badge Visibility (count=1)

**Problem**: 会话数=1 时不显示 count badge，用户无法感知该 agent 有可展开内容。
**Fix**: 条件从 `conversationCount > 1` 改为 `conversationCount > 0`。

## 4. DM Section Split

**Problem**: 单一"私信"section 混合显示通用 Agent 和助手，不够清晰。
**Fix**: 拆分为"通用 Agent"和"助手"两个 section，按 `isPermanent` 分组。新增 i18n keys `generalAgentsSection` / `assistantsSection`（6 个语言文件）。

## 5. ✓ Badge Removal

**Problem**: 助手行的 ✓ badge 冗余，section 标题已区分通用 Agent 和助手。
**Fix**: 移除 `AgentDMGroup.tsx` 中 subtitle 模式和 flat/grouped 模式两处的 ✓ badge。

## 6. Click Reliability Fix

**Problem**: Agent 行点击展开时而不灵敏，约 30% 点击无响应。
**Root Cause**: 20×20px avatar 上有独立的 `handleAvatarClick` + `e.stopPropagation()`，拦截了本应传播到父级 `handleToggle` 的点击事件。
**Fix**: 移除 avatar 上的 `handleAvatarClick` 及 `stopPropagation`，整行统一使用 `handleToggle`。Avatar 点击触发 AgentProfileSider 的功能移至后续 S4 重新设计中实现。

---

## S4 Design Change Decision

**Original S4**: Agent Profile 全页面 (`/agent/:id`)，独立路由，含完整配置和历史会话。
**Revised S4**: AgentProfileSider — 侧滑 Drawer 面板，从会话头部 agent 名称触发。

**变更原因**:
1. 全页面跳转打断对话流，用户体验不佳
2. 左侧边栏已展示会话列表，Profile 页面的"最近会话"功能冗余
3. 参考群聊的 GroupMemberSider 交互模式，侧滑面板更自然

**新 S4 面板内容**:
- **通用 Agent**: 头像+名称、开始新对话按钮、所在的群聊列表
- **助手**: 头像+名称、开始新对话按钮、Rule(只读)、Skills列表(名称)、挂载的通用Agent、所在的群聊列表
- **触发方式**: 仅从会话头部 (conversation header) agent 名称点击，侧边栏不触发
