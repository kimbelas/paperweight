import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import * as fontkit from 'fontkit';
import { FontType } from './constants';
import type { PdfDocument } from './document';
import { withScope } from './memory';
import type { CoverageResult, FontDescriptor } from './types';

/**
 * Fonts: can the original render the new text, and if not, what should?
 *
 * This is the part of text editing that actually decides whether the result
 * looks right. A PDF embeds font *subsets*: a font included for the word
 * "Invoice" contains glyphs for I, n, v, o, i, c and e, and nothing else.
 * Typing "Payment" into it produces missing glyphs, and there is no way to
 * extend a subset without rebuilding the embedded font program, patching
 * /Widths, /Differences and possibly /ToUnicode. That is where hand-rolled
 * editors go wrong, so it is not attempted.
 *
 * Instead: check coverage first, reuse the original font when it can render
 * the text, and otherwise substitute a metric-compatible font and *say so*.
 * Silent substitution is what makes other editors mangle documents while
 * appearing to work.
 */

/** The bundled fallback set. Metric-compatible with the fonts they replace. */
export interface FallbackFont {
  key: string;
  file: string;
  /** What this is a metric-compatible stand-in for. */
  standsFor: string;
  serif: boolean;
  mono: boolean;
  bold: boolean;
  italic: boolean;
  /** A CSS stack for the on-screen editor overlay. */
  cssStack: string;
}

export const FALLBACK_FONTS: FallbackFont[] = [
  // Liberation Sans/Serif/Mono are glyph-width-identical to Arial, Times New
  // Roman and Courier New, so replacement text in a document set in any of
  // those occupies the same space as the original.
  f('sans', 'LiberationSans-Regular.ttf', 'Arial, Helvetica', false, false, false, false),
  f('sans-bold', 'LiberationSans-Bold.ttf', 'Arial Bold', false, false, true, false),
  f('sans-italic', 'LiberationSans-Italic.ttf', 'Arial Italic', false, false, false, true),
  f('sans-bolditalic', 'LiberationSans-BoldItalic.ttf', 'Arial Bold Italic', false, false, true, true),
  f('serif', 'LiberationSerif-Regular.ttf', 'Times New Roman', true, false, false, false),
  f('serif-bold', 'LiberationSerif-Bold.ttf', 'Times New Roman Bold', true, false, true, false),
  f('serif-italic', 'LiberationSerif-Italic.ttf', 'Times New Roman Italic', true, false, false, true),
  f('serif-bolditalic', 'LiberationSerif-BoldItalic.ttf', 'Times New Roman Bold Italic', true, false, true, true),
  f('mono', 'LiberationMono-Regular.ttf', 'Courier New', false, true, false, false),
  f('mono-bold', 'LiberationMono-Bold.ttf', 'Courier New Bold', false, true, true, false),
  f('mono-italic', 'LiberationMono-Italic.ttf', 'Courier New Italic', false, true, false, true),
  f('mono-bolditalic', 'LiberationMono-BoldItalic.ttf', 'Courier New Bold Italic', false, true, true, true),
];

/** Script faces offered for typed signatures. */
export const SIGNATURE_FONTS: FallbackFont[] = [
  {
    key: 'script-dancing',
    file: 'DancingScript-Variable.ttf',
    standsFor: 'Dancing Script',
    serif: false,
    mono: false,
    bold: false,
    italic: false,
    cssStack: '"Dancing Script", cursive',
  },
  {
    key: 'script-vibes',
    file: 'GreatVibes-Regular.ttf',
    standsFor: 'Great Vibes',
    serif: false,
    mono: false,
    bold: false,
    italic: false,
    cssStack: '"Great Vibes", cursive',
  },
  {
    key: 'script-caveat',
    file: 'Caveat-Variable.ttf',
    standsFor: 'Caveat',
    serif: false,
    mono: false,
    bold: false,
    italic: false,
    cssStack: 'Caveat, cursive',
  },
];

function f(
  key: string,
  file: string,
  standsFor: string,
  serif: boolean,
  mono: boolean,
  bold: boolean,
  italic: boolean,
): FallbackFont {
  const stack = mono
    ? '"Liberation Mono", "Courier New", monospace'
    : serif
      ? '"Liberation Serif", "Times New Roman", serif'
      : '"Liberation Sans", Arial, sans-serif';
  return { key, file, standsFor, serif, mono, bold, italic, cssStack: stack };
}

export function findFallback(key: string): FallbackFont | undefined {
  return FALLBACK_FONTS.find((x) => x.key === key) ?? SIGNATURE_FONTS.find((x) => x.key === key);
}

/**
 * Pick the closest bundled face for a font we cannot reuse.
 *
 * Category first (mono, then serif, else sans), then weight and slope. Getting
 * the category right matters far more than the exact face: a serif document
 * rendered in a sans fallback is instantly obvious, while Liberation Serif
 * standing in for Georgia is not.
 */
export function chooseFallback(font: FontDescriptor): FallbackFont {
  const wantMono = font.isFixedPitch;
  const wantSerif = !wantMono && font.isSerif;
  const suffix =
    font.isBold && font.isItalic
      ? '-bolditalic'
      : font.isBold
        ? '-bold'
        : font.isItalic
          ? '-italic'
          : '';
  const base = wantMono ? 'mono' : wantSerif ? 'serif' : 'sans';
  return findFallback(`${base}${suffix}`) ?? FALLBACK_FONTS[0];
}

/** Where font files come from. Overridable so Node tests can read from disk. */
export interface FontSource {
  /** Directory URL, e.g. `/fonts/`. */
  baseUrl?: string;
  /** Direct loader, used by tests. */
  load?: (file: string) => Promise<Uint8Array>;
}

let fontSource: FontSource = { baseUrl: '/fonts/' };

export function configureFonts(source: FontSource): void {
  fontSource = source;
  fileCache.clear();
}

const fileCache = new Map<string, Promise<Uint8Array>>();

/** Fetch a bundled font file, cached. Files are ~400 KB, so never eagerly. */
export function loadFontFile(file: string): Promise<Uint8Array> {
  let pending = fileCache.get(file);
  if (!pending) {
    pending = fontSource.load
      ? fontSource.load(file)
      : fetch(`${fontSource.baseUrl}${file}`).then(async (res) => {
          if (!res.ok) throw new Error(`Could not load the font ${file} (HTTP ${res.status}).`);
          return new Uint8Array(await res.arrayBuffer());
        });
    fileCache.set(file, pending);
  }
  return pending;
}

/**
 * Extract an embedded font program from the document.
 *
 * Returns null when the font is not embedded, in which case there is no
 * program to inspect and coverage cannot be established from the file alone.
 */
export function getEmbeddedFontData(
  mod: WrappedPdfiumModule,
  fontHandle: number,
): Uint8Array | null {
  if (!fontHandle || mod.FPDFFont_GetIsEmbedded(fontHandle) !== 1) return null;

  return withScope(mod, (scope) => {
    const sizePtr = scope.alloc(4);
    if (!mod.FPDFFont_GetFontData(fontHandle, 0, 0, sizePtr)) return null;
    const size = mod.pdfium.getValue(sizePtr, 'i32');
    if (size <= 0) return null;

    const buffer = scope.alloc(size);
    if (!mod.FPDFFont_GetFontData(fontHandle, buffer, size, sizePtr)) return null;

    const out = new Uint8Array(size);
    out.set(mod.pdfium.HEAPU8.subarray(buffer, buffer + size));
    return out;
  });
}

interface ParsedFont {
  hasGlyphForCodePoint(cp: number): boolean;
  unitsPerEm: number;
  layout(text: string): { advanceWidth: number };
}

/** Parse a font program with fontkit, tolerating the formats it cannot read. */
function parseFont(data: Uint8Array): { font: ParsedFont | null; reason?: string } {
  try {
    const parsed = fontkit.create(data as unknown as Buffer);
    // A .ttc/OTC collection has no glyphs of its own; take the first face.
    const font = ('fonts' in parsed ? (parsed as { fonts: unknown[] }).fonts[0] : parsed) as
      | ParsedFont
      | undefined;
    if (!font || typeof font.hasGlyphForCodePoint !== 'function') {
      return { font: null, reason: 'The embedded font is in a format we cannot inspect.' };
    }
    return { font };
  } catch {
    // Bare CFF programs (/FontFile3 with /Subtype /Type1C or /CIDFontType0C)
    // are not sfnt-wrapped and fontkit rejects them. That is a "cannot tell",
    // not a "no coverage", and the caller treats it as such.
    return { font: null, reason: 'The embedded font is in a format we cannot inspect.' };
  }
}

/**
 * Can this font render this text?
 *
 * A conservative check. When coverage cannot be established the answer is no,
 * because substituting a font that definitely works is better than emitting
 * missing glyphs that the user only discovers later in another viewer.
 */
export function checkCoverage(
  mod: WrappedPdfiumModule,
  fontHandle: number,
  text: string,
): CoverageResult {
  const codePoints = [...text].map((ch) => ch.codePointAt(0)!);
  // Whitespace is positioning in PDF rather than a drawn glyph, so a missing
  // space glyph does not prevent reuse.
  const meaningful = codePoints.filter((cp) => cp !== 0x20 && cp !== 0x09);

  if (meaningful.length === 0) return { covered: true, missing: [] };

  const data = getEmbeddedFontData(mod, fontHandle);
  if (!data) {
    return {
      covered: false,
      missing: [],
      reason: 'This font is not embedded in the document, so it cannot be reused.',
    };
  }

  const { font, reason } = parseFont(data);
  if (!font) return { covered: false, missing: [], reason };

  const missing: string[] = [];
  for (const cp of meaningful) {
    if (!font.hasGlyphForCodePoint(cp)) {
      const ch = String.fromCodePoint(cp);
      if (!missing.includes(ch)) missing.push(ch);
    }
  }

  return { covered: missing.length === 0, missing };
}

/** Measure a string in a parsed font program, in points at `size`. */
export function measureWithFontData(
  data: Uint8Array,
  text: string,
  size: number,
): number | null {
  const { font } = parseFont(data);
  if (!font) return null;
  try {
    const run = font.layout(text);
    return (run.advanceWidth / font.unitsPerEm) * size;
  } catch {
    return null;
  }
}

/**
 * Load a bundled fallback into the document and return a PDFium font handle.
 *
 * Handles are cached per document: loading the same face repeatedly would
 * embed it repeatedly and inflate the file.
 */
const loadedFonts = new WeakMap<PdfDocument, Map<string, number>>();

export async function loadFallbackIntoDocument(
  doc: PdfDocument,
  fallback: FallbackFont,
): Promise<number> {
  let perDoc = loadedFonts.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    loadedFonts.set(doc, perDoc);
  }
  const cached = perDoc.get(fallback.key);
  if (cached) return cached;

  const data = await loadFontFile(fallback.file);
  const { mod } = doc;

  const handle = withScope(mod, (scope) => {
    const ptr = scope.allocBytes(data);
    // `cid: false` embeds as a simple TrueType font. PDFium generates the
    // /ToUnicode map itself, which keeps the replacement text extractable and
    // searchable rather than turning it into unsearchable shapes.
    return mod.FPDFText_LoadFont(doc.handle, ptr, data.byteLength, FontType.TrueType, false);
  });

  if (!handle) {
    throw new Error(`The fallback font ${fallback.standsFor} could not be embedded.`);
  }
  perDoc.set(fallback.key, handle);
  return handle;
}

/** Measure a string in a bundled fallback, in points at `size`. */
export async function measureFallback(
  fallback: FallbackFont,
  text: string,
  size: number,
): Promise<number | null> {
  return measureWithFontData(await loadFontFile(fallback.file), text, size);
}
