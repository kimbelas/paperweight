import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The tests run against the built static export rather than the dev server,
 * because the things most likely to break are build-time: whether the engine
 * worker was emitted as executable JavaScript, whether the WASM binary is
 * reachable at the path the worker asks for, and whether the fonts are
 * present. A dev server can paper over all three.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // A plain static file server, which is all the app needs. If this is
    // enough to run it, then any static host is.
    command: 'npx serve out --listen 4173 --no-clipboard --single',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
