# Architecture / 运行架构

[English README](../README.md) · [简体中文](../README.zh-CN.md)

## Process lifecycle / 运行流程

Vite transforms application modules in the host process. A separate Node.js or Bun process loads them over IPC and starts Elysia with the user-selected adapter. File changes enter a serial restart queue when watching is enabled.

Vite 主进程转换应用模块，独立的 Node.js 或 Bun 子进程通过 IPC 加载模块，并使用用户配置的 adapter 启动 Elysia。启用监听时，文件变更进入串行重启队列。

```mermaid
flowchart TD
  Start[启动 Vite] --> Environment[创建 Elysia environment]
  Environment --> Spawn[启动 Node.js 或 Bun 子进程]
  Spawn --> Load[ModuleRunner 通过 IPC 向 Vite 加载应用模块]
  Load --> Listen[Elysia 使用用户配置的 adapter 监听内部随机端口]
  Listen --> Ready[向主进程报告地址并进入 ready 状态]

  Change[服务端文件新增、修改或删除] --> Watch{是否启用 watch}
  Watch -->|否| Keep[保持当前应用进程]
  Watch -->|是| Queue[100ms 去抖并进入串行重启队列]
  Queue --> Retire[断开业务 WS、失效模块缓存并关闭旧进程]
  Retire --> Spawn

  Ready -->|Vite 关闭或自身重启| Dispose[移除监听器、关闭业务连接和子进程]
```

## Request flow / 请求流转

Matching HTTP requests and business WebSocket upgrades are forwarded to the active application process. Frontend assets and Vite HMR remain with Vite. The public address stays stable while internal ports can change across restarts.

匹配的 HTTP 请求和业务 WebSocket upgrade 转发给当前应用进程。前端资源与 Vite HMR 仍由 Vite 处理；公开地址保持不变，内部端口可以随重启变化。

```mermaid
sequenceDiagram
  participant Browser as 浏览器
  participant Vite as Vite / Vite Elysia
  participant Runner as env-runner
  participant App as 子进程中的 Elysia

  alt HTTP 请求匹配 routes
    Browser->>Vite: GET /api/hello 或其他业务 HTTP 请求
    Note over Vite,Runner: 等待当前启动或重启任务结束
    Vite->>Runner: NodeRequest 转为 Fetch 请求
    Runner->>App: 转发到当前子进程的内部端口，保留原路径
    App-->>Runner: Response
    Runner-->>Vite: 返回响应
    Vite-->>Browser: 写回状态码、响应头和响应体
  else 业务 WS upgrade 匹配 routes
    Browser->>Vite: Upgrade /ws
    Note over Vite,Runner: 排除 Vite HMR 协议，并等待应用 ready
    Vite->>Runner: 转交原始 upgrade 请求和 socket
    Runner->>App: 代理 WebSocket 握手
    App-->>Browser: 经代理返回握手结果
    loop 连接存续期间
      Browser->>App: 经代理发送 WebSocket 消息
      App-->>Browser: 经代理返回 WebSocket 消息
    end
  else 前端资源或 Vite HMR
    Browser->>Vite: 其他 HTTP 路径或 vite-hmr / vite-ping 协议
    Vite-->>Browser: 由 Vite 或后续中间件处理
  end
```

New application requests wait for the current startup or restart task. An unavailable application returns HTTP 503; forwarding errors return 502. Business WebSockets are closed when the application is unavailable or restarted, and clients must reconnect.

新业务请求等待当前启动或重启任务。应用不可用时 HTTP 返回 503，转发异常返回 502。应用不可用或重启时业务 WS 会关闭，客户端需要自行重连。
