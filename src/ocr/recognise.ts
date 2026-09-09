'use client';

import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import type { Rect } from '@/engine/types';

/**
 * Reading text off a scanned page.
 *
 * A scan has no text objects: the words are pixels in a photograph. OCR
 * recovers where they are and what they say, which is what makes a scanned
 * document searchable and — combined with covering the pixels and drawing
 * replacement text — editable.
 *
 * Two things about this are worth stating plainly, because they set the honest
 * limits of the feature.
 *
 * First, OCR output is a *guess*. Every line carries a confidence, and the UI
 * shows it, because a misread word silently replacing a correct one is worse
 * than no OCR at all.
 *
 * Second, recognising text does not make the page editable by itself. The
 * original ink stays in the image. Changing a word means painting over those
 * pixels and drawing new text on top, which looks clean on a flat scan and
 * visibly patched on a grey or textured one. The app says so rather than
 * pretending the scan became a word processor.
 *
 * Everything runs locally. tesseract.js would otherwise fetch its worker, its
 * WASM core and its language model from a CDN; all three are served from
 * `public/tesseract/` instead, so the no-upload promise holds and OCR works
 * offline. See `scripts/sync-ocr.mjs`.
 */

/** Where the locally hosted assets live, relative to the page. */
function assetPaths() {
  const base = new URL('tesseract/', document.baseURI).toString();
  return {
    workerPath: `${base}worker.min.js`,
    // A specific file rather than a directory, which skips tesseract's own
    // SIMD feature detection and the four variants we do not ship.
    corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
    langPath: base,
  };
}

/**
 * Resolution to OCR at, in points-to-pixels.
 *
 * Tesseract wants roughly 300 DPI for reliable results, which would be a
 * scale of about 4.2. That makes a 35 megapixel buffer for an A4 page, so 3
 * (~216 DPI) is used instead: accuracy on printed documents is close and the
 * memory cost is less than half.
 */
export const OCR_SCALE = 3;

/** One recognised line, positioned in PDF points. */
export interface OcrLine {
  id: string;
  page: number;
  text: string;
  bounds: Rect;
  /** 0-100, as reported by the engine. */
  confidence: number;
  /**
   * Type size estimated from the line's height, in points.
   *
   * There is no font information in a scan, so this is inferred from geometry:
   * a line box is roughly the cap height plus descender, which is about 0.72
   * of the em for common text faces.
   */
  estimatedFontSize: number;
}

export interface OcrProgress {
  /** 0-1. */
  progress: number;
  /** A short phrase for the UI, e.g. "recognising text". */
  status: string;
}

/** A cached worker, so a second page does not reload the language model. */
let workerPromise: Promise<TesseractWorker> | null = null;
let currentProgress: ((p: OcrProgress) => void) | null = null;

async function getWorker(): Promise<TesseractWorker> {
  workerPromise ??= createWorker(
    'eng',
    // OEM 1 is the LSTM engine, which is what the bundled `fast` model is
    // trained for and what the shipped core supports.
    1,
    {
      ...assetPaths(),
      // The model is gzipped, and not cached to IndexedDB: it is already a
      // local file, so a second copy in the browser's storage buys nothing.
      gzip: true,
      cacheMethod: 'none',
      // Spawn the worker by its URL. The default wraps it in a blob: URL that
      // importScripts the real file, a workaround for cross-origin hosting.
      // The worker is same-origin here, and the shim would need
      // `worker-src blob:` in the Content-Security-Policy that
      // scripts/write-headers.mjs emits.
      workerBlobURL: false,
      legacyCore: false,
      legacyLang: false,
      logger: (message: { progress?: number; status?: string }) => {
        if (!currentProgress) return;
        currentProgress({
          progress: typeof message.progress === 'number' ? message.progress : 0,
          status: readableStatus(message.status ?? ''),
        });
      },
    },
  ).catch((error: unknown) => {
    // A failed start must not poison the cache, or every later attempt
    // rejects with the same stale error.
    workerPromise = null;
    throw new Error(
      error instanceof Error
        ? `The text recogniser could not start: ${error.message}`
        : 'The text recogniser could not start.',
    );
  });

  return workerPromise;
}

function readableStatus(raw: string): string {
  if (raw.includes('loading language')) return 'loading the language model';
  if (raw.includes('initializing')) return 'starting the recogniser';
  if (raw.includes('loading tesseract core')) return 'loading the recogniser';
  if (raw.includes('recognizing')) return 'reading the page';
  return raw || 'working';
}

/** Free the recogniser and its memory. */
export async function disposeOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    await (await pending).terminate();
  } catch {
    // Already gone; nothing to release.
  }
}

export interface RecogniseInput {
  page: number;
  /** RGBA pixels of the rendered page. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /**
   * Maps a point in this bitmap to PDF space. Supplied by the caller because
   * only the engine knows how rotation and the crop box affect it.
   */
  toPdf: (x: number, y: number) => { x: number; y: number };
}

/**
 * Recognise the text on a rendered page.
 *
 * Lines, not words: a line is the unit a person edits, and it matches how the
 * rest of the editor treats text.
 */
export async function recognisePage(
  input: RecogniseInput,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrLine[]> {
  const canvas = toCanvas(input);
  const worker = await getWorker();

  currentProgress = onProgress ?? null;
  try {
    const { data } = await worker.recognize(
      canvas as unknown as Parameters<TesseractWorker['recognize']>[0],
      {},
      { blocks: true, text: false, hocr: false, tsv: false },
    );

    const lines = collectLines(data);
    return lines
      .map((line, index) => toOcrLine(line, index, input))
      .filter((line): line is OcrLine => line !== null);
  } finally {
    currentProgress = null;
  }
}

/** Shape of the bits of tesseract's result that are actually used. */
interface RawBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface RawLine {
  text: string;
  confidence: number;
  bbox: RawBox;
}

/**
 * Pull the line list out of the result.
 *
 * The shape has moved between major versions — lines have lived directly on
 * the result and, more recently, under blocks and paragraphs — so both are
 * accepted rather than pinning the app to one release's layout.
 */
function collectLines(data: unknown): RawLine[] {
  const result = data as {
    lines?: RawLine[];
    blocks?: { paragraphs?: { lines?: RawLine[] }[] }[];
  };

  if (Array.isArray(result.lines) && result.lines.length > 0) return result.lines;

  const out: RawLine[] = [];
  for (const block of result.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) out.push(line);
    }
  }
  return out;
}

function toOcrLine(line: RawLine, index: number, input: RecogniseInput): OcrLine | null {
  const text = (line.text ?? '').replace(/\s+$/, '');
  if (text.trim() === '') return null;

  const box = line.bbox;
  if (!box || box.x1 <= box.x0 || box.y1 <= box.y0) return null;

  // Both corners through the caller's mapping, then re-bounded: on a rotated
  // page the corner that was top-left is not any more.
  const a = input.toPdf(box.x0, box.y0);
  const b = input.toPdf(box.x1, box.y1);
  const bounds: Rect = {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    bottom: Math.min(a.y, b.y),
    top: Math.max(a.y, b.y),
  };

  const height = bounds.top - bounds.bottom;
  if (height <= 0.5) return null;

  return {
    id: `p${input.page}-ocr${index}`,
    page: input.page,
    text,
    bounds,
    confidence: Math.max(0, Math.min(100, line.confidence ?? 0)),
    // A line box spans about cap height plus descender, roughly 0.72 em.
    estimatedFontSize: Math.max(4, Math.round((height / 0.72) * 10) / 10),
  };
}

/** Draw the engine's pixels into a canvas for tesseract to read. */
function toCanvas(input: RecogniseInput): HTMLCanvasElement | OffscreenCanvas {
  const { width, height, data } = input;

  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });

  const ctx = (canvas as HTMLCanvasElement).getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('This browser could not prepare the page for recognition.');

  ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return canvas;
}

/** A short, honest description of how much to trust a line. */
export function confidenceLabel(confidence: number): {
  label: string;
  tone: 'good' | 'fair' | 'poor';
} {
  if (confidence >= 85) return { label: 'clear', tone: 'good' };
  if (confidence >= 60) return { label: 'uncertain', tone: 'fair' };
  return { label: 'poor', tone: 'poor' };
}
