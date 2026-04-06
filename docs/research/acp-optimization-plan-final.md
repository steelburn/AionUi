# AionUi ACP 优化计划（Final）

> 日期：2026-04-04
> 目标：形成一份可直接立项、拆 Sprint、拆 Issue 的最终统一方案
> 状态：ACP 改造唯一技术方案
> 方法：以代码审查结论作为最终裁决标准；将“共识项”“待验证项”“已降级项”分开
> 配套流程：`acp-development-workflow.md`
> 配套执行日志：`acp-execution-log.md`

---

## 一、最终结论

这次改造的核心，不是“把 ACP 接好”，而是“把 ACP 服务之后到用户看到界面的整条链路做好”。

最终统一判断如下：

1. AionUi 的主要问题不在 ACP bridge 本身，而在连接生命周期、状态语义、错误可见性、认证交互、队列语义和可观测性。
2. Claude Code 方案对 `streaming buffer`、`disconnected`、`turn guard`、`queue/idle kill 风险` 的方向判断有价值，但部分表述过满，部分优先级偏高。
3. Zed 真正领先的不只是“更顺滑”，而是把 external agent 当作一等产品能力来做：连接复用、认证 CTA、Send Now、错误分层、ACP logs。
4. 最终方案不能只做短期止血，也不能直接跳到大重构。正确顺序应是：
   `先补真相层 -> 再补用户动作层 -> 再收口状态机和热路径 -> 最后才动连接拓扑和运行时托管`

一句话总结：

- 短期目标：让用户知道“现在发生了什么”和“下一步该做什么”
- 中期目标：让 stop / queue / disconnect / auth 的体验可信
- 长期目标：把 AionUi 的 ACP 体验做成接近 Zed 的一等能力

---

## 二、已经收敛的共识

以下内容已可视为双方收敛结论。

### 1. 不是 bridge 问题优先

AionUi 已经完成了 ACP 接入，当前问题重点不在协议桥本身，而在桥后面的产品化能力。

### 2. 当前体验差距主要来自 5 个层面

- 连接和 session 生命周期
- 状态机与断连语义
- 停止 / 排队 / 抢发语义
- 认证与错误交互
- ACP 调试与可观测性

### 3. Zed 的优势已经可以明确归纳

Zed 领先点已经比较稳定，可归纳为：

- 连接复用
- 认证 CTA
- 线程级错误 UI
- Send Now / interrupt-and-send
- ACP logs
- capability-based degrade

### 4. AionUi 不是“没有能力”，而是“能力分散”

当前 AionUi 已具备以下基础能力：

- session restore / load
- keepalive
- request trace
- queue 持久化、暂停、恢复、重排
- mode/model/context 持久化
- startup error 分类

问题在于：

- 能力分散在多层
- 用户感知层拿不到统一状态真相源
- 主链路里副作用太多

---

## 三、代码审查后的最终裁决

本节用于明确哪些说法成立，哪些说法需要降级。

### 1. 成立：Stop 当前是乐观停止

当前 `Stop` 是：

1. 前端发 stop
2. process 调 `task.stop()`
3. `AcpAgentManager.stop()` 调 `agent.cancelPrompt()`
4. 前端 `finally` 立刻 reset

这条链路没有等待 backend 的显式确认。

相关代码：

- `src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx:284`
- `src/process/bridge/conversationBridge.ts:399`
- `src/process/task/AcpAgentManager.ts:977`
- `src/process/agent/acp/AcpConnection.ts:1030`

### 2. 成立：断连现在会被伪装成 finish

连接层知道进程退出的 `code/signal`，但 `handleDisconnect()` 只发 `finish`，没有把断连原因透给 UI。

相关代码：

- `src/process/agent/acp/AcpConnection.ts:489`
- `src/process/agent/acp/AcpConnection.ts:512`
- `src/process/agent/acp/index.ts:1219`

### 3. 成立：renderer 已有 disconnected 处理，但用户层没闭环

`useAcpMessage()` 已经能处理 `disconnected`，但 process 层没有稳定发出，历史消息组件还会主动隐藏 `disconnected`。

相关代码：

- `src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts:201`
- `src/process/agent/acp/index.ts:1306`
- `src/renderer/pages/conversation/Messages/components/MessageAgentStatus.tsx:32`

### 4. 成立：需要 ACP 专用 streaming reveal buffer

当前 renderer 并非“完全没有缓冲”，因为 `useAddOrUpdateMessage()` 自己有批处理。

但 ACP `content` 事件仍然每个 chunk 走一次消息更新，缺少类似 Zed 的、按帧 reveal 的专用流式缓冲。

相关代码：

- `src/renderer/pages/conversation/Messages/hooks.ts:278`
- `src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts:176`
- `crates/acp_thread/src/acp_thread.rs:1598`

### 5. 成立：热路径职责过多

`AcpAgentManager.onStreamEvent` 目前承担的职责过多，状态过滤、preview、thinking、transform、DB、IPC、team bus、channel bus 混在一起。

这既影响排障，也影响性能归因。

相关代码：

- `src/process/task/AcpAgentManager.ts:342`
- `src/process/task/AcpAgentManager.ts:503`

### 6. 成立：Zed 在产品能力层面领先，不只是代码实现层面领先

已能从代码与文档中明确确认的 Zed 优势：

- 连接复用：`AgentConnectionStore`
- 认证 CTA：`Authentication Required` / `Authenticate`
- 抢发：`interrupt_and_send` / `Send Now`
- ACP logs：专用 debug 入口

相关代码：

- `crates/agent_ui/src/agent_connection_store.rs:117`
- `crates/agent_ui/src/conversation_view.rs:640`
- `crates/agent_ui/src/conversation_view/thread_view.rs:8043`
- `crates/agent_ui/src/conversation_view/thread_view.rs:1170`
- `crates/agent_ui/src/conversation_view/thread_view.rs:3281`
- `docs/src/ai/external-agents.md:247`

### 7. 降级：不能再说“完全没有前端缓冲”

这句话不成立。

更准确的说法应该是：

- 当前没有 ACP 专用的、按帧预算的流式文本 reveal buffer
- 但 renderer 本身并不是完全零缓冲

### 8. 降级：不能再说“当前 DB 双层缓冲是 AcpAgentManager + StreamingMessageBuffer”

这句话不成立。

`StreamingMessageBuffer.ts` 当前没有实际调用点，不能继续当作现状能力写入正式方案。

### 9. 降级：不能再把 worker hop 当成当前主要瓶颈

当前 ACP manager 热路径是直接 `AcpAgent -> AcpConnection`，不是依赖 worker hop。

相关代码：

- `src/process/task/AcpAgentManager.ts:279`
- `src/process/agent/acp/index.ts:215`

### 10. 降级：`flush DB buffer`、`简单退避重连`、`suppressAbortError` 都不应作为最高优先级核心项

原因分别是：

- `flush DB buffer` 在现有 signal 链里已基本覆盖
- 简单 300ms retry 当前已经存在
- `suppressAbortError` 有价值，但更适合做 hardening，而不是主修复项

相关代码：

- `src/process/task/AcpAgentManager.ts:506`
- `src/process/agent/acp/index.ts:329`
- `src/process/agent/acp/AcpConnection.ts:1030`

---

## 四、本周必须补测的高风险项

这两项来自 CC 版，价值很高，但最终口径应当是“高风险项，需要专项复现与埋点”，而不是未经实验直接定性。

### 1. queue 死锁风险

风险描述：

- queue 门闸依赖 renderer 推断的 `running / aiProcessing`
- 如果 turn 结束信号丢失或状态未正确归零，后续消息会持续被当作 busy 而进入队列
- 用户会感知成“卡住”“只能刷新”

代码线索：

- `src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx:257`
- `src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts:156`
- `src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts:339`

本周动作：

- 复现 kill CLI / sleep-wake / stop-late-content 等场景
- 记录 queue 是否卡死、是否需刷新才能恢复

### 2. idle kill 误杀风险

风险描述：

- `WorkerTaskManager` 只按 `lastActivityAt` 和 `cronBusyGuard` 判断 ACP idle
- 当前判断里没有显式检查 `pendingPermissions`
- 也没有显式检查 ACP 连接是否仍在等待用户交互

代码线索：

- `src/process/task/WorkerTaskManager.ts:16`
- `src/process/task/WorkerTaskManager.ts:33`
- `src/process/agent/acp/index.ts:159`

本周动作：

- 复现“权限确认界面挂 30 分钟”的场景
- 判断是否会误 kill
- 如能复现，直接进 Sprint 1

---

## 五、最终改造路线图

### P0：真相层与可观测性

这一阶段解决的是“系统到底发生了什么”，不先做这个，后续所有 UX 修复都容易漂。

#### P0.1 区分 `finish` 与 `disconnected`

目标：

- `finish` 仅表示当前 turn 正常结束
- `disconnected` 表示 backend 异常中断
- 把 `exitCode` / `signal` 向上透传
- 历史消息不再隐藏 `disconnected`

#### P0.2 建立 ACP 显式状态机

建议状态：

- `connecting`
- `connected`
- `authenticating`
- `authenticated`
- `session_restoring`
- `session_active`
- `running`
- `waiting_permission`
- `cancelling`
- `disconnected`
- `error`

目标：

- 不再由 renderer 猜 ACP 阶段
- 切页后恢复的不只是 busy/idle

#### P0.3 建立 ACP logs 最小版

最少覆盖：

- connect
- auth
- session new/load/resume
- prompt start / first chunk / finish
- cancel sent
- process exit

目标：

- 让“断连”“认证失败”“卡住”可以被快速归因

#### P0.4 完整统一 trace

补齐统一时序点：

- connect ready
- auth ready
- session ready
- first chunk
- turn finish
- disconnect reason

#### P0.5 复现并裁决两类高风险项

在 P0 结束前必须得到明确结论：

- queue 死锁是否稳定存在
- idle kill 是否稳定误杀

如果存在，直接升为 Sprint 1 内修复项。

---

### P1：用户动作层

这一阶段解决“用户下一步能做什么”。

#### P1.1 认证 CTA

目标：

- 不再只抛一段认证失败消息
- 改成线程级错误 UI + 明确动作
- 支持 `Authenticate` / `Retry Login`

#### P1.2 Send Now / interrupt-and-send

当前 queue 已经支持持久化、编辑、删除、重排、暂停、恢复。

缺的是：

- 当前 turn 正在跑时，允许下一条抢发
- 用户明确知道是在“排队”还是“打断当前并立即发送”

#### P1.3 Stop 语义补齐

最终版本应包含：

- `cancelling` 状态
- renderer-side stream flush
- stale content guard
- tool cancel state 同步
- 视情况增加 `suppressAbortError`

注意：

- 不再把 `flush DB buffer` 单独当作 P0 核心项
- Stop 的真正难点是“取消后迟到内容污染 UI”

#### P1.4 错误分层

至少区分：

- auth required
- process exited
- unsupported version
- install/runtime error
- timeout
- generic error

---

### P2：状态机与热路径收口

这一阶段开始处理“为什么 AionUi 比 Zed 更容易卡、容易状态错位”。

#### P2.1 ACP 专用 Streaming Reveal Buffer

建议实现：

- 每个消息维护 pending 文本
- 16ms tick 批量 reveal
- `finish` / `error` / `cancel` 时 flush

当前进度（2026-04-05）：

- 最小版已落地在 renderer `useAcpMessage`
- 目前采用 `40ms` cadence 合并同一 `msg_id` 的连续 `content` chunk
- `finish / request_trace / agent_status / error` 前会先 flush pending content
- `resetState` / unmount 会直接 clear pending buffer，避免 stop 后 ghost text
- 更进一步的 `16ms tick / frame-budget` 精细调优，已降级为后续可选优化，而非当前 blocker

#### P2.2 拆热路径职责

把 `AcpAgentManager.onStreamEvent` 至少拆成：

1. protocol normalize
2. state machine update
3. persistence
4. renderer/team/channel fan-out

#### P2.3 queue / busy 真相源回到主进程

长期目标：

- turn lifecycle 由主进程负责
- renderer 不再自己恢复 / 猜测 `running`

#### P2.4 切页恢复 ACP 阶段状态

当前状态：

- `Authenticate / Retry / Send Now` 的 remount-safe UI 状态已经落地：
  - recovery CTA 可跨 remount 维持进行中语义
  - duplicate click 会被抑制
  - terminal barrier handoff 后不会再冒旧的 `auth_failed / retry_failed`
- 尚未补齐的 phase：
  - waiting permission
  - cancelling

需要继续补齐：

- restore 中更细的 phase 恢复
- waiting permission
- cancelling

---

### P3：连接拓扑

这是大收益项，但不应抢在 P0/P1 前面做。

#### P3.1 从 per-conversation 连接改到 per-backend/workspace 复用

目标：

- connection 按 backend/workspace 复用
- conversation 持有 session identity
- session new/load/resume 在已连接 host 上完成

#### P3.2 capability-based degrade

如果 backend 只支持：

- `load_session`
- 或 `resume_session`
- 或都不支持

都要明确给 UI 提示，不再默默降级。

---

### P4：运行时托管

这一阶段解决环境脆弱性。

目标：

- managed install
- version cache
- startup compatibility check
- 对不支持 ACP 的 CLI 给出明确升级提示

---

## 六、最终 Sprint 顺序

### Sprint 1

- `disconnected` 透传与展示
- 历史消息保留 `disconnected`
- ACP logs 最小版
- 统一 trace
- 认证 CTA 原型
- 补测 queue 死锁与 idle kill

### Sprint 2

- Send Now / interrupt-and-send
- Stop stale-content guard
- tool cancel 状态同步
- 错误分层

### Sprint 3

- ACP 专用 streaming reveal buffer
- ACP 状态机持久化与恢复
- 热路径拆层

### Sprint 4

- connection reuse 原型
- capability-based degrade

### Sprint 5

- runtime 托管与安装链优化

---

## 七、暂缓或降级处理的项

以下内容不再占据第一批开发资源。

### 1. `Stop 时 flush DB buffer`

原因：

- 当前 signal 链里已基本覆盖
- 不是当前体验差异最大的真实根因

### 2. `简单指数退避重连`

原因：

- 当前已有一次 300ms retry
- 它能改善启动失败，但不能解释 Zed 的主要体验优势

### 3. 把 worker hop 当成主要瓶颈

原因：

- 当前 ACP 主链路是 direct `AcpAgent -> AcpConnection`
- 证据不足

### 4. 只做 `suppressAbortError` 就认为 Stop 修好了

原因：

- 它只能处理一部分错误表现
- 真正难点在 stale content、取消态、tool 状态同步

---

## 八、最终验收指标

### 核心指标

- 冷启动首条消息 `first chunk` 耗时
- 热启动首条消息 `first chunk` 耗时
- `Stop -> UI 停止追加文本` 的耗时
- 断连后用户是否能看到明确状态
- 认证失败后用户是否能看到明确动作
- `Send Now` 成功率
- silent hang 超时可见率
- 通过 ACP logs 定位问题的成功率

### 场景矩阵

至少覆盖：

- 冷启动首条消息
- 同会话第二条消息
- 新会话同 backend
- 双会话并发
- 长时间 silent tool
- 认证过期
- 手动 kill CLI
- 系统 sleep / wake
- stop 后立即继续发送
- 队列中途抢发
- 权限弹窗悬停 30 分钟

---

## 九、最终执行原则

1. 先把真相层做对，再做交互层，再做重构层。
2. 所有“体验优化”都必须绑定指标，不接受空泛描述。
3. 所有“根因判断”都必须区分：
   - 代码已确认
   - 高风险待验证
   - 已降级表述
4. 在没有 P0/P1 数据前，不启动连接拓扑大改。
5. 最终目标不是“修几个 bug”，而是把 ACP 做成 AionUi 的一等产品能力。

---

## 十、当前完成度判断（2026-04-06）

当前状态不应再描述为“方案研究期”，也不应过度描述为“全部优化完成”。

更准确的判断是：

- 已完成：`P0/P1` 主链路，以及 `P2` 的一部分关键合同
- 未完成：ACP UI 的最终产品化收口，以及更深层的结构优化

### 已完成的部分

- `Stop / late content / finish` 的主链路已经收口
- `disconnected -> Retry` 已有 thread-level UI 和自动化回归
- `auth_required -> Authenticate` 已有 thread-level UI 和自动化回归
- reopen / resume / load 的 hermetic 和 real canary 主链路已打通
- queue / Send Now / barrier blocking 的关键合同已补齐
- live generic error / in-flight recovery / historical error reopen 这三类 queue 边界也已进一步收紧
- `Authenticate / Retry` 的 in-flight 状态已可跨 remount 保持，并抑制 terminal handoff 后的 stale failure
- 侧栏 spinner 与详情页 send/stop 状态的主要分裂已收口
- 历史 timeline 不再默认混入 ACP runtime status 和 legacy 基础设施红条
- ACP 最小版 streaming reveal buffer 已落地，并已守住 finish / stop / unmount 语义
- `ACP logs` 已从主界面撤到右上角 runtime status dot 的二级诊断入口

### 仍未完成的部分

- `queue / busy` 的更底层单一真相源还未完全回收到更统一的 runtime contract
- 连接复用拓扑、capability-based degrade、runtime 托管仍属于后续阶段

一句话判断：

- 现在已经“能稳定用”
- 但还没有完全达到“像 Zed 一样克制、成熟、默认产品化”的最终形态

---

## 十一、AionUi 当前用户可见 UI 状态

本节只描述“普通用户实际会看到什么”，不描述内部 trace 或进程层细节。

### 1. 正常空闲

用户会看到：

- 正常消息流
- 普通发送按钮

不会看到：

- `connected / authenticated / session_active` 这类成功状态卡片进入正文 timeline

### 2. 正常请求进行中

用户会看到：

- 发送按钮变成 `stop`
- 侧栏该会话显示生成中 spinner
- 必要时会出现 thinking / tool 相关区域

### 3. 需要认证

用户会看到：

- thread-level 黄色 banner
- `Authenticate` 按钮

但以下情况默认不会直接升格成这块 banner：

- 只是历史 `lastAcpStatus` hydrate 回来的 `auth_required`
- 且当前线程没有 pending queue，也没有正在进行中的 authenticate recovery

用户此时不会看到：

- queue 自动继续执行下一条消息
- `Send Now`

### 4. 连接断开

用户会看到：

- thread-level 红色 banner
- `Retry` 按钮

但以下情况默认不会直接升格成这块 banner：

- 只是历史 `lastAcpStatus` hydrate 回来的 `disconnected`
- 且当前线程没有 pending queue，也没有正在进行中的 retry recovery

用户此时不会看到：

- queue 自动继续执行下一条消息
- `Send Now`

### 5. 认证 / 重连进行中

用户会看到：

- banner 继续保留
- 对应按钮进入 loading 态

只有真正恢复 ready 后：

- banner 才会消失
- queue 才会继续自动放行下一条

### 6. 一般错误

用户现在会看到：

- live `send_failed / request_error / status:error`
- 对应的 thread-level generic error callout
- callout 内的 `Copy / Close`

但以下情况默认不会升格成这块 generic error callout：

- `auth_failed`
- `auth_required`
- `disconnected`
- 历史 hydrate 回来的 `lastAcpStatus: error`

这些状态会分别走：

- `Authenticate` banner
- `Retry` banner
- diagnostics-only historical error

### 7. 有排队消息时

用户会看到：

- queue panel
- 编辑 / 删除 / 暂停 / 恢复 / 清空等操作

如果当前 turn 正在运行：

- 会看到 `Send Now`

如果当前线程正卡在 `auth_required` 或 `disconnected`：

- `Send Now` 会隐藏
- queue 继续冻结

如果 live generic error 发生在当前 turn，且 queue 中还有待执行消息：

- queue 会自动转入 paused
- 不会悄悄继续滑到下一条
- 需要用户明确 `Resume` 后才继续

如果只是历史 hydrate 回来的 terminal status，但 queue 里还有待执行消息：

- `auth_required / disconnected`：
  - 仍然会保留对应 banner
  - 用户必须先恢复，再继续自动出队
- `error`：
  - 不再作为 reopen 后的隐形 queue barrier
  - queue 不会因为一个历史 generic error 被静默卡死

### 8. 右上角 runtime status dot / diagnostics

用户会看到：

- 右上角 agent pill 右侧一个细小的 runtime status dot
- live ACP failure 时，dot 会跟随当前 runtime 状态变色
- send 后到首包前，dot 会进入轻微 pulse 的 waiting 态

但以下情况不会再把 dot 升格成当前故障色：

- 只是历史 hydrate 回来的 `auth_required`
- 只是历史 hydrate 回来的 `disconnected`
- 只是历史 hydrate 回来的 `error`

用户可以：

- 点击 status dot 打开 diagnostics
- 在 diagnostics 中查看 ACP logs

用户默认不会看到：

- 内联展示在发送区上方的 `ACP 日志` 面板

### 9. 重新打开旧会话

如果该 ACP 会话上次结束在：

- `auth_required`
- `disconnected`
- `error`

当前会恢复出：

- 中性的 status dot / diagnostics
- 对应 diagnostics 记录
- 如果只是历史 generic `error`，不会额外把 queue 卡在一个没有恢复入口的隐形障碍态里

只有以下情况仍会看到 banner：

- 该历史线程里仍有 pending queue
- 当前线程已有正在进行中的 recovery CTA

而不会再把这些状态混成正文里的红色消息块。

### 10. 发送后到首包前

当前用户会看到：

- 发送按钮已经切到 `stop`
- 右上角 runtime status dot 进入 waiting pulse
- 在线程底部、输入框上方出现一条 `Processing / Connecting to {agent}` warmup row
- 如果 ACP 在首包前先发出 inline `thinking`，则由 inline `thinking` 接管这一段等待提示，避免双重过渡 UI
- 如果切回的是一个已经 hydrated 的 `running` 会话：
  - 当最后一条可见 timeline 消息仍是 user-side 时，waiting cue 会继续保留
  - 当已经出现 assistant-side activity 时，保持 busy/stop 语义，但不会错误回到 `Connecting to {agent}`

当前用户不会看到：

- 为了制造“热闹感”而插入一条假的 assistant 正文消息

### 11. ACP Logs

当前普通用户默认不会看到：

- 内联的 `ACP 日志` 面板

当前普通用户只有在点击右上角 status dot 后，才会看到 diagnostics，其中会展示：

- request started
- first response
- request finished
- request error
- auth / retry / cancel / send now / status
- 历史 hydrate 回来的 `auth_required / disconnected`
- 历史 hydrate 回来的 `error`

### 12. 仍然偏粗糙的用户体验点

当前仍需继续优化的用户面问题：

- generic error callout 已有 `Copy / Close`，但还没有 Zed 那种更完整的 `Retry Generation` 语义
- 流式 reveal 已有最小版收口，但 cadence 仍可继续微调
- diagnostics 入口虽然已经二级化，但仍比 Zed 更直接暴露在主线程 header 中

---

## 十二、Zed 当前用户可见 UI 状态

### 1. 正常情况

用户通常只看到：

- 正常消息线程
- 正常生成 / 停止 / 队列操作

在 loading / warmup 阶段，Zed 还会给用户一个更明确的过渡 affordance：

- panel/thread loading 会显示明显的 loading view
- 发送后到首包前，会有可感知的 loading / generating affordance

用户通常不会看到：

- `connected`
- `authenticated`
- `session_active`

这类 runtime chatter 默认出现在主界面。

### 2. 需要认证

用户会看到：

- thread-level `Authentication Required` callout
- `Authenticate` 按钮
- 可复制错误信息的入口

### 3. 一般错误

用户会看到：

- `An Error Happened` callout
- 可能的 `Retry Generation`
- `Copy Error Message`
- dismiss / close

### 4. 启动 / 安装失败

用户会看到：

- `Failed to Launch`
- `Failed to Install`

这类明确的 callout，而不是把错误混进正文。

### 5. 队列中的抢发

用户会看到：

- 明确的 `Send Now`

并且它对应的是 thread 级的 `interrupt_and_send` 语义，而不是仅仅“停止后碰碰运气继续发”。

### 6. ACP Logs

Zed 也有 ACP logs，但它是：

- 二级调试入口
- 通过 Command Palette 的 `dev: open acp logs` 打开

它不是普通用户默认一直看到的主界面元素。

---

## 十三、当前与 Zed 的用户感知差距

截至 2026-04-06，AionUi 与 Zed 的主要差距已经不再是：

- stop 不工作
- retry 不工作
- auth 不工作
- reopen 不工作

当前剩余的主要差距更偏产品化：

- AionUi 已将 `ACP logs` 收到二级入口，但 diagnostics status dot 仍比 Zed 更直接暴露在主线程 header 中
- AionUi 的 live generic failure 已经进主线程 callout，也已有 `Copy / Close`，但仍缺少 Zed 更完整的 `Retry Generation`
- AionUi 的 send-time waiting affordance 已上移到线程底部，但仍没有 Zed 那种更完整的 thread-level generating row / elapsed meta
- AionUi 的 streaming reveal 已有最小版，但离 Zed 更细腻的观感调优仍有空间

因此后续优先级应继续是：

1. 评估 generic error callout 是否值得进入 request-level `Retry Generation`
2. 再决定是否需要引入更明确的 thread-level generating affordance
3. 再决定 diagnostics 入口是否继续下沉到更深层调试入口
4. 再决定是否进入更大的连接拓扑 / runtime 托管阶段
