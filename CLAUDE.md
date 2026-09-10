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
  the appearance is truncated. That is why the field editor offers "Widen to
  fit", and why `measureFieldFit` warns when a committed value will not fit.
  Width is clamped so a field can never be widened off the page.

  **"Widen to fit" is the only way a width is set.** The right edge was
  draggable as well and was removed: there is exactly one correct width for a
  value — the one that holds it — the button computes it from the same probe
  the cut-off warning measures, and a drag is an invitation to find it by eye,
  on a box a few pixels tall, against type the editor may have floored for
  touch. Every miss leaves a document that either still clips or has one field
  visibly wider than its neighbours. A control that can only be operated
  correctly by accident is worse than no control.

  Two traps in `setFormFieldWidth`. The appearance must be rebuilt after
  `FPDFAnnot_SetRect`, or the stream stays laid out to the old box and the
  text is still clipped exactly where it was — which reads as the resize
  having done nothing. And the page must be reloaded between the two, because
  the form-fill environment caches a widget's geometry for as long as the page
  is open: without that, the synthetic click aimed at the middle of the
  widened box lands outside the widget PDFium still thinks is there, and focus
  fails outright. `doc.invalidatePage` is what re-pairs it.

  Only a field that stays a field clips, and `FormFieldInfo.clips` is that
  answer — the same condition as `appearanceIsTrustworthy`, since a value the
  engine draws into the page instead runs on in full. It gates "Widen to fit"
  and the cut-off warning together, because on a field that will be redrawn as
  page text both describe something the file does not do: the warning fires on
  a value nothing will cut, and the width the user then sets is discarded by
  the conversion.

- **Editing a field must never change its type size, and "auto" is never an
  acceptable answer.** A `/DA` of `0 Tf` means "size the type to the box", and
  PDFium takes it literally: on a 24pt-tall widget it picks **18pt**, where the
  rest of the form sits at 9pt. Worse, the oversized value no longer fits its
  own rectangle, and a field clips to its rectangle — so the value comes back
  both huge *and* truncated. Width is the user's to change; size is not.

  `drawnSize` answers in four steps and never returns "auto": an explicit
  `/DA` size is the document's own decision and is left alone; else the size
  the file's own appearance draws at; else **the median of the sizes the other
  fields on the page use**, because the neighbours look right so match the
  neighbours; else a size derived from the box, erring small.

  The third step is the one that matters and its absence was the first fix's
  bug: it read the field's own appearance, found nothing to preserve on a
  field the filler left without an `/AP`, and silently gave up — leaving the
  reported symptom exactly as it was. `autosize-field.pdf` covers the
  has-an-appearance case, `autosize-no-appearance.pdf` the harder one.

  There is **one** answer to that question and everything reads it: `/DA`
  pinning, drawing the value as page text, measuring the fit, and — through
  `FormFieldInfo.textSize` — the interface. It used to be three near-copies
  plus a fourth guess in `PageView`, which took the size from the widget's
  *height*. A box's height says nothing about its type size: a 24pt-tall field
  on a form set in 9pt is ordinary, and that guess showed a 9pt value at 14pt.
  The value appeared to swell the moment it was clicked, "Widen to fit" then
  sized the box to text half again as wide as the real thing, and
  `measureFieldFit` had its own version of the same guess at `height * 0.66`.
  A field that measures as one size and draws as another is the shape of every
  bug in this area.

- **The inline editor sits at the document's size, with a floor on touch.**
  `InlineTextEditor` draws over the line at the size the page draws it, which
  is the whole illusion — and on a phone it is unusable. At the zoom that fits
  a page to a 390px screen a 9pt field is six pixels of type in a six-pixel
  box: tapping a field opened an editor that was focused, selected and ready,
  and looked precisely like nothing having happened. So on a coarse pointer
  the type is floored at 16px, which is also the size below which mobile
  Safari zooms the whole viewport in when an input takes focus.

  The box grows in **height** only. Scaling its width to match was the
  obvious thing and it is wrong: a 210pt field magnified three times is wider
  than a phone, so focusing it dragged the whole document sideways and left
  the form's own labels off the screen. Width is also the one dimension that
  has to stay honest — it is what the resize handle sets and what clips a
  value.

  So the input no longer reports how wide the value would be on the page, and
  the `clipped` check cannot ask it. A hidden `probeRef` span holds the same
  string in the same face at the *document's* size, and both `clipped` and
  `fitToText` measure that. Desktop is left exactly at the document's size;
  the floor is for the pointer that has a soft keyboard.

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

  **A notice leaves on its own, and how long it stays is its severity.** Five
  seconds for a confirmation, eight for a disclosure like this one, ten for an
  error or a warning that the document changed in a way the user did not ask
  for. They used to stay until dismissed, which sounds like the honest choice
  and stops being one after a dozen edits: the corner becomes a wall of stale
  acknowledgements, only four are shown, and the one that matters is the one
  pushed out of sight by the six that do not. Two things keep the clock from
  swallowing a disclosure — hovering or focusing a notice stops it, and a
  repeat restarts it rather than folding silently into an entry that is about
  to disappear. That last one is why `Notice` carries `raisedAt`.

  A test that waits, then asserts a notice is *absent*, is asking a question
  whose answer expires. `print.spec.ts` records them from a `MutationObserver`
  as they appear, and asserts over everything the run raised.

- **No AGPL dependencies.** MuPDF is the better redaction engine and is
  AGPL-3.0-or-later or a quoted commercial licence. PDFium is BSD-3, its
  wrapper is MIT, the fonts are SIL OFL 1.1. Keep it that way; the licence
  files ship in `public/fonts/`.

- **The landing page is prerendered, and that is the whole of the site's
  public text.** The editor cannot be server-rendered — it wants `window`, a
  `Worker` and a WASM module on the way up — so the static HTML is whatever
  the dynamic import's fallback renders. That used to be the words "Starting
  the editor…", which meant every crawler, link preview and language model
  received a blank page while the app itself looked fine. `Landing` is
  therefore the `loading` fallback in `EditorLoader` *and* the editor's own
  empty state. Both, always: the fallback is what a scraper reads, and the
  editor's copy is what survives into the rendered DOM that Google actually
  indexes. Content that appears in the source and vanishes on mount counts for
  nothing. `Landing` must touch no browser API and hold no state, since it is
  rendered under Node at build time, and its button must be genuinely
  `disabled` when it has no handler — `waitForLanding` in the browser tests
  distinguishes the prerendered page from the mounted one by exactly that.

  Every public string lives in `src/site.ts`, including the FAQ, which is
  rendered both as visible text and as `FAQPage` structured data by
  `src/structured-data.ts`. `tests/e2e/seo.spec.ts` compares the two, because
  structured data that contradicts the page is worse than none.

  The README answers those same questions, for the crawl that reads
  github.com rather than the site, and `tests/docs/readme.test.ts` compares
  its `###` headings to `FAQ` — the same argument one file further out. The
  answers there are deliberately shorter; only the questions are pinned.

- **The share image and icons are committed files, not generated at build
  time.** Next can build an `opengraph-image.tsx` with `next/og`, and under
  `output: 'export'` that writes `out/opengraph-image` — no extension, because
  a route's name is all it has once there is no server to set a content type.
  Wrangler then serves it as `application/octet-stream`, every social scraper
  refuses it, and nothing anywhere reports a problem: the build passes, the
  file exists, the tag points at it, and the preview is silently blank.
  `scripts/make-brand.mjs` (`pnpm brand`) renders the PNGs once and they are
  committed beside `app/layout.tsx` as static metadata files, which keep their
  extensions. `seo.spec.ts` asserts the content type under `wrangler dev`.
  Metadata routes (`robots.ts`, `sitemap.ts`, `manifest.ts`) each need
  `export const dynamic = 'force-static'` or the export fails outright.

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

- **The offline cache is versioned per cache, not per build, and it is
  generated after the build.** `src/offline/service-worker.ts` is bundled to
  `out/sw.js` by `scripts/build-sw.mjs` as `postbuild`, because the app shell
  is a set of content-hashed chunk names that do not exist until `next build`
  has run. A worker written into `public/` beforehand could only guess at
  them, and a precache list that guesses fails its install on a 404 — leaving
  the app with no offline mode while every sign says it has one.

  Three caches, each stamped with a hash of the bytes it is allowed to hold.
  The single build-named cache is the obvious design and it is wrong here:
  Next's build ID is in the chunk names, so every deploy would invalidate
  everything and each user would re-download 4.5 MB of PDFium to receive a
  change to a label. The shell moves with each build; the **engine** — the
  worker and the WASM binary — moves only when PDFium does; the runtime cache
  is stamped by the fonts and the OCR model.

  **A stamp is taken from bytes that describe the asset, never from
  provenance.** `tesseract/assets.json` carries a `syncedAt` that
  `sync-ocr.mjs` rewrites on every prebuild, so hashing it moved the runtime
  stamp on every build and would have discarded the 8.5 MB OCR model on every
  deploy — while the split into separate caches went on looking as though it
  worked. `PROVENANCE` in `build-sw.mjs` is the exclusion list, and that a
  rebuild moves the shell stamp and nothing else is worth reading off the
  build log whenever that script changes.

  The engine is fetched when the page reports it has loaded, not during
  `install`. A browser allows about six connections to a host, so an install
  asking for 6 MB at once holds all of them and the page's own chunks queue
  behind it: the app took seconds longer to become usable on a first visit,
  and it starved an unrelated browser test until it gave up waiting.
  `register.ts` posts a message after the `load` event, and until that lands
  the engine is cached on first use like anything else. Engine URLs are
  written to the engine cache wherever they were fetched from, so the two
  paths cannot leave two copies of 5 MB.

  The engine is cached ahead of use; the fonts and the OCR model are not.
  Without the engine, "works offline" means the app opens and then cannot open
  a document, which is the half-shipped offline mode the manifest used to
  disclaim. The other two are 14 MB serving paths that may never be taken,
  and `fonts.ts` says "never eagerly" about exactly those files, so they are
  kept the first time they are actually fetched.

  **Never refresh the cached shell from a live response.** The shell is a
  matched set — HTML naming chunk files, and those files — so storing a newer
  page beside the old build's chunks leaves the next offline start naming
  files the cache does not hold, with everything appearing fresh. A deploy
  changes the stamps, and a new install is what moves the shell forward.

  A navigation is network-first so a deploy is picked up on the next reload;
  everything else is cache-first, matched with `ignoreSearch`, because the
  engine worker is requested as `engine-worker.js?v=<stamp>` and Next appends
  a hash to its metadata files. Registration lives in the client bundle
  (`src/offline/register.ts`), never in an inline script: `write-headers.mjs`
  allow-lists inline scripts by hash, so an inline registration would add one
  to the policy for nothing. The policy itself needs no change — the worker is
  same-origin, so `worker-src 'self'` and `connect-src 'self'` already cover
  it. `tests/e2e/offline.spec.ts` cuts the network with
  `context.setOffline(true)` and asserts both halves of the FAQ's claim: the
  page renders, and a document opens.

  **WebKit cannot test this, and the skip is not a bug to fix.** Playwright
  supports service workers on Chromium-based browsers only: under its WebKit
  build `setOffline` does not reach the worker and `page.reload` fails inside
  the driver. The worker itself is fine there — probing it shows the same
  install, the same control and the same two caches as Chromium — so the two
  tests that cut the network skip on WebKit and the two that do not run
  everywhere. Real Safari has had service workers since 11.1; confirming the
  offline path there is a manual pass that `TASKS.md` tracks.

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
src/offline/   The service worker and its registration. Built to out/sw.js.
src/site.ts    Every public-facing string. No imports; read by both sides.
               structured-data.ts turns it into schema.org JSON-LD.
scripts/       sync-wasm, sync-ocr, build-worker, build-sw, write-headers,
               make-fixtures, make-scan-fixture, make-brand, make-screenshots.
fixtures/      Hand-built PDFs pinning the structural edge cases.
               fixtures/local/ is gitignored: real documents go there.
docs/screenshots/  The README's images. Committed; `pnpm shots` remakes them.
tests/engine/  vitest, driving the real WASM under Node.
tests/docs/    vitest. The README against src/site.ts, so the two cannot drift.
tests/e2e/     Playwright, against the built static export. Three engines.
tests/deploy/  Playwright, only under wrangler dev: the response headers.
wrangler.jsonc The Cloudflare deployment. .github/workflows/ci.yml runs it.
```

### Working on this

- `pnpm dev` (runs `sync-wasm`, `sync-ocr` and `build-worker` first)
- `pnpm test` engine tests · `pnpm test:e2e` browser tests ·
  `pnpm test:e2e:deploy` the same under wrangler dev with the real headers
- `pnpm typecheck` · `pnpm build`
- `pnpm format` before pushing. CI runs `prettier --check .` as part of
  "Test and build", and it fails the whole job — so a stray line break
  stops the browser suites from running at all. `pnpm lint` is not the
  gate and does not currently work: it is `next lint`, which Next 16
  removed.
- `pnpm brand` regenerates the share image and icons from `app/icon.svg` and
  `src/site.ts`. Run it by hand after changing either, and commit the PNGs.
- `pnpm shots` regenerates the README's screenshots from the built site, into
  `docs/screenshots/`. Run it after `pnpm build` when the interface changes,
  and commit the PNGs — a README is read on github.com and in a crawl, neither
  of which runs a build. It may only ever photograph a fixture: a screenshot
  of anything in `fixtures/local/` is somebody's real document, committed.
- After changing anything in `src/engine/`, run `pnpm build:worker` or the
  browser will keep running the previous engine.
- After changing anything in `src/offline/`, run `pnpm build` — `build:sw`
  reads the finished `out/`, so it cannot run before the build it describes.
- The browser suites run in Chromium, Firefox and WebKit. Add
  `--project=webkit` to run one; CI runs the three as parallel jobs against a
  single build, so a failure names the engine. Edge is Chromium and is not run
  separately — the README says why, since it is a claim about this code.

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
