import { BitmapFormat, FillMode, LineCap, LineJoin } from './constants';
import type { PdfDocument } from './document';
import { findFallback, loadFallbackIntoDocument } from './fonts';
import { MARKS, markStrokeWidth } from './marks';
import { rectHeight, rectWidth, setObjectMatrix, withScope, type Rect, type Rgba } from './memory';
import type {
  ImagePlacement,
  PathPlacement,
  Placement,
  RectPlacement,
  TextPlacement,
} from './types';

/**
 * Adding content to a page: signatures, images, text and cover rectangles.
 *
 * These are the "apply" half of the editor. While the user is working, an
 * addition is an overlay object in the UI that can be dragged and resized
 * freely. Applying it turns it into a real page object here, which is what
 * makes it survive saving, printing and being opened in any other viewer.
 */

/**
 * Draw an image onto a page.
 *
 * Used for signatures, whether drawn, typed or uploaded: all three become a
 * transparent PNG and take this path. Flattening to an image object rather
 * than a stamp annotation is deliberate. Annotations are hidden by some
 * viewers when printing, and a signature that does not print is worse than
 * useless.
 */
export function insertImage(doc: PdfDocument, placement: ImagePlacement): void {
  const { mod } = doc;
  const page = doc.page(placement.page);
  const { pixelWidth, pixelHeight, data, rect } = placement;

  if (pixelWidth <= 0 || pixelHeight <= 0) throw new Error('That image has no size.');
  if (data.length < pixelWidth * pixelHeight * 4) {
    throw new Error('That image data is incomplete.');
  }

  const imageObj = mod.FPDFPageObj_NewImageObj(doc.handle);
  if (!imageObj) throw new Error('The image could not be added.');

  const stride = pixelWidth * 4;

  // PDFium reads bitmap memory lazily, so the buffer has to outlive the
  // FPDFImageObj_SetBitmap call. It is allocated outside any scope and freed
  // only once the bitmap has been consumed and destroyed.
  const bufferPtr = mod.pdfium.wasmExports.malloc(stride * pixelHeight);
  if (!bufferPtr) {
    mod.FPDFPageObj_Destroy(imageObj);
    throw new Error('Not enough memory to add that image.');
  }

  let bitmap = 0;
  try {
    // Input bitmaps are BGRA; the RGBA that canvases and PNGs produce has to
    // be swizzled. On the way out, rendering asks PDFium for reversed byte
    // order instead, which is why only this direction needs the swap.
    const heap = mod.pdfium.HEAPU8;
    for (let i = 0, n = pixelWidth * pixelHeight; i < n; i++) {
      const s = i * 4;
      const d = bufferPtr + s;
      heap[d] = data[s + 2];
      heap[d + 1] = data[s + 1];
      heap[d + 2] = data[s];
      heap[d + 3] = data[s + 3];
    }

    bitmap = mod.FPDFBitmap_CreateEx(
      pixelWidth,
      pixelHeight,
      BitmapFormat.BGRA,
      bufferPtr,
      stride,
    );
    if (!bitmap) throw new Error('The image could not be prepared.');

    // Passing no pages is valid and means "do not update page caches".
    if (!mod.FPDFImageObj_SetBitmap(0, 0, imageObj, bitmap)) {
      throw new Error('The image data could not be attached.');
    }

    // An image object's own space is the unit square, so its matrix carries
    // the whole placement: scale to the target size, translate to the target
    // corner.
    setObjectMatrix(mod, imageObj, {
      a: rectWidth(rect),
      b: 0,
      c: 0,
      d: rectHeight(rect),
      e: rect.left,
      f: rect.bottom,
    });

    mod.FPDFPage_InsertObject(page, imageObj);
    doc.markDirty(placement.page);
  } catch (error) {
    mod.FPDFPageObj_Destroy(imageObj);
    throw error;
  } finally {
    if (bitmap) mod.FPDFBitmap_Destroy(bitmap);
    mod.pdfium.wasmExports.free(bufferPtr);
  }
}

/**
 * Draw a filled rectangle.
 *
 * This backs the Cover tool. It is called "cover" and never "redact" because
 * that is what it does: the content underneath is still in the file, still
 * selectable and still extractable. Calling it redaction would be a lie with
 * consequences.
 */
export function insertRect(doc: PdfDocument, placement: RectPlacement): void {
  const { mod } = doc;
  const page = doc.page(placement.page);
  const { rect, colour } = placement;

  const obj = mod.FPDFPageObj_CreateNewRect(
    rect.left,
    rect.bottom,
    rectWidth(rect),
    rectHeight(rect),
  );
  if (!obj) throw new Error('The rectangle could not be added.');

  try {
    mod.FPDFPageObj_SetFillColor(obj, colour.r, colour.g, colour.b, colour.a);
    // Without an explicit fill mode the path is constructed but never
    // painted, which looks like the tool silently doing nothing.
    if (!mod.FPDFPath_SetDrawMode(obj, FillMode.Winding, false)) {
      throw new Error('The rectangle could not be filled.');
    }
    mod.FPDFPage_InsertObject(page, obj);
    doc.markDirty(placement.page);
  } catch (error) {
    mod.FPDFPageObj_Destroy(obj);
    throw error;
  }
}

/**
 * Draw a mark — a cross, a tick, a ring, a dot, a rule — as a vector path.
 *
 * The geometry comes from `marks.ts` in a unit box and is scaled onto the
 * placement's rectangle here. Sharing that definition with the on-screen
 * preview is the point: the mark that lands in the file is the same shape the
 * user positioned, rather than a second drawing of the same idea.
 *
 * Everything is built in page space rather than in the unit square with a
 * matrix on top. A matrix would scale the stroke width with the box, so a
 * mark stretched wide would come out with an oval pen, which is what a
 * squashed hand-drawn tick looks like and is never what was wanted.
 */
export function insertPath(doc: PdfDocument, placement: PathPlacement): void {
  const { mod } = doc;
  const page = doc.page(placement.page);
  const { rect, colour } = placement;

  const def = MARKS[placement.shape];
  if (!def) throw new Error(`Unknown mark "${placement.shape}".`);

  const width = rectWidth(rect);
  const height = rectHeight(rect);
  if (width <= 0 || height <= 0) throw new Error('That mark has no size.');

  const x = (u: number) => rect.left + u * width;
  const y = (v: number) => rect.bottom + v * height;

  // One path object holding every subpath, so the cross is a single thing to
  // select, move and delete rather than two strokes that come apart.
  const first = def.subpaths[0];
  const obj = mod.FPDFPageObj_CreateNewPath(x(first.from[0]), y(first.from[1]));
  if (!obj) throw new Error('The mark could not be added.');

  try {
    def.subpaths.forEach((subpath, index) => {
      if (index > 0 && !mod.FPDFPath_MoveTo(obj, x(subpath.from[0]), y(subpath.from[1]))) {
        throw new Error('The mark could not be drawn.');
      }

      for (const segment of subpath.segments) {
        const ok =
          'c1' in segment
            ? mod.FPDFPath_BezierTo(
                obj,
                x(segment.c1[0]),
                y(segment.c1[1]),
                x(segment.c2[0]),
                y(segment.c2[1]),
                x(segment.to[0]),
                y(segment.to[1]),
              )
            : mod.FPDFPath_LineTo(obj, x(segment.to[0]), y(segment.to[1]));
        if (!ok) throw new Error('The mark could not be drawn.');
      }

      if (subpath.close) mod.FPDFPath_Close(obj);
    });

    if (def.filled) {
      mod.FPDFPageObj_SetFillColor(obj, colour.r, colour.g, colour.b, colour.a);
    } else {
      mod.FPDFPageObj_SetStrokeColor(obj, colour.r, colour.g, colour.b, colour.a);
      mod.FPDFPageObj_SetStrokeWidth(obj, markStrokeWidth(width, height, placement.weight));
      // Round ends and corners: a tick with mitred joins reads as a machine
      // mark, and these stand in for something drawn by hand.
      mod.FPDFPageObj_SetLineCap(obj, LineCap.Round);
      mod.FPDFPageObj_SetLineJoin(obj, LineJoin.Round);
    }

    // Same trap as the cover rectangle: without an explicit draw mode the path
    // is built and then never painted, which looks like the tool silently
    // doing nothing. A stroked mark asks for no fill at all.
    if (!mod.FPDFPath_SetDrawMode(obj, def.filled ? FillMode.Winding : FillMode.None, !def.filled)) {
      throw new Error('The mark could not be painted.');
    }

    mod.FPDFPage_InsertObject(page, obj);
    doc.markDirty(placement.page);
  } catch (error) {
    mod.FPDFPageObj_Destroy(obj);
    throw error;
  }
}

/** Draw new text in one of the bundled fonts. */
export async function insertText(doc: PdfDocument, placement: TextPlacement): Promise<void> {
  const { mod } = doc;
  const page = doc.page(placement.page);

  const fallback = findFallback(placement.fontKey);
  if (!fallback) throw new Error(`Unknown font "${placement.fontKey}".`);

  const fontHandle = await loadFallbackIntoDocument(doc, fallback);
  const obj = mod.FPDFPageObj_CreateTextObj(doc.handle, fontHandle, placement.fontSize);
  if (!obj) throw new Error('The text could not be added.');

  try {
    const ok = withScope(mod, (scope) =>
      mod.FPDFText_SetText(obj, scope.allocUtf16(placement.text)),
    );
    if (!ok) throw new Error('The text could not be set.');

    mod.FPDFPageObj_SetFillColor(
      obj,
      placement.colour.r,
      placement.colour.g,
      placement.colour.b,
      placement.colour.a,
    );
    setObjectMatrix(mod, obj, { a: 1, b: 0, c: 0, d: 1, e: placement.x, f: placement.y });
    mod.FPDFPage_InsertObject(page, obj);
    doc.markDirty(placement.page);
  } catch (error) {
    mod.FPDFPageObj_Destroy(obj);
    throw error;
  }
}

/** Apply a batch of placements in order, so later ones paint on top. */
export async function applyPlacements(
  doc: PdfDocument,
  placements: Placement[],
): Promise<void> {
  for (const placement of placements) {
    switch (placement.type) {
      case 'image':
        insertImage(doc, placement);
        break;
      case 'rect':
        insertRect(doc, placement);
        break;
      case 'path':
        insertPath(doc, placement);
        break;
      case 'text':
        await insertText(doc, placement);
        break;
    }
  }
}

export interface PatchRegionRequest {
  page: number;
  /** The region to paint over, in PDF points. */
  rect: Rect;
  text: string;
  fontSize: number;
  fontKey: string;
  colour: Rgba;
  /** Override the sampled background, e.g. plain white. */
  background?: Rgba;
}

/**
 * Replace text on a page that has none: paint over the pixels and draw again.
 *
 * This is the only way to change a word on a scan. The ink there is part of a
 * photograph, not a text object, so there is nothing to edit — the region is
 * covered and new text is drawn on top.
 *
 * It is a genuinely different operation from editing text, and the UI must
 * keep them apart. The result is a patch: clean over a flat white scan,
 * visible over a grey or textured one, and never a match for the original
 * typeface. The original pixels also remain in the image underneath, so this
 * is not redaction.
 */
export async function patchTextRegion(
  doc: PdfDocument,
  request: PatchRegionRequest,
): Promise<void> {
  const { rect, page } = request;

  // Sampled from the ring just outside the region, so a patch over a shaded
  // form field or a grey scan matches its surroundings instead of leaving a
  // white block.
  const background = request.background ?? sampleBackgroundColour(doc, page, rect);

  // A little bleed, because a glyph's ink usually reaches a fraction past the
  // box OCR reports and a hairline of the original would otherwise survive.
  const bleed = Math.max(0.6, (rect.top - rect.bottom) * 0.08);
  insertRect(doc, {
    type: 'rect',
    page,
    rect: {
      left: rect.left - bleed,
      right: rect.right + bleed,
      bottom: rect.bottom - bleed,
      top: rect.top + bleed,
    },
    colour: background,
  });

  if (request.text.trim() === '') return;

  // Sit the replacement on the baseline the original occupied: a line box is
  // roughly cap height plus descender, so the baseline is about a fifth of
  // the box up from its bottom edge.
  await insertText(doc, {
    type: 'text',
    page,
    x: rect.left,
    y: rect.bottom + (rect.top - rect.bottom) * 0.2,
    text: request.text,
    fontSize: request.fontSize,
    colour: request.colour,
    fontKey: request.fontKey,
  });
}

/**
 * Sample the page background just outside a rectangle.
 *
 * The Cover tool defaults to white, which is wrong over a shaded table cell or
 * a coloured band. Reading the actual pixels next to the target is a better
 * guess than assuming the page is white.
 */
export function sampleBackgroundColour(
  doc: PdfDocument,
  pageIndex: number,
  rect: Rect,
  renderScale = 2,
): Rgba {
  const { mod } = doc;
  const page = doc.page(pageIndex);
  const pageHeight = mod.FPDF_GetPageHeightF(page);
  const pageWidth = mod.FPDF_GetPageWidthF(page);

  // Render a small region around the rectangle rather than the whole page.
  const pad = 6;
  const left = Math.max(0, rect.left - pad);
  const bottom = Math.max(0, rect.bottom - pad);
  const right = Math.min(pageWidth, rect.right + pad);
  const top = Math.min(pageHeight, rect.top + pad);

  const width = Math.max(1, Math.ceil((right - left) * renderScale));
  const height = Math.max(1, Math.ceil((top - bottom) * renderScale));

  const bitmap = mod.FPDFBitmap_Create(width, height, 0);
  if (!bitmap) return { r: 255, g: 255, b: 255, a: 255 };

  try {
    mod.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
    // Shift the page so the region of interest lands at the bitmap origin.
    mod.FPDF_RenderPageBitmap(
      bitmap,
      page,
      Math.round(-left * renderScale),
      Math.round(-(pageHeight - top) * renderScale),
      Math.round(pageWidth * renderScale),
      Math.round(pageHeight * renderScale),
      0,
      0,
    );

    const bufferPtr = mod.FPDFBitmap_GetBuffer(bitmap);
    const heap = mod.pdfium.HEAPU8;

    // Sample the border ring only. The interior is the content being covered,
    // and averaging it in would tint the patch toward the thing it hides.
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const ring = Math.max(1, Math.floor(pad * renderScale * 0.5));

    for (let y = 0; y < height; y++) {
      const edgeRow = y < ring || y >= height - ring;
      for (let x = 0; x < width; x++) {
        if (!edgeRow && x >= ring && x < width - ring) continue;
        const i = bufferPtr + (y * width + x) * 4;
        // PDFium's native order here is BGRA, since no reverse flag was set.
        b += heap[i];
        g += heap[i + 1];
        r += heap[i + 2];
        n++;
      }
    }

    if (n === 0) return { r: 255, g: 255, b: 255, a: 255 };
    return {
      r: Math.round(r / n),
      g: Math.round(g / n),
      b: Math.round(b / n),
      a: 255,
    };
  } finally {
    mod.FPDFBitmap_Destroy(bitmap);
  }
}
