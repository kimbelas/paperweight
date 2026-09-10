import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { certificationLevel, listAnnotations, removeAnnotations } from './annotations';
import { PdfDocument } from './document';
import { formFieldLabel, formFieldPhrase } from './form-label';
import { History } from './history';
import {
  appearanceIsTrustworthy,
  convertFieldToText,
  formFieldAt,
  formFieldByName,
  listFormFields,
  measureFieldFit,
  setFormFieldText,
  setFormFieldWidth,
  toggleFormField,
} from './forms';
import {
  applyPlacements,
  patchTextRegion,
  sampleBackgroundColour,
  type PatchRegionRequest,
} from './insert';
import { moveObjects } from './move';
import { getModule } from './module';
import { deletePages, extractPages, insertBlankPage, movePages, rotatePage } from './pages';
import { hitTestObject, listPageObjects } from './objects';
import {
  deviceRectToPage,
  deviceToPage,
  pageToDevice,
  renderPage,
  type RenderOptions,
} from './render';
import {
  removeSignature,
  scanForSignatures,
  scanPageForSignatures,
  type SignatureScan,
} from './signatures';
import { getGlyphs, getTextLines, hitTestLine } from './text';
import { removeObjectsByPath, replaceLineText } from './text-edit';
import type { FieldConversion } from './forms';
import type {
  Badge,
  CommitResult,
  DocumentInfo,
  FormFieldFit,
  FormFieldInfo,
  Glyph,
  PageObject,
  Placement,
  Rect,
  RenderedPage,
  Rgba,
  SignatureCandidate,
  TextLine,
} from './types';

/**
 * The editing session: the whole engine behind one object.
 *
 * This is the only surface the UI sees, and it is deliberately coarse. Each
 * mutating method is one user-visible action that snapshots, mutates,
 * regenerates the pages it touched and reports what changed. Exposing PDFium
 * handles or letting the UI compose several calls into one action would put
 * the snapshot boundary in the wrong place and make undo unreliable.
 */
export class EditorSession {
  private mod: WrappedPdfiumModule | null = null;
  private doc: PdfDocument | null = null;
  private history = new History();
  private signatureScan: SignatureScan | null = null;
  private warnedAboutSignature = false;

  /** Open a document, replacing any already open. */
  async open(bytes: Uint8Array, password = ''): Promise<DocumentInfo> {
    this.mod ??= await getModule();
    this.closeDocument();

    this.doc = PdfDocument.open(this.mod, bytes, password);
    this.history.clear();
    this.signatureScan = null;
    this.warnedAboutSignature = false;
    return this.doc.info();
  }

  /** True once a document is open. */
  get isOpen(): boolean {
    return this.doc !== null;
  }

  info(): DocumentInfo {
    return this.require().info();
  }

  // --- Reading -----------------------------------------------------------

  render(pageIndex: number, options: RenderOptions): RenderedPage {
    return renderPage(this.require(), pageIndex, options);
  }

  textLines(pageIndex: number): TextLine[] {
    return getTextLines(this.require(), pageIndex);
  }

  glyphs(pageIndex: number): Glyph[] {
    return getGlyphs(this.require(), pageIndex);
  }

  objects(pageIndex: number): PageObject[] {
    return listPageObjects(this.require(), pageIndex);
  }

  annotations(pageIndex: number) {
    return listAnnotations(this.require(), pageIndex);
  }

  /** Every interactive form field on a page. Empty when there is no form. */
  formFields(pageIndex: number): FormFieldInfo[] {
    return listFormFields(this.require(), pageIndex);
  }

  /**
   * Which line is under a point.
   *
   * The point arrives in device pixels because that is what a click gives,
   * and is converted here so the UI never has to know about PDF coordinates
   * or page rotation.
   */
  lineAt(
    pageIndex: number,
    deviceWidth: number,
    deviceHeight: number,
    x: number,
    y: number,
  ): TextLine | null {
    const doc = this.require();
    const point = deviceToPage(doc, pageIndex, deviceWidth, deviceHeight, x, y);
    // The engine's hit test resolves the glyph to the text object that drew
    // it, which is exact; the nearest-line fallback lives inside it.
    return hitTestLine(doc, pageIndex, point.x, point.y);
  }

  /**
   * Which form field is under a point.
   *
   * Asked separately from `lineAt`, and after it: a page can hold both, and
   * a field value is invisible to the text hit test however clearly it is
   * drawn, so the UI has to try both before concluding a click hit nothing.
   */
  formFieldAt(
    pageIndex: number,
    deviceWidth: number,
    deviceHeight: number,
    x: number,
    y: number,
  ): FormFieldInfo | null {
    const doc = this.require();
    const point = deviceToPage(doc, pageIndex, deviceWidth, deviceHeight, x, y);
    return formFieldAt(doc, pageIndex, point.x, point.y);
  }

  objectAt(
    pageIndex: number,
    deviceWidth: number,
    deviceHeight: number,
    x: number,
    y: number,
  ): PageObject | null {
    const doc = this.require();
    const point = deviceToPage(doc, pageIndex, deviceWidth, deviceHeight, x, y);
    return hitTestObject(listPageObjects(doc, pageIndex), point.x, point.y);
  }

  toPagePoint(
    pageIndex: number,
    deviceWidth: number,
    deviceHeight: number,
    x: number,
    y: number,
  ): { x: number; y: number } {
    return deviceToPage(this.require(), pageIndex, deviceWidth, deviceHeight, x, y);
  }

  toDevicePoint(
    pageIndex: number,
    deviceWidth: number,
    deviceHeight: number,
    x: number,
    y: number,
  ): { x: number; y: number } {
    return pageToDevice(this.require(), pageIndex, deviceWidth, deviceHeight, x, y);
  }

  toPageRect(
    pageIndex: number,
    deviceWidth: number,
    deviceHeight: number,
    rect: { x: number; y: number; width: number; height: number },
  ): Rect {
    return deviceRectToPage(this.require(), pageIndex, deviceWidth, deviceHeight, rect);
  }

  sampleBackground(pageIndex: number, rect: Rect): Rgba {
    return sampleBackgroundColour(this.require(), pageIndex, rect);
  }

  /** Scan for signatures, cached until the document changes. */
  signatures(): SignatureScan {
    this.signatureScan ??= scanForSignatures(this.require());
    return this.signatureScan;
  }

  pageSignatures(pageIndex: number): SignatureCandidate[] {
    return scanPageForSignatures(this.require(), pageIndex);
  }

  // --- Mutating ----------------------------------------------------------

  async replaceText(pageIndex: number, lineId: string, text: string): Promise<CommitResult> {
    return this.commit('Edit text', async (doc) => {
      const outcome = await replaceLineText(doc, { page: pageIndex, lineId, text });
      return outcome.badges;
    });
  }

  /**
   * Replace text on a scanned page by covering it and drawing again.
   *
   * Separate from `replaceText` on purpose. That edits a text object; this
   * paints over an image, which is a different operation with a different
   * result, and collapsing the two would let the UI imply a scan behaves like
   * a text document.
   */
  async patchRegion(request: PatchRegionRequest): Promise<CommitResult> {
    return this.commit('Edit scanned text', async (doc) => {
      await patchTextRegion(doc, request);
      return [
        {
          kind: 'font-substituted' as const,
          message:
            'This page is a scan, so the original text was covered and redrawn. It will not match the surrounding type, and the covered pixels remain in the image.',
          page: request.page,
        },
      ];
    });
  }

  /**
   * Set a form field's value.
   *
   * The page is repainted but deliberately not regenerated. A field value
   * lives in the form, not in the page's content stream, so there is nothing
   * on the page to rewrite — and calling `GenerateContent` here would rewrite
   * a page the user never edited, which is the one thing the engine promises
   * not to do.
   */
  async setFormFieldValue(
    pageIndex: number,
    name: string,
    value: string,
    width?: number,
  ): Promise<CommitResult> {
    return this.commit(
      'Edit form field',
      async (doc) => {
        const field = this.findField(doc, pageIndex, name);

        // When the document does not say how the field should look, PDFium's
        // rebuilt appearance will not match it -- an auto size resolved to the
        // box height, a comb field re-spaced per character. Drawing the value
        // as page text instead is the only way to guarantee what is shown is
        // what prints, and it also stops the value being clipped to the box.
        //
        // `width` is deliberately not applied here: page text is not clipped,
        // so there is no box to widen. The interface offers no width for such
        // a field either -- see `FormFieldInfo.clips` -- so a width arriving
        // on this path would be a caller asking for something the outcome
        // makes meaningless, not a width being quietly lost.
        if (!appearanceIsTrustworthy(doc, field)) {
          const conversion = await convertFieldToText(doc, field, value);
          return this.conversionBadges(field, conversion);
        }

        // Width first: setting it rebuilds the appearance, so applying the
        // value afterwards would otherwise be undone by the resize.
        if (width !== undefined && Math.round(width) !== Math.round(fieldWidth(field))) {
          setFormFieldWidth(doc, field, width);
        }

        const resized = this.findField(doc, pageIndex, name);
        setFormFieldText(doc, resized, value);

        return this.fitBadges(doc, this.findField(doc, pageIndex, name), value);
      },
      false,
      [pageIndex],
    );
  }

  /** Widen a field to hold its current value, and report the new width. */
  async fitFormFieldWidth(pageIndex: number, name: string): Promise<CommitResult> {
    return this.commit(
      'Widen form field',
      async (doc) => {
        const field = this.findField(doc, pageIndex, name);
        const fit = await measureFieldFit(doc, field, field.value);
        const applied = setFormFieldWidth(doc, field, fit.requiredWidth);

        if (applied < fit.requiredWidth) {
          return [
            {
              kind: 'text-overflows' as const,
              message: `${capitalise(formFieldPhrase(field))} was widened as far as the page allows, but the value is still wider than the box and will be cut off. Shorten it, or move the field.`,
              page: pageIndex,
            },
          ];
        }
        return [];
      },
      false,
      [pageIndex],
    );
  }

  /** Ask whether a value fits a field, without changing anything. */
  async measureFormField(pageIndex: number, name: string, value: string): Promise<FormFieldFit> {
    const doc = this.require();
    return measureFieldFit(doc, this.findField(doc, pageIndex, name), value);
  }

  /**
   * Disclose that a field became page text.
   *
   * Said once per field rather than suppressed: the document really has
   * changed shape, and someone who meant to send the form on for further
   * filling needs to know that field no longer accepts a value.
   */
  private conversionBadges(field: FormFieldInfo, conversion: FieldConversion): Badge[] {
    const badges: Badge[] = [
      {
        kind: 'font-substituted',
        message:
          `${capitalise(formFieldPhrase(field))} was drawn into the page at ${conversion.size}pt so that it prints exactly as shown. ` +
          'This document did not say what size that field should use, and left to itself the PDF engine sizes such text to the height of the box, which came out far larger than the rest of the form and was then cut off. ' +
          'The value is now ordinary text and can be edited like any other line; it is no longer an interactive form field.',
        page: field.page,
      },
    ];

    if (conversion.overhangs) {
      badges.push({
        kind: 'text-overflows',
        message:
          `That value is longer than the ${formFieldLabel(field)} box, so it now runs past the form's line. ` +
          'It is drawn in full and will print in full -- nothing is cut off -- but check it does not collide with anything to its right.',
        page: field.page,
      });
    }

    return badges;
  }

  /**
   * Say so when a committed value will be cut off.
   *
   * A field clips to its own rectangle, so this is not cosmetic: the value is
   * in the file and prints truncated. Saying nothing would let someone submit
   * a form believing it says something it does not.
   */
  private async fitBadges(doc: PdfDocument, field: FormFieldInfo, value: string): Promise<Badge[]> {
    const fit = await measureFieldFit(doc, field, value);
    if (fit.fits) return [];

    return [
      {
        kind: 'text-overflows',
        message: `That value is wider than ${formFieldPhrase(field)}, so it will be cut off when printed. Drag the field's right edge to widen it, or use Widen to fit.`,
        page: field.page,
      },
    ];
  }

  /** Tick or untick a checkbox, or select a radio button. */
  toggleFormFieldValue(pageIndex: number, name: string): CommitResult {
    return this.commitSync(
      'Tick form field',
      (doc) => {
        const field = this.findField(doc, pageIndex, name);
        toggleFormField(doc, field);
        return [];
      },
      false,
      [pageIndex],
    );
  }

  removeSignatureById(id: string): CommitResult {
    const candidate = this.signatures().candidates.find((c) => c.id === id);
    if (!candidate) throw new Error('That signature is no longer in the document.');

    return this.commitSync('Remove signature', (doc) => {
      const result = removeSignature(doc, candidate);
      return result.badges;
    });
  }

  removeObjects(pageIndex: number, paths: number[][]): CommitResult {
    return this.commitSync('Delete', (doc) => {
      const removed = removeObjectsByPath(doc, pageIndex, paths);
      if (removed === 0) throw new Error('Nothing was removed.');
      const badges: Badge[] = [];
      if (removed < paths.length) {
        badges.push({
          kind: 'partial-removal',
          message: `${removed} of ${paths.length} items were removed; the rest were no longer on the page.`,
          page: pageIndex,
        });
      }
      return badges;
    });
  }

  /**
   * Move objects by a delta in PDF points.
   *
   * One user action, so one undo step, however many objects a dragged line
   * turns out to consist of.
   */
  moveObjects(pageIndex: number, paths: number[][], dx: number, dy: number): CommitResult {
    return this.commitSync('Move', (doc) => {
      const result = moveObjects(doc, pageIndex, paths, dx, dy);
      if (result.moved === 0 && result.badges.length === 0) {
        throw new Error('Nothing moved.');
      }
      return result.badges;
    });
  }

  removeAnnotationsAt(pageIndex: number, indices: number[]): CommitResult {
    return this.commitSync('Delete annotation', (doc) => {
      if (removeAnnotations(doc, pageIndex, indices) === 0) {
        throw new Error('Nothing was removed.');
      }
      return [];
    });
  }

  /** Flatten pending additions into the document. */
  async apply(placements: Placement[]): Promise<CommitResult> {
    if (placements.length === 0) return { changedPages: [], badges: [] };
    return this.commit('Apply changes', async (doc) => {
      await applyPlacements(doc, placements);
      return [];
    });
  }

  rotate(pageIndex: number, quarterTurns: number): CommitResult {
    return this.commitSync('Rotate page', (doc) => {
      rotatePage(doc, pageIndex, quarterTurns);
      return [];
    });
  }

  deletePages(indices: number[]): CommitResult {
    return this.commitSync(
      'Delete pages',
      (doc) => {
        deletePages(doc, indices);
        return [];
      },
      true,
    );
  }

  movePages(indices: number[], destination: number): CommitResult {
    return this.commitSync(
      'Reorder pages',
      (doc) => {
        movePages(doc, indices, destination);
        return [];
      },
      true,
    );
  }

  insertBlankPage(atIndex: number): CommitResult {
    return this.commitSync(
      'Insert page',
      (doc) => {
        insertBlankPage(doc, atIndex);
        return [];
      },
      true,
    );
  }

  /** Build a new PDF from selected pages, for split or export. */
  extract(indices: number[]): Uint8Array {
    return extractPages(this.require(), indices);
  }

  // --- History -----------------------------------------------------------

  async undo(): Promise<CommitResult | null> {
    const doc = this.require();
    if (!this.history.canUndo) return null;

    const current = doc.save();
    const snapshot = this.history.undo('Redo', current);
    if (!snapshot) return null;

    await this.reopen(snapshot.bytes);
    return { changedPages: allPages(this.require()), badges: [] };
  }

  async redo(): Promise<CommitResult | null> {
    const doc = this.require();
    if (!this.history.canRedo) return null;

    const current = doc.save();
    const snapshot = this.history.redo('Undo', current);
    if (!snapshot) return null;

    await this.reopen(snapshot.bytes);
    return { changedPages: allPages(this.require()), badges: [] };
  }

  historyState(): {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    depth: number;
    truncated: boolean;
  } {
    return {
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
      depth: this.history.depth,
      truncated: this.history.truncated,
    };
  }

  // --- Output ------------------------------------------------------------

  /** Serialise the document as it currently stands. */
  save(): Uint8Array {
    return this.require().save();
  }

  close(): void {
    this.closeDocument();
    this.history.clear();
  }

  // --- Internals ---------------------------------------------------------

  private require(): PdfDocument {
    if (!this.doc) throw new Error('No document is open.');
    return this.doc;
  }

  /**
   * Resolve a field by name, at the moment of the mutation.
   *
   * Looked up again rather than trusting the `FormFieldInfo` the UI is
   * holding: undo reopens the document from bytes, so any handle or index
   * captured when the editor opened would be stale by now.
   */
  private findField(doc: PdfDocument, pageIndex: number, name: string): FormFieldInfo {
    const field = formFieldByName(doc, pageIndex, name);
    if (!field) throw new Error(`The field "${name}" is no longer on this page.`);
    return field;
  }

  private closeDocument(): void {
    this.doc?.close();
    this.doc = null;
  }

  /**
   * Snapshot, mutate, regenerate, report.
   *
   * The snapshot is taken before the mutation so undo lands on the state the
   * user saw. `flushDirty` regenerates only the pages the mutation marked,
   * which is what keeps an edit on page one from rewriting page fifty.
   */
  private async commit(
    label: string,
    mutate: (doc: PdfDocument) => Promise<Badge[]>,
    structural = false,
    repaint: number[] = [],
  ): Promise<CommitResult> {
    const doc = this.require();
    const before = doc.save();

    let badges: Badge[];
    try {
      badges = await mutate(doc);
    } catch (error) {
      // The document may be half-changed, so restore the snapshot rather than
      // leaving the user with a state no undo entry describes.
      await this.reopen(before);
      throw error;
    }

    const snapshot = this.history.push(label, before);
    const changedPages = doc.flushDirty();
    // `repaint` covers changes that alter how a page looks without touching
    // its content stream; see `commitSync`.
    snapshot.affectedPages = [...new Set([...changedPages, ...repaint])].sort((a, b) => a - b);
    this.signatureScan = null;

    return {
      changedPages: structural ? allPages(doc) : snapshot.affectedPages,
      badges: [...badges, ...this.signatureWarning(doc)],
      undoId: snapshot.id,
    };
  }

  /**
   * As `commit`, synchronously.
   *
   * `repaint` names pages whose bitmap is stale even though their content
   * stream was not touched. Form fields are the case that needs it: the value
   * changed and the page looks different, but the change is in the form, so
   * there is nothing to regenerate and `flushDirty` rightly reports nothing.
   * Without this the edit would be invisible until something else forced a
   * redraw.
   */
  private commitSync(
    label: string,
    mutate: (doc: PdfDocument) => Badge[],
    structural = false,
    repaint: number[] = [],
  ): CommitResult {
    const doc = this.require();
    const before = doc.save();

    let badges: Badge[];
    try {
      badges = mutate(doc);
    } catch (error) {
      this.reopenSync(before);
      throw error;
    }

    const snapshot = this.history.push(label, before);
    const changedPages = doc.flushDirty();
    snapshot.affectedPages = [...new Set([...changedPages, ...repaint])].sort((a, b) => a - b);
    this.signatureScan = null;

    return {
      changedPages: structural ? allPages(doc) : snapshot.affectedPages,
      badges: [...badges, ...this.signatureWarning(doc)],
      undoId: snapshot.id,
    };
  }

  /**
   * Warn once per session that editing invalidates a digital signature.
   *
   * It is unavoidable rather than a bug: a signature certifies exact bytes.
   * Saying so once is honest; saying it on every keystroke is noise.
   */
  private signatureWarning(doc: PdfDocument): Badge[] {
    if (this.warnedAboutSignature) return [];
    if (doc.mod.FPDF_GetSignatureCount(doc.handle) === 0) return [];

    this.warnedAboutSignature = true;
    const level = certificationLevel(doc);
    const extra =
      level === 1
        ? ' The author certified it with no changes allowed, so some viewers will report it as altered.'
        : '';

    return [
      {
        kind: 'signature-invalidated',
        message: `This document is digitally signed. Any change makes that signature invalid, because it certifies the exact bytes of the original.${extra}`,
      },
    ];
  }

  private async reopen(bytes: Uint8Array): Promise<void> {
    this.mod ??= await getModule();
    this.reopenSync(bytes);
  }

  private reopenSync(bytes: Uint8Array): void {
    if (!this.mod) throw new Error('The PDF engine is not loaded.');
    this.closeDocument();
    this.doc = PdfDocument.open(this.mod, bytes);
    this.signatureScan = null;
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A field's current width in points. */
function fieldWidth(field: FormFieldInfo): number {
  return field.rect.right - field.rect.left;
}

function allPages(doc: PdfDocument): number[] {
  return Array.from({ length: doc.pageCount }, (_, i) => i);
}
