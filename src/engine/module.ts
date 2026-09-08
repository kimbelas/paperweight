import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';

/**
 * PDFium module lifecycle.
 *
 * The WASM binary is ~4.5 MB and the library has global state, so exactly one
 * instance is created per worker and shared. `FPDF_InitLibrary` must be called
 * once before any other entry point.
 */

let modulePromise: Promise<WrappedPdfiumModule> | null = null;

/** Where the binary lives. Overridable so Node tests can pass their own bytes. */
export interface WasmSource {
  /** URL to fetch, relative to the worker's origin. */
  url?: string;
  /** Pre-loaded bytes, used by tests running under Node. */
  binary?: ArrayBuffer;
}

let wasmSource: WasmSource = { url: '/pdfium/pdfium.wasm' };

/**
 * Point the loader at a different binary. Must be called before `getModule`.
 * Tests use this to supply bytes read from `node_modules`.
 */
export function configureWasm(source: WasmSource): void {
  if (modulePromise) {
    throw new Error('configureWasm must be called before the module is loaded.');
  }
  wasmSource = source;
}

/** Load PDFium, initialising the library on first call. */
export function getModule(): Promise<WrappedPdfiumModule> {
  modulePromise ??= load();
  return modulePromise;
}

async function load(): Promise<WrappedPdfiumModule> {
  const binary = wasmSource.binary ?? (await fetchWasm(wasmSource.url!));

  // Emscripten honours `wasmBinary`, which keeps the fetch under our control:
  // one explicit request for one explicit path, no bundler involvement and no
  // `locateFile` guesswork.
  const mod = await init({ wasmBinary: binary } as Parameters<typeof init>[0]);

  mod.FPDF_InitLibrary();
  return mod;
}

async function fetchWasm(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not load the PDF engine from ${url} (HTTP ${res.status}).`);
  }
  return res.arrayBuffer();
}
