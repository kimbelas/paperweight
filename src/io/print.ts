/**
 * Printing.
 *
 * The real PDF bytes are handed to the browser's own PDF viewer inside a
 * hidden iframe, which is then asked to print. This keeps vectors as vectors
 * and embedded fonts as fonts. The alternative — rasterising each page to a
 * canvas and printing images — is a fallback, not the default, because it
 * prints a photograph of the document instead of the document.
 *
 * Three browser quirks shape the code, all of them load-bearing:
 *
 *  - Firefox re-fetches the blob URL while building the print preview, so the
 *    URL must not be revoked when `print()` returns. Revoking early yields a
 *    blank preview.
 *  - Safari ignores `print()` on a `display: none` iframe. It is positioned
 *    off-screen instead, which keeps it laid out.
 *  - The iframe's PDF viewer needs a moment after `load` before it will
 *    print, so there is a short settle delay and a timeout that falls back.
 */

/** How long to wait for the embedded viewer to be ready to print. */
const LOAD_TIMEOUT_MS = 12_000;
/** Grace period after load before calling print. */
const SETTLE_MS = 250;
/** How long the blob URL and frame are kept alive after printing starts. */
const CLEANUP_DELAY_MS = 60_000;

export interface PrintResult {
  /** How the print dialog was reached. */
  method: 'iframe' | 'tab';
  /** Set when the dialog could not be opened automatically. */
  hint?: string;
}

/**
 * Print a PDF.
 *
 * Resolves once the print dialog has been requested, which is the last moment
 * the page can observe: whether the user then prints or cancels is not visible
 * to script.
 */
export async function printPdf(bytes: Uint8Array): Promise<PrintResult> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  try {
    await printViaIframe(url);
    return { method: 'iframe' };
  } catch {
    // Safari in particular refuses to drive a frame's print dialog. Opening
    // the document in a tab and telling the user to press the shortcut is
    // less magical but it works, and it beats a silent no-op.
    const opened = window.open(url, '_blank');
    if (!opened) {
      URL.revokeObjectURL(url);
      throw new Error(
        'Printing needs a new tab, and the browser blocked it. Allow pop-ups for this page, or download the file and print it from your PDF viewer.',
      );
    }
    scheduleCleanup(url, null);
    return {
      method: 'tab',
      hint: 'The document opened in a new tab. Press Ctrl+P (or Cmd+P) there to print it.',
    };
  }
}

function printViaIframe(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');

    // Off-screen rather than hidden: a display:none frame does not print in
    // Safari, and a zero-size one can fail to lay out its PDF viewer.
    frame.style.position = 'fixed';
    frame.style.right = '100%';
    frame.style.bottom = '100%';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.border = '0';
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'Print preview';

    let settled = false;

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      frame.remove();
      reject(new Error('The print preview did not load in time.'));
    }, LOAD_TIMEOUT_MS);

    frame.onload = () => {
      // Give the embedded viewer a moment to become interactive.
      window.setTimeout(() => {
        if (settled) return;
        try {
          const view = frame.contentWindow;
          if (!view) throw new Error('The print frame is unavailable.');

          view.focus();
          view.print();

          settled = true;
          window.clearTimeout(timeout);
          scheduleCleanup(url, frame);
          resolve();
        } catch (error) {
          settled = true;
          window.clearTimeout(timeout);
          frame.remove();
          reject(error instanceof Error ? error : new Error('Printing failed.'));
        }
      }, SETTLE_MS);
    };

    frame.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      frame.remove();
      reject(new Error('The document could not be loaded for printing.'));
    };

    document.body.append(frame);
    frame.src = url;
  });
}

/**
 * Tear down well after the dialog has opened.
 *
 * The print dialog is modal but not synchronous from the page's point of
 * view, and Firefox reads the blob again while rendering the preview, so
 * nothing may be released promptly.
 */
function scheduleCleanup(url: string, frame: HTMLIFrameElement | null): void {
  window.setTimeout(() => {
    frame?.remove();
    URL.revokeObjectURL(url);
  }, CLEANUP_DELAY_MS);
}
