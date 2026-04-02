# Aion App Framework — 技术架构方案

**状态**: 草稿，待老尺复核  
**作者**: 架构-阿构  
**日期**: 2026-04-02  
**关联产品方案**: docs/proposals/aion-app-store-product.md（郭聪明负责）

---

## 0. 现有架构基线

在设计之前，先明确 AionUi 现有的可复用资产，新方案必须基于这些而不是另起炉灶。

| 现有模块 | 位置 | 可复用点 |
|---------|------|---------|
| Extension 系统 | `src/process/extensions/` | Manifest 格式、权限模型、沙箱（Worker Thread）、生命周期钩子、EventBus |
| Channels 系统 | `src/process/channels/` | 统一消息协议 `IUnifiedIncomingMessage`、插件状态机、ActionExecutor 路由 |
| ACP 协议 | `src/process/agent/acp/` | AI agent 标准连接协议，CLI/stdio/websocket/http 四种连接 |
| Sandbox | `src/process/extensions/sandbox/` | Worker Thread 隔离，RPC 消息（`SandboxMessage`），权限执行 |
| IPC Bridge | `src/preload.ts` + `src/common/adapter/` | 单通道 Renderer↔Main 双向通信 |
| ConversationService | `src/process/services/` | 会话创建、Agent 生命周期管理 |
| ExtensionEventBus | `src/process/extensions/lifecycle/` | 跨扩展事件发布/订阅，已有命名空间约定 |

**核心判断**：Aion App Framework 不是从零造一个新运行时，而是在现有 Extension 系统之上增加三层能力：
1. 每个 App 内可以运行 N 个 AI Agent（ACP 连接）
2. App 之间可以通过信箱通信（参考 channels 的 session 模型）
3. 动态协商：两个 App 的 Agent 之间可以用自然语言协商接口

---

## 1. 三层架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    Framework Layer（框架层）                   │
│  App 项目结构规范 · aion-app.json manifest · Agent 声明       │
│  高级权限 API（CLI/git/截屏/录音）· 合规校验器                  │
├─────────────────────────────────────────────────────────────┤
│                    Protocol Layer（协议层）                    │
│  Capability Manifest · 协商消息格式 · 动态适配                  │
│  （基于现有 IUnifiedMessage 扩展，与 MCP 互补）                 │
├─────────────────────────────────────────────────────────────┤
│                    Runtime Layer（运行时层）                   │
│  AppRuntime（沙箱进程）· 信箱路由 · 权限执行 · Agent 生命周期   │
│  （基于现有 SandboxHost + ACP 连接）                           │
└─────────────────────────────────────────────────────────────┘
         ↓ 构建于
┌─────────────────────────────────────────────────────────────┐
│               AionUi Core（Electron 三进程架构）               │
│  Main Process · Renderer · Worker · IPC Bridge              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Framework Layer — 应用框架规范

### 2.1 应用项目结构

```
my-app/
├── aion-app.json          # App manifest（必须）
├── src/
│   ├── main.js            # App 入口（在沙箱中运行）
│   └── agents/
│       └── assistant.md  # Agent 上下文文件（每个 agent 一个）
├── i18n/
│   ├── en-US/app.json
│   └── zh-CN/app.json
└── assets/
    └── icon.png
```

**与现有 Extension 结构对齐**：`aion-app.json` 是 `aion-extension.json` 的超集，复用所有现有字段，新增 `agents` 和 `capabilities` 声明。

### 2.2 App Manifest（aion-app.json）

```typescript
// 基于现有 ExtensionManifestSchema 扩展（src/process/extensions/types.ts）
interface AionAppManifest extends ExtensionManifest {
  // 继承现有字段：name, version, description, permissions, lifecycle 等

  contributes: ExtContributes & {
    // 新增：App 内的 AI Agent 声明
    appAgents?: AppAgentDeclaration[];
  };

  // 新增：App 能力声明（对外暴露什么能力）
  capabilities?: CapabilityManifest;
}

interface AppAgentDeclaration {
  id: string;                    // 如 "assistant"
  contextFile: string;           // Agent 上下文 md 文件路径
  acpBackend: string;            // 使用哪个 ACP adapter（如 "claude"）
  model?: string;                // 可覆盖默认模型
  autoStart?: boolean;           // 是否随 App 启动
  // 继承现有 ExtAssistantSchema 的其他字段
}
```

### 2.3 高级权限 API

现有权限模型（`ExtPermissions`）已有 storage/network/shell/filesystem/clipboard，新增 App 专属高级权限：

```typescript
// 在现有 permissions 字段下新增（src/process/extensions/types.ts）
interface AppExtendedPermissions extends ExtPermissions {
  // 新增高级权限
  screenshot?: boolean;          // 截屏（调用 Electron desktopCapturer）
  audioCapture?: boolean;        // 录音（Web Audio API）
  gitAccess?: boolean;           // git 操作（通过沙箱 shell 限定为 git 命令）
  systemInfo?: boolean;          // 获取系统信息（CPU/内存/进程列表）
  windowManage?: boolean;        // 创建/管理子窗口
}
```

**实现思路**：高级权限在 Sandbox Worker 内通过 `apiHandlers` 代理实现（现有模式），不直接暴露 Node API：

```typescript
// 在 SandboxHost.options.apiHandlers 注册
const appApiHandlers: Record<string, SandboxApiHandler> = {
  'screenshot.capture': async (opts) => {
    checkPermission(permissions, 'screenshot');
    return await captureScreen(opts);        // 调用 desktopCapturer
  },
  'git.run': async (cmd, args) => {
    checkPermission(permissions, 'gitAccess');
    validateGitCommand(cmd);                  // 白名单校验
    return await runGit(appWorkspace, cmd, args);
  },
  // ...
};
```

### 2.4 合规校验器

安装 App 时运行静态校验，拒绝不合规的应用：

```typescript
interface AppValidator {
  // 校验 manifest 格式（Zod schema 已覆盖大部分）
  validateManifest(manifest: AionAppManifest): ValidationResult;

  // 校验入口文件存在性
  validateEntryPoints(appDir: string, manifest: AionAppManifest): ValidationResult;

  // 校验权限声明合理性（如 shell: true 且 network: true 需要额外审核）
  validatePermissionCombinations(permissions: AppExtendedPermissions): ValidationResult;

  // 校验 agents 声明的 contextFile 存在
  validateAgentFiles(appDir: string, agents: AppAgentDeclaration[]): ValidationResult;
}
```

---

## 3. Protocol Layer — 通信协议设计

### 3.1 与 MCP 的关系

| 维度 | MCP（Model Context Protocol） | Aion App Protocol |
|------|------------------------------|-------------------|
| 定位 | 工具/资源服务，静态注册 | 应用间通信，支持动态协商 |
| 连接方式 | stdio / SSE / HTTP Streamable | 信箱（mailbox）+ 事件总线 |
| 能力发现 | 启动时枚举工具列表 | 运行时 capability manifest + 动态协商 |
| AI 参与 | 不涉及 | 协商过程由双方 Agent 主导 |
| 复用 | AionUi 已有 MCP 连接层 | 作为 App 的工具层基础设施 |

**结论**：Aion App Protocol 不替代 MCP，而是在 MCP 之上增加应用层协商能力。App 的 Agent 可以使用 MCP 工具，同时也支持跨 App 的高层协商。

### 3.2 Capability Manifest（能力声明）

每个 App 在 `aion-app.json` 的 `capabilities` 字段声明自己能提供什么、能接受什么：

```typescript
interface CapabilityManifest {
  // 对外提供的能力
  provides: CapabilitySpec[];
  // 需要外部提供的能力（用于依赖发现）
  requires?: CapabilitySpec[];
}

interface CapabilitySpec {
  id: string;              // 如 "speech-to-text", "code-review", "image-gen"
  version: string;         // semver
  description: string;     // 自然语言描述，供 Agent 协商时理解
  // 结构化 schema（可选，作为协商的起始建议，不是强制约束）
  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;
  // 协商策略
  negotiation?: {
    strategy: 'strict' | 'flexible' | 'agent-driven';
    // flexible: 接受 schema 偏差，自动适配
    // agent-driven: 让 Agent 决定如何适配
  };
}
```

**示例**：
```json
{
  "capabilities": {
    "provides": [
      {
        "id": "speech-to-text",
        "version": "1.0.0",
        "description": "将音频流转录为文字，支持实时流式输出",
        "outputSchema": {
          "type": "object",
          "properties": {
            "text": { "type": "string" },
            "segments": { "type": "array" }
          }
        },
        "negotiation": { "strategy": "agent-driven" }
      }
    ]
  }
}
```

### 3.3 统一应用消息格式

基于现有 `IUnifiedIncomingMessage`（channels 系统）扩展：

```typescript
// 应用间消息（App ↔ App）
interface AppMessage {
  id: string;                    // 消息 ID，用于 request-reply 对
  version: '1';
  from: AppAddress;              // 发件人
  to: AppAddress;                // 收件人
  type: AppMessageType;
  payload: unknown;
  timestamp: number;
  correlationId?: string;        // 用于关联 request/response
  ttl?: number;                  // 毫秒，超时后丢弃
}

interface AppAddress {
  appId: string;                 // App name（kebab-case）
  agentId?: string;              // 可选，指定 App 内的具体 Agent
}

type AppMessageType =
  | 'capability.query'           // 查询对方能力
  | 'capability.response'        // 能力应答
  | 'negotiation.start'          // 发起协商
  | 'negotiation.message'        // 协商过程中的消息（Agent 自然语言）
  | 'negotiation.complete'       // 协商完成，包含最终接口定义
  | 'data'                       // 普通数据消息（协商完成后使用）
  | 'event'                      // 单向事件（不需要 reply）
  | 'error';                     // 错误通知
```

### 3.4 动态协商机制（核心）

这是整个方案最复杂的部分。

**协商流程**：

```
App A 想连接 App B（语音识别）
          │
          ▼
1. App A 的 Agent 读取 App B 的 capability manifest
          │
          ▼
2. App A 发送 negotiation.start：
   "我需要语音转文字能力，我的数据格式是 {audioBuffer: ArrayBuffer}"
          │
          ▼
3. App B 的 Agent 收到，分析差异：
   "我的接口接受 {audioUrl: string} 或 {base64: string}，
    可以接受 ArrayBuffer 吗？不行的话我可以改造输入处理"
          │
          ▼
4. 多轮对话协商（negotiation.message）：
   - Agent 之间用自然语言沟通
   - 可以提出"我方改造自己"或"你方转换格式"
          │
          ▼
5. 达成一致 → negotiation.complete：
   最终接口定义（双方确认的 schema）
          │
          ▼
6. 后续通信用 data 消息，按最终 schema 传输
```

**数据结构**：

```typescript
// negotiation.start payload
interface NegotiationStartPayload {
  requestedCapabilityId: string;
  callerContext: string;     // 发起方 Agent 的自然语言描述："我需要X，我的数据是Y格式"
  proposedSchema?: JSONSchema; // 发起方建议的接口格式（可选）
}

// negotiation.message payload（Agent 间的自然语言消息）
interface NegotiationMessagePayload {
  role: 'requester' | 'provider';
  content: string;           // Agent 生成的自然语言消息
  proposedAdaptation?: {     // 可选：提议的适配方案
    side: 'requester' | 'provider'; // 谁来改造自己
    description: string;
    schemaChange?: JSONSchema;
  };
}

// negotiation.complete payload
interface NegotiationCompletePayload {
  finalSchema: {
    input: JSONSchema;
    output: JSONSchema;
  };
  adaptationSummary: string; // 达成了什么协议的自然语言说明
  agentHandshakeRecord: NegotiationMessagePayload[]; // 协商记录，供审计
}
```

**Agent 协商的实现方式**：

协商过程本质是：收到 `negotiation.start` 后，App Runtime 把消息注入给 App 内指定的 Agent（通过 ACP），Agent 生成回复，回复经 App Runtime 包装成 `negotiation.message` 发回。这利用现有的 ACP 连接机制，无需新的 AI 调用基础设施。

---

## 4. Runtime Layer — 运行时引擎

### 4.1 进程模型

```
AionUi Main Process（Node.js）
├── AppRuntimeManager              # 管理所有运行中的 App
│   ├── AppRuntime[app-a]
│   │   ├── SandboxHost            # 复用现有 sandbox.ts（Worker Thread）
│   │   │   └── main.js            # App 的业务逻辑代码
│   │   └── AgentPool[app-a]       # 该 App 的 Agent 连接池
│   │       ├── AcpConnection[assistant]   # 复用现有 AcpConnection
│   │       └── AcpConnection[reviewer]
│   └── AppRuntime[app-b]
│       ├── SandboxHost
│       └── AgentPool[app-b]
│           └── AcpConnection[transcriber]
│
├── AppMailboxRouter               # 信箱路由（新增）
│   ├── Mailbox[app-a]             # 每个 App 一个信箱
│   └── Mailbox[app-b]
│
└── AppRegistry                    # App 注册表（基于现有 ExtensionRegistry）
```

**设计决策**：每个 App 用 Worker Thread 沙箱隔离（复用现有 `SandboxHost`），不用独立进程。理由：
- 启动更快（毫秒级 vs 秒级）
- 通信开销更低（内存消息 vs IPC）
- 与现有 Extension 系统保持一致，降低实现成本
- 代价：沙箱隔离强度低于独立进程（Worker Thread 无法完全隔离 CPU/内存），可在 V2 升级

### 4.2 AppRuntime 生命周期

```typescript
class AppRuntime {
  private sandbox: SandboxHost;          // 业务逻辑沙箱
  private agentPool: Map<string, AcpConnection>;   // Agent 连接池

  async start(app: LoadedApp): Promise<void> {
    // 1. 启动沙箱
    this.sandbox = await createSandbox({
      extensionName: app.manifest.name,
      extensionDir: app.directory,
      entryPoint: app.manifest.contributes.appEntry ?? 'src/main.js',
      permissions: app.manifest.permissions,
      apiHandlers: this.buildApiHandlers(app),   // 包含 App 专属 API
    });

    // 2. 启动声明了 autoStart 的 Agent
    for (const agentDecl of app.manifest.contributes.appAgents ?? []) {
      if (agentDecl.autoStart) {
        await this.startAgent(agentDecl);
      }
    }

    // 3. 注册到 AppMailboxRouter
    appMailboxRouter.register(app.manifest.name, this.handleIncomingMessage.bind(this));
  }

  private async startAgent(decl: AppAgentDeclaration): Promise<void> {
    // 复用现有 ConversationService.createConversation + AcpConnection
    const conv = await conversationService.createConversation({
      type: 'acp',
      model: { ... },
      extra: {
        workspace: this.app.directory,
        contextFileName: decl.contextFile,
        agentName: decl.id,
      }
    });
    const conn = new AcpConnection(/* ... */);
    this.agentPool.set(decl.id, conn);
  }
}
```

### 4.3 AppMailboxRouter — 信箱系统

参考 Claude Code team mode 的文件 mailbox 设计（已在阿构记忆中有深度研究），但使用 SQLite 持久化（与现有系统一致）：

```typescript
interface Mailbox {
  appId: string;
  messages: AppMessage[];   // 未读消息队列
}

class AppMailboxRouter {
  // SQLite 表：app_mailboxes
  // 字段：id, from_app, to_app, message_type, payload, created_at, read_at

  async send(message: AppMessage): Promise<void> {
    // 1. 持久化到 DB
    await db.insertMailboxMessage(message);
    // 2. 唤醒目标 App Runtime（如果在运行）
    const runtime = this.getRuntimeByAppId(message.to.appId);
    if (runtime) {
      runtime.notifyNewMessage(message);   // 同步通知，无需轮询
    }
  }

  async readMessages(appId: string): Promise<AppMessage[]> {
    return db.getUnreadMessages(appId);
  }
}
```

**消息路由规则**：
- `to.agentId` 有值 → 直接注入指定 Agent 的对话上下文
- `to.agentId` 为空 → 交给 App 的 `main.js` 业务逻辑处理
- `type === 'negotiation.*'` → 优先路由给 App 内的 negotiation agent（如有声明）或默认主 agent

### 4.4 App 内 Agent 的自由度实现

"每个应用 = 一堆代码 + N个AI，不限粒度" — 实现方式：

App 的 `main.js` 通过沙箱 API 控制 Agent：

```javascript
// App 内代码（运行在 Worker Thread 沙箱中）
const { agents, mailbox } = aion;  // aion 是注入的 proxy API

// 启动一个临时 Agent 处理某任务
const agent = await agents.start('reviewer', {
  task: '请 review 这段代码',
  context: codeContent,
});

// 监听 Agent 的输出
agent.on('message', (msg) => {
  mailbox.send('app-b', { type: 'data', payload: msg });
});

// Agent 完成后关闭（节省资源）
agent.on('done', () => agent.stop());
```

**沙箱 API 设计**（通过 `SandboxHost.apiHandlers` 实现）：

```typescript
// 注入到沙箱的 aion proxy API
interface AionAppAPI {
  agents: {
    start(agentId: string, opts: AgentStartOpts): Promise<AgentHandle>;
    stop(agentId: string): Promise<void>;
    list(): Promise<AgentStatus[]>;
  };
  mailbox: {
    send(toAppId: string, message: Omit<AppMessage, 'from' | 'id' | 'timestamp'>): Promise<void>;
    onMessage(handler: (msg: AppMessage) => void): () => void;
  };
  storage: {   // 复用现有 ExtensionStorage
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  // 高级权限 API（需 manifest 声明）
  screenshot?: { capture(opts?: CaptureOpts): Promise<Buffer> };
  git?: { run(cmd: string, args: string[]): Promise<string> };
  audio?: { startCapture(): Promise<AudioStream> };
}
```

---

## 5. 应用打包与分发

### 5.1 本地 Store 目录结构

```
~/.aion/apps/
├── registry.json              # 已安装 App 的索引
├── installed/
│   ├── speech-app/            # 解压后的 App 目录
│   │   ├── aion-app.json
│   │   └── ...
│   └── code-reviewer/
└── cache/
    ├── speech-app-1.0.0.aionapp  # 下载缓存（.aionapp 格式）
    └── ...
```

### 5.2 应用包格式（.aionapp）

`.aionapp` = ZIP 压缩包，包含：
- `aion-app.json`（必须）
- `src/`（必须）
- `assets/`（可选）
- `i18n/`（可选）
- `signature.json`（签名，P1）

**复用现有 Extension 系统**：`.aionapp` 安装逻辑可直接复用 `ExtensionLoader.ts`，只需在校验步骤加入 App 专属的合规检查（Section 2.4）。

### 5.3 本地 Store 实现

```typescript
interface AppStoreService {
  // 本地已安装 App
  listInstalled(): Promise<InstalledApp[]>;

  // 安装（从文件路径）
  installFromFile(filePath: string): Promise<void>;

  // 安装（从远程，P1）
  installFromRemote(appId: string, version?: string): Promise<void>;

  // 卸载
  uninstall(appId: string): Promise<void>;

  // 检查更新（P1）
  checkUpdates(): Promise<UpdateInfo[]>;
}
```

### 5.4 远程发行（P1）

远程 Store 方案暂定两阶段：
- **P0（本地）**：用户手动安装 `.aionapp` 文件，类似 Electron 拖入安装
- **P1（远程）**：类似 VS Code 市场，提供 HTTP API 供 Aion 客户端搜索/下载
  - 上传：开发者提交 `.aionapp` + 元信息，经人工审核后上架
  - 下载：客户端调用 API，验证 SHA256 + 签名后安装

---

## 6. 安全模型

### 6.1 权限沙箱

三层防御：

| 层级 | 机制 | 现有基础 |
|------|------|---------|
| L1 静态声明 | manifest 中 `permissions` 字段声明，安装时用户确认 | 现有 `ExtPermissions` + `analyzePermissions()` |
| L2 运行时执行 | `SandboxHost.apiHandlers` 每次调用前 `checkPermission()` | 现有 `SandboxHost` 架构，补充执行逻辑 |
| L3 Worker 隔离 | Worker Thread 无直接 fs/net/child_process 访问 | 现有 `sandboxWorker.ts` |

**现有 L2 的空缺**：现有 `SandboxHost` 已有 apiHandlers 架构，但尚未在 `permissions.ts` 中实现运行时 enforcement（代码注释标明是 P2）。App Framework 需要把这个补上，否则权限声明只是展示用。

### 6.2 通信鉴权

App 间通信通过 `AppMailboxRouter`，每条消息携带 `from.appId`，由 Router 在主进程侧注入（沙箱内的 App 代码不能伪造发件人）：

```typescript
// 沙箱 API 层（主进程 handler）
'mailbox.send': async (toAppId, partialMessage) => {
  const message: AppMessage = {
    ...partialMessage,
    id: generateId(),
    from: { appId: currentAppName },   // 主进程注入，不信任沙箱传入
    timestamp: Date.now(),
  };
  await appMailboxRouter.send(message);
}
```

### 6.3 恶意应用防护

| 威胁 | 缓解措施 |
|------|---------|
| 越权访问 | L2 运行时 permission check，调用未声明权限 → 抛出错误 |
| 无限 Agent 启动 | `agentPool` 最大并发限制（默认 5 个/App） |
| 信箱洪水攻击 | 发送速率限制（100 msg/s/App），TTL 自动丢弃 |
| 协商劫持 | negotiation 只在双方 App 都 running 时进行，完成结果持久化到 DB |
| 本地存储滥用 | 每 App 隔离存储目录（`~/.aion/apps/{appId}/storage/`） |
| 代码注入 | 动态协商中 Agent 生成的"适配代码"不直接 eval，通过 SandboxHost.call() 受控执行 |

---

## 7. AI 开发应用的完整流程

```
用户意图："帮我做一个语音笔记 App"
          │
          ▼
[1. 需求分析]
Agent 读取 App Framework 规范文档（本文 + aion-app.json schema）
生成 App 骨架：目录结构、manifest 草稿、功能模块划分
          │
          ▼
[2. 代码生成]
Agent 生成代码，遵循规范：
- 使用 aion.agents.start() / aion.mailbox.send() API
- 在 aion-app.json 中正确声明 permissions
- 不使用未授权的 Node API（规范检查是静态 lint）
          │
          ▼
[3. 合规校验（AppValidator.validateManifest）]
- Zod schema 校验 aion-app.json
- 检查权限声明 vs 代码中实际调用（静态分析，正则匹配）
- 校验失败 → 返回错误列表给 Agent → Agent 修复 → 重新校验
          │
          ▼
[4. 打包]
Agent 调用 pack 工具：
- 压缩为 .aionapp
- 生成 SHA256 摘要
          │
          ▼
[5. 安装（本地）]
AppStoreService.installFromFile(path)
- 解压到 ~/.aion/apps/installed/{name}/
- 更新 registry.json
- 运行 lifecycle.onInstall 钩子
          │
          ▼
[6. 运行验证]
AppRuntimeManager.start(appId)
- 启动沙箱，运行 main.js
- 检查 Agent 是否正常连接
- 报告状态给用户
```

**关键约束**：第 3 步的静态校验是"不合规则拒绝安装"的实现点。校验规则来自规范文档，Agent 在生成代码时同样能读这份规范，形成闭环。

---

## 8. 与现有 Aion 架构的集成方式

### 8.1 新增模块清单

| 模块 | 路径 | 说明 |
|------|------|------|
| `AppRuntimeManager` | `src/process/apps/AppRuntimeManager.ts` | App 生命周期管理 |
| `AppMailboxRouter` | `src/process/apps/AppMailboxRouter.ts` | 信箱路由 |
| `AppStoreService` | `src/process/apps/AppStoreService.ts` | 安装/卸载/列表 |
| `AppValidator` | `src/process/apps/AppValidator.ts` | 合规校验 |
| `AionAppAPI` | `src/process/apps/AionAppAPI.ts` | 沙箱内 proxy API |
| DB migration | `src/process/services/database/migrations.ts` | 新增 `app_mailboxes` 表 |
| IPC bridge endpoints | `src/process/bridge/appBridge.ts` | Renderer ↔ Main App 管理 |

### 8.2 不修改的现有模块

- `SandboxHost` / `sandboxWorker.ts` — 直接复用，不改
- `AcpConnection` / `AcpAdapter` — 直接复用，不改
- `ExtensionManifestSchema` — 只扩展（新增字段），保持向后兼容
- `ExtensionLoader` / `ExtensionRegistry` — 直接复用，App 复用 Extension 加载路径

### 8.3 IPC Bridge 端点（新增）

```typescript
// src/process/bridge/appBridge.ts
// 请求-响应
'app.list-installed'     // UI → Main: 列出已安装 App
'app.install-file'       // UI → Main: 从文件安装
'app.uninstall'          // UI → Main: 卸载
'app.start'              // UI → Main: 启动 App
'app.stop'               // UI → Main: 停止 App
'app.get-status'         // UI → Main: 获取运行状态

// 事件推送
'app.status-changed'     // Main → UI: App 状态变化
'app.message-received'   // Main → UI: 收到跨 App 消息（供 UI 展示）
```

---

## 9. 关键风险与待决策项

### 风险

| 风险 | 等级 | 说明 |
|------|------|------|
| 动态协商质量不稳定 | 高 | Agent 协商结果依赖 LLM，可能无法达成一致，需要超时 + 人工介入机制 |
| Worker Thread 沙箱强度 | 中 | 无法完全隔离 CPU/内存，恶意 App 可影响主进程性能；V2 考虑 Child Process |
| ACP 连接数开销 | 中 | 每个 Agent 一个 ACP 连接，多 App 多 Agent 时连接数可能很大 |
| 协商记录大小 | 低 | `agentHandshakeRecord` 如果协商轮次多，payload 会很大；需要 TTL 清理 |

### 待决策（需郭总确认）

1. **动态协商是否需要人工确认节点**？即协商完成后，是否需要用户审批最终 schema 才生效？
2. **Agent 协商失败的降级策略**：超时后是直接断开还是回退到静态 schema 尝试？
3. **本地 Store 的 App 来源**：仅用户手动安装，还是 P0 就支持 Aion 内置 App 目录？
4. **Worker Thread vs Child Process**：V0 用 Worker Thread 节省成本，但沙箱强度上限；是否可接受？

---

## 10. 阶段性交付建议

| 阶段 | 交付内容 | 不包含 |
|------|---------|--------|
| P0 | aion-app.json 规范、AppRuntimeManager（单 App）、基础信箱（无协商）、本地安装/卸载 | 远程 Store、动态协商、高级权限 |
| P1 | 动态协商协议（完整流程）、高级权限 API（截屏/git）、App 间 EventBus、权限 L2 执行 | 远程发行、签名校验 |
| P2 | 远程 Store API、应用签名、Child Process 强沙箱、协商 AI 模型优化 | - |
