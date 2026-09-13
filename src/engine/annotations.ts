import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { AnnotSubtype } from './constants';
import type { PdfDocument } from './document';
import { detachFieldsFromForm } from './field-tree';
import { readRectF, withScope, type Rect } from './memory';
import type { Annotation } from './types';

/**
 * Annotations, and the signature fields among them.
 *
 * Field types are read straight off the annotation dictionary with
 * `FPDFAnnot_GetStringValue(annot, 'FT')`, which returns `Sig`, `Tx` and so
 * on. The alternative is `FPDFAnnot_GetFormFieldType`, which needs a form-fill
 * environment: a large struct of callbacks that exists to support interactive
 * form editing and is unnecessary for reading.
 */

/** Read a string entry from an annotation's dictionary. */
function readAnnotString(mod: WrappedPdfiumModule, annot: number, key: string): string {
  return withScope(mod, (scope) => {
    const needed = mod.FPDFAnnot_GetStringValue(annot, key, 0, 0);
    if (needed <= 2) return '';
    const buffer = scope.alloc(needed);
    mod.FPDFAnnot_GetStringValue(annot, key, buffer, needed);
    return mod.pdfium.UTF16ToString(buffer);
  });
}

function annotRect(mod: WrappedPdfiumModule, annot: number): Rect {
  return withScope(mod, (scope) => {
    const ptr = scope.allocRectF();
    if (!mod.FPDFAnnot_GetRect(annot, ptr)) {
      return { left: 0, bottom: 0, right: 0, top: 0 };
    }
    return readRectF(mod, ptr);
  });
}

/** Everything known about one annotation, without holding its handle. */
export interface AnnotationDetail extends Annotation {
  /** `/FT`, the form field type: `Sig`, `Tx`, `Btn`, `Ch`, or empty. */
  fieldType: string;
  /** `/NM`, the annotation name. */
  name: string;
  /** True when a form field carries a `/V` value. */
  hasValue: boolean;
  /** True when this is a signature field holding actual signature data. */
  isSignedSignatureField: boolean;
  /** True when this is a signature field with nothing in it yet. */
  isEmptySignatureField: boolean;
}

/** Run `fn` with an annotation handle, closing it afterwards. */
function withAnnot<T>(
  doc: PdfDocument,
  pageIndex: number,
  index: number,
  fn: (annot: number) => T,
): T {
  const { mod } = doc;
  const page = doc.page(pageIndex);
  const annot = mod.FPDFPage_GetAnnot(page, index);
  if (!annot) throw new Error(`Annotation ${index} could not be read.`);
  try {
    return fn(annot);
  } finally {
    mod.FPDFPage_CloseAnnot(annot);
  }
}

export function listAnnotations(doc: PdfDocument, pageIndex: number): AnnotationDetail[] {
  const { mod } = doc;
  const page = doc.page(pageIndex);
  const count = mod.FPDFPage_GetAnnotCount(page);
  const out: AnnotationDetail[] = [];

  for (let i = 0; i < count; i++) {
    const annot = mod.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    try {
      const subtype = mod.FPDFAnnot_GetSubtype(annot);
      const fieldType = readAnnotString(mod, annot, 'FT');
      const hasValue = mod.FPDFAnnot_HasKey(annot, 'V');
      const isSig = subtype === AnnotSubtype.Widget && fieldType === 'Sig';

      out.push({
        page: pageIndex,
        index: i,
        subtype,
        bounds: annotRect(mod, annot),
        fieldType,
        name: readAnnotString(mod, annot, 'NM'),
        title: readAnnotString(mod, annot, 'T') || undefined,
        hasValue,
        // A signature field with a /V holds signature data. One without is an
        // empty placeholder: somewhere for a signature to go, not a signature.
        // Removing the latter invalidates nothing, and telling the two apart
        // is something the mainstream tools get wrong.
        isSignedSignatureField: isSig && hasValue,
        isEmptySignatureField: isSig && !hasValue,
      });
    } finally {
      mod.FPDFPage_CloseAnnot(annot);
    }
  }

  return out;
}

/**
 * Remove annotations from a page.
 *
 * Indices are removed high to low, because `FPDFPage_RemoveAnnot` renumbers
 * everything after the one it removes.
 *
 * A widget is the visible end of a form field, and the field is somewhere
 * `FPDFPage_RemoveAnnot` never looks: `/AcroForm /Fields`, or a parent's
 * `/Kids`. Left there, Acrobat rebuilds the widget from the field tree and the
 * saved file shows the field the user watched disappear, old value and all.
 * So the widgets' object numbers are read before anything is removed — an
 * annotation that has left `/Annots` cannot be opened again — the tree is
 * edited in the serialised bytes afterwards (`field-tree.ts` says why it has
 * to be bytes), and the document is reloaded from the result.
 *
 * That reload voids every PDFium handle for the document. Do not hold a page,
 * annotation or text page across this call; `doc.page()` hands out a fresh
 * one afterwards.
 *
 * Annotations are not page content, so the page is not marked dirty: there is
 * nothing in its content stream to regenerate, and regenerating it anyway
 * would rewrite a stream the user did not touch. Callers that need the page
 * repainted say so through the session's `repaint` list.
 */
export function removeAnnotations(doc: PdfDocument, pageIndex: number, indices: number[]): number {
  const { mod } = doc;
  const page = doc.page(pageIndex);
  const ordered = [...new Set(indices)].sort((a, b) => b - a);

  const widgetAt = new Map<number, number>();
  for (const index of ordered) {
    const annot = mod.FPDFPage_GetAnnot(page, index);
    if (!annot) continue;
    try {
      if (mod.FPDFAnnot_GetSubtype(annot) === AnnotSubtype.Widget) {
        // 0 for a widget written as a direct object, which nothing in the
        // field tree can refer to, so there is nothing to detach.
        const objectNumber = mod.EPDFAnnot_GetObjectNumber(annot);
        if (objectNumber > 0) widgetAt.set(index, objectNumber);
      }
    } finally {
      mod.FPDFPage_CloseAnnot(annot);
    }
  }

  let removed = 0;
  const widgets: number[] = [];
  for (const index of ordered) {
    if (!mod.FPDFPage_RemoveAnnot(page, index)) continue;
    removed++;
    const objectNumber = widgetAt.get(index);
    if (objectNumber !== undefined) widgets.push(objectNumber);
  }

  if (widgets.length > 0) doc.reload(detachFieldsFromForm(doc.save(), widgets));
  return removed;
}

/** Details of the document's cryptographic signatures. */
export interface DigitalSignature {
  index: number;
  reason: string;
  subFilter: string;
  /** Signing time as recorded in the signature dictionary, if present. */
  time: string;
  /**
   * `/DocMDP` permission level, or 0 when this is not a certification
   * signature. 1 means no changes are allowed at all, 2 allows form fill-in
   * and signing, 3 additionally allows annotation changes.
   */
  docMdpPermission: number;
}

/** Read the document's cryptographic signature dictionaries. */
export function listDigitalSignatures(doc: PdfDocument): DigitalSignature[] {
  const { mod } = doc;
  const count = mod.FPDF_GetSignatureCount(doc.handle);
  const out: DigitalSignature[] = [];

  for (let i = 0; i < count; i++) {
    const sig = mod.FPDF_GetSignatureObject(doc.handle, i);
    if (!sig) continue;

    out.push({
      index: i,
      reason: readSigString(mod, (buf, len) => mod.FPDFSignatureObj_GetReason(sig, buf, len), true),
      subFilter: readSigString(
        mod,
        (buf, len) => mod.FPDFSignatureObj_GetSubFilter(sig, buf, len),
        false,
      ),
      time: readSigString(mod, (buf, len) => mod.FPDFSignatureObj_GetTime(sig, buf, len), false),
      docMdpPermission: mod.FPDFSignatureObj_GetDocMDPPermission(sig),
    });
  }

  return out;
}

function readSigString(
  mod: WrappedPdfiumModule,
  fill: (buffer: number, length: number) => number,
  utf16: boolean,
): string {
  const needed = fill(0, 0);
  if (needed <= 1) return '';
  return withScope(mod, (scope) => {
    const buffer = scope.alloc(needed);
    fill(buffer, needed);
    return utf16 ? mod.pdfium.UTF16ToString(buffer) : mod.pdfium.UTF8ToString(buffer);
  });
}

/**
 * The strictest certification level in the document.
 *
 * A certification signature records what changes the author permitted, and
 * that permission is inside the signed bytes so it cannot be edited away. It
 * is worth surfacing before the user starts work rather than after.
 */
export function certificationLevel(doc: PdfDocument): number {
  let strictest = 0;
  for (const sig of listDigitalSignatures(doc)) {
    if (sig.docMdpPermission > 0) {
      strictest =
        strictest === 0 ? sig.docMdpPermission : Math.min(strictest, sig.docMdpPermission);
    }
  }
  return strictest;
}

export function subtypeName(subtype: number): string {
  const found = Object.entries(AnnotSubtype).find(([, v]) => v === subtype);
  return found ? found[0] : 'Unknown';
}
