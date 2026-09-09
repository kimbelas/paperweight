/**
 * Reading and changing the fields of an interactive form.
 *
 * This is a second, parallel way for text to exist in a PDF, and it does not
 * meet the text-object path anywhere. `src/engine/text.ts` works through
 * `FPDFText_LoadPage`, which reads the page's content stream; a field's value
 * is not in the content stream. It is a string in the field dictionary,
 * painted from an appearance stream that hangs off the widget annotation. So
 * `getTextLines` cannot see a field value and `hitTestLine` cannot hit one,
 * however plainly it is showing on screen — which is why field editing needs
 * its own path rather than a wider hit-test tolerance.
 *
 * Changes go through the `FORM_*` input calls rather than by writing `/V`
 * directly. Setting the string by hand leaves the appearance stream showing
 * the old value, so the file would say one thing and render another; driving
 * the field the way a click and a keystroke would makes PDFium regenerate the
 * appearance itself. `FORM_ForceToKillFocus` is what commits it, exactly as
 * clicking away from a field does in a viewer.
 */

import { FormFieldType, StructSize } from './constants';
import type { PdfDocument } from './document';
import { removeAnnotations } from './annotations';
import { findFallback, measureFallback } from './fonts';
import { insertText } from './insert';
import { readRectF, withScope } from './memory';
import type { FormFieldInfo, FormFieldKind, FormFieldFit } from './types';

/** Smallest useful field width, in points. Narrower is not clickable. */
const MIN_FIELD_WIDTH = 24;
/** Keep a resized field off the very edge of the paper. */
const PAGE_MARGIN = 6;
/**
 * Padding PDFium leaves inside a text widget, in points.
 *
 * Its generated appearance insets the text by a small amount on each side, so
 * a value needs slightly more box than its measured width to avoid touching
 * the border.
 */
const FIELD_INSET = 2;

/** `FPDF_FORMFLAG_*` — fpdf_annot.h, plus the text-field bits from the spec. */
const FormFlag = {
  ReadOnly: 1 << 0,
  Required: 1 << 1,
  NoExport: 1 << 2,
  /** Text spans lines, so a single-line redraw would not reproduce it. */
  Multiline: 1 << 12,
  /**
   * One character per cell, spread across the box.
   *
   * PDFium re-spaces a comb field's glyphs individually every time it rebuilds
   * the appearance, and the flag cannot be cleared through the public API, so
   * a regenerated comb field never matches what the file drew.
   */
  Comb: 1 << 24,
} as const;

/** Map PDFium's field type onto something the interface can say out loud. */
function kindOf(type: number): FormFieldKind {
  switch (type) {
    case FormFieldType.TextField:
      return 'text';
    case FormFieldType.ComboBox:
      return 'choice';
    case FormFieldType.ListBox:
      return 'list';
    case FormFieldType.CheckBox:
      return 'checkbox';
    case FormFieldType.RadioButton:
      return 'radio';
    case FormFieldType.PushButton:
      return 'button';
    case FormFieldType.Signature:
      return 'signature';
    default:
      return 'unknown';
  }
}

function describeLimit(kind: FormFieldKind): string | undefined {
  switch (kind) {
    case 'text':
    case 'choice':
    case 'checkbox':
    case 'radio':
      return undefined;
    case 'list':
      return 'This is a list field. Choosing from its options is not supported yet.';
    case 'button':
      return 'This is a button, not a value.';
    case 'signature':
      return 'This is a signature field. Use the signature tools rather than typing into it.';
    default:
      return 'This field is of a kind the editor does not handle.';
  }
}

/** Read one of the two-call UTF-16 strings the form API returns. */
function readFormString(
  doc: PdfDocument,
  annot: number,
  read: (buffer: number, length: number) => number,
): string {
  const { mod } = doc;
  return withScope(mod, (scope) => {
    const needed = read(0, 0);
    // A two-byte result is just the terminator, i.e. an empty string.
    if (needed <= 2) return '';
    const buffer = scope.alloc(needed);
    read(buffer, needed);
    return mod.pdfium.UTF16ToString(buffer);
  });
}

/** Describe an open widget annotation as plain data. */
function describeField(
  doc: PdfDocument,
  form: number,
  annot: number,
  pageIndex: number,
): FormFieldInfo {
  const { mod } = doc;

  const type = mod.FPDFAnnot_GetFormFieldType(form, annot);
  const flags = mod.FPDFAnnot_GetFormFieldFlags(form, annot);
  const kind = kindOf(type);

  const name = readFormString(doc, annot, (b, n) =>
    mod.FPDFAnnot_GetFormFieldName(form, annot, b, n),
  );
  const value = readFormString(doc, annot, (b, n) =>
    mod.FPDFAnnot_GetFormFieldValue(form, annot, b, n),
  );

  const rect = withScope(mod, (scope) => {
    const ptr = scope.allocRectF();
    if (!mod.FPDFAnnot_GetRect(annot, ptr)) return { left: 0, bottom: 0, right: 0, top: 0 };
    return readRectF(mod, ptr);
  });

  const readOnly = (flags & FormFlag.ReadOnly) !== 0;
  const typeable = kind === 'text' || kind === 'choice';
  const clickable = kind === 'checkbox' || kind === 'radio';

  return {
    page: pageIndex,
    name,
    kind,
    value,
    rect,
    readOnly,
    editable: typeable && !readOnly,
    toggleable: clickable && !readOnly,
    notEditableReason: readOnly
      ? 'The form marks this field read-only, so its value is not meant to be changed here.'
      : describeLimit(kind),
  };
}

/**
 * The field under a point given in PDF user space, or null.
 *
 * The annotation handle is opened here and closed before returning: callers
 * get plain data, never a handle, so no field lifetime can outlive the call
 * and get used after the page is reloaded.
 */
export function formFieldAt(
  doc: PdfDocument,
  pageIndex: number,
  x: number,
  y: number,
): FormFieldInfo | null {
  const { mod } = doc;
  const form = doc.form;
  if (!form) return null;

  const page = doc.page(pageIndex);

  // `annot` is a PDFium handle, not scope memory, so it legitimately outlives
  // the scope that held the point struct.
  const annot = withScope(mod, (scope) => {
    const point = scope.alloc(StructSize.PointF);
    mod.pdfium.setValue(point, x, 'float');
    mod.pdfium.setValue(point + 4, y, 'float');
    return mod.FPDFAnnot_GetFormFieldAtPoint(form, page, point);
  });
  if (!annot) return null;

  try {
    return describeField(doc, form, annot, pageIndex);
  } finally {
    mod.FPDFPage_CloseAnnot(annot);
  }
}

/** Every form field on a page, in the order the annotations are stored. */
export function listFormFields(doc: PdfDocument, pageIndex: number): FormFieldInfo[] {
  const { mod } = doc;
  const form = doc.form;
  if (!form) return [];

  const page = doc.page(pageIndex);
  const count = mod.FPDFPage_GetAnnotCount(page);
  const fields: FormFieldInfo[] = [];

  for (let i = 0; i < count; i++) {
    const annot = mod.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    try {
      const field = describeField(doc, form, annot, pageIndex);
      // A non-widget annotation reports an unknown field type and no name.
      if (field.kind !== 'unknown' || field.name) fields.push(field);
    } finally {
      mod.FPDFPage_CloseAnnot(annot);
    }
  }

  return fields;
}

/**
 * Find a field by name.
 *
 * Names rather than indices cross the worker boundary, because an index into
 * a page's annotations is only meaningful until something reorders them,
 * whereas the name is what the form itself calls the field.
 */
export function formFieldByName(
  doc: PdfDocument,
  pageIndex: number,
  name: string,
): FormFieldInfo | null {
  return listFormFields(doc, pageIndex).find((f) => f.name === name) ?? null;
}

/**
 * Run `fn` with the widget annotation for a named field, then close it.
 *
 * Mutations need the handle, and the handle must not escape: reopening the
 * page — which undo does — invalidates it.
 */
function withFieldAnnot<T>(
  doc: PdfDocument,
  pageIndex: number,
  name: string,
  fn: (annot: number, form: number, annotIndex: number) => T,
): T {
  const { mod } = doc;
  const form = doc.form;
  if (!form) throw new Error('This document has no interactive form.');

  const page = doc.page(pageIndex);
  const count = mod.FPDFPage_GetAnnotCount(page);

  for (let i = 0; i < count; i++) {
    const annot = mod.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    try {
      const found = readFormString(doc, annot, (b, n) =>
        mod.FPDFAnnot_GetFormFieldName(form, annot, b, n),
      );
      if (found === name) return fn(annot, form, i);
    } finally {
      mod.FPDFPage_CloseAnnot(annot);
    }
  }

  throw new Error(`The field "${name}" is no longer on this page.`);
}

/**
 * The size the field's text is actually drawn at.
 *
 * A `/DA` of `0 Tf` means auto: PDFium shrinks the type until the value fits
 * the box, so such a field never clips, it just gets smaller and smaller. A
 * fixed size does clip, and that is the case worth warning about. The two
 * need telling apart before anything is said to the user about cut-off text.
 */
function drawnFontSize(doc: PdfDocument, field: FormFieldInfo): { size: number; auto: boolean } {
  const { mod } = doc;
  const form = doc.form;
  const height = field.rect.top - field.rect.bottom;

  const declared = form
    ? withFieldAnnot(doc, field.page, field.name, (annot) =>
        withScope(mod, (scope) => {
          const out = scope.allocFloat();
          if (!mod.FPDFAnnot_GetFontSize(form, annot, out)) return 0;
          return mod.pdfium.getValue(out, 'float');
        }),
      )
    : 0;

  if (declared > 0) return { size: declared, auto: false };
  // Auto-sized: PDFium's own choice tracks the box height closely enough for
  // measuring, and this branch is only used to report, never to draw.
  return { size: Math.max(4, height * 0.66), auto: true };
}

/**
 * Will this value fit the field, and how wide would it have to be?
 *
 * Measured with the bundled metric-compatible sans face rather than the
 * form's own font. A form's `/DA` almost always names one of the base-14
 * (`/Helv`), which is not embedded and has no font program in the file to
 * measure; the bundled substitute is metric-compatible with it, which is the
 * same basis the text editor already uses for fitting.
 */
export async function measureFieldFit(
  doc: PdfDocument,
  field: FormFieldInfo,
  text: string,
): Promise<FormFieldFit> {
  const { size, auto } = drawnFontSize(doc, field);
  const fallback = findFallback('sans');

  const width =
    fallback && text.length > 0 ? ((await measureFallback(fallback, text, size)) ?? 0) : 0;

  const inner = Math.max(0, field.rect.right - field.rect.left - FIELD_INSET * 2);
  const pageWidth = doc.pageInfo(field.page).width;

  const required = Math.min(
    width + FIELD_INSET * 2,
    Math.max(MIN_FIELD_WIDTH, pageWidth - PAGE_MARGIN - field.rect.left),
  );

  return {
    fits: auto || width <= inner,
    autoSized: auto,
    textWidth: width,
    requiredWidth: Math.ceil(required),
    maxWidth: Math.floor(Math.max(MIN_FIELD_WIDTH, pageWidth - PAGE_MARGIN - field.rect.left)),
  };
}

/**
 * Set a field's width, in points, keeping its left edge and height.
 *
 * The value is re-applied afterwards because the appearance stream is built
 * against the old rectangle: widening the box without regenerating leaves the
 * text still clipped to where the border used to be, which looks exactly like
 * the resize having failed.
 */
export function setFormFieldWidth(doc: PdfDocument, field: FormFieldInfo, width: number): number {
  const { mod } = doc;
  const pageWidth = doc.pageInfo(field.page).width;

  const maxWidth = Math.max(MIN_FIELD_WIDTH, pageWidth - PAGE_MARGIN - field.rect.left);
  const clamped = Math.min(Math.max(width, MIN_FIELD_WIDTH), maxWidth);

  withFieldAnnot(doc, field.page, field.name, (annot) => {
    withScope(mod, (scope) => {
      const ptr = scope.allocRectF();
      // FS_RECTF is left, top, right, bottom.
      mod.pdfium.setValue(ptr, field.rect.left, 'float');
      mod.pdfium.setValue(ptr + 4, field.rect.top, 'float');
      mod.pdfium.setValue(ptr + 8, field.rect.left + clamped, 'float');
      mod.pdfium.setValue(ptr + 12, field.rect.bottom, 'float');
      if (!mod.FPDFAnnot_SetRect(annot, ptr)) {
        throw new Error('That field could not be resized.');
      }
    });
  });

  // The form environment caches a widget's geometry for as long as the page
  // is open, so the page is reloaded before the appearance is rebuilt. Without
  // this the environment still believes the old rectangle: the synthetic click
  // aimed at the middle of the widened box lands outside the widget it knows
  // about and focus fails, and even when it does not, the regenerated stream
  // is laid out to the old box and the text stays clipped where it was.
  doc.invalidatePage(field.page);

  const resized = formFieldByName(doc, field.page, field.name);
  if (resized?.editable) setFormFieldText(doc, resized, resized.value);

  return clamped;
}

/** The middle of a field, which is the safest point to aim a synthetic click at. */
function centreOf(field: FormFieldInfo): { x: number; y: number } {
  return {
    x: (field.rect.left + field.rect.right) / 2,
    y: (field.rect.bottom + field.rect.top) / 2,
  };
}

/** `FPDF_ANNOT_APPEARANCEMODE_NORMAL` — fpdf_annot.h */
const AP_NORMAL = 0;

/** Read a string entry from the annotation's own dictionary. */
function readAnnotString(doc: PdfDocument, annot: number, key: string): string {
  const { mod } = doc;
  return withScope(mod, (scope) => {
    const needed = mod.FPDFAnnot_GetStringValue(annot, key, 0, 0);
    if (needed <= 2) return '';
    const buffer = scope.alloc(needed);
    mod.FPDFAnnot_GetStringValue(annot, key, buffer, needed);
    return mod.pdfium.UTF16ToString(buffer);
  });
}

/** Read the annotation's normal appearance stream as text. */
function readAppearance(doc: PdfDocument, annot: number): string {
  const { mod } = doc;
  return withScope(mod, (scope) => {
    const needed = mod.FPDFAnnot_GetAP(annot, AP_NORMAL, 0, 0);
    if (needed <= 2) return '';
    const buffer = scope.alloc(needed);
    mod.FPDFAnnot_GetAP(annot, AP_NORMAL, buffer, needed);
    return mod.pdfium.UTF16ToString(buffer);
  });
}

/** The size named by a `Tf` operator in a `/DA` or appearance stream. */
const TF = /\/([A-Za-z0-9_.+#-]+)\s+([\d.]+)\s+Tf/;
/** A fill colour, in any of the three spaces a `/DA` may use. */
const FILL = /([\d.]+(?:\s+[\d.]+){0,3})\s+(g|rg|k)(?![A-Za-z])/;

/** The font and size a field's appearance stream actually draws with. */
export function drawnAppearanceStyle(
  doc: PdfDocument,
  field: FormFieldInfo,
): { font: string; size: number } | null {
  return withFieldAnnot(doc, field.page, field.name, (annot) => {
    const match = TF.exec(readAppearance(doc, annot));
    return match ? { font: match[1], size: Number(match[2]) } : null;
  });
}

/**
 * Pin the style a field is *actually drawn in* into its `/DA`.
 *
 * A `/DA` of `0 Tf` means auto: size the type to the box. PDFium takes that
 * literally and fills the height — on a 24pt-tall widget it picks 18pt, where
 * the tool that filled the form had drawn the value at 9pt and stored that in
 * the appearance stream. Nothing is wrong until the value is edited; then the
 * appearance is rebuilt from `/DA`, the auto size wins, and that one field
 * comes back in huge type while every untouched field around it still renders
 * from its original stream at the original size. The user sees one field go
 * strange the moment they touch it.
 *
 * So before regenerating, the font and size the existing appearance uses are
 * read back out of it and written into `/DA` as an explicit size. A `/DA`
 * that already declares a size is left alone: it is the document's own
 * intent, and this is only here to resolve "auto" the way the file already
 * resolved it once.
 */
/** The explicit type sizes the other fields on a page are set in. */
function siblingFieldSizes(doc: PdfDocument, pageIndex: number): number[] {
  const { mod } = doc;
  const form = doc.form;
  if (!form) return [];

  const page = doc.page(pageIndex);
  const count = mod.FPDFPage_GetAnnotCount(page);

  // The sizes the file's own appearances use, recorded before the form
  // environment had a chance to generate any of its own.
  const sizes: number[] = [...doc.originalApSizesOnPage(pageIndex)];

  // Plus anything a field declares outright.
  for (let i = 0; i < count; i++) {
    const annot = mod.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    try {
      if (mod.FPDFAnnot_GetFormFieldType(form, annot) < 0) continue;
      const match = TF.exec(readAnnotString(doc, annot, 'DA'));
      const size = match ? Number(match[2]) : 0;
      if (size > 0) sizes.push(size);
    } finally {
      mod.FPDFPage_CloseAnnot(annot);
    }
  }

  return sizes;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Decide the size an edited field must draw at, and never answer "auto".
 *
 * Auto is the whole problem. `0 Tf` tells PDFium to fill the box height, so
 * regenerating an appearance blows the type up — 18pt on a 24pt widget, where
 * the rest of the form sits at 9pt — and the value is then too wide for its
 * own box and comes back truncated. Editing a field must not change how big
 * its text is; only the width is the user's to change.
 *
 * The chain, in order of how much it knows:
 *
 *  1. The widget declares a size. That is the document's own decision and is
 *     returned untouched.
 *  2. Its appearance stream draws at a size. That is what the file looks like
 *     today, so it is what the edit must preserve.
 *  3. Neither — no `/AP`, or one whose text is nested deeper than a top-level
 *     `Tf`, which is what a form filled by an online tool routinely looks
 *     like. Then the rest of the form is the best evidence available: the
 *     median of the sizes its other fields use. The neighbours look right, so
 *     match the neighbours.
 *  4. Nothing anywhere. Fall back to a size that suits the box, kept small
 *     enough to read as a form entry rather than a heading.
 *
 * Step 3 is the one that matters in practice, and its absence was the bug:
 * the previous version simply gave up at that point and let auto win.
 */
function resolveTextSize(
  doc: PdfDocument,
  field: FormFieldInfo,
  annot: number,
  annotIndex: number,
): { font: string; size: number; fill: string } | null {
  const da = readAnnotString(doc, annot, 'DA');
  const daTf = TF.exec(da);

  // 1. Already explicit: leave the document's intent alone.
  if (daTf && Number(daTf[2]) > 0) return null;

  const ap = readAppearance(doc, annot);
  const apTf = TF.exec(ap);

  const fillMatch = FILL.exec(ap) ?? FILL.exec(da);
  const fill = fillMatch ? `${fillMatch[1]} ${fillMatch[2]}` : '0 g';
  // Keep whichever font name the file already names; PDFium resolves a
  // base-14 name even when the form's `/DR` does not list it.
  const font = apTf?.[1] ?? daTf?.[1] ?? 'Helv';

  // 2. The size the file's own appearance draws at.
  //
  // Read from the snapshot rather than from the stream in front of us: for a
  // field the file left without an appearance, PDFium has already generated
  // one at the auto size, and preserving that would preserve the very thing
  // being fixed.
  const original = doc.originalApSize(field.page, annotIndex);
  if (original !== null && original > 0) return { font, size: original, fill };

  // 3. What the rest of the form uses.
  const siblings = siblingFieldSizes(doc, field.page).filter((s) => s > 0);
  if (siblings.length > 0) return { font, size: median(siblings), fill };

  // 4. Nothing to go on: pick from the box, erring small.
  const height = field.rect.top - field.rect.bottom;
  const size = Math.min(11, Math.max(6, Math.round(height * 0.45)));
  return { font, size, fill };
}

/**
 * Pin an explicit type size into the field's `/DA` before it is regenerated.
 *
 * Returns true when `/DA` was rewritten, which means the page has to be
 * reloaded: the form environment caches the widget, `/DA` included.
 */
function pinTextSize(doc: PdfDocument, field: FormFieldInfo): boolean {
  const { mod } = doc;
  let changed = false;

  withFieldAnnot(doc, field.page, field.name, (annot, _form, annotIndex) => {
    const style = resolveTextSize(doc, field, annot, annotIndex);
    if (!style) return;

    const da = `/${style.font} ${round2(style.size)} Tf ${style.fill}`;
    changed = withScope(mod, (scope) =>
      mod.FPDFAnnot_SetStringValue(annot, 'DA', scope.allocUtf16(da)),
    );
  });

  if (changed) doc.invalidatePage(field.page);
  return changed;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The size an edited field must draw at, definitely rather than possibly.
 *
 * Same chain as `resolveTextSize`, but it always answers with a number: used
 * when the value is going to be drawn by this engine rather than by PDFium.
 */
function effectiveFieldSize(doc: PdfDocument, field: FormFieldInfo): number {
  return withFieldAnnot(doc, field.page, field.name, (annot, _form, annotIndex) => {
    const declared = TF.exec(readAnnotString(doc, annot, 'DA'));
    if (declared && Number(declared[2]) > 0) return Number(declared[2]);

    const original = doc.originalApSize(field.page, annotIndex);
    if (original !== null && original > 0) return original;

    const siblings = siblingFieldSizes(doc, field.page).filter((s) => s > 0);
    if (siblings.length > 0) return median(siblings);

    const height = field.rect.top - field.rect.bottom;
    return Math.min(11, Math.max(6, Math.round(height * 0.45)));
  });
}

/**
 * Can PDFium be trusted to rebuild this field's appearance faithfully?
 *
 * Only when the document itself says how the field should look. An explicit
 * size in `/DA` is that statement, and a plain single-line field is one
 * PDFium reproduces. Everything else — an auto size it will resolve to the
 * box height, a comb field it will re-space per character, a multiline field
 * a single-line redraw cannot represent — comes back looking unlike the
 * document, and no amount of steering `/DA` fixes it.
 */
export function appearanceIsTrustworthy(doc: PdfDocument, field: FormFieldInfo): boolean {
  return withFieldAnnot(doc, field.page, field.name, (annot, form) => {
    const declared = TF.exec(readAnnotString(doc, annot, 'DA'));
    if (!declared || !(Number(declared[2]) > 0)) return false;

    const flags = doc.mod.FPDFAnnot_GetFormFieldFlags(form, annot);
    if ((flags & FormFlag.Comb) !== 0) return false;
    if ((flags & FormFlag.Multiline) !== 0) return false;

    return true;
  });
}

/** What converting a field into page text did. */
export interface FieldConversion {
  /** The size the value was drawn at. */
  size: number;
  /** True when the value is wider than the field's box and now runs past it. */
  overhangs: boolean;
}

/**
 * Draw a field's value as page text, and take the widget away.
 *
 * The escape hatch from PDFium's appearance generation, used when that
 * generation cannot be trusted to match the document. Once the value is an
 * ordinary text object, three things follow that no amount of `/DA` tuning
 * achieves:
 *
 *  - It draws at exactly the size asked for, every time.
 *  - It is not clipped. A field clips to its rectangle, which is why an
 *    over-long value came back truncated; page text simply runs on, so a long
 *    value prints in full.
 *  - It becomes editable through the ordinary text path, with the fitting and
 *    font-substitution reporting that path already has.
 *
 * The cost, which the interface has to state rather than bury: that field
 * stops being an interactive form field. The value is in the page from then
 * on, so software that reads form values will not find it. For a form being
 * filled in and printed that is the better trade; for one being sent back for
 * further filling it is not.
 */
export async function convertFieldToText(
  doc: PdfDocument,
  field: FormFieldInfo,
  text: string,
): Promise<FieldConversion> {
  const size = effectiveFieldSize(doc, field);
  const height = field.rect.top - field.rect.bottom;

  // Sit the text where the widget drew it: inset from the left edge, and
  // centred in the box's height with room for descenders.
  const x = field.rect.left + FIELD_INSET;
  const baseline = field.rect.bottom + Math.max(1, (height - size) / 2 + size * 0.2);

  const annotIndex = withFieldAnnot(doc, field.page, field.name, (_a, _f, index) => index);

  // Remove the widget first: it holds the old value, and leaving it would
  // draw both at once.
  removeAnnotations(doc, field.page, [annotIndex]);

  // Then reload the page, because removing the annotation from the dictionary
  // does not remove the widget from the form-fill environment: it keeps its
  // own view of the page and `FPDF_FFLDraw` goes on painting the old value
  // from it, superimposed on the new text. Done here, before anything is
  // added, since reloading a page discards page objects that have not been
  // written into the content stream yet.
  doc.invalidatePage(field.page);

  if (text.length > 0) {
    await insertText(doc, {
      type: 'text',
      page: field.page,
      x,
      y: baseline,
      text,
      fontSize: size,
      colour: { r: 0, g: 0, b: 0, a: 255 },
      fontKey: 'sans',
    });
  }

  const fallback = findFallback('sans');
  const width =
    fallback && text.length > 0 ? ((await measureFallback(fallback, text, size)) ?? 0) : 0;
  const inner = Math.max(0, field.rect.right - field.rect.left - FIELD_INSET * 2);

  doc.markDirty(field.page);

  return { size, overhangs: width > inner };
}

/**
 * Replace a text field's value.
 *
 * Driven as a click, a select-all and a replacement, because that is the only
 * route that leaves the stored value and the drawn appearance agreeing. The
 * click lands on the middle of the field rather than wherever the user
 * happened to press, so a press near a border cannot miss the widget PDFium
 * is about to focus.
 */
export function setFormFieldText(doc: PdfDocument, field: FormFieldInfo, text: string): void {
  const { mod } = doc;
  const form = doc.form;
  if (!form) throw new Error('This document has no interactive form.');
  if (!field.editable) {
    throw new Error(field.notEditableReason ?? 'This field cannot be typed into.');
  }

  // Never let PDFium resolve "auto" to the box height: editing a field must
  // not change how big its text is.
  pinTextSize(doc, field);

  const page = doc.page(field.page);
  const { x, y } = centreOf(field);

  mod.FORM_OnLButtonDown(form, page, 0, x, y);
  mod.FORM_OnLButtonUp(form, page, 0, x, y);

  if (!mod.FORM_SelectAllText(form, page)) {
    mod.FORM_ForceToKillFocus(form);
    throw new Error('That field could not be focused for editing.');
  }

  withScope(mod, (scope) => {
    mod.FORM_ReplaceSelection(form, page, scope.allocUtf16(text));
  });

  // Committing is what writes the value back and regenerates the appearance.
  mod.FORM_ForceToKillFocus(form);
}

/**
 * Toggle a checkbox or radio button, by clicking it.
 *
 * PDFium owns the semantics here, which matters for radio groups: clicking
 * one button clears its siblings, and reimplementing that from `/V` and
 * `/AS` by hand is how a form ends up with two options selected at once.
 */
export function toggleFormField(doc: PdfDocument, field: FormFieldInfo): void {
  const { mod } = doc;
  const form = doc.form;
  if (!form) throw new Error('This document has no interactive form.');
  if (!field.toggleable) {
    throw new Error(field.notEditableReason ?? 'This field cannot be ticked.');
  }

  const page = doc.page(field.page);
  const { x, y } = centreOf(field);

  mod.FORM_OnLButtonDown(form, page, 0, x, y);
  mod.FORM_OnLButtonUp(form, page, 0, x, y);
  mod.FORM_ForceToKillFocus(form);
}

/** True when the document has an interactive form at all. */
export function hasForm(doc: PdfDocument): boolean {
  return doc.form !== 0;
}
