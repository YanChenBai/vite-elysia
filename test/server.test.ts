import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import elysia from 'vite-elysia';
import { createServer } from 'vite-plus';
import { describe, it, expect, vi } from 'vite-plus/test';

import type { ServerState } from './types.ts';

async function connect(url: string, protocol?: string): Promise<WebSocket> {
  const socket = new WebSocket(url, protocol);
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
  return socket;
}

async function message(socket: WebSocket, value: unknown): Promise<unknown> {
  const response = once(socket, 'message', { signal: AbortSignal.timeout(5000) });
  socket.send(JSON.stringify(value));
  const [event] = await response;
  return JSON.parse((event as MessageEvent<string>).data);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.each(['node', 'bun'] as const)('%s child process', runtime => {
  it('serves HTTP and validated WS, restarts dependencies, recovers from errors, and closes', async () => {
    const root = await mkdtemp(resolve('.elysia-test-'));
    const directory = join(root, 'server');
    await mkdir(directory);
    const dependency = join(root, 'value.ts');
    await writeFile(dependency, 'export const value = "before";');
    const entry = join(directory, 'app.ts');

    const source = `
      import { Elysia, t } from "elysia";
      import { appendFileSync, existsSync } from "node:fs";
      const stopLog = new URL("../stopped.txt", import.meta.url);
      ${runtime === 'node' ? 'import { node } from "@elysia/node";' : ''}
      import { value } from "../value.ts";
      export default new Elysia(${runtime === 'node' ? '{ adapter: node() }' : ''})
        .onStop(() => { appendFileSync(stopLog, String(process.pid) + "\\n"); })
        .get("/api/state", () => ({ value, pid: process.pid, runtime: "Bun" in globalThis ? "bun" : "node" }))
        .post("/api/echo", ({ body }) => body)
        .get("/api/flag", () => ({ exists: existsSync(new URL("./flag.txt", import.meta.url)), pid: process.pid }))
        .ws("/ws", {
          body: t.Object({ message: t.String() }),
          parse(_ws, message) { return typeof message === "string" ? JSON.parse(message) : message; },
          message(ws, data) { ws.send({ ...data, value, pid: process.pid }); }
        });
    `;

    await writeFile(entry, source);

    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [elysia({ runtime, entry: 'server/app.ts' })],
      server: {
        host: '127.0.0.1',
        port: 0,
        watch: { awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 } },
      },
    });

    const sockets: WebSocket[] = [];
    const pids = new Set<number>();

    try {
      await server.listen();
      const address = server.httpServer!.address();

      if (!address || typeof address === 'string') {
        throw new Error('Missing Vite listener');
      }

      const base = `http://127.0.0.1:${address.port}`;

      const readState = async (): Promise<ServerState> => {
        const response = await fetch(`${base}/api/state`);
        expect(response.status).toBe(200);
        return response.json();
      };

      const first = await readState();
      pids.add(first.pid);
      expect(first).toMatchObject({ value: 'before', runtime });
      expect(first.pid).not.toBe(process.pid);
      const payload = { nested: { value: 'body' }, list: [1, 2, 3] };

      const post = await fetch(`${base}/api/echo`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
      });

      expect(await post.json()).toEqual(payload);
      expect((await fetch(`${base}/api/missing`)).status).toBe(404);
      const ws = await connect(`${base.replace('http:', 'ws:')}/ws`);
      sockets.push(ws);
      expect(await message(ws, { message: 'hello' })).toEqual({
        message: 'hello',
        value: 'before',
        pid: first.pid,
      });
      const invalid = await message(ws, { message: 123 });
      expect(invalid).toMatchObject({ type: 'validation', on: 'message' });

      const hmr = await connect(
        `${base.replace('http:', 'ws:')}/?token=${server.config.webSocketToken}`,
        'vite-hmr',
      );

      sockets.push(hmr);
      const disconnected = once(ws, 'close', { signal: AbortSignal.timeout(10000) });
      await writeFile(dependency, 'export const value = "after";');
      await vi.waitFor(
        async () => {
          const state = await readState();
          expect(state.value).toBe('after');
          expect(state.pid).not.toBe(first.pid);
          pids.add(state.pid);
        },
        { timeout: 10000 },
      );
      await disconnected;
      expect(hmr.readyState).toBe(WebSocket.OPEN);
      await vi.waitFor(() => expect(alive(first.pid)).toBe(false));
      expect((await readFile(join(root, 'stopped.txt'), 'utf8')).split('\n')).toContain(
        String(first.pid),
      );
      const reconnected = await connect(`${base.replace('http:', 'ws:')}/ws`);
      sockets.push(reconnected);
      expect(await message(reconnected, { message: 'new' })).toMatchObject({
        message: 'new',
        value: 'after',
      });
      const flag = join(directory, 'flag.txt');
      let previousPid = (await readState()).pid;
      await writeFile(flag, 'created');
      await vi.waitFor(
        async () => {
          const response = await fetch(`${base}/api/flag`);
          const state = await response.json();
          expect(state.exists).toBe(true);
          expect(state.pid).not.toBe(previousPid);
          pids.add(state.pid);
        },
        { timeout: 10000 },
      );
      previousPid = (await readState()).pid;
      await rm(flag);
      await vi.waitFor(
        async () => {
          const response = await fetch(`${base}/api/flag`);
          const state = await response.json();
          expect(state.exists).toBe(false);
          expect(state.pid).not.toBe(previousPid);
          pids.add(state.pid);
        },
        { timeout: 10000 },
      );

      await writeFile(entry, 'export default ;');
      await vi.waitFor(async () => expect((await fetch(`${base}/api/state`)).status).toBe(503), {
        timeout: 10000,
      });
      await writeFile(entry, source);
      await vi.waitFor(
        async () => {
          const state = await readState();
          expect(state.value).toBe('after');
          pids.add(state.pid);
        },
        { timeout: 10000 },
      );

      for (const socket of sockets) {
        socket.close();
      }

      await server.restart();
      const restarted = await readState();
      expect(pids.has(restarted.pid)).toBe(false);
      pids.add(restarted.pid);
    } finally {
      for (const socket of sockets) {
        socket.close();
      }

      await server.close();
      await rm(root, { recursive: true, force: true });
    }

    await vi.waitFor(() => {
      for (const pid of pids) {
        expect(alive(pid)).toBe(false);
      }
    });
  }, 45000);

  it('keeps the running application and WS when watch is false until Vite restarts', async () => {
    const root = await mkdtemp(resolve('.elysia-test-'));
    const entry = join(root, 'app.ts');

    const source = `
      import { Elysia } from "elysia";
      ${runtime === 'node' ? 'import { node } from "@elysia/node";' : ''}
      const value = "before";
      export default new Elysia(${runtime === 'node' ? '{ adapter: node() }' : ''})
        .get("/api/state", () => ({ value, pid: process.pid }))
        .ws("/ws", { message(ws) { ws.send({ value, pid: process.pid }); } });
    `;

    await writeFile(entry, source);

    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [elysia({ runtime, entry: 'app.ts', watch: false })],
      server: { host: '127.0.0.1', port: 0 },
    });

    const sockets: WebSocket[] = [];
    const pids = new Set<number>();

    try {
      await server.listen();
      const address = server.httpServer!.address();

      if (!address || typeof address === 'string') {
        throw new Error('Missing Vite listener');
      }

      const base = `http://127.0.0.1:${address.port}`;
      const first = await (await fetch(`${base}/api/state`)).json();
      pids.add(first.pid);
      const ws = await connect(`${base.replace('http:', 'ws:')}/ws`);
      sockets.push(ws);
      const changed = once(server.watcher, 'change', { signal: AbortSignal.timeout(5000) });
      await writeFile(entry, source.replace('"before"', '"after"'));
      await changed;
      // Wait beyond the restart debounce after Vite has observed the file change.
      await delay(300);
      expect(await (await fetch(`${base}/api/state`)).json()).toEqual(first);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(await message(ws, 'state')).toEqual(first);

      ws.close();
      await server.restart();
      const after = await (await fetch(`${base}/api/state`)).json();
      pids.add(after.pid);
      expect(after.value).toBe('after');
      expect(after.pid).not.toBe(first.pid);
    } finally {
      for (const socket of sockets) {
        socket.close();
      }

      await server.close();
      await rm(root, { recursive: true, force: true });
    }

    await vi.waitFor(() => {
      for (const pid of pids) {
        expect(alive(pid)).toBe(false);
      }
    });
  }, 20000);
});
