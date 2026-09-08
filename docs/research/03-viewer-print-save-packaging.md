# Research 03 — Rendering, viewing, printing, downloading and packaging

> Deep-dive research for the pdf-editor plan. Verified against npm registry / GitHub / MDN browser-compat-data on 2026-09-07. All claims cite sources in the final section.

---

## 1. Summary and recommendations

**Use `pdfjs-dist` directly. Do not use `react-pdf` for this project.**

`pdfjs-dist` is at **6.3.289**, published **2026-08-29**. pdf.js ships on a **strict ~monthly cadence** (6.2.108 → 2026-07-28, 6.1.200 → 2026-06-27, 6.0.227 → 2026-05-30, 5.7.284 → 2026-04-27). Verified via `registry.npmjs.org/pdfjs-dist`.

The decisive fact: **`react-pdf` 10.5.0 (2026-08-20) pins `pdfjs-dist` to the exact version `5.4.296` (2025-10-05)** — roughly a year behind, and behind the entire 6.x line. The tracking issue wojtekmaj/react-pdf#2091 "Update pdfjs version to v6.0.227" is still **open** (created 2026-03-31). `react-pdf` also exposes no annotation-editor API, no `saveDocument()`, and no `extractPages()`. It renders PDFs; it does not edit them.

Other wrappers:

| Wrapper | Latest | Verdict |
|---|---|---|
| `react-pdf` (wojtekmaj) | 10.5.0, 2026-08-20 · 11.2k★ | React 19 peer-ok (`^19.0.0`), Next 16 sample maintained. But pins pdfjs 5.4.296, viewer-only. **Use as reference config, not dependency.** |
| `@react-pdf-viewer/core` | **3.12.0, 2023-03-21** — peers `pdfjs-dist ^2.16 \|\| ^3.0`, `react >=16.8` | **Abandoned.** 2.6k★, last push 2024-08. Do not use. |
| `@embedpdf/react` | 3.0.0-next.11 (2026-09-01); stable line `@embedpdf/core` 2.15.0 | 4.4k★, active, MIT. **PDFium/WASM engine, not pdf.js.** Real annotation + redaction plugins. Strong plan-B / idea source. |
| `pdfjs-viewer-element` | 4.0.2, 2026-09-02 | Thin web-component wrapper around the stock pdf.js viewer. Fine for a read-only embed, useless for a custom editor. |

**Recommendation:** direct `pdfjs-dist` + reuse pdf.js's own layer classes (`TextLayer`, `AnnotationLayer`, `AnnotationEditorLayer`, `AnnotationEditorUIManager`, `DrawLayer`), which are all exported from `pdf.mjs`. Optionally pull `TextLayerBuilder`, `AnnotationLayerBuilder`, `PDFPageView`, `EventBus`, `PDFLinkService`, `PDFFindController` from `pdfjs-dist/web/pdf_viewer.mjs` for the plumbing you don't want to rewrite.

**Print:** save the edited doc to a `Uint8Array` via `saveDocument()`, then hidden-iframe + `contentWindow.print()`. Keep pdf.js's canvas print service as the fallback. **Download:** `<a download>` as the baseline, File System Access API as a Chrome/Edge-only upgrade. **Architecture:** client-only is genuinely viable. **Desktop:** Tauri v2, with one significant print caveat.

---

## 2. pdf.js integration details

### 2.1 Package shape (6.3.289)

```json
{ "main": "build/pdf.mjs", "types": "types/src/pdf.d.ts",
  "optionalDependencies": { "@napi-rs/canvas": "^1.0.0" },
  "browser": { "canvas": false, "fs": false, "http": false, "https": false, "url": false },
  "engines": { "node": ">=22.13.0 || >=24" } }
```

Two things worth knowing:

1. **There is no `exports` field**, so deep imports (`pdfjs-dist/web/pdf_viewer.mjs`, `pdfjs-dist/build/pdf.worker.min.mjs`) resolve fine.
2. **The old `canvas` SSR problem is largely gone.** The optional native dep is now `@napi-rs/canvas`, not `canvas`, and the `browser` field already maps `canvas: false`. The historic `next.config.js` incantations (`resolveAlias: { canvas: './empty-module.ts' }`, `swcMinify: false`) are legacy. You still need `ssr: false` because the code touches `document`/`window`.

Ship these directories to `/public` — pdf.js 6.x needs a **`wasmUrl`** now (JBIG2, OpenJPEG, QCMS are WASM modules):

```
pdfjs-dist/cmaps          → /public/cmaps/
pdfjs-dist/standard_fonts → /public/standard_fonts/
pdfjs-dist/wasm           → /public/wasm/    ← new in 6.x
pdfjs-dist/iccs           → /public/iccs/    ← optional, ICC profiles
```

`DocumentInitParameters` accepts `cMapUrl`, `standardFontDataUrl`, `wasmUrl`, `iccUrl`, and `useWorkerFetch` (auto-enables when all three URLs are same-origin-fetchable, so the worker fetches assets directly instead of round-tripping through the main thread).

### 2.2 Next.js 16 worker setup — the verified pattern

This is copied from react-pdf's **actively maintained `sample/next-app`** (`next ^16.2.11`, `react ^19.2.0`), whose **`next.config.ts` is literally empty** — no Turbopack workarounds needed in Next 16:

```tsx
// app/page.tsx
'use client';
import dynamic from 'next/dynamic';
const Viewer = dynamic(() => import('./Viewer'), { ssr: false });
export default function Page() { return <Viewer />; }
```

```tsx
// app/Viewer.tsx
'use client';
import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
const options = { cMapUrl: '/cmaps/', standardFontDataUrl: '/standard_fonts/', wasmUrl: '/wasm/' };
```

Pitfalls, all real:
- **`workerSrc` must be assigned in the same module that uses the API** — module execution order otherwise lets the default overwrite it (react-pdf README warns on this explicitly).
- **pnpm** needs `public-hoist-pattern[]=pdfjs-dist` in `.npmrc` for `new URL(...)` resolution.
- If `new URL` resolution ever misbehaves, fall back to copying `pdf.worker.min.mjs` into `/public` and pointing `workerSrc` at `/pdf.worker.min.mjs`. Version must match `pdfjs.version` exactly.
- Turbopack has been the default bundler since **Next 16.0**, and **16.2 fixed Web Worker `location.origin`** (workers were bootstrapped via `blob://`, breaking `importScripts()`/`fetch()` inside them) — that release note says it "should unblock anyone who had trouble running WASM code inside a Worker." Turbopack ships WASM/worker runtime code on demand as of 16.3. WASM isn't in the Turbopack "supported features" table, so treat `.wasm` **fetched at runtime from `/public`** as the safe path; `--webpack` with `experiments.asyncWebAssembly` remains the escape hatch.

### 2.3 Canvas rendering, DPR, cancellation

`RenderParameters` in 6.x prefers **`canvas`** over `canvasContext` ("it is recommended to use the `canvas` parameter instead"). Relevant fields: `viewport`, `intent` (`'display' | 'print' | 'any'`), `annotationMode`, `transform`, `background`, `optionalContentConfigPromise`, `annotationCanvasMap`, `printAnnotationStorage`, and **`isEditing`** (render the page in editing mode). 6.x also added `recordImages`, `recordOperations`, and `operationsFilter` — potentially very useful for hit-testing content.

DPR handling mirrors pdf.js's `OutputScale` (`src/display/display_utils.js`), which initialises `sx = sy = devicePixelRatio` and exposes `limitCanvas(...)` for a `maxCanvasPixels` ceiling:

```ts
const viewport = page.getViewport({ scale });
const dpr = window.devicePixelRatio || 1;
canvas.width  = Math.floor(viewport.width  * dpr);
canvas.height = Math.floor(viewport.height * dpr);
canvas.style.width  = `${Math.floor(viewport.width)}px`;
canvas.style.height = `${Math.floor(viewport.height)}px`;

const task = page.render({ canvas, viewport,
  transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
try { await task.promise; }
catch (e) { if (e?.name !== 'RenderingCancelledException') throw e; }
// on unmount / scale change:
task.cancel();
```

Cancel on every scroll-out, zoom, or unmount — `RenderingCancelledException` is exported from `pdf.mjs` and is the expected, swallowable error. pdf.js also sets a `--scale-factor` CSS custom property on the page container; the layer CSS in `pdfjs-dist/web/pdf_viewer.css` depends on it, as does `setLayerDimensions` (also exported).

**Virtualization:** `@tanstack/react-virtual` **3.14.10** (2026-08-18) is the better fit — headless, first-class variable/dynamic item sizes, which matters because PDF pages differ in height. `react-window` **2.3.1** (2026-09-05, 17.2k★) is very much alive (v2 was a rewrite) and lighter, but TanStack's measurement API is less friction for mixed page sizes. Either way, mount/unmount canvases on the virtualizer's overscan boundary and cancel render tasks on unmount.

### 2.4 Text layer

`getTextContent({ includeMarkedContent?, disableNormalization? })` resolves `{ items, styles }`. `TextItem` (verbatim from `src/display/api.js`):

```ts
{ str: string; dir: 'ttb'|'ltr'|'rtl'; transform: number[];  // [a,b,c,d,e,f]
  width: number; height: number; fontName: string; hasEOL: boolean }
```

`styles` is `Record<fontName, { ascent, descent, vertical, fontFamily }>`. `includeMarkedContent: true` interleaves `TextMarkedContent` sentinels (`beginMarkedContent` / `beginMarkedContentProps` / `endMarkedContent`), which is how you recover logical structure/order for editing.

The `TextLayer` **class** (exported from `pdf.mjs`; superseded the old `renderTextLayer()` function in v4):

```ts
const tl = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
await tl.render();
tl.update({ viewport: newViewport });  // on zoom — no re-fetch
tl.cancel();
const divs = tl.textDivs;              // parallel to tl.textContentItemsStr
TextLayer.cleanup();                   // static caches: ascent, canvas ctx
```

`textDivs[i]` ↔ `textContentItemsStr[i]` is your click→item mapping: hit-test the DOM span (or `document.caretPositionFromPoint`), take its index, index back into your `items` array.

**Coordinate conversion.** `PixelsPerInch.CSS = 96`, `PixelsPerInch.PDF = 72`, `PDF_TO_CSS_UNITS = 4/3` (both exported). Use `viewport.convertToViewportPoint(x, y)` / `convertToPdfPoint(x, y)` rather than hand-rolling the matrix; `viewport.transform` is available if you need it. A text item's PDF-space origin is `(transform[4], transform[5])`, its scale is `transform[0]`/`transform[3]`.

### 2.5 Annotation layer and the editor

`page.getAnnotations({ intent })` → raw annotation dicts. `AnnotationLayer` renders them; pass `annotationMode: AnnotationMode.ENABLE_FORMS` to `render()` so widgets go to the DOM layer, and `ENABLE_STORAGE` when you want `AnnotationStorage` values baked into the canvas (this is what printing uses).

`AnnotationEditorType` (from `src/shared/util.js`, v6.3.289):

```js
{ DISABLE: -1, NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, STAMP: 13, INK: 15,
  POPUP: 16, SIGNATURE: 101, COMMENT: 102 }
```

Version archaeology (diffed `src/shared/util.js` across tags):
- **`SIGNATURE: 101` first appears in v5.0.375 (2025-03-15)** — the Signature editor is a 5.0 feature.
- **`COMMENT: 102` landed between 5.0 and 5.4.149 (2025-08-30)** — newer still.
- **6.2.108 (2026-07-28) added Digital Signature *and certificate* verification** (PR #21247), plus `getSignatures()` / `getSignatureData()` API and a `SignaturePropertiesManager`. This is verification, distinct from the drawing/signature editor.
- **6.3.289 (2026-08-29)** made `HighlightEditor extend DrawingEditor` (PR #21769) — internal but relevant if you subclass.

Drive edits through `AnnotationEditorUIManager` + `AnnotationEditorLayer` + `DrawLayer` (all exported), then serialize:

```ts
const bytes: Uint8Array = await pdfDocument.saveDocument();
```

`saveDocument()` warns (`"saveDocument called while annotationStorage is empty, please use the getData-method instead"`) and serializes `annotationStorage.serializable` to the worker — so `getData()` for the untouched original, `saveDocument()` once anything is edited.

**Newer and undersold: `extractPages()`.** pdf.js 5.7+ carries a full incremental writer at `src/core/editor/pdf_editor.js` (a `PDFEditor` class with `writePDF()`, object streams, AcroForm/outline/named-destination/struct-tree fixups). It is worker-side and *not* exported, but it is reachable through:

```ts
pdfDocument.extractPages(pageInfos: PageInfo[], copyLevels?: Int32Array): Promise<Uint8Array>
```

where each `PageInfo` is `{ document?, image?, includePages?, excludePages?, pageIndices?, insertAfter? }`. That means **merge, split, reorder, delete, and insert-image-as-page are now first-class pdf.js operations** — you may not need `pdf-lib` for page-level surgery at all. (`pdf-lib` is still **1.17.1 from 2021-11-06**, last repo push 2024-07; 8.6k★ but effectively unmaintained.)

### 2.6 pdf.js 6.0 breaking changes to plan for

From the v6.0.227 release notes: `[api-major]` minimum supported browsers raised / polyfills removed; `[api-major]` **`getDocument()` without a parameter object removed**, and **`PDFDocumentProxy.prototype.destroy()` removed** (use `loadingTask.destroy()`). Node engine floor is now `>=22.13.0 || >=24`.

---

## 3. Printing

### The three approaches, and what actually happens

**(a) Blob → hidden iframe → `iframe.contentWindow.print()`.** Best fidelity: the browser's own PDF engine rasterizes, so vectors stay vector and embedded fonts stay embedded, and *all* pages print by default. Caveats: Chrome/Edge work reliably for same-origin/blob PDFs once the built-in viewer has initialized; **Safari frequently ignores `print()` on a fully hidden iframe** and wants user activation plus non-zero visibility (the common hack is `position: fixed; right: 100%; bottom: 100%` rather than `display: none`, and briefly focusing the frame). Historically Firefox failed silently on iframe'd PDFs (bugzilla #856116, pdf.js#5397); fixed since Firefox 22, but Firefox has a separate live gotcha — **it re-fetches blob URLs when rendering the print dialog**, so revoking the object URL too early produces broken/blank output (pdf.js#19988).

**(b) pdf.js's own print service** (`web/pdf_print_service.js`, 401 lines — worth reading in full). Its exact strategy:
- `PRINT_UNITS = printResolution / PixelsPerInch.PDF`, with viewer default **`printResolution: 150`** (`web/app_options.js`), i.e. 150/72 ≈ 2.08×.
- One reused `scratchCanvas` sized `floor(size.width * PRINT_UNITS)`; render with `transform: [PRINT_UNITS, 0, 0, PRINT_UNITS, 0, 0]`, `intent: "print"`, `annotationMode: AnnotationMode.ENABLE_STORAGE`.
- `scratchCanvas.toBlob()` → `URL.createObjectURL` → `<img>` inside `<div class="printedPage">` appended to `#printContainer`; **object URLs are deliberately revoked only in `destroy()`**, for the Firefox reason above.
- Page size injected as a constructed stylesheet: `sheet.replaceSync(`@page { size: ${width}pt ${height}pt; }`)`.
- `performPrint()` calls `window.print()` **inside `setTimeout(..., 0)`** to escape the microtask queue (pdf.js#7547), then `setTimeout(resolve, 20)` in case `print()` returned async.
- It also monkey-patches `window.print` to reject re-entrant print jobs.

**(c) `window.open(blobUrl).print()`.** Popup-blocker-dependent and the least controllable. Skip it.

### Recommendation

`saveDocument()` → `Blob` → **hidden iframe** as the primary path, with the pdf.js canvas service as an automatic fallback (feature-detect + timeout: if `onload` doesn't fire or `print()` throws, switch). On Safari specifically, prefer opening the blob in a new tab with a "press ⌘P" hint over silently failing. This is exactly the shape of pdf.js's own split between `firefox_print_service.js` and `pdf_print_service.js`.

### Print CSS

pdf.js's `viewer.css` `@media print` block is the reference:

```css
@media print {
  body { background: rgb(0 0 0 / 0) none; }
  body[data-pdfjsprinting] #outerContainer { display: none; }
  body[data-pdfjsprinting] #printContainer { display: block; height: 100%; }
  #printContainer > .printedPage {
    page-break-after: always; page-break-inside: avoid;
    height: 100%; width: 100%;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
  }
  #printContainer > .printedPage :is(canvas, img) {
    max-width: 100%; max-height: 100%; direction: ltr; display: block;
  }
}
```

Note it uses the legacy `page-break-*` properties, not `break-after`, and relies on **intrinsic image size** to fit the page. Add `@page { size: <w>pt <h>pt; margin: 0 }` per-document (constructed stylesheet, as pdf.js does). For color, emit both:

```css
-webkit-print-color-adjust: exact;
print-color-adjust: exact;   /* unprefixed: Chrome 92+, Firefox 97+, Safari/iOS 15.4+ */
```

`@page` margin boxes are inconsistent: Chrome full since ~2023, Safari ~2024 (and mdn/browser-compat-data#23178 tracks Safari mishandling `@page` margins), Firefox partial. Keep `@page` to `size` + `margin: 0` and do your own layout.

---

## 4. Download / save

**Baseline (works everywhere):**

```ts
const blob = new Blob([bytes], { type: 'application/pdf' });
const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement('a'), { href: url, download: name });
a.click();
setTimeout(() => URL.revokeObjectURL(url), 10_000); // don't revoke immediately
```

**File System Access API — Chrome/Edge only, still.** MDN BCD (`api/Window.json`, main branch, today):

| API | Chrome | Chrome Android | Edge | Firefox | Safari | iOS |
|---|---|---|---|---|---|---|
| `showSaveFilePicker` | 86 | 132 | mirror | **false** | **false** | mirror |
| `showOpenFilePicker` | 86 | 132 | mirror | **false** | **false** | mirror |
| `showDirectoryPicker` | 86 | 132 | mirror | **false** | **false** | mirror |

MDN flags it *"not Baseline"*, experimental, secure-context-only, and requiring **transient user activation**. Firefox and Safari have shipped nothing. Use `GoogleChromeLabs/browser-fs-access` (1.6k★, Apache-2.0, active — pushed 2026-06-22) which is precisely this API with the `<a download>` / `<input type=file>` fallback baked in. The real UX win is **true save-in-place**: keep the `FileSystemFileHandle`, and Ctrl+S overwrites the user's original file with no re-download.

**Open:** `<input type="file" accept="application/pdf">` + drag-and-drop (`DataTransferItem.getAsFileSystemHandle()` on Chromium gives you a writable handle from a drop). On installed Chromium PWAs, the **File Handling API** lets you become the OS handler for `.pdf` — but `LaunchQueue` is **Chrome 102 / Edge only; Firefox and Safari: false**.

**Autosave / drafts — OPFS is the right tool, and it's the one thing with real cross-browser support.** BCD:

| | Chrome | Firefox | Safari |
|---|---|---|---|
| `navigator.storage.getDirectory()` | 86 | 111 | 15.2 |
| `createSyncAccessHandle()` (worker-only) | 102 | 111 | 15.2 |
| `createWritable()` | 86 | 111 | **26** |

MDN calls OPFS Baseline/widely-available since March 2023. The sharp edge: **`createWritable()` only reached Safari 26** — so for Safari coverage, do OPFS writes via `createSyncAccessHandle()` **inside a Web Worker** (sync handles are worker-only by spec anyway, and are much faster: in-place writes, no temp files, no Safe-Browsing checks). Use IndexedDB (or `idb-keyval`) for the *recent-files index* and for persisting `FileSystemFileHandle` objects (they're structured-cloneable) — not for the PDF bytes themselves.

**Large PDFs.** `ArrayBuffer`/`Uint8Array` are transferable: `worker.postMessage(bytes, [bytes.buffer])` moves ownership with zero copy — but **detaches the source**, so re-read from the worker's reply rather than assuming you still own it. `Comlink` (4.4.2, 2024-11-07 — stable, 12.8k★, still actively pushed) makes worker RPC ergonomic; wrap buffers in `Comlink.transfer(bytes, [bytes.buffer])` explicitly, otherwise Comlink structured-clones (copies) them. Also call `pdfDocument.cleanup()` between documents, keep `maxCanvasPixels` bounded, and zero out `canvas.width = canvas.height = 0` on unmount (pdf.js does exactly this in its print service teardown) — detached canvases are a notorious mobile-Safari memory leak.

---

## 5. Architecture: client-only, workers, WASM, Next.js config

**Client-only is genuinely achievable, and it's the differentiator.** pdf.js already runs its parser/renderer in a Web Worker. `saveDocument()` and `extractPages()` write the new PDF **in the worker**. So view/annotate/edit/reorder/merge/split/print/save need **zero** server. "Your files never leave your device" is a truthful claim, not marketing.

**What still wants a server (or a heavy WASM payload):**
- **OCR for scanned PDFs.** `tesseract.js` **7.0.0** (2025-12-15, 38.7k★, Apache-2.0) works fully client-side, uses `wasm-feature-detect` to pick a SIMD/threaded core, and caches models via `idb-keyval`. But language models are tens of MB and throughput is poor on mobile. Offer it as an opt-in "OCR this page (downloads ~15MB, runs locally)".
- **DOCX → PDF conversion.** No credible client-side path. Server, or drop the feature.
- **Font fetching / substitution** beyond the 14 standard fonts bundled in `standard_fonts/`.

**Alternative WASM engines** (only if pdf.js's editing proves insufficient):
- **PDFium** via `@embedpdf/pdfium` **2.15.0** — **MIT**, ~7.5 MB unpacked, exports `./pdfium.wasm` as a subpath. This is what EmbedPDF is built on.
- **MuPDF** via the `mupdf` npm package **1.28.1** (2026-09-06, official Artifex, ESM) — **⚠️ AGPL-3.0-or-later**. For a self-hosted local app that's arguably fine; for anything distributed or commercial it's a licensing landmine. `mupdf-js` (2.0.1, 2024) is a stale third-party wrapper. **Prefer PDFium** on license grounds alone.

Run either in a Worker behind Comlink. Only reach for `SharedArrayBuffer` + threaded WASM if profiling demands it, because:

**⚠️ The COOP/COEP × static-export conflict — this is the single most important architectural constraint in this report.** Next.js docs explicitly list **`Headers`** among the *Unsupported Features* for `output: 'export'`, alongside Rewrites, Redirects, Proxy, Server Actions, and ISR. So:

```ts
// next.config.ts — WORKS on a Node/Vercel deploy, IGNORED under output:'export'
async headers() {
  return [{ source: '/:path*', headers: [
    { key: 'Cross-Origin-Opener-Policy',   value: 'same-origin' },
    { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' }, // or require-corp
  ]}];
}
```

Under static export you must set these at the host (Nginx/Cloudflare/`_headers`), and the headers **must be on the top-level HTML navigation response**, not just on `.wasm`, or cross-origin isolation silently fails. **Conclusion: design for single-threaded WASM.** Then `output: 'export'` stays available and the same `out/` folder drops onto any static host *and* into a desktop shell unchanged.

**Turbopack + WASM in practice:** serve `.wasm` from `/public` and `fetch()` it at runtime with an explicit, statically-analyzable path. This avoids the whole "Turbopack won't bundle a `.wasm` that isn't referenced in app code" class of problem, works identically under `--webpack`, and survives static export. Keep `next build --webpack` (+ `experiments.asyncWebAssembly`) as the documented escape hatch.

---

## 6. Desktop and PWA

**Tauri v2** — `@tauri-apps/cli` **2.11.4** (2026-06-28), `@tauri-apps/api` **2.11.1**, `plugin-dialog` **2.7.3**, `plugin-fs` **2.5.2** (all 2026-08-31). Bundles land in the **~3–10 MB** range against Electron's ~120–200 MB, with roughly 4× faster cold start and ~75% less idle RAM in third-party 2026 benchmarks. It consumes a Next.js static export directly (point `frontendDist` at `out/`), and `plugin-dialog` gives you native open/save with type filters on Windows/macOS/Linux/iOS/Android.

**Electron** — **44.2.0** (2026-09-04), `electron-builder` 26.15.3. Chromium-uniform rendering (your pdf.js code behaves identically on every platform), no Rust, and — critically — a real **`webContents.print()` / `printToPDF()`** API with programmatic printer, margin, and copy control.

**The Tauri catch you must weigh:** Tauri has **no print API**. tauri-apps/plugins-workspace#293 "[print] Add plugin for (silent) print API" is **still open** (last updated 2025-11-23, 17 comments), as are the upstream tauri#4917 and tauri#5330. Inside a Tauri webview you're back to `window.print()` and whatever the platform WebView (WebView2 / WKWebView / WebKitGTK) does with it — which is exactly the inconsistency you're trying to escape.

**Recommendation:** **Tauri v2**, because the printing path is already a browser path and you get native save dialogs for free. If, during implementation, print output proves unacceptable on WKWebView, switching to Electron costs you the shell only — the static export is identical.

**PWA as the lighter option.** Installable on Chrome/Edge desktop (dock/Start-menu icon, standalone window) and Android. `LaunchQueue`-based file handling makes you the OS `.pdf` handler — **Chromium only**. iOS/iPadOS requires manual Share → *Add to Home Screen*; Safari shows no install prompt. Ship the PWA first (it's near-free once you're static-export + offline-capable via OPFS), and add the Tauri shell for the "local app" story.

---

## 7. Reference projects

| Project | Stars | Lang / License | Last push | Why it matters |
|---|---|---|---|---|
| mozilla/pdf.js | **53.8k** | JS, Apache-2.0 | 2026-09-07 | **The primary reference.** Read `web/` end-to-end: `pdf_print_service.js`, `pdf_page_view.js`, `text_layer_builder.js`, `annotation_editor_layer_builder.js`, `draw_layer_builder.js`, `download_manager.js`, `comment_manager.js`, `digital_signature_properties_manager.js`, `app_options.js`, and `src/core/editor/pdf_editor.js` (the incremental writer). |
| Stirling-Tools/Stirling-PDF | **91.4k** | Java, open-core | 2026-09-07 | The 800-lb gorilla. Server-side (PDFBox) with a separate `frontend/`; ships desktop client + browser UI + self-hosted server. Study its **feature taxonomy and UX**, not its architecture — the client-only model is the opposite bet. |
| embedpdf/embed-pdf-viewer | **4.5k** | TS, MIT | 2026-09-01 | Closest peer. PDFium-WASM engine, headless plugin architecture (`plugin-annotation`, `plugin-selection`, `plugin-history`, `plugin-interaction-manager`, `plugin-scroll`). v3 React adapter is `next.11`. **Best source of ideas for plugin boundaries and true redaction.** |
| pdfme/pdfme | **4.8k** | TS, MIT | 2026-09-01 | WYSIWYG template designer + viewer, browser and Node. Good reference for canvas-overlay editing UX. |
| pdfarranger/pdfarranger | 5.9k | Python/GTK, GPL-3.0 | 2026-09-01 | Page-level UX gold standard (merge/split/rotate/crop/rearrange) — map directly onto pdf.js `extractPages()`. |
| wojtekmaj/react-pdf | 11.2k | TS, MIT | 2026-09-04 | Use `sample/next-app` as the **canonical Next 16 + React 19 + pdfjs config**; read `Page`/`TextLayer` internals for React-lifecycle-safe render cancellation. |
| ShizukuIchi/pdf-editor | 1.9k | JS | 2024-02-29 | "Offline PDF editor — add images, signatures, text in your browser." Stale but the closest small-scale precedent for exactly this pitch. |
| SimplePDF/simplepdf-embed | 409 | MIT | 2026-09-03 | Active browser PDF editor (text, checkboxes, images, signatures, merge, rotate) as iframe/script/React. |
| GoogleChromeLabs/browser-fs-access | 1.6k | Apache-2.0 | 2026-06-22 | Drop-in File System Access + fallback. Just use it. |
| GoogleChromeLabs/comlink | 12.8k | Apache-2.0 | 2026-09-05 | Worker RPC. |
| naptha/tesseract.js | 38.7k | Apache-2.0 | 2026-05-17 | v7.0.0 client-side OCR. |
| Hopding/pdf-lib | 8.6k | MIT | **2024-07-17** | 1.17.1 from 2021. Effectively unmaintained — and `extractPages()` now covers most of why you'd want it. |
| react-pdf-viewer/react-pdf-viewer | 2.6k | NOASSERTION | **2024-08-19** | Abandoned; pdfjs 2/3-era peers. Avoid. |

Also worth a look for the privacy-first-WASM-office positioning: baotlake/office-website (1.4k★, "Local-First & Private… Zero data uploads, 100% client-side") and SteveTheKiller/KillerPDF (3.8k★, C#/Windows, but its feature list — OCR, redact, compare, edit text, flatten — is a good scope checklist).

---

## 8. Sources

- https://www.npmjs.com/package/pdfjs-dist · https://registry.npmjs.org/pdfjs-dist
- https://github.com/mozilla/pdf.js/releases · https://api.github.com/repos/mozilla/pdf.js/releases
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/src/display/api.js
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/src/display/text_layer.js
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/src/display/display_utils.js
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/src/shared/util.js
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/src/core/editor/pdf_editor.js
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/src/pdf.js
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/web/pdf_print_service.js
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/web/pdf_page_view.js
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/web/app_options.js
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/web/viewer.css
- https://raw.githubusercontent.com/mozilla/pdf.js/v6.3.289/web/pdf_viewer.component.js
- https://github.com/mozilla/pdf.js/pull/21247 · /21769 · https://github.com/mozilla/pdf.js/issues/19988 · /7547 · /5397
- https://github.com/mozilla/pdf.js/wiki/frequently-asked-questions
- https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/package.json · https://data.jsdelivr.com/v1/packages/npm/pdfjs-dist@6.3.289
- https://github.com/wojtekmaj/react-pdf · /issues/2091 · /issues/1855 · `packages/react-pdf/README.md` · `sample/next-app/{package.json,next.config.ts,app/page.tsx,app/Sample.tsx}`
- https://www.npmjs.com/package/react-pdf · https://react-pdf-viewer.dev/examples/keep-the-worker-version-in-sync-with-pdfjs-dist-version/
- https://www.embedpdf.com/ · https://www.embedpdf.com/react-pdf-viewer · https://www.embedpdf.com/docs/pdfium/introduction · https://www.npmjs.com/package/@embedpdf/pdfium · https://github.com/embedpdf/embed-pdf-viewer/releases
- https://nextjs.org/docs/app/api-reference/turbopack · https://nextjs.org/blog/next-16-2-turbopack · https://nextjs.org/blog/next-16-3-turbopack
- https://nextjs.org/docs/app/guides/static-exports · https://nextjs.org/docs/app/api-reference/config/next-config-js/headers · https://nextjs.org/docs/app/guides/lazy-loading#skipping-ssr
- https://github.com/vercel/next.js/issues/65406 · /86099
- https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
- https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- https://developer.mozilla.org/en-US/docs/Web/API/Launch_Handler_API
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/print-color-adjust
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing
- https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/{Window,FileSystemFileHandle,StorageManager,LaunchQueue}.json · https://github.com/mdn/browser-compat-data/issues/23178
- https://developer.chrome.com/docs/capabilities/web-apis/file-system-access · https://web.dev/patterns/files/handle-files-opened-from-the-file-explorer
- https://bugzilla.mozilla.org/show_bug.cgi?id=856116 · =647658 · =1755509
- https://www.nutrient.io/blog/how-to-print-pdfs-using-pdfjs/ · https://www.nutrient.io/blog/how-to-build-a-reactjs-viewer-with-pdfjs/ · https://www.nutrient.io/blog/top-react-pdf-viewers/
- https://gist.github.com/danielrose7/adb604b9334118d98de6e856efd043df · https://www.javaspring.net/blog/how-do-i-print-an-iframe-from-javascript-in-safari-chrome/
- https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/ · https://dev.to/stefnotch/enabling-coop-coep-without-touching-the-server-2d3n
- https://v2.tauri.app/plugin/dialog/ · https://v2.tauri.app/reference/javascript/dialog/ · https://github.com/tauri-apps/plugins-workspace/issues/293 · https://github.com/tauri-apps/tauri/issues/4917 · /5330
- https://www.electronjs.org/docs/latest/api/dialog · https://www.npmjs.com/package/electron
- https://rustify.rs/articles/rust-tauri-vs-electron-2026 · https://www.pkgpulse.com/guides/electron-vs-tauri-2026 · https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026
- https://www.pkgpulse.com/guides/tanstack-virtual-vs-react-window-vs-react-virtuoso-2026 · https://github.com/TanStack/virtual/discussions/459 · https://react-window.vercel.app/
- https://github.com/{Stirling-Tools/Stirling-PDF, pdfarranger/pdfarranger, pdfme/pdfme, SimplePDF/simplepdf-embed, ShizukuIchi/pdf-editor, Hopding/pdf-lib, GoogleChromeLabs/browser-fs-access, GoogleChromeLabs/comlink, naptha/tesseract.js, baotlake/office-website, SteveTheKiller/KillerPDF}
- https://mupdf.readthedocs.io/en/latest/ · https://registry.npmjs.org/mupdf/1.28.1 (license: AGPL-3.0-or-later)
