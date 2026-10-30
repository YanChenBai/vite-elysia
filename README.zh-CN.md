<h1 align="center">Vite Elysia</h1>

<p align="center">
  <a href="./README.md">English</a> · 简体中文
</p>

<p align="center">
  在 Vite 中开发 Elysia，让服务运行在独立的 Node.js 或 Bun 子进程。
</p>

<p align="center">
  HTTP · WebSocket · 文件变更重启 · Vite ModuleRunner
</p>

<p align="center">
  [<a href="#开始使用">开始使用</a>]
  [<a href="#配置">配置</a>]
  [<a href="./docs/architecture.md">运行架构与请求流转</a>]
  [<a href="#前端产物托管">前端产物托管</a>]
  [<a href="#本地开发">本地开发</a>]
</p>

基于 [env-runner](https://github.com/unjs/env-runner) 管理应用子进程，使用 [Vite](https://vite.dev) 解析和转换模块，并保留 [Elysia](https://elysiajs.com) 的 HTTP 路由与 WebSocket 行为。前端资源、API 和业务 WS 都通过 Vite 的开发地址访问。

> [!NOTE]
> `runtime` 只选择执行应用的运行时。Elysia adapter 由应用自行安装和传入，插件不注入或替换 adapter。Node.js / Bun 可执行文件也需要自行安装，并放到 PATH 中。

## 开始使用

需要 Vite 8 和 Node.js 22.18+。使用 `runtime: 'bun'` 时，还需要安装 Bun。

在 Vite 配置中注册插件：

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import elysia from 'vite-elysia';

export default defineConfig({
  plugins: [
    elysia({
      entry: 'server/app.ts',
      runtime: 'bun',
    }),
  ],
});
```

然后导出 Elysia 应用：

```ts
// server/app.ts
import { Elysia } from 'elysia';

export default new Elysia()
  .get('/api/hello', () => ({ message: 'Hello from Elysia' }))
  .ws('/ws', {
    message(ws, message) {
      ws.send(message);
    },
  });
```

> [!TIP]
> 入口只导出应用，不调用 `.listen()`。插件会在子进程中启动内部随机端口，浏览器使用 Vite 的地址访问 `/api/hello` 和 `/ws`。

<details>
<summary><strong>使用 Node.js 和自己的 adapter</strong></summary>

应用自行安装 `@elysia/node`，将插件配置改为 `runtime: 'node'`，并在创建 Elysia 时传入 adapter：

```ts
// server/app.ts
import { node } from '@elysia/node';
import { Elysia } from 'elysia';

export default new Elysia({ adapter: node() })
  .get('/api/hello', () => ({ message: 'Hello from Node.js' }))
  .ws('/ws', {
    message(ws, message) {
      ws.send(message);
    },
  });
```

WebSocket 的消息解析和能力由应用选择的 adapter 决定。仓库中的 [Node 示例](./example/app-node.ts) 为 JSON schema 显式配置了 `parse`，以适配 `@elysia/node@1.4.6` 的消息解析行为。

</details>

## 配置

```ts
elysia({
  entry: 'server/app.ts',
  runtime: 'bun',
  routes: ['/api', '/ws'],
  watch: ['server/**'],
});
```

| 配置      | 默认值            | 含义                                                         |
| --------- | ----------------- | ------------------------------------------------------------ |
| `entry`   | 必填              | 默认导出 Elysia 实例的模块，相对 Vite root 解析              |
| `runtime` | `'bun'`           | `'node'` 或 `'bun'`，两者均使用独立子进程                    |
| `routes`  | `['/api', '/ws']` | 转发的路径前缀，匹配完整路径段，不删除前缀                   |
| `watch`   | `[]`              | 额外监听的文件、目录或 glob；设为 `false` 关闭自动监听和重启 |

默认自动监听入口目录和通过 Vite 加载的源码依赖。模板、配置等额外文件可以加入 `watch`。`routes` 中的 `/api` 会匹配 `/api` 和 `/api/users`，不会匹配 `/apix`。

设置 `watch: false` 后，文件变更不会替换当前应用进程，已建立的业务 WS 保持连接。HTTP、WS 和 Vite 自身的 HMR 继续工作；手动重启 Vite 后才会加载修改后的应用。

使用 Vite+ 时，配置中的 `defineConfig` 从 `vite-plus` 导入，开发命令使用 `vp dev`。

## 重启与退出

运行流程和 HTTP、WebSocket、Vite HMR 的请求流转见 [架构文档](./docs/architecture.md)。

启动、重启和错误日志使用 Vite logger 的时间戳及前缀，项目内文件路径相对 Vite root 展示：

```text
17:23:43 [vite+] (elysia) server started. server/app.ts
17:24:04 [vite+] (elysia) server restarted. server/app.ts
```

服务端文件新增、修改和删除以 100ms 去抖并进入串行重启队列。应用模块在目标 runtime 内通过 Vite ModuleRunner 加载。

应用不可用时业务 HTTP 返回 `503`，转发异常返回 `502`，业务 WS upgrade 会关闭连接。子进程重启会断开旧业务 WS，客户端需要自行重连；连接和内存状态不会迁移，Vite 自身的 HMR 通道独立处理。

插件发送关闭消息，让应用停止服务并执行 `.onStop()`；超过 1 秒会终止旧子进程。文件变更触发的重启按队列串行执行，重启期间的新业务请求等待当前启动任务结束。

启动失败后，修正文件可再次触发启动；使用 `watch: false` 时，需要手动重启 Vite。Vite 自身重启或关闭时，也会清理业务 WS、监听器和子进程。

当前插件仅用于开发，使用 `apply: 'serve'`。生产入口、打包与部署由应用管理。

## 前端产物托管

前端由 Vite 构建，服务端源码可以直接交给 Node.js / Bun 执行。静态资源托管使用现成的 [Elysia 静态资源插件](https://elysiajs.com/plugins/static)，无需 Vite Elysia 包装静态插件或生成额外的产物 JSON。

例如，前端构建到 `dist`，在独立的生产入口中注册目录：

```ts
import { fileURLToPath } from 'node:url';

// server/production.ts
import { staticPlugin } from '@elysia/static';

import app from './app.ts';

app
  .use(
    staticPlugin({
      assets: fileURLToPath(new URL('../dist/', import.meta.url)),
      prefix: '/',
    }),
  )
  .listen(Number(process.env.PORT ?? 3000));
```

`@elysia/static` 由应用自行安装。这里复用的 `app.ts` 仍然只导出 Elysia 实例，并由应用配置需要的 adapter；开发入口继续交给 Vite Elysia 管理监听，生产入口自行调用 `.listen()`。生产运行不需要加载 Vite 配置。

产物路径相对 `import.meta.url` 定位，不依赖启动命令的工作目录。Vite 默认输出的 `index.html` 已包含构建后 JS/CSS 的引用，普通静态托管只需知道产物目录。

部署到子路径时，静态插件的 `prefix` 应与 Vite `base` 一致。SPA history 路由按需配置静态插件的 `indexHTML` 回退，并保留 API 404 和缺失 JS/CSS 的 404。所选静态插件与 Node.js / Bun adapter 的兼容性由应用验证。

直接执行服务端源码时，应使用目标 runtime 支持的语法和模块解析方式；生产入口不会经过开发期的 Vite ModuleRunner 转换。

## 本地开发

安装依赖并运行 Bun 示例：

```sh
vp install
vp run dev
```

<details>
<summary><strong>运行 Node.js 示例</strong></summary>

先设置 `ELYSIA_RUNTIME=node`。PowerShell：

```powershell
$env:ELYSIA_RUNTIME = 'node'
vp run dev
```

POSIX shell：

```sh
ELYSIA_RUNTIME=node vp run dev
```

</details>

示例提供 `GET /api/hello`、`POST /api/echo` 和 `WS /ws`。示例 WS 消息为 `{"message":"hello"}`。

构建与检查：

```sh
vp run build
vp check --fix
vp run test
```

集成验证需要 PATH 中同时存在 Node.js 和 Bun，会实际启动两种子进程，验证 HTTP/WS、文件变更重启、`watch: false`、错误恢复、Vite HMR 共存及进程退出。
