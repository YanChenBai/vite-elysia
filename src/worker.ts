import type { Socket } from 'node:net';

// @env node
import { createViteTransport } from 'env-runner/vite';
import { ModuleRunner, createNodeImportMeta } from 'vite/module-runner';

import type {
  AppModule,
  WorkerControlMessage,
  WorkerData,
  WorkerInitMessage,
  WorkerServer,
} from './types.ts';

const send = (message: unknown): void => {
  if (process.connected) {
    process.send?.(message);
  }
};

// env-runner's process runners deliver bootstrap data through IPC.
const init = Promise.withResolvers<WorkerData>();

const onInit = (message: WorkerInitMessage): void => {
  if (message.event !== 'init-data') {
    return;
  }

  process.off('message', onInit);
  init.resolve(JSON.parse(message.data!) as WorkerData);
};

process.on('message', onInit);
send({ event: 'request-init-data' });
const data = await init.promise;

const runner = new ModuleRunner({
  // File changes replace the whole process; module HMR must not mutate the running app.
  hmr: false,
  createImportMeta: createNodeImportMeta,
  transport: createViteTransport(
    send,
    listener => process.on('message', listener),
    data.environment,
  ),
});

let app: AppModule['default'] | undefined;

let server: WorkerServer | undefined;

let stopping = false;

const connections = new Set<Socket>();

async function stop(): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;

  try {
    if (app && 'Bun' in globalThis) {
      await app.stop(true);
    } else if (server) {
      // @elysia/node does not forward the force flag, so close its sockets explicitly.
      for (const socket of connections) {
        socket.destroy();
      }

      await server.stop(true);

      if (app) {
        for (const hook of app.event.stop ?? []) {
          await hook.fn(app);
        }
      }
    }

    await runner.close();
    send({ event: 'exit' });
  } finally {
    process.exit(0);
  }
}

process.on('disconnect', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
process.on('message', (message: WorkerControlMessage) => {
  if (message.event === 'shutdown') {
    void stop();
  }
});

try {
  app = (await runner.import<AppModule>(data.entry)).default;

  if (!app || typeof app.listen !== 'function' || typeof app.fetch !== 'function') {
    throw new TypeError('vite-elysia: entry must default-export an Elysia application.');
  }

  if (app.server) {
    throw new Error('vite-elysia: export the application without calling .listen().');
  }

  // Async Elysia plugins must finish registering routes before the listener starts.
  await app.modules;

  const listening = Promise.withResolvers<WorkerServer>();
  app.listen({ port: 0, hostname: '127.0.0.1' }, value => {
    listening.resolve(value as unknown as WorkerServer);
  });

  server = await listening.promise;
  await server.raw?.ready();

  server.raw?.node?.server?.on('connection', socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });

  const address = server.raw?.node?.server?.address();
  const port = address && typeof address === 'object' ? address.port : server.port;

  if (!port) {
    throw new Error('vite-elysia: Elysia did not report a listening port.');
  }

  send({ address: { host: '127.0.0.1', port } });
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);

  // Flush initialization failure over IPC before exiting; Vite formats the error.
  if (process.connected) {
    process.send?.({ event: 'init-error', error: message }, () => process.exit(1));
  } else {
    process.exit(1);
  }
}
