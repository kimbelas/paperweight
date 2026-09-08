## Project: Paperweight (pdf-editor)

A local-first PDF editor. Edit the text already in a document, remove and add
signatures, print and save. Next.js 16 App Router (static export), React 19,
TypeScript, Tailwind 4, pnpm. PDFium via WebAssembly in a Web Worker.

Read `PLAN.md` for the reasoning and `docs/research/` for the evidence behind
the decisions. `docs/research/01-editing-engines.md` and
`05-pdf-internals-and-fonts.md` are the load-bearing ones.

### Hard rules

- **Only `src/engine/` may import `@embedpdf/pdfium`.** The UI talks to the
  engine through the Comlink surface in `src/engine/worker.ts` and nothing
  else. A PDFium handle reaching a React component means handle lifetimes get
  tangled with render cycles, and the failures there are memory corruption
  rather than exceptions.

- **Never return a WASM pointer out of `withScope`.** Every allocation is
  freed the moment the callback returns, and the allocator writes its free-list
  bookkeeping into the first bytes of the released block. This is not a
  theoretical risk: an early version built an `FS_MATRIX` in one scope and
  passed the pointer to `FPDFPageObj_SetMatrix` afterwards. The `a` and `b`
  components came back as denormalised noise, every glyph collapsed onto one
  point, and PDFium's text extraction then deduplicated them — which surfaced
  as replacement text silently losing its repeated letters. Allocate and
  consume in the same scope; `setObjectMatrix` in `memory.ts` is the pattern.

- **A page is regenerated only if it was edited.** `FPDFPage_GenerateContent`
  rewrites a page's whole content stream from PDFium's object model, so
  anything PDFium does not fully model round-trips imperfectly. Mutations call
  `doc.markDirty(page)` and a single `doc.flushDirty()` acts on the set. Never
  call `GenerateContent` on a page the user did not touch. The
  "nothing else changes" tests in `tests/engine/text-edit.test.ts` exist to
  catch a regression here.

- **Reload the text page after any text-object mutation.** Removing a text
  object invalidates every `FPDF_TEXTPAGE` for that page. `withTextPage` opens
  and closes one per call for exactly this reason; do not hoist it or cache
  the handle.

- **Remove objects by handle, and destroy what you remove.** Removal
  renumbers every later index, so resolve all handles before mutating.
  `FPDFPage_RemoveObject` transfers ownership, so skipping
  `FPDFPageObj_Destroy` leaks on every edit.

- **A filled form only renders through the form-fill environment.** PDFium
  draws page content and annotation appearance streams from
  `FPDF_RenderPageBitmap`, and a form field's value is neither: it lives in
  the field dictionary as `/V`, and a field filled programmatically often has
  no `/AP` stream to draw at all. So a completed form rendered that way comes
  out looking like a blank form — while printing it through the browser's own
  PDF viewer shows every value, because that viewer does run the second pass.
  This was reported on a filled visa application: blank on screen, complete on
  paper, which is the worst shape of failure here because the user cannot tell
  which one is the real document. `PdfDocument` therefore stands up an
  `FPDFDOC_InitFormFillEnvironment` for any document whose `FPDF_GetFormType`
  is not `None`, announces every page to it with `FORM_OnAfterLoadPage`,
  withdraws them with `FORM_OnBeforeClosePage`, and `renderPage` follows
  `FPDF_RenderPageBitmap` with `FPDF_FFLDraw` over the same bitmap. The field
  highlight alpha is set to 0: PDFium tints fields blue by default, and a tint
  that exists on screen but not in the saved file is precisely the divergence
  this app is meant not to have. Field values are drawn even when
  `annotations` is off, because that switch is about not double-drawing the
  app's own pending overlays, and a field value is not an overlay.

- **A form field is not a line of text, and is edited through `FORM_*`.**
  `FPDFText_LoadPage` cannot see field values, so `getTextLines` and
  `hitTestLine` cannot either, however plainly the value is drawn. Field
  editing therefore has its own path in `src/engine/forms.ts` and its own
  `EditTarget` kind in `PageView`, rather than a widened hit-test tolerance.

  Never set a value by writing `/V` directly: the appearance stream would go
  on showing the old text, so the file would say one thing and render
  another. Drive the field as a click, a select-all and a replacement
  (`FORM_OnLButtonDown` → `FORM_SelectAllText` → `FORM_ReplaceSelection`), and
  let `FORM_ForceToKillFocus` commit it — PDFium then regenerates the
  appearance itself. Ticking a box goes through the same synthetic click,
  because PDFium owns radio-group semantics and reimplementing them from `/V`
  and `/AS` is how a form ends up with two options selected at once.

  **Form fields are hit-tested before page text.** A widget hit is exact —
  inside the rectangle or not — while `hitTestLine` falls back to the nearest
  line in the same horizontal band. On a form those disagree in a way that
  matters: a label like "Surname (as shown in passport)" shares a baseline
  with the box holding the answer, so asking the text layer first offers to
  edit the caption instead of the field.

  A form edit repaints its page but must never mark it dirty. The value is in
  the form, not the content stream, so there is nothing to regenerate, and
  calling `GenerateContent` would rewrite a page the user never edited.
  `commit` and `commitSync` take a `repaint` list for exactly this case.

- **A field clips to its own rectangle, so its width is part of the
  document.** A value wider than the box is cut off in the file — on screen
  and on paper alike, and silently, since the stored `/V` is complete while
  the appearance is truncated. That is why the field editor can be resized by
  its right edge and offers "Widen to fit", and why `measureFieldFit` warns
  when a committed value will not fit. Width is clamped so a field can never
  be widened off the page.

  Two traps in `setFormFieldWidth`. The appearance must be rebuilt after
  `FPDFAnnot_SetRect`, or the stream stays laid out to the old box and the
  text is still clipped exactly where it was — which reads as the resize
  having done nothing. And the page must be reloaded between the two, because
  the form-fill environment caches a widget's geometry for as long as the page
  is open: without that, the synthetic click aimed at the middle of the
  widened box lands outside the widget PDFium still thinks is there, and focus
  fails outright. `doc.invalidatePage` is what re-pairs it.

  An auto-sized field (`0 Tf` in its `/DA`) never clips — PDFium shrinks the
  type instead — so `measureFieldFit` reports `autoSized` and says nothing
  about cut-off text. Telling the two apart matters before warning anyone.

- **Editing a field must never change its type size, and "auto" is never an
  acceptable answer.** A `/DA` of `0 Tf` means "size the type to the box", and
  PDFium takes it literally: on a 24pt-tall widget it picks **18pt**, where the
  rest of the form sits at 9pt. Worse, the oversized value no longer fits its
  own rectangle, and a field clips to its rectangle — so the value comes back
  both huge *and* truncated. Width is the user's to change; size is not.

  `resolveTextSize` answers in four steps and never returns "auto": an
  explicit `/DA` size is the document's own decision and is left alone; else
  the size the file's own appearance draws at; else **the median of the sizes
  the other fields on the page use**, because the neighbours look right so
  match the neighbours; else a size derived from the box, erring small.

  The third step is the one that matters and its absence was the first fix's
  bug: it read the field's own appearance, found nothing to preserve on a
  field the filler left without an `/AP`, and silently gave up — leaving the
  reported symptom exactly as it was. `autosize-field.pdf` covers the
  has-an-appearance case, `autosize-no-appearance.pdf` the harder one.

- **When PDFium's appearance cannot be trusted, draw the value yourself.**
  `appearanceIsTrustworthy` is the gate: the document has to declare a size in
  `/DA`, and the field must be neither comb nor multiline. Only then does
  PDFium's rebuilt appearance match what the file drew, and only then is the
  value edited as a form field.

  Otherwise `convertFieldToText` draws it as page text and removes the widget.
  Three things follow that no amount of `/DA` steering achieves: it draws at
  exactly the size asked for; it is **not clipped**, so a long value prints in
  full instead of being truncated to its box; and it becomes editable through
  the ordinary text path with that path's fitting and font reporting. The cost
  is real and is disclosed in the interface rather than buried — the field
  stops being an interactive form field, so software that reads form values
  will not find it. For a form being filled in and printed that is the better
  trade; for one being sent back for further filling it is not.

  **Reload the page after removing the widget.** Taking the annotation out of
  the dictionary does not take the widget out of the form-fill environment: it
  keeps its own view of the page and `FPDF_FFLDraw` goes on painting the old
  value from it, superimposed on the new text. Reload before adding anything,
  since reloading discards page objects not yet written into the content
  stream. This was invisible to the engine tests, which checked the object
  model, and was caught only by an e2e test that looked at pixels — which is
  the argument for keeping both.

- **Record appearance sizes before the form environment exists.**
  `snapshotAppearanceSizes` runs in `PdfDocument.open` *before*
  `FPDFDOC_InitFormFillEnvironment`, because PDFium generates an appearance
  for every field lacking one the moment that environment is created — at the
  auto size. After that instant there is no way to tell a stream the file
  supplied from one PDFium invented, so "the size this field is really drawn
  at" becomes unanswerable and preserving it would preserve the bug. The
  snapshot is keyed by annotation index, since a field's name can live on a
  parent rather than the widget; undo reopens the document and re-runs it, so
  it cannot go stale.

- **`scripts/inspect-form.mjs` reports a form's structure and no values.** For
  diagnosing a real document without handling somebody's passport number: it
  prints each field's box, `/Ff` (including COMB), `/MaxLen`, `/DA` and the
  `Tf` its appearance uses, and replaces machine-generated names with an
  index.

- **A field's `/T` is an identifier, not a caption.** Forms filled online
  carry names like `dhFormfield-6597933572` or
  `topmostSubform[0].Page1[0].f1_07[0]`, and putting one in front of the user
  says nothing and reads like a bug. Everything user-facing goes through
  `formFieldLabel`/`formFieldPhrase` in `form-label.ts`, which keeps a real
  name and substitutes the kind of field for a generated one. That module
  deliberately holds no PDFium or fontkit imports, because the interface needs
  it and `forms.ts` would drag the engine into the page bundle.

- **Geometry is stored in PDF user space, never in pixels.** Points, y-up,
  origin at the bottom-left of the crop box. Screen conversion goes through
  `src/editor/transform.ts`, which measures PDFium's own mapping with three
  probe points and inverts it. Do not hand-roll the rotation or crop-box
  arithmetic: `/Rotate` and a crop box offset from the media box are exactly
  where this goes wrong, and the fixtures `rotated-90.pdf` and
  `cropbox-offset.pdf` are there to prove it does not.

- **Cover is not redaction, and the UI must never blur that.** `insertRect`
  draws an opaque rectangle; the content underneath stays in the file and
  stays extractable. The word "redact" is reserved for actual content removal.
  A test asserts the covered text is still there, so nobody can quietly
  reinterpret the feature.

- **A declared font size is not a rendered font size.** `FPDFTextObj_GetFontSize`
  returns the size the object declares, and the object's matrix may carry a
  scale on top of it. Documents built as a form XObject routinely declare a
  size of 1 with a matrix scale of 12. Use `effectiveFontSize` for anything a
  user sees or that reasons in page points; using the raw value drew the
  inline editor's text at one pixel on every such document.

- **Font substitution is always reported.** An embedded font is a subset, so
  it usually cannot render new characters. `checkCoverage` decides, and when it
  says no, a bundled metric-compatible face is used and a `font-substituted`
  badge is raised. Silent substitution is the thing that makes other editors
  mangle documents while appearing to work.

- **No AGPL dependencies.** MuPDF is the better redaction engine and is
  AGPL-3.0-or-later or a quoted commercial licence. PDFium is BSD-3, its
  wrapper is MIT, the fonts are SIL OFL 1.1. Keep it that way; the licence
  files ship in `public/fonts/`.

- **The worker URL carries a build stamp, and it is not optional.** A worker
  is fetched by plain URL and browsers cache one hard, so without a changing
  URL a rebuilt engine is silently ignored: the tab goes on running the
  previous worker while every test passes against the new one. The source is
  right, the artefact is right, and the app behaves as though neither had
  changed — indistinguishable from a fix that does not work. It cost three
  rounds of chasing the wrong cause on a real bug report before anyone
  suspected the cache. `build-worker.mjs` writes `src/engine/worker-build.json`
  and `useEngine` appends `?v=<stamp>`, so a rebuild always invalidates it. The
  same stamp is logged once as `Paperweight engine build <n>`, which is how
  you tell from the console which engine is actually running when behaviour
  and source appear to disagree. `tests/e2e/engine-build.spec.ts` guards both.

- **The worker is built by `scripts/build-worker.mjs`, not by the page
  bundler.** `new Worker(new URL('./worker.ts', import.meta.url))` was tried
  first: Turbopack treated it as a static asset and copied the TypeScript
  source into the output verbatim, which a browser cannot execute and which
  fails silently at build time. esbuild produces a real self-contained module
  in `public/`, loaded by plain URL, which behaves identically under a static
  export and on any host. `predev` and `prebuild` run it.

- **Single-threaded WASM only.** A static export sets no response headers of
  its own. On Cloudflare `out/_headers` adds some, but the app must never
  *depend* on a header to function, so COOP/COEP stay out and
  `SharedArrayBuffer` with them. Keeping the engine single-threaded is what
  keeps the deploy story to "copy `out/` anywhere".

- **Nothing leaves the device.** There is no server, no upload path, no
  analytics. Playwright tests assert zero cross-origin requests and zero
  request bodies, both while a document is open and while OCR runs. Do not add
  a dependency that phones home.

  tesseract.js is the live example of why this needs guarding: by default it
  fetches its worker, its WASM core *and* its language model from jsdelivr.
  All three are copied into `public/tesseract/` by `scripts/sync-ocr.mjs` and
  the paths are pinned in `src/ocr/recognise.ts`. If OCR ever starts making
  network requests, that is the wiring to check.

- **The Content-Security-Policy is generated, and it is strict.**
  `scripts/write-headers.mjs` runs as `postbuild` and writes `out/_headers`
  for Cloudflare: every origin is `'self'`, inline scripts are allowed by
  the hash of exactly what this build emitted, and there is no
  `'unsafe-inline'` or `'unsafe-eval'` for scripts. The policy is the
  "nothing leaves the device" promise stated as a header, and it is also why
  a document opened here cannot be exfiltrated by an injected script. Anything
  new the app loads — a font, a frame, a worker, a fetch, an inline script —
  has to be reflected in that script, and the test that tells you so is
  `pnpm test:e2e:deploy`, which runs the whole browser suite under the real
  headers through `wrangler dev`. Fix the app or the directive; never widen
  the policy to make a test pass. The OCR model download in `sync-ocr.mjs`
  is pinned by SHA-256 for the same reason: a build must not trust a third
  party's branch to still contain what it did.

- **Editing a scan is a different operation, and the UI must keep it
  distinct.** A scan has no text objects; its words are pixels. OCR recovers
  where they are and what they probably say, and `patchRegion` paints over the
  region and draws replacement text. It is not editing and it is not
  redaction: the original pixels stay in the image, the result never matches
  the surrounding type, and the recognised text is a guess with a confidence
  score. All three are stated in the interface, not just in comments.

### Layout

```
src/engine/    PDFium. Runs in the worker. types.ts is the wire format.
src/editor/    React. transform.ts owns coordinate conversion.
src/ocr/       tesseract.js, for reading scans. Never touches PDFium.
src/io/        Files, printing and local storage, with browser fallbacks.
scripts/       sync-wasm, sync-ocr, build-worker, write-headers,
               make-fixtures, make-scan-fixture.
fixtures/      Hand-built PDFs pinning the structural edge cases.
               fixtures/local/ is gitignored: real documents go there.
tests/engine/  vitest, driving the real WASM under Node.
tests/e2e/     Playwright, against the built static export.
tests/deploy/  Playwright, only under wrangler dev: the response headers.
wrangler.jsonc The Cloudflare deployment. .github/workflows/ci.yml runs it.
```

### Working on this

- `pnpm dev` (runs `sync-wasm`, `sync-ocr` and `build-worker` first)
- `pnpm test` engine tests · `pnpm test:e2e` browser tests ·
  `pnpm test:e2e:deploy` the same under wrangler dev with the real headers
- `pnpm typecheck` · `pnpm build`
- After changing anything in `src/engine/`, run `pnpm build:worker` or the
  browser will keep running the previous engine.

### Fixture note

`scanned-page.pdf` is grey bars standing in for print. It is right for testing
that a scan is *detected*, and useless for testing OCR, because there are no
glyph shapes in it and a recogniser correctly finds nothing — which looks
exactly like a broken recogniser. Use `scanned-text.pdf`, generated by
`scripts/make-scan-fixture.mjs`, which renders a real document to a bitmap.

### Known limitations, deliberately

- Text edits are line-scoped and never reflow. PDF has no paragraph model; a
  longer replacement is condensed, then shrunk, then flagged as overflowing.
- Text inside a form XObject is edited by removing it and redrawing it at
  page level, not in place. In-place mutation reports success and is lost on
  save, because regenerating the page does not rewrite a form's own content
  stream and PDFium exposes no call that does. The redraw keeps the original
  font when that font is embedded and covers the text.
- Scanned pages have no text objects. They can be read with OCR and then
  changed by covering and redrawing, which the UI presents as a separate,
  clearly-labelled operation rather than as editing.
- Nested images and shapes cannot be moved, only nested text. Moving one would
  mean re-encoding its pixels; it is refused rather than half-supported.
- Editing any digitally signed document invalidates the signature. This is the
  mechanism working; the user is told once per session.
- Saving in place needs the File System Access API, so it is Chromium-only.
  Elsewhere the button says "Download" and produces a copy.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
