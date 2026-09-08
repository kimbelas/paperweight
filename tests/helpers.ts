import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { configureWasm, getModule } from '@/engine/module';
import { configureFonts } from '@/engine/fonts';
import { PdfDocument } from '@/engine/document';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

const require = createRequire(import.meta.url);
const FIXTURES = join(process.cwd(), 'fixtures');

let configured = false;

/**
 * Load PDFium under Node with the binary read straight from `node_modules`.
 *
 * The tests exercise the same engine code the worker runs; only where the
 * WASM bytes come from differs.
 */
export async function loadEngine(): Promise<WrappedPdfiumModule> {
  if (!configured) {
    const wasmPath = require.resolve('@embedpdf/pdfium/pdfium.wasm');
    const bytes = await readFile(wasmPath);
    configureWasm({
      binary: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    });
    // Bundled fonts are read from public/ rather than fetched, so the tests
    // exercise the same font code the browser runs.
    configureFonts({
      load: async (file) =>
        new Uint8Array(await readFile(join(process.cwd(), 'public', 'fonts', file))),
    });
    configured = true;
  }
  return getModule();
}

export async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(FIXTURES, name)));
}

/** Open a fixture and hand it to `fn`, closing it afterwards. */
export async function withFixture<T>(
  name: string,
  fn: (doc: PdfDocument, mod: WrappedPdfiumModule) => T | Promise<T>,
): Promise<T> {
  const mod = await loadEngine();
  const doc = PdfDocument.open(mod, await fixtureBytes(name));
  try {
    return await fn(doc, mod);
  } finally {
    doc.close();
  }
}

/** Open bytes directly, e.g. to re-open something just saved. */
export async function withBytes<T>(
  bytes: Uint8Array,
  fn: (doc: PdfDocument, mod: WrappedPdfiumModule) => T | Promise<T>,
): Promise<T> {
  const mod = await loadEngine();
  const doc = PdfDocument.open(mod, bytes);
  try {
    return await fn(doc, mod);
  } finally {
    doc.close();
  }
}

/** Real-world files the user dropped into `fixtures/local/`, if any. */
export async function localFixtures(): Promise<string[]> {
  try {
    const names = await readdir(join(FIXTURES, 'local'));
    return names.filter((n) => n.toLowerCase().endsWith('.pdf'));
  } catch {
    return [];
  }
}

export async function localFixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(FIXTURES, 'local', name)));
}

/**
 * Count pixels that differ between two same-sized RGBA buffers, ignoring
 * anything inside `exclude` (in bitmap coordinates).
 *
 * This backs the invariant that matters most for an editor: an edit changes
 * the region it targeted and nothing else. Comparing whole-page renders
 * before and after catches content-stream regeneration quietly reflowing or
 * dropping unrelated content, which is the failure mode that makes users stop
 * trusting the tool.
 */
export function diffPixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  exclude?: { x: number; y: number; width: number; height: number },
  tolerance = 12,
): number {
  let differing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        exclude &&
        x >= exclude.x &&
        x < exclude.x + exclude.width &&
        y >= exclude.y &&
        y < exclude.y + exclude.height
      ) {
        continue;
      }
      const i = (y * width + x) * 4;
      if (
        Math.abs(a[i] - b[i]) > tolerance ||
        Math.abs(a[i + 1] - b[i + 1]) > tolerance ||
        Math.abs(a[i + 2] - b[i + 2]) > tolerance ||
        Math.abs(a[i + 3] - b[i + 3]) > tolerance
      ) {
        differing++;
      }
    }
  }
  return differing;
}
