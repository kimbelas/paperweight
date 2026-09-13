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

/**
 * The binary's URL carries the same build stamp as the worker's own URL.
 *
 * `build-worker.mjs` bakes the stamp in. It is there for the offline service
 * worker, which answers engine requests from its cache and would otherwise
 * hand a freshly deployed worker the previous build's binary on the first
 * load after a deploy — a glue-and-binary mismatch the stamp on the worker
 * URL alone cannot prevent. A worker built without a stamp (the tests build
 * none) asks for the plain path.
 */
const WASM_URL = process.env.NEXT_PUBLIC_WORKER_STAMP
  ? `/pdfium/pdfium.wasm?v=${process.env.NEXT_PUBLIC_WORKER_STAMP}`
  : '/pdfium/pdfium.wasm';

let wasmSource: WasmSource = { url: WASM_URL };

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
