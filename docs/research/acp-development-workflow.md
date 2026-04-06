# AionUi ACP 改造研发流程

> 日期：2026-04-04
> 适用范围：`feat/acp-optimization` 后续所有改造切片
> 对应技术方案：`acp-optimization-plan-final.md`
> 对应场景卡：`acp-scenario-cards.md`
> 执行留痕：`acp-execution-log.md`
> 目标：让 ACP 改造过程可自循环自测、可复盘、可审查，而不是靠人工感觉验收

---

## 一、执行模式

这次改造不建议用“单 agent 一把梭”模式，建议固定成 `2+1`：

- `Driver`：唯一实现责任人。每次只允许一个人或一个 agent 改一个切片，避免状态机改动互相覆盖。
- `Reviewer`：独立审查人。只负责挑错、找回归、质疑验收口径，不和 Driver 在同一轮混写代码。
- `Automation`：固定脚本门禁。任何 ACP 改动都必须过自动化，不接受“我本地点过了”。

如果只有一个 agent 可用，也必须模拟这套分工：

- 第一轮只做实现。
- 第二轮切换成 reviewer 心智做反证审查。
- 只有自动化和 review 都过了，才算当前切片完成。

---

## 二、交付原则

### 1. 一个切片只解决一个用户问题

每个切片必须绑定一个明确体验问题，例如：

- `Stop` 后仍有幽灵文本
- 子进程退出后 UI 只显示 `finish`
- queue 卡住后不自动出队
- 认证失败后用户不知道如何恢复

不要在同一个切片里同时改：

- `stop`
- `disconnect`
- `queue`
- `auth`
- `logs`

这会让问题定位和回滚都变差。

### 2. 先写场景卡，再写代码

每个切片开始前先写一张**独立** `scenario card`，统一登记在 `acp-scenario-cards.md`，至少包含：

- 用户动作
- ACP 事件序列
- UI 预期状态
- 错误表现
- 自动化断言点
- 关联测试层

补充规则：

- 场景卡必须先于代码 diff 出现
- 每个切片必须有唯一 `SC-XXX` 编号
- `acp-execution-log.md` 必须引用对应场景卡编号
- 不允许只把场景卡混写在执行日志里

### 3. 缺少自动化断言，不算 done

ACP 体验问题大多是事件时序问题。没有自动化断言，只靠肉眼回放，几轮后一定回归。

### 4. 一个场景卡 / 一个 execution batch / 一个 git commit

从 `feat/acp-optimization` 当前阶段开始，执行节奏固定为：

- 完成一个 `SC-XXX`
- 在 `acp-execution-log.md` 追加一个对应 batch
- 自动化门禁过绿
- 独立切一个 commit
- commit 后立即推到远端对应分支

不允许把多个场景卡的已完成实现长期堆在未提交工作区里。这样做的目的只有两个：

- git 本身成为第三层留痕，不只靠文档回忆
- 一旦某个 batch 需要回滚或做体验对照，边界是清楚的

---

## 三、测试金字塔

仓库已经有基础设施：

- Vitest 双环境项目在 `vitest.config.ts`
- fake ACP CLI 在 `tests/fixtures/fake-acp-cli/index.js`
- ACP smoke 在 `tests/integration/acp-smoke.test.ts`
- 当前 ACP e2e 起点在 `tests/e2e/specs/acp-agent.e2e.ts`

但还没形成面向 ACP 体验改造的闭环，所以本次统一采用 `L0-L4`。

### L0. 静态门禁

每次改动都必须先过：

```bash
bun run lint
bun run format:check
bunx tsc --noEmit
```

如果改到 `src/renderer/` 或 i18n：

```bash
bun run i18n:types
node scripts/check-i18n.js
```

### L1. 单测

目标：守住时序逻辑、状态机和边界条件。

优先覆盖这些模块：

- `src/process/agent/acp/AcpConnection.ts`
- `src/process/agent/acp/index.ts`
- `src/process/task/AcpAgentManager.ts`
- `src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts`
- `src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx`
- `src/renderer/pages/conversation/platforms/useConversationCommandQueue.ts`

重点断言：

- `cancel` 后是否还有迟到内容被接收
- `disconnect` 是否能透传到 UI 真相源
- `finish` / `disconnected` / `error` 是否互斥
- queue busy gate 是否能正确归零
- auth / permission / timeout 是否按预期切换状态

### L2. 集成测试

目标：守住 `AcpConnection -> AcpAgent -> AcpAgentManager` 这一段的真实事件顺序。

必须基于 fake ACP CLI，不依赖真实网络或真实账号。

当前已有：

- `tests/integration/acp-smoke.test.ts`
- `tests/integration/hub-install-flow.test.ts`

这层后续要补的不是“更多 happy path”，而是更多故障脚本。

### L3. E2E

目标：守住用户实际看到的界面行为。

当前已有的 ACP e2e 更偏设置页和 backend 切换，还不够覆盖核心体验。

本次改造必须新增或强化以下 e2e 场景：

- 发送首条消息并出现首个 chunk
- `Stop` 后不再追加文本
- 子进程退出后 UI 出现 `disconnected`
- 认证失败后出现恢复入口
- queue 自动出队
- `Send Now` / 抢发语义
- ACP logs 可见且能帮助定位

### L4. 真实 CLI Canary

目标：验证 fake CLI 之外没有接入漂移。

规则：

- 不作为主回归源
- 不阻塞每个小提交
- 至少在 pre-merge 或每日一次运行

原因很简单：真实 CLI 受 auth、网络、环境、版本波动影响太大，不能拿来替代确定性回归。

---

## 四、fake ACP CLI 的增强要求

当前 fake CLI 只覆盖 `initialize`、`session/new`、`session/prompt`、`session/cancel` 的最小 happy path。

在 ACP 改造开始前，先把它补成可编排场景的测试桩。至少支持：

- `late chunk after cancel`
- `child exit mid-stream`
- `auth required`
- `permission pending and resume`
- `silent hang`
- `first connect fail then recover`
- `duplicate finish`
- `out-of-order update`

原则：

- 每个故障场景都可复现
- 每个故障场景都可脚本化选择
- 结果必须稳定，不依赖随机时序

---

## 五、核心场景矩阵

以下场景是 ACP 改造期间的必跑矩阵。

### 1. 发送

- 冷启动首条消息
- 同会话第二条消息
- 新会话同 backend 首条消息

### 2. 停止

- 正常 stop
- stop 后有迟到 chunk
- stop 后立即发送下一条

### 3. 断连

- 子进程主动退出
- 中途 crash
- sleep / wake 后状态恢复

### 4. 认证与权限

- auth required
- auth 完成后重试
- permission pending
- permission reject

### 5. 队列

- busy 时入队
- turn finish 自动出队
- queue 卡住后恢复
- `Send Now` 抢发

### 6. 可观测性

- request trace 可导出
- ACP logs 能定位失败点
- 错误 UI 和 trace 一致

---

## 六、固定命令

本次新增并统一使用以下命令：

```bash
bun run test:acp:unit
bun run test:acp:integration
bun run test:acp:e2e
bun run test:acp:all
bun run verify:acp
```

语义：

- `test:acp:unit`：ACP 核心单测与 DOM 测试
- `test:acp:integration`：fake CLI 驱动的集成回归
- `test:acp:e2e`：ACP 相关 Playwright 场景
- `test:acp:all`：完整 ACP 回归
- `verify:acp`：ACP PR 的本地门禁命令

规则：

- 每个 ACP PR 至少跑到 `test:acp:integration`
- 任何 UI / 状态语义改动必须跑 `test:acp:e2e`
- 合并前必须跑 `verify:acp`

---

## 七、每个切片的标准流程

### Step 0. 先做 AionUi / Zed 代码事实对照

如果本轮切片来自“让 AionUi 更接近 Zed”的体验差距，开始前必须先做一次代码事实对照，而不是只凭截图、印象或口头描述下判断。

固定对照基线：

- AionUi 仓库：当前工作区
- Zed 仓库：`/Users/veryliu/Documents/GitHub/zed`

硬性要求：

- 至少同时查看一处 AionUi 对应实现和一处 Zed 对应实现
- 在场景卡、执行日志或 reviewer 裁决里，明确写出对照所依据的文件路径
- 如果判断来自运行时行为，而不是静态代码，也要先找到对应状态机、事件流或会话恢复入口，再下结论
- 如果 Zed 仓库里没有找到明确对应实现，必须显式写明“当前仅有产品观感对照，缺少代码事实锚点”

### Step 1. 写场景卡

先写清楚：

- 改什么
- 为什么改
- 用户会看到什么变化
- 自动化如何证明它生效

硬性要求：

- 先在 `acp-scenario-cards.md` 追加新卡，再开始代码和测试改动
- reviewer 审查时必须先核对场景卡是否和本轮 diff 一致

### Step 2. 先补失败测试

如果这是 bugfix，先让测试失败，再改实现。

如果这是新能力，至少先把最关键的不变量测试补上。

### Step 3. 做最小实现

一次只动一个切片的必要代码，不顺手重构不相关模块。

### Step 4. 本地自循环

至少执行：

```bash
bun run test:acp:unit
bun run test:acp:integration
```

如果影响 UI，再加：

```bash
bun run test:acp:e2e
```

### Step 5. Reviewer 审查

Reviewer 不重复解释设计，而是只做这几件事：

- 找时序回归
- 找状态机漏洞
- 找“看起来正常，但用户不可见”的假修复
- 找测试盲区

### Step 6. 归档证据

每个切片收口时至少保留：

- 通过的命令记录
- 关键截图
- request trace
- 失败场景与修复说明

### Step 7. 追加决策日志与执行日志

每个切片结束前，必须同步更新 `acp-execution-log.md`。

至少记录：

- 当前批次目标
- 对应 `SC-XXX`
- 本轮关键决策
- 触发决策的证据文件或 reviewer 裁决
- 具体改动范围
- 跑过的命令与结果
- 尚未关闭的风险
- 下一轮建议动作

规则：

- 只追加，不覆盖旧条目
- 结论要写成“为什么这样做”，不只写“做了什么”
- 如果 reviewer 推翻了前一轮判断，必须在日志中显式写明“裁决变更”
- 如果某个风险决定延后处理，必须写清楚延后的原因和重新触发条件

### Step 8. 邀请用户体验（小白版）

如果这个切片已经到达适合用户体验的节点，必须给出一段面向普通用户的体验引导，而不是只写内部术语。

硬性要求：

- 先写“从哪里开始”，例如先点哪个会话、哪个入口、哪个按钮
- 再写“具体怎么做”，每一步都用界面上真实可见的名称描述
- 再写“正常应该看到什么”，只描述用户可见现象，不使用 `warm session`、`hydration`、`runtime contract` 这类内部词
- 最后写“如果不对劲怎么反馈”，尽量让用户用一句简单的话就能回报问题

推荐模板：

```md
请这样体验：

1. 先进入……
2. 点……
3. 发送……
4. 然后看……

正常情况：

- 你应该看到……

如果有问题：

- 直接告诉我“我看到……，但我本来以为会……”即可。
```

规则：

- 默认先给一条最短体验路径，不要一次丢给用户三四组复杂场景
- 只有在主路径稳定后，才补充扩展体验路径
- 任何内部判断，都必须先翻译成用户能看懂的界面现象再发给用户

---

## 八、决策留痕规范

### 1. 什么时候必须记决策

出现以下任一情况，必须记一条 decision note：

- 调整技术路线或优先级
- reviewer 否决、降级、或改写既有判断
- 为了稳定性引入新测试基座或新夹具
- 发现“看起来像 bug，但代码事实不支持”的误判
- 主动暂缓一个看上去重要但证据不足的项

### 2. 决策记录的最小字段

- `Decision`
- `Why`
- `Evidence`
- `Impact`
- `Follow-up trigger`

建议格式：

```md
### D-00X 标题

- Decision:
- Why:
- Evidence:
- Impact:
- Follow-up trigger:
```

### 3. 执行日志的最小字段

- `Batch`
- `Goal`
- `Changes`
- `Verification`
- `Open risks`
- `Next`

建议格式：

```md
## YYYY-MM-DD / Batch N

- Goal:
- Changes:
- Verification:
- Open risks:
- Next:
```

---

## 九、合并门禁

以下任一条不满足，不允许进入下一切片：

- 自动化未通过
- reviewer 未 sign-off
- 没有对应场景卡
- 场景卡不是独立登记在 `acp-scenario-cards.md`
- 没有失败路径测试
- 改了 UI 但没有 e2e
- 改了 renderer 文案但没做 i18n 校验
- 没有更新 `acp-execution-log.md`

---

## 十、这次项目的建议排期

### Sprint 0：先搭测试实验室

- fake ACP CLI 故障注入
- `test:acp:*` 命令
- request trace 产物化
- ACP e2e 基础夹具

### Sprint 1：P0 真相层

- `disconnected`
- `stop stale-content guard`
- busy / turn 真相源收口
- ACP logs 基础入口

### Sprint 2：P1 用户动作层

- auth CTA
- error callout
- queue 语义修正
- `Send Now`

### Sprint 3：P2 热路径与状态机

- streaming reveal buffer
- 事件热路径解耦
- trace / UI / logs 对齐

### Sprint 4：P3 以后再做

- 连接复用拓扑
- runtime 托管
- capability-based degrade 完整化

---

## 十一、最终要求

这次 ACP 改造的验收，不看“感觉更顺了没有”，只看三件事：

- 核心场景是否自动化
- 失败场景是否可复现
- 修复是否能被 reviewer 和脚本同时证明

如果只做其中两项，后面一定会回归。
