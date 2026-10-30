import type { Plugin } from 'vite';

import { ElysiaEnvironment } from './server.ts';
import type { ElysiaOptions } from './types.ts';

export type { ElysiaOptions, ElysiaRuntime } from './types.ts';

/**
 * Integrate a child-process Elysia server without affecting production builds.
 */
export default function elysia(options: ElysiaOptions): Plugin {
  return {
    name: 'vite-elysia',
    apply: 'serve',

    config() {
      return {
        environments: {
          elysia: {
            consumer: 'server',
            resolve: {
              // Match package exports to the child runtime rather than the Vite host.
              conditions:
                options.runtime === 'node'
                  ? ['node', 'development']
                  : ['bun', 'node', 'development'],
            },

            dev: {
              createEnvironment: (name, config) => new ElysiaEnvironment(name, config, options),
            },
          },
        },
      };
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const environment = server.environments.elysia as ElysiaEnvironment;

        if (!environment.matches(req.url ?? '/')) {
          return next();
        }

        void environment.handle(req, res).catch(next);
      });
    },

    hotUpdate() {
      // Server updates replace the process; module HMR must not re-evaluate the app.
      if (this.environment.name === 'elysia') {
        return [];
      }
    },
  };
}
