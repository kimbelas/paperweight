# PDF Editor — Plan

**Stage:** Planning · **Date:** 2026-09-07 · **Archetype:** Local-first desktop-browser tool
**Stack:** Next.js 16 (App Router, static export) · React 19 · TypeScript 5 · Tailwind 4 · pnpm · PDFium (WebAssembly)

Research behind every decision here lives in `docs/research/` (five deep dives, ~250 cited sources). Read `docs/research/README.md` for the index. This document is the synthesis; `TASKS.md` is the phased checklist.

---

## The brief

### What this is

A PDF editor that runs entirely in the browser on my own machine. Open a PDF, click on existing text and change it, click a signature and delete it, draw or type a new signature and place it, then print or save the result. The same things Sejda, Smallpdf or PDFescape offer — without uploading the file to anyone, without a task quota, without a watermark, and without a sign-up wall.

### Why it exists

- **Every mainstream free tool uploads the document.** Smallpdf, iLovePDF, Sejda, PDFescape, Adobe online all process server-side. Contracts, IDs and invoices go to someone else's machine.
- **Free tiers do not survive one real job.** Xodo: 1 action/day. Smallpdf: 2/day. Sejda: 3/hour, 200 pages, 50 MB. Adobe: edit for free, but you cannot download.
- **The tools that *are* local cannot edit existing text.** SimplePDF, LocalPDF, PDF24 and every pdf.js-based editor only overlay new content. A local-first editor that changes existing text sits in an empty quadrant.
- **Signature removal is a trap everywhere.** Competitors conflate three different things (an annotation, an image baked into the page, a cryptographic signature) and users end up with a white box over pixels that are still in the file.

### What "working" looks like

- Drop a PDF onto the window. The first page is visible in under a second. DevTools shows **zero network requests** carrying document bytes.
- Click a word on an invoice, retype it, press Enter. The page re-renders with the new text **in the original font**. Save writes back to the same file on disk.
- Click a signature image on a contract, press Delete. It is gone, and the saved file contains **no trace of the image object** (object enumeration confirms, not just the pixels).
- Sign: draw with a mouse or stylus, place, resize, save. The signature prints correctly from Chrome, Acrobat and Firefox.
- Print hands the **real PDF** to the OS print dialog, not a screenshot of the DOM.
- Undo works for everything, including the destructive engine operations.
- Where the tool cannot do the honest thing, it **says so**: "this page is a scan, text cannot be edited", "font substituted", "this will invalidate the digital signature", "Cover hides pixels; Redact removes them."

### Edges — deliberately not building

- **Paragraph re-flow.** Edits are line-scoped, like Sejda. Longer text shrinks or squeezes; it does not push the next line down. PDF has no paragraph model and no competitor solves this well.
- **Cryptographic signing.** Drawing a signature image is in scope. Producing a PKCS#7 digital signature needs a CA-issued certificate and a private key, and doing that in a browser tab is an anti-pattern. Out of scope for v1.
- ~~**OCR.** Scanned pages are detected and labelled unusable for text editing.~~ **Built** (2026-09-08). Scanned pages can be read with `tesseract.js`, entirely on device, and a recognised line can be replaced by covering it and redrawing. Presented as a distinct operation from editing, because it is one.
- **Any server.** No accounts, no upload, no conversion (DOCX to PDF), no collaboration.
- **Mobile layout.** Desktop browsers first. Nothing should break on a tablet, but no touch-first design in v1.
- **Form-field creation and annotation tooling** (highlight, comments). Later phases.
- **pdf.js.** Best viewer in the world, but read-only by design and the maintainers closed text editing as "not planned". Using it alongside an editing engine means two WASM payloads and a save-reload-rerender loop after every commit. One engine owns the document.

### Decisions already made

- **One engine: PDFium via `@embedpdf/pdfium`, in a Web Worker.** It is the only permissively licensed WASM build verified to export the text-mutation API (`FPDFText_SetText`, `FPDFPage_RemoveObject`, `FPDFPage_GenerateContent`, `FPDFText_GetTextObject`, font-introspection calls). It renders too, so hit-testing, editing and drawing share one document instance and one coordinate space. Details in "Architecture".
- **No AGPL.** MuPDF is technically the best redaction engine reachable from JS, but it is AGPL-3.0-or-later or a quoted commercial licence. PDFium is BSD-3, the wrapper is MIT/Apache-2.0, fonts are SIL OFL. Nothing else gets in.
- **No pdf-lib.** Last release 2021, cannot edit existing text, and PDFium covers everything it would have done.
- **100% client-side, `output: 'export'`.** The whole app is a folder of static files. It can be hosted anywhere, installed as a PWA, or wrapped in Tauri unchanged.
- **Single-threaded WASM.** Static export cannot set COOP/COEP headers, so no `SharedArrayBuffer`. This keeps the deploy story trivial and is fast enough for the workload.
- **PDF user space is the only stored coordinate system.** Points, origin bottom-left. Screen coordinates are derived at render time via PDFium's `FPDF_DeviceToPage` / `FPDF_PageToDevice`, which respect `/Rotate` and `/CropBox`.
- **Undo is snapshot-based.** Before every committed engine mutation the worker serialises the document into a ring buffer. PDFium mutations are not reliably invertible; snapshots are simple and always correct.
- **Additions stay floating until applied.** New text, images and signatures are app-level overlay objects (movable, resizable) until Save/Print/Apply flattens them into page objects. Edits to *existing* content (text change, object delete) commit to the engine immediately and re-render.
- **"Cover" and "Redact" are different tools with different names.** Cover draws an opaque rectangle. Redact removes content. The UI never lets one masquerade as the other.
- **Editing a digitally signed PDF shows a warning first.** Any byte change invalidates the signature. That is the mechanism working, not a bug, and the user is told before proceeding.
- **New signatures are flattened as image objects by default.** Renders and prints identically in every viewer. A "keep as annotation" toggle can come later.
- **Font fallback is visible.** When the original embedded subset lacks a glyph, a metric-compatible bundled font is used and a badge says so. Never silent substitution.

### Constraints that shape the build

- **`FPDFPage_GenerateContent` rewrites the whole page content stream** from PDFium's object model. Pages that were not edited must never be regenerated. This is enforced at the worker API level: mutations are per-page and a page is only regenerated if it was touched.
- **Removing a text object invalidates every text-page handle for that page.** The worker must reload the text page after each text mutation or it is a use-after-free.
- **Embedded fonts are subsets.** A font embedded for the word "Invoice" contains seven glyphs. Coverage must be checked before reusing the original font, and extending a subset is never attempted.
- **WASM payload ~2 MB gzipped** plus lazily loaded fonts. First-load budget: under 3 MB transferred before the first page renders.
- **Memory.** Snapshot ring buffer capped (30 entries or 300 MB, whichever first). Large-document behaviour (100 pages, 30 MB) is a measured budget, not a hope.
- **Browser reality.** Save-in-place (File System Access API) is Chromium-only. Firefox and Safari get download-as-new-file. OPFS writes for autosave go through a worker sync access handle because `createWritable()` only reached Safari 26.

---

## Research summary

| Doc | What it settles |
|---|---|
| `01-editing-engines.md` | No open-source library edits existing text out of the box. `@embedpdf/pdfium` is the only permissive WASM build that exposes PDFium's mutation API (verified by scanning the published `.wasm`). MuPDF is AGPL. pdf-lib is dead. Commercial editors (Apryse, Nutrient, Foxit, ComPDFKit) all do it, all quote-priced. |
| `02-signatures.md` | A "signature" is one of six PDF structures. Annotation-based ones are cleanly removable; flattened image objects need content-stream editing; scanned ones are pixels. Removing anything from a digitally signed file invalidates the signature by design. |
| `03-viewer-print-save-packaging.md` | pdf.js 6.3 state of the art, why not to use `react-pdf`, hidden-iframe printing with a canvas fallback, File System Access / OPFS browser support, the COOP/COEP-vs-static-export conflict, Tauri v2 has no print API. |
| `04-competitors-and-ux.md` | Feature matrix of 11 editors, the universal UI conventions (top toolbar, left thumbnails, click-text-to-edit, three-tab signature modal), the pain points that become differentiators, and a value-vs-difficulty MVP ordering. |
| `05-pdf-internals-and-fonts.md` | The content-stream text model, why `Tj` bytes are glyph codes not Unicode, the three editing strategies, font coverage checks with fontkit, bundled fallback fonts with licences, the coordinate math, and a 20-item gotcha checklist. |

---

## Architecture

### Engine decision

Three viable shapes were considered:

| Option | Shape | Pros | Cons |
|---|---|---|---|
| A | pdf.js for viewing + PDFium worker for mutations | Best viewer chrome for free (text layer, annotation editor, print service) | Two engines, two WASM payloads, save→reload→rerender after every commit, no object identity in pdf.js so hit-tests map to PDFium objects by coordinates only |
| B | EmbedPDF v2 headless framework (PDFium underneath) + custom text-edit plugin | Viewer, selection, thumbnails, redaction, print, export already built; Apache-2.0 | Locks into their plugin architecture mid v2→v3 migration (v3 not production-ready), 210 open issues, unclear whether raw `FPDF_*` calls are reachable from its document handles |
| **C** | **PDFium only (`@embedpdf/pdfium` raw bindings) in a worker; own React UI** | One engine, one document, one coordinate space; edits mutate the live document and re-render that page (true WYSIWYG); `FPDFText_GetTextObject` gives object identity straight from a click; PDFium is Chrome's renderer; permissive licence | Viewer primitives are built by hand: render loop, text layer from glyph boxes, thumbnails, selection. Interactive forms need the FORM environment later |

**Decision: C.** The one feature nobody else has (editing existing text locally) requires PDFium's object model regardless. Once one engine owns the document, everything else is simpler. **Escape hatch:** if viewer chrome consumes too much time, adopt EmbedPDF v2 headless plugins for the shell. Same engine underneath, so the editing core in `src/engine/` is portable. EmbedPDF's source is also the reference for how to call PDFium from JS correctly.

### System shape

```
┌──────────────────────── Main thread (React) ────────────────────────┐
│  Editor store (zustand): tool, selection, zoom, pages, overlay       │
│  objects, history stack                                              │
│                                                                      │
│  PageView ×N (virtualised)                                           │
│   ├─ <canvas>  bitmap from worker (ImageData, transferred)           │
│   ├─ text layer  glyph boxes → transparent spans (select/copy/hit)   │
│   ├─ overlay     floating objects: new text, images, signatures,     │
│   │              cover rects; drag/resize handles                    │
│   └─ selection   hover/selection outlines for page objects           │
│                                                                      │
│  Panels: thumbnails · signatures found · properties                  │
│  I/O: open (drop/picker/recent) · save/save-as · print · autosave    │
└───────────────┬──────────────── Comlink RPC ─────────────────────────┘
                │  Uint8Array transfers, per-page commands
┌───────────────▼───────────── Web Worker ─────────────────────────────┐
│  PDFium WASM (@embedpdf/pdfium, single-threaded)                     │
│   render(page, scale)         → BGRA bitmap → ImageData              │
│   textPage(page)              → glyphs, runs, char→object map        │
│   objects(page)               → typed list: text/image/path/annot    │
│   replaceLineText(...)        → SetText | remove+recreate            │
│   removeObjects / removeAnnot → RemoveObject + GenerateContent       │
│   insertImage / insertText / insertRect (flatten overlay on apply)   │
│   pageOps: rotate/delete/reorder/insert/import                       │
│   save()                      → FPDF_SaveAsCopy → Uint8Array         │
│  Snapshot ring buffer (undo)  · fontkit coverage checks              │
│  OPFS autosave via sync access handle                                │
└──────────────────────────────────────────────────────────────────────┘
```

### Proposed layout

```
pdf-editor/
  app/                         Next.js App Router, output: 'export'
    layout.tsx  page.tsx       page.tsx dynamic-imports the editor with ssr:false
  src/
    engine/                    everything that touches PDFium; runs in the worker
      worker.ts                Comlink-exposed API surface (the only import the UI sees)
      pdfium.ts                thin typed wrapper over FPDF_* calls, handle lifetimes
      render.ts                bitmap rendering, DPR, tile budget
      text.ts                  text page, glyphs, runs, line clustering, hit-test
      text-edit.ts             replaceLineText: coverage check → path A / path B → fit → badges
      objects.ts               enumerate page objects, signature heuristics, remove
      annotations.ts           list/remove annots, Sig field + AcroForm cleanup, digital-sig detection
      pages.ts                 rotate/delete/reorder/insert/merge/split
      fonts.ts                 fallback ladder, lazy TTF loading, fontkit coverage
      snapshots.ts             undo ring buffer, OPFS mirror
    editor/                    React UI; never imports pdfium directly
      store/                   zustand store, command types, history
      canvas/                  PageView, layers, virtualiser, coordinate helpers
      tools/                   select · edit-text · cover · add-text · add-image · signature
      panels/                  Thumbnails · Signatures · Properties
      dialogs/                 SignatureModal (draw/type/upload) · warnings
      shell/                   Toolbar, zoom controls, page nav, status bar
    io/                        open/save (browser-fs-access), recent files (IndexedDB), print
  public/
    pdfium/pdfium.wasm         fetched at runtime; never bundled
    fonts/                     Liberation ×12, Noto Sans ×2, 2–3 script fonts; lazy
  fixtures/                    test corpus (see "Test corpus")
  tests/
    engine/                    vitest, runs PDFium WASM in Node: golden + render-diff tests
    e2e/                       Playwright: flows + visual regression
  docs/
    research/                  the five deep dives
```

### Document model, commands and undo

Two kinds of command, one history stack:

1. **Overlay commands** — add/move/resize/delete a floating object (new text, image, signature, cover rect). Pure state in the store. Undo restores previous state. Nothing touches the engine until Apply.
2. **Engine commands** — replace existing text, delete a page object or annotation, page ops, Apply (flatten all overlay objects). The worker takes a snapshot first, mutates, calls `GenerateContent` on the touched page only, re-renders that page, returns the bitmap and any badges. Undo reloads the snapshot and re-renders affected pages.

Apply happens automatically on Save and Print, and explicitly via an "Apply" button. Until then the overlay objects are drawn by the DOM at the exact PDF-space position they will be flattened to, so the preview is faithful.

Snapshot budget: 30 entries or 300 MB. Beyond that, oldest snapshots drop and the undo depth shrinks. Snapshots also feed autosave: the newest one is mirrored to OPFS on a debounce, and on next launch the app offers to recover.

### Coordinates

Stored geometry is always PDF user space (points, y-up, origin bottom-left of the `/MediaBox`). Conversion to and from CSS pixels goes through PDFium's `FPDF_PageToDevice` / `FPDF_DeviceToPage` with the current render rect and rotation, never hand-rolled matrices. Rectangles are normalised (`min/max`) after conversion because rotated pages can flip corner order. The first spike includes a `CropBox ≠ MediaBox` fixture and a `/Rotate 90` fixture because that is where every PDF editor gets it wrong the first time.

---

## Feature designs

### F1 — Open, view, navigate

Open via drag-and-drop, file picker (`browser-fs-access`, which keeps a writable handle on Chromium), or the recent-files list (IndexedDB, storing handles). Pages are virtualised with `@tanstack/react-virtual` because page heights vary. Each visible page requests a bitmap at `scale × devicePixelRatio`; zoom re-requests. Thumbnails are the same render at small scale, cached. Text layer: glyph boxes from the worker become transparent absolutely positioned spans so native selection and copy work.

### F2 — Edit existing text (the core)

**Interaction.** Text tool active → single click on existing text → the run's line becomes an inline editor: an input positioned at the line's PDF-space bounds, styled with the nearest CSS font (serif/sans/mono from the font flags, weight, italic), scaled by zoom, coloured like the original. An opaque cover in the sampled background colour hides the original line while typing. A floating mini-toolbar shows font name, size, colour and any badges. Clicking empty canvas with the Text tool creates a *new* floating text box instead (F6).

**Hit-test and line model.** Worker: `FPDFText_GetCharIndexAtPos` → `FPDFText_GetTextObject` → the text object that drew that glyph, its bounds, matrix, font (family, flags, weight, italic angle, embedded?), size, fill colour. Text objects whose baselines agree within 0.3 × size and whose x-extents are contiguous are clustered into one **line**. Word and InDesign output often splits a single visual line into many text objects because of kerning; the line is the unit the user edits.

**Commit algorithm** (`replaceLineText`):

1. Snapshot.
2. Coverage check: for each font in the line, get the embedded program (`FPDFFont_GetFontData`) and test every new code point with fontkit `hasGlyphForCodePoint`. Type 3 fonts and bare CFF programs that fontkit cannot parse fail the check.
3. **Path A — original font covers the text.** Set the full new string on the first text object with `FPDFText_SetText`, remove the other objects of the line. Per-glyph kerning from the original `TJ` arrays is lost; the font, size, colour and baseline are preserved. Accepted trade-off, to be validated in spike S2.
4. **Path B — glyphs missing or font unusable.** Remove all objects of the line. Pick a fallback from the bundled set by flags (Liberation Sans/Serif/Mono are metric-compatible with Arial/Times/Courier New; Noto Sans for wider Unicode), load it once via `FPDFText_LoadFont` (TrueType, CID), create a text object with the original size, colour and baseline matrix, insert. Badge: "Font substituted: Liberation Sans".
5. Fit: measure the new advance width with fontkit. If wider than the original line box, first squeeze horizontally via the object matrix down to 0.9, then shrink size down to 0.85 of the original. Beyond that, keep the text and show an "Overflows" badge. Never re-flow.
6. `FPDFPage_GenerateContent` on this page only. Reload the text page. Re-render. Return bitmap + badges.

**Fallbacks and honesty.** Pages with no text objects and one page-sized image are flagged as scans on open; the Text tool shows a banner instead of an editor. Documents with digital signatures show the invalidation warning once per session before the first engine command.

### F3 — Remove a signature (tiered)

A single "Select object" tool serves signatures and everything else: hovering highlights the page object or annotation under the cursor with its bounds; click selects; Delete removes. A "Signatures" panel additionally lists detected candidates with thumbnails and a one-click remove, so the user does not have to hunt.

| Tier | What it is | Detection | Removal | Honesty |
|---|---|---|---|---|
| 1 | Stamp / Ink / FreeText annotation, or a Widget of a `/Sig` field | `FPDFPage_GetAnnot*` subtype; form-field type = signature; `FPDF_GetSignatureCount` for cryptographic ones | `FPDFPage_RemoveAnnot`; for `/Sig` also remove the field from `/AcroForm /Fields` and clear `/Perms /DocMDP` | Clean removal. Warn that any digital signature becomes invalid |
| 2 | Image (or vector path cluster) drawn into the page content | Enumerate page objects; score images by aspect 2:1–6:1, width 60–300 pt, alpha/soft mask present, bottom third of page, proximity to "Sign"/"Date"/underscore text | `FPDFPage_RemoveObject` + `FPDFPageObj_Destroy` for each object, then `GenerateContent` | Clean removal; the object is gone from the file |
| 3 | Pixels inside a scanned page image | Page is a scan | Offer **Cover** (opaque rect) and say plainly the pixels remain underneath; true pixel redaction via PDFium's `EPDF*` redaction calls if spike S9 confirms they are reachable | Never call it "removed" |

### F4 — Add a signature

Modal with three tabs, matching every competitor: **Draw** (`signature_pad`, pointer events, canvas scaled by DPR), **Type** (2–3 bundled OFL script fonts), **Upload** (PNG/JPG; near-white pixels made transparent with a soft ramp). Output is a transparent PNG. Saved signatures live in IndexedDB. The signature is placed as a floating overlay object with proportional corner handles; on Apply it becomes an image object (`FPDFPageObj_NewImageObj` + `FPDFImageObj_SetBitmap` with alpha, matrix = position and size). Spike S5 confirms alpha survives the save in Chrome, Acrobat and Firefox.

### F5 — Cover and Redact

**Cover**: a filled rectangle path object (white by default, or a sampled background colour) placed as a floating object and flattened on Apply. Tooltip: "Hides content visually. The content is still in the file." **Redact** (later phase): removes text glyphs and image pixels inside the rectangle for real. Different icon, different name, confirmation dialog.

### F6 — Add text and images

New text boxes use bundled fonts (Liberation Sans default), with size and colour controls, as floating objects; flattened via `FPDFText_LoadFont` + `FPDFPageObj_CreateTextObj`. Images are placed like signatures.

### F7 — Print

Primary: Apply → `FPDF_SaveAsCopy` → Blob → hidden iframe (`position:fixed; right:100%`, not `display:none`, for Safari) → on load, `contentWindow.print()`. Revoke the object URL only after a minute, because Firefox re-fetches blob URLs while building the print preview. Fallback (feature-detect + timeout): render every page at 150 DPI in the worker, append `<img>`s to a print container with a constructed `@page { size: Wpt Hpt; margin: 0 }` stylesheet, call `window.print()` from a `setTimeout(…, 0)`. This is exactly pdf.js's own print-service design.

### F8 — Download, save, autosave

`browser-fs-access` gives Save (in place, Chromium, using the retained handle), Save As, and a plain download fallback elsewhere. Ctrl+S maps to Save. Autosave mirrors the latest snapshot to OPFS every few commits via a worker sync access handle; on launch, unsaved drafts are offered for recovery. Recent files are IndexedDB entries holding `FileSystemFileHandle`s where available.

### F9 — Page operations

Rotate (`FPDFPage_SetRotation`), delete (`FPDFPage_Delete`), reorder by drag in the thumbnail rail (rebuild via `FPDF_ImportPagesByIndex` into a new document, or `FPDF_MovePages` if the build exports it), insert blank (`FPDFPage_New`), merge another file (`FPDF_ImportPages`), split (export index subsets).

---

## Fonts bundle

| Family | Faces | Purpose | Licence | Approx. size |
|---|---|---|---|---|
| Liberation Sans / Serif / Mono | Regular, Bold, Italic, BoldItalic ×3 | Metric-compatible with Arial, Times New Roman, Courier New — the default fallbacks | SIL OFL 1.1 | ~110–140 KB each, lazy |
| Noto Sans | Regular, Bold | Wide Latin/Greek/Cyrillic coverage when Liberation lacks a glyph | SIL OFL 1.1 | ~300 KB each, lazy |
| Dancing Script, Great Vibes (+1) | Regular | Typed signatures | SIL OFL 1.1 | ~100 KB each, lazy |

Carlito (Calibri-compatible) and Caladea (Cambria-compatible) are attractive because so many Word documents use Calibri, but their licence is reported inconsistently (OFL vs Apache-2.0). Add them only after reading the LICENSE file shipped with the actual TTFs. All fonts are served from `/public/fonts` and loaded on first use, never in the initial bundle.

---

## Test corpus and verification

The engine is only as good as the PDFs it has been tried on. Assemble `fixtures/` before Phase 1 ends:

- Generators: Word, Google Docs, LibreOffice, LaTeX (pdfTeX and XeLaTeX), InDesign export, Chrome print-to-PDF, macOS Quartz, a scanner.
- Structure: single-page and 100-page; `/Contents` as an array; text inside Form XObjects; `/Rotate 90` and `270`; `CropBox ≠ MediaBox`; encrypted with owner password only.
- Fonts: WinAnsi simple fonts, Identity-H CID fonts (CJK), subset TrueType, bare CFF (`FontFile3`), Type 3 (old dvips), unembedded standard-14.
- Signatures: DocuSign sample, Adobe Sign sample, Acrobat Fill & Sign (Stamp), Ink annotation, flattened PNG signature, scanned signed page, certified document (DocMDP).
- Forms: AcroForm with text fields, checkboxes, a `/Sig` field.

Verification layers:

1. **Engine golden tests** (vitest, Node, PDFium WASM): after `replaceLineText`, extracted text equals expected; render-diff between before and after is zero **outside** the edited bounds ("nothing else changed" invariant); removed objects are absent from enumeration after save+reopen.
2. **Cross-viewer checks** (manual, per phase): open saved outputs in Chrome, Firefox, Acrobat Reader, Edge. Fonts render, alpha preserved, no "damaged file" repair prompts.
3. **Playwright e2e**: open → edit → save → reopen flows; visual regression screenshots of the shell.
4. **Privacy check in CI**: Playwright asserts no network request after initial asset load while a document is open.

---

## Risks and Phase 0 spikes

Each spike is a throwaway script or page with a pass/fail criterion. Do them in a scratch project before scaffolding the real one.

| # | Spike | Pass criterion | Risk retired |
|---|---|---|---|
| S1 | `@embedpdf/pdfium` inside a Next 16 worker, WASM fetched from `/public`, `output:'export'` | `next build` succeeds; served from a static folder; opens, renders, saves a PDF | Toolchain / bundler |
| S2 | `FPDFText_SetText` on ≥10 real documents (one word changed per doc) | ≥8/10 visually acceptable in Chrome + Acrobat; failure classes documented | Core feature fidelity |
| S3 | `RemoveObject` + `GenerateContent` round-trip | Object gone after save + reopen in three viewers; render-diff zero outside its bbox | The old PDFium "removed objects reappear" bug |
| S4 | Fallback font: `FPDFText_LoadFont` with Liberation Sans → new text object → save | Text renders in three viewers and is extractable (ToUnicode present) | Path B |
| S5 | Image with alpha via `FPDFImageObj_SetBitmap` | Transparency preserved after save in three viewers | Signature placement |
| S6 | Print via hidden iframe on Chrome, Edge, Firefox; canvas fallback | All pages print at correct size; no blank preview | Print |
| S7 | `FPDF_DeviceToPage` on `/Rotate 90` and `CropBox ≠ MediaBox` fixtures | A rectangle drawn on screen lands where clicked after save | Coordinates |
| S8 | 100-page 30 MB document | Open < 3 s, page render < 200 ms at fit-width, `SaveAsCopy` snapshot < 500 ms, memory stable over 30 edits | Performance budgets |
| S9 | Are the `EPDF*` redaction functions callable from the raw `@embedpdf/pdfium` module? | Yes/no; if yes, `EPDFText_RedactInRect` removes glyphs | True redaction path |
| S10 | DocuSign sample: `FPDF_GetSignatureCount`, remove the `/Sig` widget and field | Signature detected; after removal the file opens clean and Acrobat shows no signature panel | Tier-1 removal |

Other risks without a spike: **line clustering quality** on real layouts (mitigate: start with single-object lines, widen), **kerning loss in Path A** (mitigate: S2 measures it; Path B with the same font's full TTF if the system has it is a later option), **EmbedPDF wrapper churn** (mitigate: `src/engine/pdfium.ts` is the only file that imports it).

---

## Roadmap

| Phase | Goal | Exit criterion |
|---|---|---|
| 0 — Spikes | Retire the ten risks above | S1–S7 pass; S8 budgets written down |
| 1 — Shell | Open, view, navigate, download, print, undo infrastructure, fixtures | A PDF round-trips through open → save with zero network requests |
| 2 — Objects and signatures | Select/delete objects, signature detection, cover, add signature/text/image | A DocuSign-signed sample has its signature removed and a new one placed, and prints from Acrobat |
| 3 — Edit existing text | Hit-test, inline editor, Path A/B commit, badges, scan detection | A Word-generated invoice has a line edited in its own font and saves in place |
| 4 — Pages and persistence | Rotate/delete/reorder/insert/merge/split, OPFS autosave, PWA | Installed as a PWA, survives a tab crash with the draft intact |
| 5 — Hardening | Performance, cross-browser, accessibility, optional Tauri shell | Budgets green on the 100-page fixture in Chrome, Edge, Firefox |
| Later | Forms, annotations, true redaction UI, OCR, signature verification display, CJK fonts | — |

The task-level breakdown with priority and size is in `TASKS.md`.

---

## Stack and versions (verified 2026-09-07)

| Piece | Choice | Version | Licence |
|---|---|---|---|
| Framework | Next.js App Router, `output: 'export'` | 16.3.x | MIT |
| UI | React, TypeScript, Tailwind | 19.2.x / 5.x / 4.x | MIT |
| Package manager | pnpm | 10.29 | MIT |
| PDF engine | `@embedpdf/pdfium` (PDFium WASM) | 2.15.0 | MIT wrapper, BSD-3 core |
| Worker RPC | `comlink` | 4.4.2 | Apache-2.0 |
| Font parsing | `fontkit` | 2.0.4 | MIT |
| Virtualisation | `@tanstack/react-virtual` | 3.14.10 | MIT |
| File access | `browser-fs-access` | current | Apache-2.0 |
| Signature drawing | `signature_pad` | current | MIT |
| State | `zustand` | current | MIT |
| Small KV | `idb-keyval` | current | Apache-2.0 |
| Tests | vitest, Playwright | current | MIT / Apache-2.0 |
| Fonts | Liberation, Noto Sans, Dancing Script, Great Vibes | — | SIL OFL 1.1 |
| Desktop (later) | Tauri v2 | 2.11.x | MIT/Apache-2.0 |

Runtime on this machine: Node 26.3, pnpm 10.29, git 2.36.

---

## Open questions

These change the plan materially, so they are yours to answer before Phase 1:

1. **Name.** The folder is `pdf-editor`. Pick a product name before scaffolding so the repo, PWA manifest and window title agree.
2. **Personal tool or distributable product?** Personal: skip onboarding polish, ship Chromium-first. Product: the Firefox/Safari fallbacks, the PWA and eventually Tauri matter, and the licence discipline above is essential.
3. **Browser targets.** Is "save-in-place works in Chrome and Edge, everyone else downloads a copy" acceptable for v1? The plan assumes yes.
4. **Language coverage.** Latin only (English, Filipino) keeps the font bundle small. CJK or Arabic editing means Noto CJK / Noto Arabic (several MB each) and RTL handling.
5. **Forms in MVP?** Filling existing AcroForm fields is a moderate add via PDFium's FORM environment. The plan defers it.
6. **Build shell from scratch (Option C) or start from EmbedPDF headless (Option B)?** The plan recommends C with B as the escape hatch. If speed-to-demo matters more than owning the viewer, flip it.
