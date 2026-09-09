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

  /**
   * All three engines, because the app ships different behaviour in each and
   * for most of its life none of it was tested. `src/io/files.ts` has a
   * `<input type=file>` path commented "for Firefox and Safari", `print.ts`
   * carries a quirk for each of them, and the save-in-place button changes its
   * own label depending on the answer — none of which a Chromium-only run
   * ever exercised.
   *
   * Edge is deliberately absent. It is Chromium with the same engine and the
   * same File System Access API, so it takes the same path through every
   * branch above; a third Chromium project would spend minutes to re-prove
   * the first one. That is a claim about the code rather than about Edge, so
   * it is written down in the README rather than left implied here.
   *
   * WebKit is not Safari. It is the closest engine that can be driven in CI,
   * and it is a genuine test of layout, of the print path and of the File
   * System Access fallback. It is not a test of the service worker: Playwright
   * supports those on Chromium only, which `tests/e2e/offline.spec.ts`
   * documents where it skips.
   */
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: {
    // A plain static file server, which is all the app needs. If this is
    // enough to run it, then any static host is.
    command: 'npx serve out --listen 4173 --no-clipboard --single',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
