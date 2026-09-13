import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { FormType, ObjType, PDF_ERROR_MESSAGES, SaveFlag, StructSize } from './constants';
import { withScope } from './memory';
import type { DocumentInfo, PageInfo } from './types';

/** `FPDF_ANNOT_APPEARANCEMODE_NORMAL` — fpdf_annot.h */
const AP_NORMAL = 0;
/** The size named by a `Tf` operator in an appearance stream. */
const APPEARANCE_TF = /\/[A-Za-z0-9_.+#-]+\s+([\d.]+)\s+Tf/;

/**
 * An open PDF, owning every PDFium handle derived from it.
 *
 * Handle discipline, which is the whole reason this is a class:
 *
 * - Page handles are cached, because loading one is not free and the viewer
 *   asks for the same page repeatedly while scrolling.
 * - Text page handles are **not** cached across mutations. Removing a text
 *   object invalidates every `FPDF_TEXTPAGE` for that page, and using one
 *   afterwards is a use-after-free, so `withTextPage` opens and closes one per
 *   call rather than holding it.
 * - `FPDFPage_GenerateContent` rewrites a page's content stream from PDFium's
 *   object model, which is lossy for anything PDFium does not fully model. So
 *   a page is regenerated only if it was actually edited: `markDirty` records
 *   the intent and `flushDirty` acts on it. An untouched page is never
 *   rewritten.
 * - A document with an AcroForm also owns a form-fill environment, because
 *   PDFium draws field values only through that. It is created before any
 *   page is loaded and destroyed before the document, since every page handed
 *   to it must be announced with `FORM_OnAfterLoadPage` and withdrawn with
 *   `FORM_OnBeforeClosePage`.
 */
export class PdfDocument {
  private readonly pageCache = new Map<number, number>();
  private readonly dirtyPages = new Set<number>();
  private closed = false;
  /** Form-fill environment, or 0 when the document has no AcroForm. */
  private formHandle = 0;
  /** The `FPDF_FORMFILLINFO` backing `formHandle`; PDFium keeps the pointer. */
  private formInfoPtr = 0;
  /**
   * Type size each widget's *own* appearance stream draws at, per page, by
   * annotation index. Null where the file supplied no appearance.
   */
  private readonly originalApSizes = new Map<number, (number | null)[]>();
  /** Bumped by `reload`; see `generation`. */
  private generationCounter = 0;

  private constructor(
    readonly mod: WrappedPdfiumModule,
    private docHandle: number,
    /** Kept alive for the document's lifetime: PDFium reads this buffer lazily. */
    private dataPtr: number,
    private dataLen: number,
  ) {}

  /**
   * Open a document from bytes.
   *
   * The buffer is copied onto the WASM heap and must stay allocated: PDFium
   * parses lazily and reads from it for as long as the document is open.
   */
  static open(mod: WrappedPdfiumModule, bytes: Uint8Array, password = ''): PdfDocument {
    const { handle, dataPtr } = PdfDocument.load(mod, bytes, password);
    const doc = new PdfDocument(mod, handle, dataPtr, bytes.byteLength);
    doc.initFormEnvironment();
    return doc;
  }

  /** Copy bytes onto the heap and parse them; frees the copy if parsing fails. */
  private static load(
    mod: WrappedPdfiumModule,
    bytes: Uint8Array,
    password: string,
  ): { handle: number; dataPtr: number } {
    const dataPtr = mod.pdfium.wasmExports.malloc(bytes.byteLength);
    if (!dataPtr) throw new Error('Not enough memory to open this document.');
    mod.pdfium.HEAPU8.set(bytes, dataPtr);

    const handle = mod.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, password);
    if (!handle) {
      const code = mod.FPDF_GetLastError();
      mod.pdfium.wasmExports.free(dataPtr);
      const err = new Error(PDF_ERROR_MESSAGES[code] ?? `Could not open the document (${code}).`);
      err.name = code === 4 ? 'PasswordRequired' : 'OpenFailed';
      throw err;
    }

    return { handle, dataPtr };
  }

  /**
   * Replace the document's contents with these bytes, in place.
   *
   * For a change PDFium's object model cannot make but the serialised file
   * can take: `removeAnnotations` edits the form field tree in the output of
   * `save` and hands the result back here. The alternative was to patch the
   * bytes at every save and leave the in-memory document disagreeing with the
   * file until the next undo; reloading keeps one truth, and has PDFium parse
   * the edited file at once rather than leaving that to whatever opens the
   * download.
   *
   * Every handle PDFium issued for the document is void afterwards — pages,
   * annotations, text pages and fonts alike. `generation` changes so caches
   * keyed by this object can tell. Call it with bytes from `save`, which has
   * already regenerated every dirty page; pending marks are dropped here
   * because they described the old object model.
   *
   * The replacement is parsed before the current document is released, so a
   * failure leaves the document exactly as it was.
   */
  reload(bytes: Uint8Array): void {
    this.assertOpen();
    const { handle, dataPtr } = PdfDocument.load(this.mod, bytes, '');

    this.release();
    this.docHandle = handle;
    this.dataPtr = dataPtr;
    this.dataLen = bytes.byteLength;
    this.generationCounter++;
    this.initFormEnvironment();
  }

  /**
   * Which load of the document this is. Starts at 0 and rises on every
   * `reload`, so a cache of PDFium handles keyed by the document can notice
   * that its entries belong to a document that no longer exists.
   */
  get generation(): number {
    return this.generationCounter;
  }

  get handle(): number {
    this.assertOpen();
    return this.docHandle;
  }

  /**
   * The form-fill environment, or 0 when there is no form to fill.
   *
   * Rendering needs this: `FPDF_RenderPageBitmap` draws page content and
   * annotation appearance streams, but a form field's value is not page
   * content, and a field filled programmatically often has no appearance
   * stream at all. Only the form-fill environment generates and draws those,
   * which is why a filled form renders blank without it while printing from
   * any ordinary viewer shows every value.
   */
  get form(): number {
    return this.formHandle;
  }

  /**
   * The size the file's own appearance for a widget draws at, if it had one.
   *
   * Recorded before the form-fill environment exists, because that is the
   * only moment it can be known: see `snapshotAppearanceSizes`.
   */
  originalApSize(pageIndex: number, annotIndex: number): number | null {
    return this.originalApSizes.get(pageIndex)?.[annotIndex] ?? null;
  }

  /** Every size the file's own appearances use on a page. */
  originalApSizesOnPage(pageIndex: number): number[] {
    return (this.originalApSizes.get(pageIndex) ?? []).filter(
      (size): size is number => size !== null && size > 0,
    );
  }

  /**
   * Record the type size every widget's appearance stream draws at.
   *
   * Must run *before* `FPDFDOC_InitFormFillEnvironment`. PDFium generates an
   * appearance for any field that lacks one as soon as the environment is
   * created, and that generated stream is auto-sized — 18pt on a 24pt box.
   * Once it exists there is no way left to tell it apart from an appearance
   * the file actually supplied, so "the size this field is really drawn at"
   * becomes unanswerable. Asking first is the whole point.
   *
   * Keyed by annotation index rather than field name: a name may live on a
   * parent field rather than the widget, whereas the index is exactly what
   * the mutation path iterates with. Undo reopens the document, which runs
   * this again, so the mapping never goes stale.
   */
  private snapshotAppearanceSizes(): void {
    const { mod } = this;
    const pageCount = mod.FPDF_GetPageCount(this.docHandle);

    for (let p = 0; p < pageCount; p++) {
      const page = mod.FPDF_LoadPage(this.docHandle, p);
      if (!page) continue;

      const count = mod.FPDFPage_GetAnnotCount(page);
      const sizes: (number | null)[] = [];

      for (let i = 0; i < count; i++) {
        const annot = mod.FPDFPage_GetAnnot(page, i);
        let size: number | null = null;

        if (annot) {
          const needed = mod.FPDFAnnot_GetAP(annot, AP_NORMAL, 0, 0);
          if (needed > 2) {
            const text = withScope(mod, (scope) => {
              const buffer = scope.alloc(needed);
              mod.FPDFAnnot_GetAP(annot, AP_NORMAL, buffer, needed);
              return mod.pdfium.UTF16ToString(buffer);
            });
            const match = APPEARANCE_TF.exec(text);
            if (match && Number(match[1]) > 0) size = Number(match[1]);
          }
          mod.FPDFPage_CloseAnnot(annot);
        }

        sizes.push(size);
      }

      this.originalApSizes.set(p, sizes);
      mod.FPDF_ClosePage(page);
    }
  }

  /**
   * Stand up the form-fill environment, for documents that have a form.
   *
   * Skipped entirely when `FPDF_GetFormType` says there is no AcroForm, so
   * the overwhelmingly common case -- an ordinary document -- keeps exactly
   * the render path it had before.
   */
  private initFormEnvironment(): void {
    const { mod } = this;
    if (mod.FPDF_GetFormType(this.docHandle) === FormType.None) return;

    // Before the environment, not after: it rewrites what we are reading.
    this.snapshotAppearanceSizes();

    const ptr = mod.pdfium.wasmExports.malloc(StructSize.FormFillInfo);
    if (!ptr) return; // A form we cannot draw is not worth failing the open for.
    mod.pdfium.HEAPU8.fill(0, ptr, ptr + StructSize.FormFillInfo);

    // Version 2 is what a current PDFium expects; version 1 is the older ABI
    // and is accepted by builds compiled without XFA. Try the newer one and
    // fall back rather than assuming which build this is.
    for (const version of [2, 1]) {
      mod.pdfium.setValue(ptr, version, 'i32');
      this.formHandle = mod.FPDFDOC_InitFormFillEnvironment(this.docHandle, ptr);
      if (this.formHandle) break;
    }

    if (!this.formHandle) {
      mod.pdfium.wasmExports.free(ptr);
      return;
    }

    this.formInfoPtr = ptr;

    // No highlight wash over the fields. PDFium tints them light blue by
    // default, which is right for a form-filling UI and wrong here: the
    // screen has to match what saving and printing produce, and a tint that
    // exists only on screen is exactly the kind of quiet divergence this app
    // is meant not to have.
    mod.FPDF_SetFormFieldHighlightAlpha(this.formHandle, 0);
  }

  get pageCount(): number {
    return this.mod.FPDF_GetPageCount(this.handle);
  }

  /** Load a page, caching the handle. */
  page(index: number): number {
    this.assertOpen();
    const cached = this.pageCache.get(index);
    if (cached) return cached;

    const handle = this.mod.FPDF_LoadPage(this.docHandle, index);
    if (!handle) throw new Error(`Page ${index + 1} could not be loaded.`);
    this.pageCache.set(index, handle);

    // The form environment tracks pages it has been shown. Announcing the
    // page here, next to the load, is what keeps that paired with the
    // withdrawal in `closePage`.
    if (this.formHandle) this.mod.FORM_OnAfterLoadPage(handle, this.formHandle);

    return handle;
  }

  /** Withdraw a page from the form environment, then close it. */
  private closePage(handle: number): void {
    if (this.formHandle) this.mod.FORM_OnBeforeClosePage(handle, this.formHandle);
    this.mod.FPDF_ClosePage(handle);
  }

  /**
   * Run `fn` with a text page, closing it afterwards.
   *
   * Never hold the handle beyond this call. Any text-object mutation on the
   * page invalidates it.
   */
  withTextPage<T>(pageIndex: number, fn: (textPage: number) => T): T {
    const page = this.page(pageIndex);
    const textPage = this.mod.FPDFText_LoadPage(page);
    if (!textPage) throw new Error(`Text could not be read from page ${pageIndex + 1}.`);
    try {
      return fn(textPage);
    } finally {
      this.mod.FPDFText_ClosePage(textPage);
    }
  }

  /** Record that a page's content stream needs regenerating. */
  markDirty(pageIndex: number): void {
    this.dirtyPages.add(pageIndex);
  }

  /**
   * Regenerate content for edited pages only, and return which ones changed.
   *
   * Call this once at the end of a mutation, not after each object change:
   * generating content is the expensive part and it is idempotent per page.
   */
  flushDirty(): number[] {
    const changed = [...this.dirtyPages].sort((a, b) => a - b);
    for (const index of changed) {
      const page = this.page(index);
      if (!this.mod.FPDFPage_GenerateContent(page)) {
        throw new Error(`Changes to page ${index + 1} could not be written.`);
      }
    }
    this.dirtyPages.clear();
    return changed;
  }

  /** Drop a cached page handle, e.g. after the page list changes shape. */
  invalidatePage(index: number): void {
    const handle = this.pageCache.get(index);
    if (handle) {
      this.closePage(handle);
      this.pageCache.delete(index);
    }
  }

  /**
   * Drop every cached page handle.
   *
   * Required after any operation that changes page indices — delete, insert,
   * reorder — because a cached handle would then be filed under the wrong
   * index and hand back the wrong page.
   */
  invalidateAllPages(): void {
    for (const handle of this.pageCache.values()) this.closePage(handle);
    this.pageCache.clear();
  }

  /** Serialise to bytes, as `FPDF_SaveAsCopy`. */
  save(incremental = false): Uint8Array {
    this.assertOpen();
    this.flushDirty();

    const chunks: Uint8Array[] = [];
    let total = 0;

    // FPDF_FILEWRITE is { int version; int (*WriteBlock)(this, data, size); }.
    // PDFium calls WriteBlock repeatedly; each chunk is copied out of the heap
    // straight away because the pointer is only valid for the call.
    const callback = this.mod.pdfium.addFunction((_self: number, dataPtr: number, size: number) => {
      const chunk = new Uint8Array(size);
      chunk.set(this.mod.pdfium.HEAPU8.subarray(dataPtr, dataPtr + size));
      chunks.push(chunk);
      total += size;
      return 1;
    }, 'iiii');

    try {
      const ok = withScope(this.mod, (scope) => {
        const writer = scope.alloc(StructSize.FileWrite);
        this.mod.pdfium.setValue(writer, 1, 'i32');
        this.mod.pdfium.setValue(writer + 4, callback, 'i32');
        const flags = incremental ? SaveFlag.Incremental : SaveFlag.NoIncremental;
        return this.mod.FPDF_SaveAsCopy(this.docHandle, writer, flags);
      });
      if (!ok) throw new Error('The document could not be saved.');
    } finally {
      this.mod.pdfium.removeFunction(callback);
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  /** Describe the document once, on open. */
  info(): DocumentInfo {
    const count = this.pageCount;
    const pages: PageInfo[] = [];
    for (let i = 0; i < count; i++) pages.push(this.pageInfo(i));

    return {
      pageCount: count,
      pages,
      signatureCount: this.mod.FPDF_GetSignatureCount(this.docHandle),
      encrypted: this.mod.EPDF_IsEncrypted(this.docHandle),
      ownerLocked: this.mod.EPDF_IsEncrypted(this.docHandle)
        ? !this.mod.EPDF_IsOwnerUnlocked(this.docHandle)
        : false,
    };
  }

  pageInfo(index: number): PageInfo {
    const page = this.page(index);
    const width = this.mod.FPDF_GetPageWidthF(page);
    const height = this.mod.FPDF_GetPageHeightF(page);
    const rotation = ((this.mod.FPDFPage_GetRotation(page) % 4) + 4) % 4;

    const objectCount = this.mod.FPDFPage_CountObjects(page);
    let textObjectCount = 0;
    let imageCount = 0;
    let largestImageArea = 0;

    for (let i = 0; i < objectCount; i++) {
      const obj = this.mod.FPDFPage_GetObject(page, i);
      const type = this.mod.FPDFPageObj_GetType(obj);
      if (type === ObjType.Text) {
        textObjectCount++;
      } else if (type === ObjType.Image) {
        imageCount++;
        largestImageArea = Math.max(largestImageArea, this.objectArea(obj));
      }
    }

    // A scan is a page whose ink is one big image and which has no text
    // objects at all. Requiring the image to cover most of the page keeps
    // full-page background graphics with real text over them out of this.
    const pageArea = width * height;
    const isScanned = textObjectCount === 0 && imageCount > 0 && largestImageArea > pageArea * 0.6;

    return {
      index,
      width,
      height,
      rotation: rotation * 90,
      isScanned,
      textObjectCount,
    };
  }

  private objectArea(obj: number): number {
    return withScope(this.mod, (scope) => {
      const l = scope.allocFloat();
      const b = scope.allocFloat();
      const r = scope.allocFloat();
      const t = scope.allocFloat();
      if (!this.mod.FPDFPageObj_GetBounds(obj, l, b, r, t)) return 0;
      const get = (p: number) => this.mod.pdfium.getValue(p, 'float');
      return Math.abs(get(r) - get(l)) * Math.abs(get(t) - get(b));
    });
  }

  close(): void {
    if (this.closed) return;
    this.release();
    this.closed = true;
  }

  /** Give back every PDFium resource the current load holds. */
  private release(): void {
    // Order matters: pages are withdrawn from the form environment (inside
    // invalidateAllPages), then the environment goes, then the document, and
    // only then is the struct PDFium was holding released.
    this.invalidateAllPages();
    this.dirtyPages.clear();

    if (this.formHandle) {
      this.mod.FPDFDOC_ExitFormFillEnvironment(this.formHandle);
      this.formHandle = 0;
    }

    this.mod.FPDF_CloseDocument(this.docHandle);

    if (this.formInfoPtr) {
      this.mod.pdfium.wasmExports.free(this.formInfoPtr);
      this.formInfoPtr = 0;
    }

    this.originalApSizes.clear();

    this.mod.pdfium.wasmExports.free(this.dataPtr);
    this.docHandle = 0;
    this.dataPtr = 0;
    this.dataLen = 0;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('This document has been closed.');
  }
}
