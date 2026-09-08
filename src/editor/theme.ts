/**
 * Light or dark, and which one you get.
 *
 * **Light is the default, unconditionally.** The app used to follow
 * `prefers-color-scheme`, which meant a document opened dark on a machine set
 * to dark — and a PDF is a white sheet of paper whatever the interface around
 * it is doing, so the page sat as a bright rectangle in a dark room and the
 * thumbnails with it. Paper is the subject here; the chrome should not argue
 * with it unless asked. Dark is one click away and remembered.
 *
 * ## Why this is not in the preferences store
 *
 * Everything else the app remembers lives in IndexedDB via `io/storage.ts`,
 * which is asynchronous. A theme read after the first paint is a theme the
 * user watches change, so this one goes in `localStorage`, which can be read
 * by a blocking script in the document head before anything is drawn.
 * `THEME_BOOT_SCRIPT` is that script.
 *
 * It stays on the device like everything else here.
 */

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'paperweight:theme';

export const DEFAULT_THEME: Theme = 'light';

export function readTheme(): Theme {
  try {
    // Only an explicit 'dark' counts. A missing value, a corrupted one, or a
    // value from some future version all mean the default.
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : DEFAULT_THEME;
  } catch {
    // Private windows and blocked site data both throw. Not worth reporting.
    return DEFAULT_THEME;
  }
}

export function writeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable. The choice still holds for this session.
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Stamp the stored theme before the first paint.
 *
 * Inlined into the document rather than shipped as a module, because a module
 * is fetched and a fetch is a frame, and a frame is exactly the flash of the
 * wrong theme this exists to prevent. The server already renders
 * `data-theme="light"`, so this only ever has to switch a returning user to
 * dark — which also means the page is correct with scripting disabled.
 */
export const THEME_BOOT_SCRIPT =
  `try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==='dark')` +
  `document.documentElement.dataset.theme='dark'}catch(e){}`;
