import { ObjType } from './constants';
import type { PdfDocument } from './document';
import {
  chooseFallback,
  checkCoverage,
  loadFallbackIntoDocument,
  loadFontFile,
  measureWithFontData,
  type FallbackFont,
} from './fonts';
import { rectWidth, setObjectMatrix, withScope, type Matrix, type Rgba } from './memory';
import { resolvePath } from './object-path';
import { getTextLines } from './text';
import type { Badge, TextLine } from './types';

/**
 * Replacing the text of an existing line.
 *
 * This is the feature the whole project exists for, and the one no
 * permissively licensed library provides. The strategy has two paths:
 *
 * **Path A — reuse the original font.** When the embedded font can render
 * every character of the new string, `FPDFText_SetText` replaces the text of
 * the line's first object and the remaining objects of that line are removed.
 * Font, size, colour and baseline all survive. The cost is per-glyph kerning:
 * a line originally emitted as a kerned `TJ` array is re-laid-out by PDFium
 * from font metrics, so tightly tracked display type shifts slightly. For body
 * text this is invisible; the user is told when it may not be.
 *
 * **Path B — substitute a font.** When the original cannot render the text —
 * which is the common case, because embedded fonts are subsets — the line's
 * objects are removed and one new object is created in a bundled,
 * metric-compatible face. The result is always legible and always extractable,
 * and the substitution is reported rather than hidden.
 *
 * Text inside a form XObject always takes Path B, whatever its font covers.
 * `FPDFText_SetText` on a nested object reports success and then loses the
 * change on save, because regenerating the page does not rewrite a form's own
 * content stream and no API exists to regenerate one. Removing a nested object
 * *does* persist, and its bounds and matrix are already in page space, so the
 * line is removed and redrawn at page level instead. Whole documents are built
 * as one form XObject, so refusing these outright made them entirely
 * uneditable.
 *
 * There is no Path C. Covering the old text with a white rectangle and drawing
 * over it leaves the original glyphs in the file, still selectable and still
 * searchable. That is the approach most free tools take and it is a privacy
 * leak dressed up as a feature.
 *
 * Text is never reflowed. PDF has no paragraph model, so a longer replacement
 * is fitted into the original line's width by squeezing and then shrinking,
 * and flagged if it still does not fit. It never pushes the next line down.
 */

/** How much horizontal squeeze is acceptable before shrinking type instead. */
const MIN_HORIZONTAL_SCALE = 0.9;
/** How much type shrink is acceptable before admitting the text overflows. */
const MIN_SIZE_SCALE = 0.85;

export interface ReplaceTextRequest {
  page: number;
  /** Line id from `getTextLines`, used to re-find the line after a re-read. */
  lineId: string;
  text: string;
}

export interface ReplaceTextOutcome {
  badges: Badge[];
  /** Which path was taken, for tests and for the UI's font indicator. */
  path: 'reused-font' | 'substituted-font' | 'deleted';
  /** The face substituted in, when path is `substituted-font`. */
  substituted?: string;
}

/**
 * Replace the text of one line.
 *
 * The caller is responsible for snapshotting first and for regenerating page
 * content afterwards via `doc.flushDirty()`; this function marks the page
 * dirty but does not decide when to write, because a single user action may
 * touch several lines.
 */
export async function replaceLineText(
  doc: PdfDocument,
  request: ReplaceTextRequest,
): Promise<ReplaceTextOutcome> {
  const { mod } = doc;
  const page = doc.page(request.page);

  const line = getTextLines(doc, request.page).find((l) => l.id === request.lineId);
  if (!line) throw new Error('That line is no longer on the page.');
  if (!line.editable) {
    throw new Error(line.notEditableReason ?? 'This text cannot be edited.');
  }

  const newText = request.text;
  const badges: Badge[] = [];

  // Resolve every object of the line to a live handle before touching
  // anything. Removing an object shifts the indices of those after it, so
  // index-based access mid-mutation reads the wrong object.
  const targets = line.runs
    .map((run) => ({ path: run.path, handle: resolvePath(mod, page, run.path) }))
    .filter((t) => t.handle !== 0);

  if (targets.length === 0) throw new Error('That text is no longer on the page.');
  const handles = targets.map((t) => t.handle);
  const paths = targets.map((t) => t.path);

  // Deleting the text is just removal, with nothing drawn in its place.
  if (newText.length === 0) {
    removeTargets(doc, request.page, paths);
    doc.markDirty(request.page);
    return { badges, path: 'deleted' };
  }

  const nested = line.runs.some((run) => run.nested);
  const firstHandle = handles[0];
  const fontHandle = mod.FPDFTextObj_GetFont(firstHandle);
  const coverage = checkCoverage(mod, fontHandle, newText);

  // The geometry to match: the line starts at its leftmost run, sits on the
  // shared baseline, and must fit the original line's width.
  const anchor = anchorMatrix(line);
  const availableWidth = rectWidth(line.bounds);

  // A nested line always has to be removed and redrawn, because in-place
  // mutation of a form's content stream does not persist. But it can still be
  // redrawn in the document's own font when that font covers the new text,
  // which is a much better result than substituting.
  if (nested) {
    const outcome = await commitByRedraw(doc, {
      page,
      pageIndex: request.page,
      handles,
      paths,
      text: newText,
      line,
      anchor,
      availableWidth,
      badges,
      font: coverage.covered
        ? { kind: 'original', handle: fontHandle }
        : { kind: 'fallback', fallback: chooseFallback(line.font) },
      reason: coverage.reason,
      missing: coverage.missing,
    });
    doc.markDirty(request.page);
    return outcome;
  }

  if (coverage.covered) {
    const outcome = await commitReusingFont(doc, {
      page,
      pageIndex: request.page,
      handles,
      text: newText,
      line,
      anchor,
      availableWidth,
      badges,
      paths,
    });
    doc.markDirty(request.page);
    return outcome;
  }

  const outcome = await commitByRedraw(doc, {
    page,
    pageIndex: request.page,
    handles,
    paths,
    text: newText,
    line,
    anchor,
    availableWidth,
    badges,
    font: { kind: 'fallback', fallback: chooseFallback(line.font) },
    reason: coverage.reason,
    missing: coverage.missing,
  });
  doc.markDirty(request.page);
  return outcome;
}

interface CommitContext {
  page: number;
  pageIndex: number;
  handles: number[];
  /** Paths matching `handles`, so removal can reach nested objects. */
  paths: readonly (readonly number[])[];
  text: string;
  line: TextLine;
  anchor: Matrix;
  availableWidth: number;
  badges: Badge[];
}

/** Path A: keep the document's own font. */
async function commitReusingFont(
  doc: PdfDocument,
  ctx: CommitContext,
): Promise<ReplaceTextOutcome> {
  const { mod } = doc;
  const [keep, ...discard] = ctx.handles;

  const ok = withScope(mod, (scope) => mod.FPDFText_SetText(keep, scope.allocUtf16(ctx.text)));
  if (!ok) throw new Error('The replacement text could not be applied.');

  // The kept object may have started mid-line, so reposition it to the line's
  // start now that it carries the whole line.
  setObjectMatrix(mod, keep, ctx.anchor);

  if (discard.length > 0) removeTargets(doc, ctx.pageIndex, ctx.paths.slice(1));

  fitObject(doc, keep, ctx);

  // Warn about kerning only where it is likely to be noticed: a line that was
  // split into many objects was kerned per glyph, and at display sizes the
  // re-layout is visible. A single-object line had no per-glyph kerning to
  // lose.
  if (ctx.handles.length > 2 && ctx.line.effectiveFontSize >= 16) {
    ctx.badges.push({
      kind: 'kerning-lost',
      message: 'Letter spacing was recalculated, so this line may look slightly different.',
      page: ctx.pageIndex,
    });
  }

  return { badges: ctx.badges, path: 'reused-font' };
}

/** Which font a redraw should use. */
type RedrawFont =
  { kind: 'original'; handle: number } | { kind: 'fallback'; fallback: FallbackFont };

/**
 * Path B: remove the line and draw a replacement.
 *
 * Used both when the original font cannot render the new text, and whenever
 * the line is nested inside a form XObject — where in-place editing is
 * impossible regardless of the font.
 */
async function commitByRedraw(
  doc: PdfDocument,
  ctx: CommitContext & { font: RedrawFont; reason?: string; missing: string[] },
): Promise<ReplaceTextOutcome> {
  const { mod } = doc;

  // Resolve the font before removing anything, so a failure here leaves the
  // page untouched rather than half-edited.
  const fontHandle =
    ctx.font.kind === 'original'
      ? ctx.font.handle
      : await loadFallbackIntoDocument(doc, ctx.font.fallback);
  if (!fontHandle) throw new Error('The font for the replacement text could not be prepared.');

  removeTargets(doc, ctx.pageIndex, ctx.paths);

  const obj = mod.FPDFPageObj_CreateTextObj(doc.handle, fontHandle, ctx.line.fontSize);
  if (!obj) throw new Error('A replacement text object could not be created.');

  const ok = withScope(mod, (scope) => mod.FPDFText_SetText(obj, scope.allocUtf16(ctx.text)));
  if (!ok) {
    mod.FPDFPageObj_Destroy(obj);
    throw new Error('The replacement text could not be applied.');
  }

  setColour(doc, obj, ctx.line.colour);
  setObjectMatrix(mod, obj, ctx.anchor);
  mod.FPDFPage_InsertObject(ctx.page, obj);

  if (ctx.font.kind === 'fallback') {
    await fitObjectWithFallback(doc, obj, { ...ctx, fallback: ctx.font.fallback });
    ctx.badges.push({
      kind: 'font-substituted',
      message:
        ctx.reason ??
        `The original font has no glyph for ${describeMissing(ctx.missing)}, so ${ctx.font.fallback.standsFor} was used instead.`,
      page: ctx.pageIndex,
    });
    return {
      badges: ctx.badges,
      path: 'substituted-font',
      substituted: ctx.font.fallback.standsFor,
    };
  }

  // Redrawn in the document's own font, so nothing was substituted and there
  // is nothing to disclose.
  fitObject(doc, obj, ctx);
  return { badges: ctx.badges, path: 'reused-font' };
}

/**
 * The matrix a replacement should be drawn with.
 *
 * Taken from the line's leftmost run so the replacement starts where the line
 * started, with that run's scale and slope preserved, and placed on the
 * line's shared baseline.
 */
function anchorMatrix(line: TextLine): Matrix {
  const leftmost = line.runs.reduce((best, run) =>
    run.bounds.left < best.bounds.left ? run : best,
  );
  return { ...leftmost.matrix, f: line.baseline };
}

function setColour(doc: PdfDocument, obj: number, colour: Rgba): void {
  doc.mod.FPDFPageObj_SetFillColor(obj, colour.r, colour.g, colour.b, colour.a);
}

/**
 * Remove the objects at these paths.
 *
 * Delegates to `removeObjectsByPath`, which is the only place that knows a
 * top-level object is removed from the page while a nested one is removed
 * from its parent form. Using `FPDFPage_RemoveObject` on a nested handle
 * silently does nothing, which previously made a nested edit look like it had
 * worked while leaving the original text in place.
 */
function removeTargets(
  doc: PdfDocument,
  pageIndex: number,
  paths: readonly (readonly number[])[],
): void {
  removeObjectsByPath(doc, pageIndex, paths);
}

/**
 * Squeeze or shrink an object so it fits the original line's width.
 *
 * Measured from the object's own bounds after the text was set, which is what
 * PDFium will actually draw, rather than from a metric estimate.
 */
function fitObject(doc: PdfDocument, obj: number, ctx: CommitContext): void {
  const { mod } = doc;
  const width = objectWidth(mod, obj);
  if (width <= 0 || ctx.availableWidth <= 0) return;
  applyFit(doc, obj, width, ctx);
}

async function fitObjectWithFallback(
  doc: PdfDocument,
  obj: number,
  ctx: CommitContext & { fallback: FallbackFont },
): Promise<void> {
  const { mod } = doc;
  let width = objectWidth(mod, obj);

  if (width <= 0) {
    // Bounds can read zero before content is generated for a freshly created
    // object; fall back to measuring the font program directly.
    const data = await loadFontFile(ctx.fallback.file);
    width = measureWithFontData(data, ctx.text, ctx.line.fontSize) ?? 0;
  }
  if (width <= 0 || ctx.availableWidth <= 0) return;
  applyFit(doc, obj, width, ctx);
}

function applyFit(doc: PdfDocument, obj: number, width: number, ctx: CommitContext): void {
  const { mod } = doc;
  const ratio = ctx.availableWidth / width;
  if (ratio >= 1) return; // It fits.

  // Squeeze horizontally first: a small condensation is much less noticeable
  // than a change in type size, and it keeps the baseline and cap height
  // matching the surrounding lines.
  const squeeze = Math.max(ratio, MIN_HORIZONTAL_SCALE);
  const afterSqueeze = width * squeeze;

  // Then shrink, down to a floor. Past that the text would be too small to
  // sit convincingly with its neighbours, so it is left overflowing and
  // flagged instead.
  const shrink =
    afterSqueeze > ctx.availableWidth
      ? Math.max(ctx.availableWidth / afterSqueeze, MIN_SIZE_SCALE)
      : 1;

  const scale = squeeze * shrink;
  if (scale < 0.999) {
    // Scale about the baseline origin so the line stays anchored at its start
    // rather than drifting left as it condenses.
    const m = ctx.anchor;
    setObjectMatrix(mod, obj, {
      a: m.a * scale,
      b: m.b,
      c: m.c,
      d: m.d * shrink,
      e: m.e,
      f: m.f,
    });
  }

  if (width * scale > ctx.availableWidth * 1.02) {
    ctx.badges.push({
      kind: 'text-overflows',
      message:
        'This text is longer than the space it replaces, so it extends past the original line.',
      page: ctx.pageIndex,
    });
  }
}

function objectWidth(mod: PdfDocument['mod'], obj: number): number {
  return withScope(mod, (scope) => {
    const l = scope.allocFloat();
    const b = scope.allocFloat();
    const r = scope.allocFloat();
    const t = scope.allocFloat();
    if (!mod.FPDFPageObj_GetBounds(obj, l, b, r, t)) return 0;
    const get = (p: number) => mod.pdfium.getValue(p, 'float');
    return Math.abs(get(r) - get(l));
  });
}

function describeMissing(missing: string[]): string {
  if (missing.length === 0) return 'some of these characters';
  const shown = missing.slice(0, 4).map((c) => `"${c}"`);
  const rest = missing.length - shown.length;
  const list = shown.join(', ');
  return rest > 0 ? `${list} and ${rest} more` : list;
}

/**
 * Remove page objects by path, e.g. a flattened signature image.
 *
 * Nested objects are removed from their parent form rather than the page,
 * which is what `FPDFFormObj_RemoveObject` is for.
 */
export function removeObjectsByPath(
  doc: PdfDocument,
  pageIndex: number,
  paths: readonly (readonly number[])[],
): number {
  const { mod } = doc;
  const page = doc.page(pageIndex);
  let removed = 0;

  // Resolve everything up front: each removal invalidates the indices used by
  // later paths.
  const targets = paths
    .map((path) => ({ path, handle: resolvePath(mod, page, path) }))
    .filter((t) => t.handle !== 0);

  for (const { path, handle } of targets) {
    if (path.length === 1) {
      if (mod.FPDFPage_RemoveObject(page, handle)) {
        mod.FPDFPageObj_Destroy(handle);
        removed++;
      }
    } else {
      const form = resolvePath(mod, page, path.slice(0, -1));
      if (form && mod.FPDFPageObj_GetType(form) === ObjType.Form) {
        if (mod.FPDFFormObj_RemoveObject(form, handle)) removed++;
      }
    }
  }

  if (removed > 0) doc.markDirty(pageIndex);
  return removed;
}
