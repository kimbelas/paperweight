# PDF Editor — tasks

Phased checklist derived from `PLAN.md`. Each item carries _(Priority, Size)_. Sizes: Small (hours), Medium (a day or two), Large (several days).

## Phase 0 — Spikes

Done inside the real project rather than a throwaway, so the work became the
engine layer and its tests instead of being discarded.

- [x] S1 `@embedpdf/pdfium` in a Next 16 worker, WASM from `/public`, `output:'export'` builds and serves statically _(High, Small)_
- [x] S2 `FPDFText_SetText` on 10 real documents; document failure classes _(High, Medium)_
- [x] S3 `RemoveObject` + `GenerateContent` round-trip; render-diff zero outside bbox; reopen in 3 viewers _(High, Small)_
- [x] S4 Fallback font via `FPDFText_LoadFont` (Liberation Sans) → new text object → save → extractable _(High, Small)_
- [x] S5 PNG with alpha via `FPDFImageObj_SetBitmap`; transparency survives save in 3 viewers _(High, Small)_
- [x] S6 Print path implemented (iframe + tab fallback); verified in Chromium _(High, Small)_
- [ ] Verify printing by hand in Firefox and Safari _(High, Small)_
- [x] S7 `FPDF_DeviceToPage` on `/Rotate 90` and `CropBox ≠ MediaBox` fixtures _(High, Small)_
- [ ] S8 100-page 30 MB document: open, render, snapshot timings and memory; write budgets down _(Medium, Small)_
- [x] S9 Confirm whether `EPDF*` redaction calls are reachable from the raw module _(Medium, Small)_
- [x] S10 DocuSign sample: detect signature count, remove `/Sig` widget + AcroForm field, reopen clean _(High, Small)_
- [x] Write spike findings into `docs/spikes.md` and adjust PLAN.md decisions if any spike fails _(High, Small)_

## Phase 1 — Shell

- [ ] Answer the six open questions in PLAN.md (name, audience, browsers, languages, forms, shell approach) _(High, Small)_
- [x] Scaffold: Next 16 + React 19 + TS + Tailwind 4 + pnpm, `output:'export'`, ESLint, vitest, Playwright, CI build check _(High, Medium)_
- [x] `src/engine/pdfium.ts`: typed wrapper, handle lifetimes, page-touched tracking so untouched pages are never regenerated _(High, Medium)_
- [x] `src/engine/worker.ts` behind Comlink; Uint8Array transfers; open/close/render/save _(High, Medium)_
- [x] Open a file: drag-and-drop, picker, retained handle for save-in-place _(High, Small)_
- [ ] Recent-files list persisted in IndexedDB _(Low, Small)_
- [x] Page list with zoom (fit-width, fit-page), DPR-correct bitmaps, render cancellation _(High, Medium)_
- [x] Left thumbnail rail with cached small renders and current-page tracking _(Medium, Small)_
- [ ] Text layer from glyph boxes: native selection and copy _(Medium, Medium)_
- [x] Download and Save-in-place (Chromium) with `<a download>` fallback; Ctrl+S _(High, Small)_
- [x] Print: iframe primary, canvas fallback, Safari new-tab hint _(High, Medium)_
- [x] Snapshot-based undo/redo in the worker with ring-buffer cap; history stack in the store _(High, Medium)_
- [x] Digital-signature detection on open and the one-time invalidation warning _(High, Small)_
- [x] Scanned-page detection on open (page-sized image, no text objects) _(Medium, Small)_
- [x] Assemble `fixtures/` corpus per PLAN.md "Test corpus" _(High, Small)_
- [x] CI privacy check: Playwright asserts zero network requests while a document is open _(Medium, Small)_

## Phase 2 — Objects and signatures

- [x] Select-object tool: click to select a page object, outline it, delete it _(High, Medium)_
- [ ] Marquee and shift-click multi-select _(Low, Medium)_
- [ ] Resize existing text and change its font, size or colour in place _(Medium, Large)_
- [x] Delete selected objects/annotations → engine command, re-render, undoable _(High, Medium)_
- [x] `/Sig` field removal also cleans `/AcroForm /Fields` and `/Perms /DocMDP` _(High, Small)_
- [x] Signature heuristics (aspect, size, alpha, position, nearby labels) and the Signatures panel with thumbnails _(Medium, Medium)_
- [x] Cover tool: floating filled rect, background-colour sampling, tooltip that says pixels remain _(High, Small)_
- [x] Floating-object overlay: move, proportional resize, delete _(High, Medium)_
- [ ] Overlay z-order controls and arrow-key nudge _(Low, Small)_
- [ ] Change font, size and colour of *existing* text, not just added text _(Medium, Large)_
- [x] Signature modal: Draw (`signature_pad`, DPR, pointer events), Type (script fonts), Upload (soft background removal) _(High, Medium)_
- [x] Saved signatures reusable within the session _(Medium, Small)_
- [x] Image placement supported by the engine and overlay _(Medium, Small)_
- [x] Add text box tool with bundled fonts, size and colour controls _(High, Medium)_
- [x] Apply: flatten all floating objects into page objects (image, text, rect) on Save/Print/explicit Apply _(High, Medium)_
- [x] Fonts served lazily from `/public/fonts`; licence files bundled alongside _(Medium, Small)_
- [x] Engine golden tests: object removal absent after reopen; render-diff invariant _(High, Small)_

## Phase 3 — Edit existing text

- [x] Hit-test: click → char index → text object → font/size/colour/matrix/bounds _(High, Medium)_
- [x] Line clustering of text objects by baseline and x-continuity _(High, Medium)_
- [x] Inline editor overlay with matched CSS font, opaque cover of the original line, floating mini-toolbar _(High, Medium)_
- [x] Coverage check via `FPDFFont_GetFontData` + fontkit; Type 3 and unparsable CFF fail closed _(High, Medium)_
- [x] Commit Path A: `FPDFText_SetText` on first object, remove the rest, regenerate, reload text page _(High, Large)_
- [x] Commit Path B: remove line, choose fallback by flags, load font once, create text object, insert _(High, Large)_
- [x] Fit: horizontal squeeze to 0.9, then size to 0.85, then "Overflows" badge _(High, Small)_
- [x] Badges: "Font substituted", "Overflows", "Digital signature invalidated" _(Medium, Small)_
- [x] Scan banner replaces the editor on image-only pages _(Medium, Small)_
- [x] Golden tests: extracted text equals expected; nothing else changed outside the edited bounds _(High, Medium)_
- [ ] Find and replace across the document (optional) _(Low, Medium)_

## Phase 4 — Pages and persistence

- [x] Rotate, delete, insert blank via PDFium page APIs _(Medium, Small)_
- [x] Page reorder in the engine (`movePages`), covered by tests _(Medium, Small)_
- [ ] Drag-to-reorder interaction in the thumbnail rail _(Medium, Medium)_
- [x] Merge and split in the engine (`importPages`, `extractPages`), covered by tests _(Medium, Small)_
- [ ] Merge and split UI _(Medium, Medium)_
- [ ] OPFS autosave via worker sync access handle; recovery prompt on launch _(Medium, Medium)_
- [x] PWA manifest, with icons and an install name _(Medium, Small)_
- [x] Offline asset caching: a service worker built by `scripts/build-sw.mjs`,
      precaching the shell and the engine, with the fonts and the OCR model kept
      on first use. No install prompt: the browser offers its own _(Medium, Small)_

## Phase 5 — Hardening

- [ ] Performance budgets from S8 enforced in CI on the 100-page fixture _(Medium, Medium)_
- [ ] Cross-browser matrix: Chrome, Edge, Firefox, Safari; document the fallbacks users see _(Medium, Medium)_
- [ ] Keyboard and screen-reader pass on the shell _(Low, Medium)_
- [ ] Tauri v2 shell over the static export; test print via WebView2/WKWebView _(Low, Medium)_
- [x] `CLAUDE.md` with the hard rules (worker is the only PDFium importer, PDF-space geometry only, no AGPL, untouched pages never regenerated) _(Medium, Small)_

## Findable on the public internet (2026-09-09)

- [x] `src/site.ts`: one source for every public string, shared by the page, the head, the structured data and the tests _(High, Small)_
- [x] Prerendered landing page: `Landing` is both the loader fallback and the editor's empty state, so the copy is in the static HTML *and* survives into the rendered DOM _(High, Medium)_
- [x] Full document head: title, description, keywords, canonical, Open Graph, Twitter card, robots, icons, manifest, theme colour _(High, Small)_
- [x] schema.org `@graph`: WebSite, Person, SoftwareApplication, SoftwareSourceCode, FAQPage, generated from the same FAQ the page renders _(Medium, Small)_
- [x] `robots.txt`, `sitemap.xml`, `llms.txt`; AI crawlers allowed on purpose _(Medium, Small)_
- [x] Brand mark, share card and icons, committed rather than generated at build time, because an export writes a code-generated image with no extension _(Medium, Medium)_
- [x] `tests/e2e/seo.spec.ts`: asserts the page with JavaScript switched off, the served files' content types, and that the copy survives hydration _(High, Medium)_
- [x] `waitForLanding` replaces ten copies of a readiness gate that the prerendered heading would have made meaningless _(High, Small)_
- [ ] Submit the sitemap to a search console and add the verification token _(Medium, Small)_
- [ ] Choose a licence; the repository has none, so the metadata claims none _(Medium, Small)_

## Fixes from real-document testing (2026-09-08)

- [x] Edit text inside a form XObject, by removing and redrawing at page level _(High, Large)_
- [x] Compose the form-ancestor transform so nested geometry is in page space _(High, Medium)_
- [x] `effectiveFontSize`, so an editor is sized in rendered points not declared ones _(High, Small)_
- [x] Drop whitespace-only and zero-width runs from the line list _(Medium, Small)_
- [x] Drag to move text and images; whole-line selection _(High, Large)_
- [x] Nested redraw reuses the original font when it is embedded and covers the text _(Medium, Medium)_
- [ ] Move nested images and shapes, which currently report as unmovable _(Low, Large)_

## Reading scans, and an interface pass (2026-09-08)

- [x] OCR a scanned page with `tesseract.js`, entirely on device _(High, Large)_
- [x] Host the recogniser, its WASM core and language model locally, so OCR makes no network requests _(High, Medium)_
- [x] Report per-line confidence, and outline poorly-read lines in amber _(High, Small)_
- [x] Replace a recognised line by covering the region and redrawing _(High, Large)_
- [x] Sample the paper tone so a patch matches the scan instead of painting white _(High, Small)_
- [x] Prefer real text over recognised lines, so a patched line stays normally editable _(High, Medium)_
- [x] A realistic scanned fixture with genuine glyph shapes _(High, Small)_
- [x] Virtualise the page list; a 28-page file mounts 3 pages, not 28 _(High, Medium)_
- [x] Derive the current page from scroll position, since a tall page never reaches a 50% intersection ratio _(High, Small)_
- [x] Replace the placeholder text-glyph icons with drawn SVG _(Medium, Medium)_
- [x] Properties panel: size, typeface and colour for added text and covers _(High, Medium)_
- [x] Add image button, wired to the existing placement path _(Medium, Small)_
- [x] Zoom with Ctrl and the scroll wheel _(Medium, Small)_
- [x] Keyboard shortcuts, and a sheet that documents them _(Medium, Medium)_
- [x] Persist signatures and view preferences in IndexedDB _(Medium, Small)_
- [x] Tool tooltips saying what a click will actually do _(Medium, Small)_
- [ ] OCR a whole document rather than a page at a time _(Medium, Medium)_
- [ ] Languages beyond English _(Low, Medium)_
- [ ] Re-read a region after the user corrects it, to improve nearby guesses _(Low, Large)_

## Later / backlog

- [x] Render the values already in an AcroForm, via the FORM environment and
      `FPDF_FFLDraw` — a filled form no longer displays blank _(High, Medium)_
- [x] Fill existing AcroForm fields: the `FORM_*` input path, so a rendered
      field value can be clicked and changed, and a tick box toggled. Field
      hit-testing runs before page text, since a label shares a baseline with
      its answer box _(High, Large)_
- [x] Adjustable field width: drag the editor's right edge or use Widen to fit,
      with a warning when a value would be cut off in the file _(High, Medium)_
- [x] Keep an edited field's drawn size: resolve a `0 Tf` auto size from the
      file, from the rest of the form, or from the box — never from PDFium's
      auto, which blows the type up and then truncates it _(High, Medium)_
- [x] Snapshot appearance sizes before the form environment generates its own,
      which is the only moment the file's real sizes are knowable _(High, Small)_
- [x] Cache-bust the engine worker URL with a build stamp, and log which build
      is running: a cached worker made three fixes look like no fix _(High, Small)_
- [x] `scripts/inspect-form.mjs`: report a form's structure with no values, so a
      real document can be diagnosed without handling personal data _(Medium, Small)_
- [x] Never show a machine-generated field name (`dhFormfield-…`) in the UI _(Medium, Small)_
- [x] Rework untrustworthy fields: draw the value as page text and drop the
      widget when the document does not declare a size, or the field is comb or
      multiline. Exact size, no clipping, editable as ordinary text _(High, Large)_
- [ ] Offer the conversion as an explicit choice rather than doing it silently,
      for anyone who needs the file to stay an interactive form
- [ ] Comb fields (`/Ff` bit 25 with `/MaxLen`) re-space per character on
      regeneration; the flag cannot be cleared through PDFium's public API, so
      a faithful edit would mean writing the appearance stream directly
- [ ] Choose from a list field's options, which currently reports as unsupported
- [ ] Tab between form fields, and show which field has focus
- [ ] Annotations: highlight, underline, strikeout, freehand, shapes
- [ ] True redaction UI (glyph and pixel removal) if S9 passes
- [ ] Digital signature verification display (read-only)
- [ ] CJK / Arabic fallback fonts and RTL text editing
- [ ] Keep-signature-as-annotation toggle
