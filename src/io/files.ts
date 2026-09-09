/**
 * Opening and saving, without a server.
 *
 * The whole point of the app is that a document never leaves the machine, so
 * there is no upload path to fall back on. That makes the browser's own file
 * APIs load-bearing, and they differ: the File System Access API can save back
 * over the original file but exists only in Chromium. Everywhere else, saving
 * means downloading a new copy.
 *
 * Rather than pretend, the capability is reported so the UI can label the
 * button honestly: "Save" where in-place saving works, "Download" where it
 * does not.
 */

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** Present only where the browser supports writing back to the same file. */
  handle?: FileSystemFileHandle;
}

/** Minimal shape of the File System Access API bits used here. */
interface FilePickerWindow {
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle>;
}

function picker(): FilePickerWindow {
  return window as unknown as FilePickerWindow;
}

/** True when the browser can save over the file the user opened. */
export function canSaveInPlace(): boolean {
  return typeof picker().showSaveFilePicker === 'function';
}

const PDF_TYPES = [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }];

/** Prompt for a file. */
export async function openFile(): Promise<OpenedFile | null> {
  const show = picker().showOpenFilePicker;

  if (show) {
    try {
      const [handle] = await show({ types: PDF_TYPES, multiple: false });
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle };
    } catch (error) {
      // An abort is the user closing the dialog, which is not a failure.
      if (isAbort(error)) return null;
      throw error;
    }
  }

  return openViaInput();
}

/** The `<input type=file>` fallback, for Firefox and Safari. */
function openViaInput(): Promise<OpenedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      } catch (error) {
        reject(error);
      }
    };

    // A cancelled picker fires no event in some browsers, so nothing is
    // resolved and the promise is simply dropped. The caller treats a
    // never-resolving open as "no file chosen", which is what happened.
    input.click();
  });
}

/** Read a dropped file. */
export async function readDroppedFile(dataTransfer: DataTransfer): Promise<OpenedFile | null> {
  // On Chromium a dropped item can yield a writable handle, which means a
  // drag-and-drop open still supports saving in place.
  const items = Array.from(dataTransfer.items ?? []);
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const withHandle = item as DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
    };

    if (typeof withHandle.getAsFileSystemHandle === 'function') {
      try {
        const handle = await withHandle.getAsFileSystemHandle();
        if (handle && handle.kind === 'file') {
          const fileHandle = handle as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          if (isPdf(file)) {
            return {
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
              handle: fileHandle,
            };
          }
        }
      } catch {
        // Fall through to the plain File below.
      }
    }
  }

  const file = Array.from(dataTransfer.files ?? []).find(isPdf);
  if (!file) return null;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Write back to the file the user opened. Chromium only. */
export async function saveToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  try {
    // A fresh ArrayBuffer view is required: the transferred buffer coming back
    // from the worker may be a subarray of a larger allocation.
    await writable.write(bytes.slice().buffer as ArrayBuffer);
  } finally {
    await writable.close();
  }
}

/** Save As, using the native dialog where available. */
export async function saveAs(
  bytes: Uint8Array,
  suggestedName: string,
): Promise<FileSystemFileHandle | null> {
  const show = picker().showSaveFilePicker;

  if (show) {
    try {
      const handle = await show({ suggestedName, types: PDF_TYPES });
      await saveToHandle(handle, bytes);
      return handle;
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  }

  download(bytes, suggestedName);
  return null;
}

/** Download as a new file. The universal fallback. */
export function download(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can abort the download in some browsers, so the URL
  // is held for a while first.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Turn `report.pdf` into `report (edited).pdf`. */
export function editedName(name: string | null): string {
  if (!name) return 'document (edited).pdf';
  const base = name.replace(/\.pdf$/i, '');
  return `${base} (edited).pdf`;
}
