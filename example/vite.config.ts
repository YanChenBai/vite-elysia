import { defineConfig, lazyPlugins } from 'vite-plus';

import elysia from '../src/index.ts';
const runtime = process.env.ELYSIA_RUNTIME === 'node' ? 'node' : 'bun';

export default defineConfig({
  plugins: lazyPlugins(() => [
    elysia({ entry: runtime === 'node' ? 'example/app-node.ts' : 'example/app.ts', runtime }),
  ]),
});
