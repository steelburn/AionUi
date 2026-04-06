# AionUi ACP 改造研发流程

> 日期：2026-04-06
> 基于：`acp-development-workflow-v2.md`（收编为正式版）
> 适用范围：`feat/acp-optimization` 后续所有改造切片
> 对应技术方案：`acp-optimization-plan-final.md`
> 对应场景卡：`acp-scenario-cards.md`
> 执行留痕：`acp-execution-log.md`
> 对照基线：AionUi 当前工作区 + Zed 本地仓库 `/Users/veryliu/Documents/GitHub/zed`
> 目标：让 ACP 改造过程可自循环自测、可复盘、可审查，而不是靠人工感觉验收

**正式版相对旧版的核心变化：**

1. `Reviewer` 升级为真隔离 subagent，单 Agent fallback 强制结构化对抗 checklist
2. 每轮标准流程新增显式拒绝路径，reviewer 否决后明确回哪一步
3. `SC-XXX` 必须出现在测试代码注释里，形成文档 ↔ 测试的双向追踪
4. 合并门禁区分「机器执行」与「人工执行」，减少“靠自觉检查”
5. 保留并固化两条本线硬规则：
   - 任何“追平 Zed”的判断，都必须先做 AionUi / Zed 代码事实对照
   - 每完成一个 `SC / batch`，都必须回看 `acp-optimization-plan-final.md`

---

## 一、执行模式

### 首选：`2+1` 真隔离

这次改造默认固定成 `Driver + Reviewer + Automation`：

- `Driver`：唯一实现责任人。每次只允许一个人或一个 agent 改一个切片，避免状态机改动互相覆盖。
- `Reviewer`：独立审查人。只负责挑错、找回归、质疑验收口径，不和 `Driver` 在同一轮混写代码。
- `Automation`：固定脚本门禁。任何 ACP 改动都必须过自动化，不接受“我本地点过了”。

**正式版新增：Reviewer 应使用真隔离 subagent。**

Reviewer subagent 的启动上下文只包含：

- 本次切片的 `SC-XXX` 场景卡
- git diff（仅本次改动）
- 测试运行结果摘要

不传入 `Driver` 的实现过程、中间决策、尝试路径。目的是确保 `Reviewer` 无法利用 `Driver` 的先验知识放行假修复。

### Fallback：单 Agent 强制对抗模式

如果只有一个 agent 可用，必须严格执行以下分轮规则：

- 第一轮：只做实现，不做任何自我评价。
- 第二轮：切换 reviewer 心智，逐条回答以下对抗 checklist。

```
Reviewer 对抗 checklist（每项必须明确回答 pass / fail / N/A）：

[ ] cancel 后是否还有迟到内容被接收？
[ ] disconnect 是否能完整透传到 UI 真相源？
[ ] finish / disconnected / error 状态是否互斥？
[ ] queue busy gate 是否能正确归零？
[ ] 这个修复在用户侧是否真的可见（非内部日志）？
[ ] 测试是否只覆盖了 happy path，缺少失败路径？
[ ] 场景卡中的自动化断言点是否全部有对应测试？
[ ] 是否存在“看起来绿，但换一个时序就红”的脆弱测试？
```

只有全部回答完毕（`pass` 或 `N/A`），才算第二轮结束。任何一项 `fail` 都必须回到对应步骤修复。

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

每个切片开始前先写一张独立 `scenario card`，统一登记在 `acp-scenario-cards.md`，至少包含：

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

**正式版新增：`SC-XXX` 必须出现在测试代码注释里。**

每个与场景卡相关的测试用例，必须在描述行附近注明对应编号：

```ts
// SC-042: stop 后有迟到 chunk 不应被接收
it('should discard chunks arriving after cancel', () => {
  ...
})
```

目的：reviewer 扫一眼 diff 就能确认“这个 SC 有没有测试覆盖”，不用来回翻文档。

### 3. 缺少自动化断言，不算 done

ACP 体验问题大多是事件时序问题。没有自动化断言，只靠肉眼回放，几轮后一定回归。

### 4. 一个场景卡 / 一个 execution batch / 一个 git commit

从 `feat/acp-optimization` 当前阶段开始，执行节奏固定为：

- 完成一个 `SC-XXX`
- 在 `acp-execution-log.md` 追加一个对应 batch
- 自动化门禁过绿
- 独立切一个 commit
- commit 后立即 push

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
- `finish / disconnected / error` 是否互斥
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

本次统一使用以下命令：

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

**正式版新增：测试描述行必须标注对应 `SC-XXX` 编号。**

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

如果改到 renderer 文案或 i18n，再加：

```bash
bun run i18n:types
node scripts/check-i18n.js
```

### Step 5. Reviewer 审查

Reviewer 审查有三种执行方式，按优先级选用。

**方式 A（首选）：subagent 真隔离**

使用独立 reviewer subagent，只传入：

```text
- SC-XXX 场景卡全文
- git diff（本次切片）
- 测试运行输出摘要
```

不传入 `Driver` 的实现过程和中间决策。

**方式 B（次选）：独立人工 reviewer**

独立审查人只看 diff 和场景卡，不听 `Driver` 的口头解释。

**方式 C（fallback）：单 Agent 对抗 checklist**

按第一节“单 Agent 强制对抗模式”执行，必须逐条回答 checklist，不允许跳过。

三种方式均需关注：

- 时序回归
- 状态机漏洞
- “看起来正常，但用户不可见”的假修复
- 测试盲区

**正式版新增：Reviewer 拒绝后的显式回退路径。**

| 拒绝原因                 | 回退到                         |
| ------------------------ | ------------------------------ |
| 假修复（用户不可见）     | Step 2（重写测试，先证明问题） |
| 实现有状态机漏洞         | Step 3（修复实现）             |
| 测试只覆盖 happy path    | Step 2（补失败路径测试）       |
| 场景卡与 diff 不一致     | Step 1（更新或拆分场景卡）     |
| 时序回归（影响已有场景） | Step 3（修复，不允许绕过）     |

拒绝后的修复不是“小改几行”，必须重新跑 Step 4 本地自循环，再回到 Step 5 重新审查。

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

### Step 8. 回看并更新 `acp-optimization-plan-final.md`

每完成一个 `SC / batch`，以及每发现一个足以改变判断的代码事实后，都必须回看一次 `acp-optimization-plan-final.md` 是否需要更新。

更新原则：

- `plan-final` 只允许基于代码事实、自动化结果、reviewer 裁决、或用户已稳定复现的现象更新
- 不允许因为“感觉像这样”“印象里 Zed 更好”“这轮看起来差不多做完了”就直接改计划
- 如果事实没有改变计划层判断，可以明确写“本轮无需更新 plan-final”

必须触发 `plan-final` 回看的情况：

- 某个阶段的完成度判断发生变化
- 某条与 Zed 的差距被证伪、收敛、或优先级变化
- 某个原本认为落后的能力，经代码事实对照后发现已经不落后
- 某个原本认为已完成的能力，被 reviewer 或自动化证明其实没有完成

更新时至少要回答 3 个问题：

- 当前有哪些判断已被本轮事实改变？
- 当前前 3 个剩余差距是什么？
- 下一轮优先级是否需要重排？

规则：

- 如果改了 `plan-final`，执行日志里必须写明“为什么这轮需要改计划”
- 如果本轮涉及与 Zed 的对比，必须引用本地 Zed 仓库 `/Users/veryliu/Documents/GitHub/zed` 的对应代码或文档锚点
- `plan-final` 是事实化计划，不是愿望清单；所有新增判断都必须可追溯到证据

### Step 9. commit / push / batch close

本轮切片在进入下一张场景卡前，必须完成：

- commit message 定稿
- 只提交本轮切片相关文件
- push 到当前工作分支
- 确认工作区没有残留“已完成但未提交”的 ACP 代码改动

推荐格式：

```text
feat(acp): refine queue barrier recovery [SC-044]
```

如果本轮不是 ACP 产品切片，而是流程文档、研究文档、脚本基建等非场景卡改动，可以不带 `SC-XXX`。

### Step 10. 邀请用户体验（小白版）

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

正式版区分「机器执行（自动）」和「人工执行（手动）」。

### 机器执行（CI / hook / 本地脚本）

以下条件应尽量由自动化保证，不依赖人工自查：

| 检查项                              | 执行方式                          |
| ----------------------------------- | --------------------------------- |
| L0 静态门禁通过                     | CI 必跑，失败则阻断               |
| `test:acp:integration` 通过         | CI 必跑，失败则阻断               |
| renderer 改动已过 i18n 校验         | CI 跑 `check-i18n.js`，失败则阻断 |
| ACP 切片 commit message 含 `SC-XXX` | commit-msg hook 或 reviewer 校验  |

ACP 切片 commit message 推荐格式：

```text
feat(acp): stop guard discards late chunks [SC-042]
```

可选 hook 示例（ACP 切片分支使用）：

```sh
grep -qE 'SC-[0-9]{3}' "$1" || {
  echo "ACP 切片 commit message 缺少 SC-XXX 编号"
  exit 1
}
```

### 人工执行（reviewer 核查）

以下条件需要 reviewer 手动确认：

- Reviewer 已 sign-off（对抗 checklist 全部回答完毕）
- 场景卡已独立登记在 `acp-scenario-cards.md`
- 有失败路径测试（不只有 happy path）
- 改了 UI 有对应 e2e
- `acp-execution-log.md` 已更新本批次条目
- 本轮事实已改变阶段判断或优先级时，`plan-final` 已回看并处理

以上任一不满足，不允许进入下一切片。

---

## 十、这次项目的建议排期

### Sprint 0：先搭测试实验室

- fake ACP CLI 故障注入
- `test:acp:*` 命令
- request trace 产物化
- ACP e2e 基础夹具
- commit message / `SC-XXX` 追踪约束

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
