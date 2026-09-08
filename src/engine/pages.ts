import type { PdfDocument } from './document';
import { withScope } from './memory';

/**
 * Page-level operations: rotate, delete, reorder, insert, merge, split.
 *
 * Every one of these changes page indices, and the document caches page
 * handles by index. So each ends by invalidating the whole cache rather than
 * trying to patch it: a handle filed under a stale index hands back the wrong
 * page, and that is a class of bug worth designing out rather than debugging.
 */

/** Rotate a page. `quarterTurns` is added to the current rotation. */
export function rotatePage(doc: PdfDocument, pageIndex: number, quarterTurns: number): void {
  const { mod } = doc;
  const page = doc.page(pageIndex);
  const current = mod.FPDFPage_GetRotation(page);
  const next = (((current + quarterTurns) % 4) + 4) % 4;
  mod.FPDFPage_SetRotation(page, next);
  // Rotation lives in the page dictionary, not the content stream, so no
  // content regeneration is needed. The bitmap is stale, though.
  doc.markDirty(pageIndex);
}

/** Delete pages. Indices refer to the document as it is now. */
export function deletePages(doc: PdfDocument, indices: number[]): void {
  const unique = [...new Set(indices)].sort((a, b) => b - a);
  if (unique.length === 0) return;
  if (unique.length >= doc.pageCount) {
    throw new Error('A document must keep at least one page.');
  }

  // Highest first, so each deletion cannot shift the indices still to come.
  for (const index of unique) {
    doc.invalidatePage(index);
    doc.mod.FPDFPage_Delete(doc.handle, index);
  }
  doc.invalidateAllPages();
}

/**
 * Move a run of pages to a new position.
 *
 * `destination` is the index the first moved page should end up at, counted
 * in the document *after* the moved pages are lifted out — which is what
 * `FPDF_MovePages` expects.
 */
export function movePages(doc: PdfDocument, indices: number[], destination: number): void {
  const { mod } = doc;
  const unique = [...new Set(indices)].sort((a, b) => a - b);
  if (unique.length === 0) return;

  const ok = withScope(mod, (scope) => {
    const ptr = scope.alloc(unique.length * 4);
    unique.forEach((value, i) => mod.pdfium.setValue(ptr + i * 4, value, 'i32'));
    return mod.FPDF_MovePages(doc.handle, ptr, unique.length, destination);
  });

  if (!ok) throw new Error('Those pages could not be moved.');
  doc.invalidateAllPages();
}

/** Insert a blank page. Size defaults to that of the page before it. */
export function insertBlankPage(
  doc: PdfDocument,
  atIndex: number,
  width?: number,
  height?: number,
): void {
  const { mod } = doc;

  let w = width;
  let h = height;
  if (w === undefined || h === undefined) {
    // Match the neighbouring page, so a blank inserted into a letter-size
    // document is letter-size rather than PDFium's default.
    const reference = Math.min(Math.max(0, atIndex - 1), Math.max(0, doc.pageCount - 1));
    if (doc.pageCount > 0) {
      const page = doc.page(reference);
      w ??= mod.FPDF_GetPageWidthF(page);
      h ??= mod.FPDF_GetPageHeightF(page);
    } else {
      w ??= 612;
      h ??= 792;
    }
  }

  const page = mod.FPDFPage_New(doc.handle, atIndex, w, h);
  if (!page) throw new Error('A blank page could not be added.');
  doc.invalidateAllPages();
}

/**
 * Append pages from another document.
 *
 * `pageRange` uses PDFium's 1-based syntax, e.g. `"1,3-5"`. Passing an empty
 * range imports everything.
 */
export function importPages(
  doc: PdfDocument,
  source: PdfDocument,
  atIndex: number,
  pageRange = '',
): void {
  const ok = doc.mod.FPDF_ImportPages(doc.handle, source.handle, pageRange, atIndex);
  if (!ok) throw new Error('Those pages could not be imported.');
  doc.invalidateAllPages();
}

/**
 * Build a new document from a subset of this one's pages, in the given order.
 *
 * This is how split and export-selection work. It also serves as a rebuild
 * path: importing into a fresh document drops orphaned objects.
 */
export function extractPages(doc: PdfDocument, indices: number[]): Uint8Array {
  const { mod } = doc;
  if (indices.length === 0) throw new Error('Select at least one page.');

  const target = mod.FPDF_CreateNewDocument();
  if (!target) throw new Error('A new document could not be created.');

  try {
    const ok = withScope(mod, (scope) => {
      const ptr = scope.alloc(indices.length * 4);
      indices.forEach((value, i) => mod.pdfium.setValue(ptr + i * 4, value, 'i32'));
      return mod.FPDF_ImportPagesByIndex(target, doc.handle, ptr, indices.length, 0);
    });
    if (!ok) throw new Error('Those pages could not be copied.');

    mod.FPDF_CopyViewerPreferences(target, doc.handle);

    // The same FPDF_FILEWRITE dance as PdfDocument.save, against a document
    // that is not wrapped in PdfDocument because it exists only for this call.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const callback = mod.pdfium.addFunction(
      (_self: number, dataPtr: number, size: number) => {
        const chunk = new Uint8Array(size);
        chunk.set(mod.pdfium.HEAPU8.subarray(dataPtr, dataPtr + size));
        chunks.push(chunk);
        total += size;
        return 1;
      },
      'iiii',
    );

    try {
      const saved = withScope(mod, (scope) => {
        const writer = scope.alloc(8);
        mod.pdfium.setValue(writer, 1, 'i32');
        mod.pdfium.setValue(writer + 4, callback, 'i32');
        return mod.FPDF_SaveAsCopy(target, writer, 2);
      });
      if (!saved) throw new Error('The extracted pages could not be saved.');
    } finally {
      mod.pdfium.removeFunction(callback);
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } finally {
    mod.FPDF_CloseDocument(target);
  }
}
