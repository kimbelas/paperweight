import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { FontFlag, ObjType } from './constants';
import type { PdfDocument } from './document';
import { walkObjects, type ObjectPath } from './object-path';
import {
  multiplyMatrix,
  normaliseRect,
  readMatrix,
  readRectF,
  rectHeight,
  rectWidth,
  transformRect,
  unionRect,
  withScope,
  type Matrix,
  type Rect,
  type Rgba,
} from './memory';
import type { FontDescriptor, Glyph, TextLine, TextRun } from './types';

/**
 * Reading text out of a page.
 *
 * Two layers are needed and they answer different questions. The glyph layer
 * says where each character is on screen, which is what hit-testing and caret
 * placement use. The object layer says which PDF text object drew it, which is
 * what editing needs, because a text object is the only thing PDFium lets us
 * mutate. `FPDFText_GetTextObject` is the bridge between them and is the
 * single most useful call in the whole editing story.
 */

/** Read a UTF-16LE string out of a PDFium getter that reports its own length. */
function readUtf16(
  mod: WrappedPdfiumModule,
  fill: (buffer: number, byteLength: number) => number,
): string {
  // Calling with a null buffer asks for the required size, in bytes,
  // including the trailing NUL.
  const needed = fill(0, 0);
  if (needed <= 2) return '';
  return withScope(mod, (scope) => {
    const buffer = scope.alloc(needed);
    fill(buffer, needed);
    return mod.pdfium.UTF16ToString(buffer);
  });
}

function readAsciiName(
  mod: WrappedPdfiumModule,
  fill: (buffer: number, byteLength: number) => number,
): string {
  const needed = fill(0, 0);
  if (needed <= 1) return '';
  return withScope(mod, (scope) => {
    const buffer = scope.alloc(needed);
    fill(buffer, needed);
    return mod.pdfium.UTF8ToString(buffer);
  });
}

/** Describe a font handle well enough to pick a visually similar fallback. */
export function describeFont(mod: WrappedPdfiumModule, fontHandle: number): FontDescriptor {
  if (!fontHandle) {
    return {
      family: '',
      baseFont: '',
      resolvedFamily: '',
      flags: 0,
      weight: 0,
      italicAngle: 0,
      isEmbedded: false,
      isSerif: false,
      isFixedPitch: false,
      isItalic: false,
      isBold: false,
      isUnsupported: true,
    };
  }

  // Two different names are available and they mean different things.
  // GetBaseFontName returns the PDF's own /BaseFont, i.e. what the document
  // asked for. GetFamilyName returns what PDFium actually resolved, which for
  // a non-embedded font is a substitute from the host ("Chrom Sans OTF" for
  // Helvetica). Identity decisions must use the former, or every standard-14
  // font is misidentified.
  const baseFont = readAsciiName(mod, (buf, len) =>
    mod.FPDFFont_GetBaseFontName(fontHandle, buf, len),
  );
  const resolvedFamily = readAsciiName(mod, (buf, len) =>
    mod.FPDFFont_GetFamilyName(fontHandle, buf, len),
  );
  const family = baseFont || resolvedFamily;
  const flags = mod.FPDFFont_GetFlags(fontHandle);
  const weight = mod.FPDFFont_GetWeight(fontHandle);
  const italicAngle = withScope(mod, (scope) => {
    const out = scope.allocInt();
    return mod.FPDFFont_GetItalicAngle(fontHandle, out) ? mod.pdfium.getValue(out, 'i32') : 0;
  });
  const isEmbedded = mod.FPDFFont_GetIsEmbedded(fontHandle) === 1;

  // The descriptor flags are the authority, but plenty of real files leave
  // them at zero, so the family name is used as a second opinion. Name
  // matching is checked first for style because it is more often right than
  // /StemV-derived weight.
  const lower = family.toLowerCase();
  const nameSaysBold = /bold|black|heavy|semib|demib/.test(lower);
  const nameSaysItalic = /italic|oblique/.test(lower);
  const nameSaysSerif = /times|georgia|garamond|book|roman|serif|minion|cambria/.test(lower);
  const nameSaysMono = /mono|courier|consol/.test(lower);

  return {
    family,
    baseFont,
    resolvedFamily,
    flags,
    weight,
    italicAngle,
    isEmbedded,
    isSerif: nameSaysSerif || (flags & FontFlag.Serif) !== 0,
    isFixedPitch: nameSaysMono || (flags & FontFlag.FixedPitch) !== 0,
    isItalic: nameSaysItalic || italicAngle !== 0 || (flags & FontFlag.Italic) !== 0,
    isBold: nameSaysBold || weight >= 600 || (flags & FontFlag.ForceBold) !== 0,
    isUnsupported: false,
  };
}

function objectBounds(mod: WrappedPdfiumModule, obj: number): Rect {
  return withScope(mod, (scope) => {
    const l = scope.allocFloat();
    const b = scope.allocFloat();
    const r = scope.allocFloat();
    const t = scope.allocFloat();
    if (!mod.FPDFPageObj_GetBounds(obj, l, b, r, t)) {
      return { left: 0, bottom: 0, right: 0, top: 0 };
    }
    const get = (p: number) => mod.pdfium.getValue(p, 'float');
    return normaliseRect({ left: get(l), bottom: get(b), right: get(r), top: get(t) });
  });
}

function objectMatrix(mod: WrappedPdfiumModule, obj: number): Matrix {
  return withScope(mod, (scope) => {
    const ptr = scope.allocMatrix();
    if (!mod.FPDFPageObj_GetMatrix(obj, ptr)) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    return readMatrix(mod, ptr);
  });
}

function objectFillColour(mod: WrappedPdfiumModule, obj: number): Rgba {
  return withScope(mod, (scope) => {
    const r = scope.allocInt();
    const g = scope.allocInt();
    const b = scope.allocInt();
    const a = scope.allocInt();
    if (!mod.FPDFPageObj_GetFillColor(obj, r, g, b, a)) {
      // Unset fill means black, which is the PDF default.
      return { r: 0, g: 0, b: 0, a: 255 };
    }
    const get = (p: number) => mod.pdfium.getValue(p, 'i32') & 0xff;
    return { r: get(r), g: get(g), b: get(b), a: get(a) };
  });
}

/** Every glyph on a page, with both its tight and layout boxes. */
export function getGlyphs(doc: PdfDocument, pageIndex: number): Glyph[] {
  const { mod } = doc;
  return doc.withTextPage(pageIndex, (textPage) => {
    const count = mod.FPDFText_CountChars(textPage);
    const glyphs: Glyph[] = [];

    withScope(mod, (scope) => {
      const l = scope.allocFloat();
      const r = scope.allocFloat();
      const b = scope.allocFloat();
      const t = scope.allocFloat();
      const loose = scope.allocRectF();

      for (let i = 0; i < count; i++) {
        const unicode = mod.FPDFText_GetUnicode(textPage, i);

        // Note the argument order here: left, RIGHT, bottom, top. It differs
        // from FPDFPageObj_GetBounds, which is left, bottom, right, top.
        const hasBox = mod.FPDFText_GetCharBox(textPage, i, l, r, b, t);
        const get = (p: number) => mod.pdfium.getValue(p, 'float');
        const box = hasBox
          ? normaliseRect({ left: get(l), right: get(r), bottom: get(b), top: get(t) })
          : { left: 0, right: 0, bottom: 0, top: 0 };

        const looseBox = mod.FPDFText_GetLooseCharBox(textPage, i, loose)
          ? readRectF(mod, loose)
          : box;

        glyphs.push({ charIndex: i, unicode, box, looseBox });
      }
    });

    return glyphs;
  });
}

/** Every text object on a page, with its text, font and geometry. */
export function getTextRuns(doc: PdfDocument, pageIndex: number): TextRun[] {
  const { mod } = doc;
  const page = doc.page(pageIndex);

  return doc.withTextPage(pageIndex, (textPage) => {
    const runs: TextRun[] = [];

    // Descend into form XObjects. PDFium's top-level object list reports a
    // form as a single object of type Form and does not surface the text
    // inside it, so a flat scan silently misses stamps, reusable headers and
    // the visible content of filled form fields.
    walkObjects(mod, page, ({ handle, path, type, nested, ancestorMatrix }) => {
      if (type !== ObjType.Text) return;

      const text = readUtf16(mod, (buf, len) =>
        mod.FPDFTextObj_GetText(handle, textPage, buf, len),
      );

      const fontSize = withScope(mod, (scope) => {
        const out = scope.allocFloat();
        return mod.FPDFTextObj_GetFontSize(handle, out) ? mod.pdfium.getValue(out, 'float') : 0;
      });

      // Both the matrix and the bounds PDFium reports for a nested object are
      // in its parent form's space, so the form chain's transform has to be
      // applied to get page space. Everything downstream — the editor's
      // position, hit-testing, where a replacement is drawn — assumes page
      // space, and a form placed with a translation would otherwise send
      // edited text to the corner of the page.
      const matrix = multiplyMatrix(objectMatrix(mod, handle), ancestorMatrix);
      const bounds = transformRect(ancestorMatrix, objectBounds(mod, handle));

      // The matrix's vertical scale is what turns a declared size into the
      // size on the page. For an identity matrix these are the same number,
      // which is why this went unnoticed until a document put the scale in the
      // matrix instead.
      const yScale = Math.hypot(matrix.c, matrix.d) || 1;

      runs.push({
        path,
        nested,
        text,
        bounds,
        fontSize,
        effectiveFontSize: fontSize * yScale,
        font: describeFont(mod, mod.FPDFTextObj_GetFont(handle)),
        colour: objectFillColour(mod, handle),
        matrix,
      });
    });

    return runs;
  });
}

/**
 * Group text runs into visually contiguous lines.
 *
 * A PDF text object is not a useful editing unit. Word, InDesign and LaTeX all
 * split one visual line into several objects so they can apply kerning, so
 * editing per object would mean editing a word or two at a time. A paragraph
 * is not represented in the format at all. The line, reconstructed from
 * geometry, is the largest unit that can be recovered reliably, and it matches
 * what the established editors offer.
 *
 * Runs join a line when their baselines agree within a fraction of the font
 * size and they do not overlap horizontally in a way that implies separate
 * columns.
 */
export function getTextLines(doc: PdfDocument, pageIndex: number): TextLine[] {
  const runs = getTextRuns(doc, pageIndex);
  if (runs.length === 0) return [];

  // The object matrix's f component carries the text origin, which is the
  // baseline. It is more reliable than the bounding box, whose bottom edge
  // moves with descenders and so differs between runs on the same line.
  const withBaseline = runs.map((run) => ({
    run,
    baseline: run.matrix.f,
    /** Rotated or skewed text is excluded from clustering; see below. */
    axisAligned: Math.abs(run.matrix.b) < 0.01 && Math.abs(run.matrix.c) < 0.01,
  }));

  const sorted = [...withBaseline].sort((a, b) => {
    const dy = b.baseline - a.baseline; // top of the page first
    if (Math.abs(dy) > 0.5) return dy;
    return a.run.bounds.left - b.run.bounds.left;
  });

  const groups: (typeof sorted)[] = [];

  for (const entry of sorted) {
    // Text on an angle has no shared baseline to cluster on, so each run
    // stands alone rather than being wrongly merged with its neighbours.
    if (!entry.axisAligned) {
      groups.push([entry]);
      continue;
    }

    const last = groups[groups.length - 1];
    const candidate = last?.[last.length - 1];

    if (candidate && candidate.axisAligned && canJoin(candidate, entry)) {
      last.push(entry);
    } else {
      groups.push([entry]);
    }
  }

  return (
    groups
      .map((group, index) => buildLine(group, pageIndex, index))
      // Drop lines that are not editing targets: runs holding only whitespace,
      // and runs with no measurable area. PDFium reports plenty of both, and
      // listing them as un-editable lines put dozens of dead entries in front
      // of the user and let clicks land on nothing.
      .filter((line) => line.text.trim() !== '' && rectWidth(line.bounds) > 0.5)
  );
}

function canJoin(
  a: { run: TextRun; baseline: number },
  b: { run: TextRun; baseline: number },
): boolean {
  // Rendered size, not declared: the thresholds below are in page points.
  const size = Math.max(a.run.effectiveFontSize, b.run.effectiveFontSize, 1);

  // Same baseline, within a fraction of the type size. Superscripts and
  // subscripts fall outside this and stay separate, which is correct: their
  // baseline really is different.
  if (Math.abs(a.baseline - b.baseline) > size * 0.3) return false;

  // Reading order runs left to right, so the next run should start at or
  // after the previous one's end. A generous gap is allowed for tab stops and
  // justified spacing; a very large one implies a separate column.
  const gap = b.run.bounds.left - a.run.bounds.right;
  if (gap < -size * 0.6) return false;
  if (gap > size * 8) return false;

  return true;
}

function buildLine(
  group: { run: TextRun; baseline: number }[],
  pageIndex: number,
  index: number,
): TextLine {
  const runs = group.map((g) => g.run);
  const bounds = runs.map((r) => r.bounds).reduce(unionRect);
  const baseline = group.reduce((sum, g) => sum + g.baseline, 0) / group.length;

  // Attribute the line to its widest run: for a line that mixes a bold label
  // with regular text, the bulk of the line is what the editor should style
  // itself as and what a replacement should be drawn in.
  const dominant = runs.reduce((best, run) =>
    rectWidth(run.bounds) > rectWidth(best.bounds) ? run : best,
  );

  // Text is joined without inserting spaces. PDFium reports the characters
  // that are actually in each object, and inter-word gaps in a PDF are often
  // positioning rather than space characters. Adding separators here would
  // put spaces into the replacement text that were never in the document.
  const text = runs.map((r) => r.text).join('');

  const unsupported = runs.find((r) => r.font.isUnsupported);
  const nested = runs.some((r) => r.nested);

  let editable = true;
  let notEditableReason: string | undefined;
  if (unsupported) {
    editable = false;
    notEditableReason = 'This text uses a font the editor cannot read.';
  } else if (rectHeight(bounds) <= 0 || rectWidth(bounds) <= 0) {
    editable = false;
    notEditableReason = 'This text has no measurable size on the page.';
  }

  // Nested text — inside a form XObject — used to be refused here, on the
  // grounds that regenerating the page does not rewrite a form's own content
  // stream. That is true (verified: `FPDFText_SetText` on a nested object
  // reports success and the change is gone after saving), and there is no
  // form-regeneration API. But it is not a reason to refuse: whole documents
  // are built as a single form XObject, and refusing left every line of them
  // uneditable.
  //
  // Removing a nested object does persist, via `FPDFFormObj_RemoveObject`, and
  // a nested object's bounds and matrix are already in page space. So such a
  // line is edited by removing it and redrawing at page level. See
  // `replaceLineText`, which forces that path when `nested` is set.

  return {
    id: `p${pageIndex}-l${index}`,
    page: pageIndex,
    runs,
    text,
    bounds,
    baseline,
    fontSize: dominant.fontSize,
    effectiveFontSize: dominant.effectiveFontSize,
    font: dominant.font,
    colour: dominant.colour,
    editable,
    notEditableReason,
  };
}

/**
 * Find the line under a point given in PDF space.
 *
 * Hit-testing goes through the glyph layer rather than the line's bounding
 * box, because a box spans the gaps between words and would claim clicks that
 * belong to whitespace. The tolerance is scaled to the type size so small
 * print stays clickable.
 */
export function hitTestLine(
  doc: PdfDocument,
  pageIndex: number,
  x: number,
  y: number,
): TextLine | null {
  const { mod } = doc;

  const charIndex = doc.withTextPage(pageIndex, (textPage) =>
    mod.FPDFText_GetCharIndexAtPos(textPage, x, y, 4, 4),
  );

  const lines = getTextLines(doc, pageIndex);

  if (charIndex >= 0) {
    // Resolve the glyph to the object that drew it, then to the line holding
    // that object. This is exact, unlike any geometric guess.
    const targetPath = doc.withTextPage(pageIndex, (textPage) => {
      const obj = mod.FPDFText_GetTextObject(textPage, charIndex);
      if (!obj) return null;
      const page = doc.page(pageIndex);
      const matches: number[][] = [];
      walkObjects(mod, page, ({ handle, path }) => {
        if (matches.length === 0 && handle === obj) matches.push([...path]);
      });
      return matches[0] ?? null;
    });

    if (targetPath) {
      const key = targetPath.join('.');
      const line = lines.find((l) => l.runs.some((r) => r.path.join('.') === key));
      if (line) return line;
    }
  }

  // Nothing directly under the cursor. Fall back to the nearest line whose
  // vertical band contains the point, so clicking in the gap between words
  // still selects the obvious line rather than doing nothing.
  let best: TextLine | null = null;
  let bestDistance = Infinity;
  for (const line of lines) {
    const pad = Math.max(2, line.fontSize * 0.25);
    if (y < line.bounds.bottom - pad || y > line.bounds.top + pad) continue;
    const dx =
      x < line.bounds.left
        ? line.bounds.left - x
        : x > line.bounds.right
          ? x - line.bounds.right
          : 0;
    if (dx < bestDistance) {
      bestDistance = dx;
      best = line;
    }
  }
  // Only claim the click if it is reasonably close horizontally, so clicking
  // far out in the margin does not select a line across the page.
  return best && bestDistance < (best.fontSize || 12) * 4 ? best : null;
}
