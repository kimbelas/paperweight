import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { PdfDocument } from './document';
import { isIdentity, readFloat, transformRect, withScope, type Matrix, type Rect } from './memory';
import { objectBounds } from './objects';
import { objectMatrix } from './object-path';

/**
 * Dissolving form XObjects into the page, so that a removal inside them
 * reaches the file.
 *
 * `FPDFPage_GenerateContent` rewrites the page's content stream from PDFium's
 * object model. When it writes a form object it descends into that form and
 * rewrites the form's own stream too — but only if something has been
 * *removed* from that form (`CPDF_PageObjectHolder::HasDirtyStreams`), and
 * only because it was writing the form object in the first place. Three
 * consequences, each verified against the build in use rather than read off
 * the headers:
 *
 *  - Changing an object inside a form never persists. `FPDFText_SetText` and
 *    `FPDFPageObj_Transform` on a nested object mark it dirty, the screen
 *    updates, and the save carries the original stream. That is why nested
 *    text is edited and moved by removal and redraw.
 *  - Removing an object persists only when its form sits directly on the
 *    page. One level down the form object is dirty, the page stream is
 *    regenerated, the form is written and so its stream is rewritten. Two
 *    levels down the inner form is dirty but the outer one has lost nothing,
 *    so the outer stream is never rewritten, the inner form is never visited,
 *    and the removed object is back the moment the file is reopened.
 *  - When PDFium does rewrite a form's stream, it gets the form's own
 *    `/Matrix` wrong. The parser folds that matrix into every child's
 *    coordinates; the rewrite emits the children as they are and leaves
 *    `/Matrix` in the dictionary, so on reload it is applied a second time and
 *    everything left in the form shifts by it. A form placed with
 *    `/Matrix [1 0 0 1 5 5]` came back five points off.
 *
 * The second one shipped as a bug. A visa form filled online had its whole
 * page wrapped in a form inside a form; editing an address drew the new value
 * over the old one in print, and a removed signature printed. The engine's
 * own tests missed it because they checked the object model, which had the
 * change; only the saved bytes did not.
 *
 * Marking the ancestors dirty does not help: a no-op transform on the outer
 * form makes the page stream regenerate, but the outer form's own stream is
 * rewritten only for a removal. Lifting the inner form onto the page — so its
 * removal is the one-level case — does work, and then runs into the third
 * point. There is no public call to rewrite a form's stream correctly, and
 * none to insert into one. What there is: `FPDFFormObj_RemoveObject` hands
 * the removed object back to the caller, and `FPDFPage_InsertObjectAtIndex`
 * accepts it.
 *
 * So the engine never lets PDFium rewrite a form's stream at all. Every form
 * on the path to the target is dissolved: each of its children is taken out
 * and placed on the page where the form was, in order, carrying the form's
 * matrix into its own — PDFium keeps a nested object's matrix relative to the
 * form holding it — with its clip path and soft mask transformed the same
 * way. The emptied form is then removed. The target ends up an ordinary page
 * object and is removed like one, and the page stream is the only stream
 * regenerated, which is the path every other edit already takes. Forms that
 * are *not* on the path are moved as units: PDFium writes a `Do` for them
 * with the composed matrix and leaves their streams byte for byte as they
 * were, since nothing was removed from them.
 *
 * What a dissolved form's children lose is the form's clip. A form drawn
 * under `W n` is cropped to that path by the viewer, not by anything in its
 * own stream. PDFium already discards a rectangular clip that contains the
 * whole form while parsing, so a clip that reaches this code crops something
 * — and lifting the cropped object out would reveal it. That is refused: an
 * edit that also changes what is visible elsewhere on the page is not the
 * edit that was asked for.
 *
 * Two caveats, documented rather than solved. A child written into the page
 * stream keeps the stream index it was parsed with, so on a page whose
 * `/Contents` is an array the dissolved content lands in the first stream and
 * may draw beneath later ones where they overlap; the single-stream page,
 * which is what every wrapper form seen so far sits on, keeps its order
 * exactly. And a form's group-level transparency — a blend mode or alpha set
 * on the form as a whole — becomes per-object once dissolved, which differs
 * only where its children overlap each other.
 */

/** `FPDF_SEGMENT_*` — fpdf_edit.h */
const Segment = { LineTo: 0, BezierTo: 1, MoveTo: 2 } as const;

/** How far a clip may fall short of containing a child before it counts as cropping, in points. */
const CLIP_TOLERANCE = 0.5;

const CLIPPED_MESSAGE =
  'That content is inside a group the page clips to a frame, and changing it would alter what the frame shows. It cannot be edited here.';

/**
 * Dissolve every form on `chain` into the page, outermost first, leaving the
 * target — and everything else those forms held — as page-level objects.
 *
 * `chain` is what `resolveChain` returns: the forms above the target, the
 * first of them on the page. `dissolved` is shared across one mutation so a
 * form two targets have in common is dissolved once; every handle in it is
 * dead. Nothing is created between the calls that share it, so a handle
 * cannot be reused for a live object while the set is in play.
 */
export function dissolveFormChain(
  doc: PdfDocument,
  pageIndex: number,
  chain: readonly number[],
  dissolved: Set<number>,
): void {
  const { mod } = doc;
  const page = doc.page(pageIndex);

  for (const form of chain) {
    if (dissolved.has(form)) continue;

    // On the page by now: the first form always was, and each deeper one was
    // placed there when its parent was dissolved. So its matrix maps its
    // contents to page space, and its clip is in page space.
    const at = indexOnPage(mod, page, form);
    if (at < 0) {
      throw new Error('That content could not be separated from the group built into the page.');
    }
    const matrix = objectMatrix(mod, form);

    const count = mod.FPDFFormObj_CountObjects(form);
    const children: number[] = [];
    for (let i = 0; i < count; i++) {
      const child = mod.FPDFFormObj_GetObject(form, i);
      if (child) children.push(child);
    }

    assertClipDoesNotCrop(mod, form, children, matrix);

    children.forEach((child, i) => {
      if (!mod.FPDFFormObj_RemoveObject(form, child)) {
        throw new Error('That content could not be separated from the group built into the page.');
      }

      if (!isIdentity(matrix)) {
        const { a, b, c, d, e, f } = matrix;
        mod.FPDFPageObj_Transform(child, a, b, c, d, e, f);
        // The clip path and any soft mask live in the form's space too, and
        // `Transform` leaves them where they were.
        mod.FPDFPageObj_TransformClipPath(child, a, b, c, d, e, f);
      }

      // Straight after the form, in the form's own order, so the drawing
      // order is what it was.
      if (!mod.FPDFPage_InsertObjectAtIndex(page, child, at + 1 + i)) {
        // The child is ours and belongs nowhere: free it rather than leak
        // it, then fail the mutation so the caller restores its snapshot.
        mod.FPDFPageObj_Destroy(child);
        throw new Error('That content could not be placed back on the page.');
      }
    });

    // Empty now, and never to be written. Removing it takes the `Do` out of
    // the page stream; its XObject stays in the file unreferenced.
    if (mod.FPDFPage_RemoveObject(page, form)) mod.FPDFPageObj_Destroy(form);
    dissolved.add(form);
  }
}

function indexOnPage(mod: WrappedPdfiumModule, page: number, handle: number): number {
  const count = mod.FPDFPage_CountObjects(page);
  for (let i = 0; i < count; i++) {
    if (mod.FPDFPage_GetObject(page, i) === handle) return i;
  }
  return -1;
}

/**
 * Refuse to dissolve a form whose clip crops any of its children.
 *
 * Children's bounds are reported in the form's space and are mapped through
 * the form's matrix; the form is on the page, so its clip is in page space
 * already.
 */
function assertClipDoesNotCrop(
  mod: WrappedPdfiumModule,
  form: number,
  children: readonly number[],
  matrix: Matrix,
): void {
  const rects = clipRectangles(mod, form);
  if (rects === null) throw new Error(CLIPPED_MESSAGE);
  if (rects.length === 0) return;

  for (const child of children) {
    const bounds = transformRect(matrix, objectBounds(mod, child));
    for (const rect of rects) {
      const contained =
        bounds.left >= rect.left - CLIP_TOLERANCE &&
        bounds.right <= rect.right + CLIP_TOLERANCE &&
        bounds.bottom >= rect.bottom - CLIP_TOLERANCE &&
        bounds.top <= rect.top + CLIP_TOLERANCE;
      if (!contained) throw new Error(CLIPPED_MESSAGE);
    }
  }
}

/**
 * The object's clip, as rectangles.
 *
 * Empty when there is no clip. Null when the clip is anything but
 * axis-aligned rectangles — a curve, a polygon, or an empty path, which PDFium
 * uses to mean "clip everything" — because containment cannot be decided from
 * a bounding box then, and the safe answer is to refuse.
 *
 * PDFium has already done part of this work: while parsing, it discards a
 * single rectangular clip that contains the whole object it applies to
 * (`CPDF_ContentParser::CheckClip`), which is why a page-sized `re W n`
 * around a wrapper form never shows up here. A clip that does show up crops
 * *something* in the form.
 */
function clipRectangles(mod: WrappedPdfiumModule, handle: number): Rect[] | null {
  const clip = mod.FPDFPageObj_GetClipPath(handle);
  if (!clip) return [];

  // A handle comes back for every object; -1 is how PDFium says it holds no
  // clip at all.
  const count = mod.FPDFClipPath_CountPaths(clip);
  if (count < 0) return [];

  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const segments = mod.FPDFClipPath_CountPathSegments(clip, i);
    if (segments <= 0) return null;

    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < segments; j++) {
      const segment = mod.FPDFClipPath_GetPathSegment(clip, i, j);
      if (!segment) return null;
      const type = mod.FPDFPathSegment_GetType(segment);
      if (type !== Segment.LineTo && type !== Segment.MoveTo) return null;

      const point = withScope(mod, (scope) => {
        const x = scope.allocFloat();
        const y = scope.allocFloat();
        if (!mod.FPDFPathSegment_GetPoint(segment, x, y)) return null;
        return { x: readFloat(mod, x), y: readFloat(mod, y) };
      });
      if (!point) return null;
      xs.push(point.x);
      ys.push(point.y);
    }

    const rect = {
      left: Math.min(...xs),
      right: Math.max(...xs),
      bottom: Math.min(...ys),
      top: Math.max(...ys),
    };
    // Every point on a corner, and no more points than a closed rectangle
    // has: anything else is a shape whose bounding box says nothing about
    // what it hides.
    const onCorner = (x: number, y: number) =>
      (near(x, rect.left) || near(x, rect.right)) && (near(y, rect.bottom) || near(y, rect.top));
    if (segments > 5 || !xs.every((x, k) => onCorner(x, ys[k]))) return null;

    rects.push(rect);
  }
  return rects;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-3;
}
