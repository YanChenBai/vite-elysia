import type { Server as HttpServer } from 'node:http';

import type { AnyElysia } from 'elysia';

/**
 * Runtime executable used to launch an isolated application process.
 */
export type ElysiaRuntime = 'node' | 'bun';

/**
 * Development server options; the application owns its Elysia adapter.
 */
export interface ElysiaOptions {
  /**
   * Entry relative to Vite root, default-exporting an app without calling listen().
   */
  entry: string;

  /**
   * Child process runtime, independent of Vite's runtime. Defaults to bun.
   */
  runtime?: ElysiaRuntime;

  /**
   * Path prefixes forwarded without rewriting. Defaults to /api and /ws.
   */
  routes?: string[];

  /**
   * Extra watch paths relative to Vite root; false disables all automatic restarts.
   */
  watch?: false | string[];
}

/**
 * Bootstrap data serialized by env-runner and delivered to the child over IPC.
 */
export interface WorkerData {
  /**
   * Absolute application entry resolved by the Vite host.
   */
  entry: string;

  /**
   * Vite environment name used to namespace module-loading messages.
   */
  environment: string;
}

/**
 * Initial data response received through env-runner's process handshake.
 */
export interface WorkerInitMessage {
  /**
   * Only init-data completes the handshake; other IPC messages are ignored here.
   */
  event?: string;

  /**
   * JSON-serialized WorkerData, present on init-data messages.
   */
  data?: string;
}

/**
 * Lifecycle message sharing the IPC channel with Vite's module transport.
 */
export interface WorkerControlMessage {
  /**
   * shutdown requests application cleanup before the parent terminates the process.
   */
  event?: string;
}

/**
 * Listener information returned by the application's Elysia adapter.
 */
export interface WorkerServer {
  /**
   * Bound port reported directly by Bun; Node's actual port is read from raw.
   */
  port: number;

  /**
   * Stop accepting requests, optionally terminating active connections.
   */
  stop(force?: boolean): unknown;

  /**
   * Native server access supplied by adapters such as @elysia/node.
   */
  raw?: {
    /**
     * Resolves once the underlying listener has bound its address.
     */
    ready(): Promise<unknown>;

    /**
     * Node-specific listener context, absent for Bun's native server.
     */
    node?: {
      /**
       * HTTP server used to read the actual port and track active connections.
       */
      server?: HttpServer;
    };
  };
}

/**
 * Module shape expected when the child evaluates the application entry.
 */
export interface AppModule {
  /**
   * User-created Elysia application, including any user-selected adapter.
   */
  default: AnyElysia;
}
