import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The browser suite against the deployment, not just a static server.
 *
 * `wrangler dev` serves `out/` the way Cloudflare will: the same asset routing
 * and the same response headers from `out/_headers`, including the
 * Content-Security-Policy. The plain static server in the base config proves
 * the app needs nothing more than files; this proves the files also work
 * under the headers they ship with. Every spec runs here, because a policy
 * that breaks one feature — a worker, a font, a blob: frame — only shows up
 * when that feature is exercised, and `tests/deploy/` adds the checks that
 * only make sense with the headers present.
 *
 * `pnpm test:e2e:deploy`. This is what CI runs before deploying.
 */
const PORT = 4174;

export default defineConfig({
  ...base,
  testDir: './tests',
  testMatch: ['e2e/**/*.spec.ts', 'deploy/**/*.spec.ts'],
  use: { ...base.use, baseURL: `http://127.0.0.1:${PORT}` },

  webServer: {
    command: `pnpm exec wrangler dev --port ${PORT} --ip 127.0.0.1 --log-level warn`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Wrangler starts its local runtime on first use, which can be slow.
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
