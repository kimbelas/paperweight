import { BitmapFormat, RenderFlag } from './constants';
import type { PdfDocument } from './document';
import { withScope, type Rect } from './memory';
import type { RenderedPage } from './types';

/** Rendering budget. A page bigger than this is drawn at a reduced scale. */
const MAX_PIXELS = 16_000_000;

export interface RenderOptions {
  /** CSS scale multiplied by device pixel ratio. */
  scale: number;
  /** Draw annotations. Off while editing so widgets do not double up. */
  annotations?: boolean;
  /** Use the print render path, which ignores screen-only annotations. */
  printing?: boolean;
}

/**
 * Render a page to RGBA pixels.
 *
 * `ReverseByteOrder` is set so PDFium writes RGBA rather than its native BGRA,
 * which means the buffer can go straight into `ImageData` with no swizzle pass.
 */
export function renderPage(
  doc: PdfDocument,
  pageIndex: number,
  options: RenderOptions,
): RenderedPage {
  const { mod } = doc;
  const page = doc.page(pageIndex);

  const pointWidth = mod.FPDF_GetPageWidthF(page);
  const pointHeight = mod.FPDF_GetPageHeightF(page);

  const scale = clampScale(pointWidth, pointHeight, options.scale);
  const width = Math.max(1, Math.floor(pointWidth * scale));
  const height = Math.max(1, Math.floor(pointHeight * scale));

  const bitmap = mod.FPDFBitmap_Create(width, height, 1);
  if (!bitmap) throw new Error(`Not enough memory to render page ${pageIndex + 1}.`);

  try {
    // Start from opaque white. A PDF page has no background of its own, and an
    // unfilled bitmap is transparent black, which shows up as a black page.
    mod.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);

    let flags = RenderFlag.ReverseByteOrder | RenderFlag.LcdText;
    if (options.annotations) flags |= RenderFlag.Annot;
    if (options.printing) flags |= RenderFlag.Printing;

    // `rotate: 0` means "as the page's own /Rotate says"; PDFium has already
    // applied it to the reported width and height.
    mod.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, flags);

    // Then the form fields, in a second pass over the same bitmap.
    //
    // A filled AcroForm keeps its values in the field dictionaries, not in the
    // page's content stream, and a field filled by software often carries no
    // appearance stream at all. `FPDF_RenderPageBitmap` draws neither, so a
    // completed form renders as an empty one -- blank on screen while every
    // value appears when printed through the browser's own viewer, because
    // that viewer does run this pass.
    //
    // Unconditional, not gated on `options.annotations`: that switch exists so
    // the app's pending overlays are not drawn twice, and a field value is not
    // an overlay. It is what the document says, so hiding it while editing
    // would mean editing a page that looks emptier than it is.
    if (doc.form) {
      mod.FPDF_FFLDraw(doc.form, bitmap, page, 0, 0, width, height, 0, flags);
    }

    const bufferPtr = mod.FPDFBitmap_GetBuffer(bitmap);
    const byteLength = width * height * 4;
    const data = new Uint8ClampedArray(byteLength);
    data.set(mod.pdfium.HEAPU8.subarray(bufferPtr, bufferPtr + byteLength));

    return { page: pageIndex, width, height, data, scale };
  } finally {
    mod.FPDFBitmap_Destroy(bitmap);
  }
}

function clampScale(pointWidth: number, pointHeight: number, scale: number): number {
  const pixels = pointWidth * scale * pointHeight * scale;
  if (pixels <= MAX_PIXELS) return scale;
  return Math.sqrt(MAX_PIXELS / (pointWidth * pointHeight));
}

/**
 * Map a point from rendered-bitmap space to PDF user space.
 *
 * Always go through PDFium for this rather than composing a matrix by hand:
 * `FPDF_DeviceToPage` accounts for `/Rotate` and for a crop box whose origin
 * is not (0, 0), and getting either wrong puts every click and every drawn
 * rectangle in the wrong place on exactly the documents that are hardest to
 * debug.
 */
export function deviceToPage(
  doc: PdfDocument,
  pageIndex: number,
  deviceWidth: number,
  deviceHeight: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const { mod } = doc;
  const page = doc.page(pageIndex);

  return withScope(mod, (scope) => {
    const outX = scope.alloc(8); // double
    const outY = scope.alloc(8);
    const ok = mod.FPDF_DeviceToPage(
      page,
      0,
      0,
      deviceWidth,
      deviceHeight,
      0,
      Math.round(x),
      Math.round(y),
      outX,
      outY,
    );
    if (!ok) throw new Error('Could not map that point onto the page.');
    return {
      x: mod.pdfium.getValue(outX, 'double'),
      y: mod.pdfium.getValue(outY, 'double'),
    };
  });
}

/** Map a point from PDF user space to rendered-bitmap space. */
export function pageToDevice(
  doc: PdfDocument,
  pageIndex: number,
  deviceWidth: number,
  deviceHeight: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const { mod } = doc;
  const page = doc.page(pageIndex);

  return withScope(mod, (scope) => {
    const outX = scope.allocInt();
    const outY = scope.allocInt();
    const ok = mod.FPDF_PageToDevice(page, 0, 0, deviceWidth, deviceHeight, 0, x, y, outX, outY);
    if (!ok) throw new Error('Could not map that point onto the view.');
    return {
      x: mod.pdfium.getValue(outX, 'i32'),
      y: mod.pdfium.getValue(outY, 'i32'),
    };
  });
}

/**
 * Convert a rectangle from device space to PDF space.
 *
 * The corners are re-ordered afterwards because y is flipped between the two
 * spaces, and on a rotated page the mapping can swap x as well.
 */
export function deviceRectToPage(
  doc: PdfDocument,
  pageIndex: number,
  deviceWidth: number,
  deviceHeight: number,
  rect: { x: number; y: number; width: number; height: number },
): Rect {
  const a = deviceToPage(doc, pageIndex, deviceWidth, deviceHeight, rect.x, rect.y);
  const b = deviceToPage(
    doc,
    pageIndex,
    deviceWidth,
    deviceHeight,
    rect.x + rect.width,
    rect.y + rect.height,
  );
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    bottom: Math.min(a.y, b.y),
    top: Math.max(a.y, b.y),
  };
}
