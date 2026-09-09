import { ObjType } from './constants';
import type { PdfDocument } from './document';
import { multiplyMatrix, setObjectMatrix, withScope, type Matrix } from './memory';
import { resolvePath, walkObjects, type ObjectPath } from './object-path';
import { removeObjectsByPath } from './text-edit';
import type { Badge } from './types';

/**
 * Moving existing content.
 *
 * Two mechanisms, chosen by where the object lives.
 *
 * A top-level object is repositioned by translating its own matrix. The page's
 * content stream is regenerated from the object model afterwards, so the move
 * persists and the object keeps its identity: same font, same glyphs, same
 * everything.
 *
 * A nested object — one inside a form XObject — cannot be repositioned that
 * way, for the same reason it cannot be edited in place: regenerating the page
 * does not rewrite a form's own content stream, and PDFium exposes no call
 * that does. Such an object is instead removed and redrawn at page level.
 *
 * The redraw reuses the original font handle rather than substituting.
 * A move does not change the text, so the embedded subset is guaranteed to
 * contain every glyph already in use — which is exactly the condition font
 * substitution exists to work around, and it does not apply here.
 */

export interface MoveResult {
  moved: number;
  badges: Badge[];
}

/** Everything needed to redraw a nested text object at a new position. */
interface NestedText {
  path: ObjectPath;
  text: string;
  fontHandle: number;
  fontSize: number;
  matrix: Matrix;
  colour: { r: number; g: number; b: number; a: number };
}

/**
 * Translate objects by a delta in PDF points.
 *
 * All paths are resolved before anything is mutated, because removing an
 * object renumbers the indices of those after it.
 */
export function moveObjects(
  doc: PdfDocument,
  pageIndex: number,
  paths: readonly ObjectPath[],
  dx: number,
  dy: number,
): MoveResult {
  const { mod } = doc;
  const page = doc.page(pageIndex);
  const badges: Badge[] = [];

  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return { moved: 0, badges };

  const topLevel: number[] = [];
  const nestedText: NestedText[] = [];
  let unmovable = 0;

  for (const path of paths) {
    const handle = resolvePath(mod, page, path);
    if (!handle) continue;

    if (path.length === 1) {
      topLevel.push(handle);
      continue;
    }

    const type = mod.FPDFPageObj_GetType(handle);
    if (type !== ObjType.Text) {
      // A nested image or shape would have to be rebuilt to move it, and
      // rebuilding an image means re-encoding its pixels. Refused rather than
      // half-supported.
      unmovable++;
      continue;
    }

    const captured = captureNestedText(
      doc,
      pageIndex,
      path,
      handle,
      ancestorFor(doc, pageIndex, path),
    );
    if (captured) nestedText.push(captured);
    else unmovable++;
  }

  // Top-level objects: translate in place.
  for (const handle of topLevel) {
    mod.FPDFPageObj_Transform(handle, 1, 0, 0, 1, dx, dy);
  }

  // Nested text: remove, then redraw at the offset position.
  if (nestedText.length > 0) {
    removeObjectsByPath(
      doc,
      pageIndex,
      nestedText.map((n) => n.path),
    );

    for (const item of nestedText) {
      redrawNestedText(doc, pageIndex, item, dx, dy);
    }
  }

  if (unmovable > 0) {
    badges.push({
      kind: 'partial-removal',
      message: `${unmovable} item${unmovable === 1 ? '' : 's'} could not be moved, because ${unmovable === 1 ? 'it is' : 'they are'} part of a template built into the page.`,
      page: pageIndex,
    });
  }

  const moved = topLevel.length + nestedText.length;
  if (moved > 0) doc.markDirty(pageIndex);
  return { moved, badges };
}

/**
 * The transform of the form chain above a path, mapping its space to page
 * space. Looked up by walking, because a path alone does not carry it.
 */
function ancestorFor(doc: PdfDocument, pageIndex: number, path: ObjectPath): Matrix {
  const key = path.join('.');
  let found: Matrix | null = null;
  walkObjects(doc.mod, doc.page(pageIndex), (visited) => {
    if (!found && visited.path.join('.') === key) found = visited.ancestorMatrix;
  });
  return found ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/** Read everything needed to recreate a nested text object. */
function captureNestedText(
  doc: PdfDocument,
  pageIndex: number,
  path: ObjectPath,
  handle: number,
  ancestorMatrix: Matrix,
): NestedText | null {
  const { mod } = doc;

  const text = doc.withTextPage(pageIndex, (textPage) => {
    const needed = mod.FPDFTextObj_GetText(handle, textPage, 0, 0);
    if (needed <= 2) return '';
    return withScope(mod, (scope) => {
      const buffer = scope.alloc(needed);
      mod.FPDFTextObj_GetText(handle, textPage, buffer, needed);
      return mod.pdfium.UTF16ToString(buffer);
    });
  });
  if (text === '') return null;

  const fontHandle = mod.FPDFTextObj_GetFont(handle);
  if (!fontHandle) return null;

  const fontSize = withScope(mod, (scope) => {
    const out = scope.allocFloat();
    return mod.FPDFTextObj_GetFontSize(handle, out) ? mod.pdfium.getValue(out, 'float') : 0;
  });
  if (fontSize <= 0) return null;

  const rawMatrix = withScope(mod, (scope) => {
    const ptr = scope.allocMatrix();
    if (!mod.FPDFPageObj_GetMatrix(handle, ptr)) return null;
    const [a, b, c, d, e, f] = [0, 1, 2, 3, 4, 5].map((i) =>
      mod.pdfium.getValue(ptr + i * 4, 'float'),
    );
    return { a, b, c, d, e, f };
  });
  if (!rawMatrix) return null;

  // Into page space, since the replacement is drawn at page level and PDFium
  // reports a nested matrix relative to its parent form.
  const matrix = multiplyMatrix(rawMatrix, ancestorMatrix);

  const colour = withScope(mod, (scope) => {
    const r = scope.allocInt();
    const g = scope.allocInt();
    const b = scope.allocInt();
    const a = scope.allocInt();
    if (!mod.FPDFPageObj_GetFillColor(handle, r, g, b, a)) {
      return { r: 0, g: 0, b: 0, a: 255 };
    }
    const get = (p: number) => mod.pdfium.getValue(p, 'i32') & 0xff;
    return { r: get(r), g: get(g), b: get(b), a: get(a) };
  });

  return { path, text, fontHandle, fontSize, matrix, colour };
}

/** Recreate a captured nested text object at page level, offset by a delta. */
function redrawNestedText(
  doc: PdfDocument,
  pageIndex: number,
  item: NestedText,
  dx: number,
  dy: number,
): void {
  const { mod } = doc;
  const page = doc.page(pageIndex);

  const obj = mod.FPDFPageObj_CreateTextObj(doc.handle, item.fontHandle, item.fontSize);
  if (!obj) return;

  const ok = withScope(mod, (scope) => mod.FPDFText_SetText(obj, scope.allocUtf16(item.text)));
  if (!ok) {
    mod.FPDFPageObj_Destroy(obj);
    return;
  }

  mod.FPDFPageObj_SetFillColor(obj, item.colour.r, item.colour.g, item.colour.b, item.colour.a);
  // The captured matrix was composed into page space, so the delta applies
  // directly to its translation.
  setObjectMatrix(mod, obj, {
    ...item.matrix,
    e: item.matrix.e + dx,
    f: item.matrix.f + dy,
  });
  mod.FPDFPage_InsertObject(page, obj);
}
