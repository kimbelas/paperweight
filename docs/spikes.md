# Phase 0 spike findings

Recorded 2026-09-07. The spikes were run inside the real project rather than a
throwaway, so each one became engine code plus a test that keeps it honest.
Test names are given so a regression points back here.

## Results

| # | Question | Result | Where it lives |
|---|---|---|---|
| S1 | Does `@embedpdf/pdfium` load, parse, render and save in a worker, under a static export? | **Pass.** Also confirmed the package is MIT over BSD-3 PDFium, and that every mutation API the plan needed is present in the shipped `.wasm` and typed in `index.d.ts`. | `tests/engine/smoke.test.ts` |
| S2 | How faithfully does `FPDFText_SetText` preserve appearance? | **Pass, with a caveat that changed the design.** See below. | `tests/engine/text-edit.test.ts` |
| S3 | Do removed objects stay removed after a save? | **Pass.** The old PDFium "removed objects reappear" report does not reproduce on this build. Verified by reopening the saved bytes and enumerating objects, not by looking at pixels. | `object removal persists` |
| S4 | Can a bundled fallback font be embedded and stay extractable? | **Pass.** `FPDFText_LoadFont` with `cid: false` generates a `ToUnicode` map, so replacement text remains searchable and copyable. | `keeps the replacement text extractable` |
| S5 | Does image alpha survive the round trip? | **Pass**, once the RGBA-to-BGRA swizzle was added. Input bitmaps are BGRA; only rendering can ask PDFium for reversed byte order. | `preserves transparency so a signature does not arrive as a white box` |
| S6 | Printing | **Implemented and verified in Chromium.** Hidden off-screen iframe, with an open-in-tab fallback. Firefox and Safari still need a manual check. | `src/io/print.ts` |
| S7 | Coordinates on rotated and cropped pages | **Pass, and it resolved an open question from the research.** `FPDF_DeviceToPage` handles a crop box offset from the media box correctly, so the feared 36-point offset does not exist. Rotation round-trips too. | `coordinate mapping` |
| S8 | Performance on a 100-page, 30 MB document | **Not done.** No fixture of that size yet. Budgets remain unmeasured, and page-list virtualisation is deliberately still open because of it. | — |
| S9 | Are the `EPDF*` redaction functions reachable? | **Yes.** `EPDFText_RedactInRect`, `EPDFText_RedactInQuads` and `EPDFPage_ApplyRedactions` are all exported. True redaction is therefore possible later; it is not wired to any UI, so nothing claims to redact. | `node_modules/@embedpdf/pdfium/dist/index.d.ts` |
| S10 | Signature field detection and removal | **Pass, and simpler than expected.** No form-fill environment is needed: `FPDFAnnot_GetStringValue(annot, 'FT')` returns `"Sig"` directly. | `tests/engine/signatures.test.ts` |

## S2 in detail: the finding that shaped the design

The plan assumed Path A (reuse the document's own font) would be the common
case and Path B (substitute) the exception. It is the other way round.

`FPDFFont_GetIsEmbedded` returns false for any non-embedded font, including
all of the standard 14. With no embedded font program there is nothing to
check glyph coverage against, so coverage fails closed and Path B is taken.
Every edit to text set in Helvetica, Times or Courier therefore substitutes.

This is the right outcome — a metric-compatible Liberation face is a better
result than guessing — but it means **the font-substituted badge is normal, not
rare**, and the UI had to be built so that seeing it is unremarkable rather
than alarming. Path A still runs, and the test `reuses the original font when
it is embedded and covers the text` proves it by editing a line twice: the
first edit embeds the fallback, and the second reuses it.

Two smaller findings from the same spike:

- **`FPDFFont_GetFamilyName` is the wrong call for font identity.** It returns
  what PDFium *resolved* the font to, which for a non-embedded font is a host
  substitute — Helvetica came back as "Chrom Sans OTF". `FPDFFont_GetBaseFontName`
  returns the document's own `/BaseFont` and is what identity decisions use.
- **Text inside a form XObject is invisible to a flat object scan.** PDFium
  reports the form as one object of type Form and does not surface its
  children, so `FPDFFormObj_CountObjects` / `GetObject` recursion was needed.
  Such text is read, displayed and editable; see the section below on what
  real documents changed.

## The bug worth remembering

While building the Path B commit, replacement text silently lost its repeated
letters: "Hello World AAAA" came back as "Helo Wrd A".

The content stream showed the text written correctly. The matrix did not:

```
BT .0000000000000000000000000000000000000026253159 .0000000000000000000000000000000000000024951408 0 1 0 0 Tm
```

The `a` and `b` components were denormalised noise. The cause was mine: a
helper built the `FS_MATRIX` inside a scope, returned the pointer, and the
scope freed the allocation before `FPDFPageObj_SetMatrix` read it. The
allocator had written free-list bookkeeping into the first eight bytes of the
released block, which is exactly `a` and `b`. Every glyph then landed on one
point, and PDFium's text extraction deduplicated the overlapping glyphs, which
is what made it look like a character-dropping bug rather than a geometry one.

The fix was to make the hazard structurally impossible: `setObjectMatrix` in
`memory.ts` allocates and consumes in the same scope, and `withScope` now
documents that returning a pointer is never safe. Worth remembering because
the symptom pointed nowhere near the cause.

## What real documents changed (2026-09-08)

The synthetic corpus was not enough. Running the engine over real files
surfaced three problems, two of them severe, and overturned one decision
recorded above.

**Whole documents can be a single form XObject.** A filled bank application
form reported 342 text runs, every one of them nested, and therefore **zero
editable lines**. The original decision — refuse nested text, because
regenerating the page does not rewrite a form's own content stream — was
technically correct and practically useless.

What was missed is that refusing was not the only option. Testing showed:

| Question | Answer |
|---|---|
| Does `FPDFText_SetText` on a nested object persist? | **No.** Reports success, gone after save. |
| Is there a form-content regeneration API? | **No.** Nothing in the build. |
| Does `FPDFFormObj_RemoveObject` persist? | **Yes.** |
| Are a nested object's bounds and matrix in page space? | **Yes.** Matrix `e` matched bounds `left` exactly. |

So a nested line is now removed and redrawn at page level, landing within
0.1pt of where it was. That form went from 0 to 206 of 206 lines editable. The
redraw reuses the original font when it is embedded and covers the text, which
on that document it does — so no substitution, and the result is
indistinguishable from an in-place edit.

**A declared font size is not the rendered size.** The same form declares
`fontSize` 1 and puts the scale in the matrix: 12, 6.7, 10, 7 for different
lines. The inline editor sized itself from the declared value and drew text at
one pixel. `effectiveFontSize` (declared size times the matrix's vertical
scale) now exists for anything user-facing, and line clustering uses it too,
since its thresholds are in page points.

**Whitespace-only runs were being listed as lines.** PDFium reports plenty of
runs holding a single space with no measurable width. These appeared as dozens
of un-editable entries and swallowed clicks. They are filtered out.

Two other things real files confirmed rather than changed: scanned documents
are correctly detected and reported (two of the seven were scans, with zero
text objects), and signature detection found the flattened images in a signed
form and the cryptographic signature in a DocuSign envelope.

## Reading scans (2026-09-08)

Two of the seven real documents tested were scans with zero text objects, so
they could not be edited at all. OCR closes that, with one important caveat
that shaped how it is presented.

**OCR does not make a scan editable.** It recovers where the words are and
what they probably say. The visible ink is still pixels in a photograph.
Changing a word therefore means painting over those pixels and drawing new
text on top — `patchRegion` — which is a different operation from editing a
text object and is labelled as one throughout. The patch matches the sampled
paper tone rather than painting white, which is what keeps it from looking
like an obvious rectangle, but it never matches the original typeface and the
covered pixels remain in the file.

Findings worth recording:

| Question | Answer |
|---|---|
| Licence? | tesseract.js is Apache-2.0. No conflict with the no-AGPL rule. |
| Does it phone home? | **Yes, by default.** Worker, WASM core *and* language model all come from jsdelivr. All three are now served from `public/tesseract/`. |
| How large? | 8.5 MB total, using the `fast` LSTM model (1.9 MB against ~15 MB for the full one) and one pinned SIMD core instead of the five variants. |
| Accuracy? | 95% mean confidence on a 150 DPI render of a text document, all six lines verbatim. |

**The fixture was the hard part.** `scanned-page.pdf` is grey bars standing in
for lines of print. OCR correctly finds nothing in it, which is
indistinguishable from a broken recogniser and cost some time before the
penny dropped. `scripts/make-scan-fixture.mjs` now renders a real document to
a bitmap at 150 DPI, with a faint mottle and an off-white paper tone, and
wraps it as a full-page image. Genuine glyph shapes, no text objects.

**One bug found by using it.** Patching a line adds a real text object, which
flipped the page from "scanned" to "has text" — and the recognised-line
hit-testing was gated on that flag, so a single edit stranded every remaining
line on the page. Hit-testing now tries real text first and falls back to
recognised lines, which is both more correct and simpler: a patched line is
subsequently edited as the text object it now is.

## An interface pass (2026-09-08)

Also fixed while there, each found by using the app rather than by reading it:

- **A tall page never reaches a 50% intersection ratio**, so the
  IntersectionObserver that tracked the current page silently stopped updating
  it on long documents. The page number is now derived from scroll position,
  choosing whichever page shows the most.
- **Every page rendered at once.** A 28-page document now mounts three pages
  and keeps exact-height placeholders for the rest, so the scrollbar stays
  honest. First page visible in about 1.5 seconds instead of after 28
  bitmaps.
- **Added text had no controls at all** — black, 12pt, one typeface — which
  made the Add text tool close to useless. Size, typeface and colour now live
  in a properties panel.
- **"Scanned page" appeared twice** in the right-hand panel, as a signature
  card title and a section heading. The section is now "Text on this scan".

## Still open

- **S8.** No large-document fixture, so no measured budgets, so no
  virtualisation. This is the main known scaling risk.
- **Printing outside Chromium.** The code paths for Safari and Firefox exist
  and are reasoned from documented behaviour, but they are untested by hand.
- **Carlito and Caladea.** Not bundled. Their licence is reported
  inconsistently upstream and Calibri-set documents are common enough that it
  is worth resolving properly rather than guessing.
