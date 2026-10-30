<h1 align="center">Vite Elysia</h1>

<p align="center">
  English · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  Develop Elysia with Vite, running your server in a separate Node.js or Bun process.
</p>

<p align="center">
  HTTP · WebSocket · Restart on changes · Vite ModuleRunner
</p>

<p align="center">
  [<a href="#getting-started">Getting started</a>]
  [<a href="#configuration">Configuration</a>]
  [<a href="./docs/architecture.md">Architecture &amp; request flow</a>]
  [<a href="#serving-frontend-builds">Serving frontend builds</a>]
  [<a href="#local-development">Local development</a>]
</p>

Vite Elysia uses [env-runner](https://github.com/unjs/env-runner) to manage application processes and [Vite](https://vite.dev) to resolve and transform modules. Your [Elysia](https://elysiajs.com) app handles HTTP routes and WebSockets, while frontend assets, APIs, and business WebSockets share Vite's development address.

> [!NOTE]
> `runtime` only selects the executable that runs your application. Install and configure your own Elysia adapter; Vite Elysia does not inject or replace it. Install Node.js / Bun separately and make the required executables available on PATH.

## Getting started

Requires Vite 8 and Node.js 22.18+. Install Bun as well when using `runtime: 'bun'`.

Register the plugin in your Vite configuration:

```ts
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

Export an Elysia application from `server/app.ts`:

```ts
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
> Export the application without calling `.listen()`. Vite Elysia starts the child server on an internal random port. Access `/api/hello` and `/ws` through Vite's address.

<details>
<summary><strong>Using Node.js with your own adapter</strong></summary>

Install `@elysia/node`, set `runtime: 'node'` in the Vite plugin options, and pass the adapter when creating Elysia:

```ts
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

WebSocket parsing and capabilities depend on the selected adapter. The [Node example](./example/app-node.ts) explicitly configures `parse` for JSON schema validation with `@elysia/node@1.4.6`.

</details>

## Configuration

```ts
elysia({
  entry: 'server/app.ts',
  runtime: 'bun',
  routes: ['/api', '/ws'],
  watch: ['server/**'],
});
```

| Option    | Default           | Description                                                                          |
| --------- | ----------------- | ------------------------------------------------------------------------------------ |
| `entry`   | Required          | Module default-exporting an Elysia application, resolved relative to Vite root       |
| `runtime` | `'bun'`           | `'node'` or `'bun'`; both run in separate child processes                            |
| `routes`  | `['/api', '/ws']` | Forwarded path prefixes, matched on path segment boundaries without rewriting        |
| `watch`   | `[]`              | Extra files, directories, or globs; `false` disables automatic watching and restarts |

The entry directory and source dependencies loaded through Vite participate in automatic restarts. Add templates or other configuration files to `watch`. A `/api` route prefix matches `/api` and `/api/users`, but not `/apix`.

With `watch: false`, file changes leave the application process and existing business WebSockets running. HTTP, WebSockets, and Vite's own HMR remain available. Restart Vite manually to load application changes.

For Vite+, import `defineConfig` from `vite-plus` and use `vp dev`.

## Restart and shutdown

See [Architecture & request flow](./docs/architecture.md) for the startup/restart diagram and the HTTP, WebSocket, and Vite HMR sequence diagram.

Startup, restart, and error messages use Vite's logger, timestamps, and prefix. Project file paths are relative to Vite root:

```text
17:23:43 [vite+] (elysia) server started. server/app.ts
17:24:04 [vite+] (elysia) server restarted. server/app.ts
```

Server file additions, modifications, and deletions are debounced for 100ms and processed through a serial restart queue. Application modules are evaluated in the target runtime through Vite ModuleRunner. New application requests wait for the current startup or restart task.

Vite Elysia sends a shutdown message to stop the application and run `.onStop()`. The previous child process is terminated if it does not close within one second. Vite restart and shutdown also clean up business WebSockets, listeners, and child processes.

An unavailable application returns HTTP `503`; forwarding failures return `502`. Business WebSocket upgrades are closed when the application is unavailable.

> [!NOTE]
> Restarting the child disconnects existing business WebSockets. Clients must reconnect; connection state and application memory do not migrate to the new process. Vite's own HMR channel is handled separately.

After a failed startup, fixing a watched file can start the application again. With `watch: false`, restart Vite manually.

Vite Elysia is a development plugin using `apply: 'serve'`. Production entry points, builds, and deployment are managed by the application.

## Serving frontend builds

Build the frontend with Vite and run server source directly with Node.js / Bun. Use the existing [Elysia static plugin](https://elysiajs.com/plugins/static) to serve the frontend output. No Vite Elysia wrapper or additional build metadata JSON is needed.

For frontend output in `dist`, register that directory in a separate production entry:

```ts
import { fileURLToPath } from 'node:url';

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

Install `@elysia/static` in your application. The shared `app.ts` still exports an Elysia instance with its user-selected adapter. Vite Elysia manages listening during development; the production entry calls `.listen()` itself and does not load Vite configuration.

Resolve the output directory relative to `import.meta.url` so deployment does not depend on the working directory. Vite's generated `index.html` already references the built JS/CSS files; regular static hosting only needs the output directory.

For deployment under a subpath, align the static plugin's `prefix` with Vite's `base`. Configure `indexHTML` fallback only when needed for SPA history routes, preserving API 404s and missing JS/CSS 404s. Verify compatibility between your static plugin, runtime, and adapter.

Server source executed directly in production must use syntax and module resolution supported by that runtime; it does not pass through the development ModuleRunner.

## Local development

Install dependencies and start the Bun example:

```sh
vp install
vp run dev
```

<details>
<summary><strong>Running the Node.js example</strong></summary>

Set `ELYSIA_RUNTIME=node`. In PowerShell:

```powershell
$env:ELYSIA_RUNTIME = 'node'
vp run dev
```

In a POSIX shell:

```sh
ELYSIA_RUNTIME=node vp run dev
```

</details>

The examples provide `GET /api/hello`, `POST /api/echo`, and `WS /ws`. Send `{"message":"hello"}` to the example WebSocket.

Build and check the project:

```sh
vp run build
vp check --fix
vp run test
```

Integration checks require both Node.js and Bun on PATH. They start real child processes and exercise HTTP/WS, file-triggered restarts, `watch: false`, error recovery, Vite HMR coexistence, and process cleanup.
