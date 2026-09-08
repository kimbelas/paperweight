# Research 01 — Engines that can edit existing PDF text (browser WASM / Node)

> Deep-dive research for the pdf-editor plan. Verified against npm registry, GitHub API, published `.wasm`/`.d.ts` files and vendor docs on 2026-09-07. All claims cite sources in the final section.

## 1. Summary and recommendation

**No permissively-licensed, ready-made "click text and edit it" library exists.** Every open-source option gives you either (a) the primitives and none of the editor, or (b) an editor for *overlay* annotations only. Every turnkey in-browser content editor (Apryse, Nutrient, ComPDFKit, Foxit) is commercial and sales-quoted.

**Primary recommendation: build on `@embedpdf/pdfium` (+ optionally EmbedPDF v2).**
This is the only permissive (BSD-3 PDFium core, MIT/Apache-2.0 wrapper) WASM build verified to *actually ship* the PDFium text-mutation API surface. Confirmed by byte-scanning the published `pdfium.wasm` (v2.15.0) that `FPDFPageObj_NewTextObj`, `FPDFText_SetText`, `FPDFText_LoadStandardFont`, `FPDFText_LoadCidType2Font`, `FPDFPage_RemoveObject` and `FPDFPage_GenerateContent` are all present and typed-cwrapped in `index.d.ts`. EmbedPDF's own engine already exposes `getPageTextRuns()` → `PdfTextRun { text, rect, font, fontSize, color, charIndex, charCount }` (runs grouped per text object) and `getPageGlyphs()` (loose + tight per-glyph boxes) — precisely the hit-testing and layout input a text editor needs. You write the paragraph clustering, font fallback, and undo yourself.

**Secondary: `mupdf` (npm, Artifex).** The only engine reachable from JS that gives *raw content-stream* read/write (`PDFObject.readStream()` / `writeStream()`), real spec redaction (`applyRedactions(..., REDACT_TEXT_REMOVE)`), a built-in undo journal, and glyph-coverage primitives (`Font.encodeCharacter()`, `Font.advanceGlyph()`). Cost: AGPL-3.0-or-later or a commercial Artifex license, and a 4.6 MB-gzip WASM.

**Do not build this on pdf-lib.** It cannot edit existing text, and it has had no npm release since 2021.

**Buy instead of build** if the timeline is short: Nutrient's Content Editor API (`getTextBlocks` / `updateTextBlocks`) is literally the API you would otherwise spend months writing.

---

## 2. Per-library findings

| Library | Version (date) | License | Size | Maintenance | Edits existing text? |
|---|---|---|---|---|---|
| **pdf-lib** | 1.17.1 (2021-11-06) | MIT | 19.5 MB unpacked | 8,622★, last push 2024-07-17, 316 open issues, 9.3M wk dl | **No.** Overlay only. But *does* export `decodePDFRawStream`, `PDFRawStream`, `PDFContentStream`, `PDFOperator`, `PDFOperatorNames`, `CustomFontSubsetEmbedder` — enough to hand-roll a rewrite. No content-stream tokenizer. |
| `@cantoo/pdf-lib` | 2.9.1 (2026-08-18) | MIT | 21.5 MB | 346★, active, 436k wk dl | No. Adds SVG path drawing. |
| `@pdfme/pdf-lib` | 6.1.12 (2026-07-23) | MIT | **2.17 MB** | active | No. Modernized/slimmed fork. |
| `pdf-lib-extended` | 1.0.61 (2026-09-01) | ISC | — | active | No. Drawing helpers only. (`pdf-lib-plus` does not exist on npm.) |
| `@libpdf/core` (Documenso) | 0.4.2 (2026-09-01) | MIT | 4.33 MB | 38 releases since 2026-01, 80k wk dl, **beta** | No. Targets lenient parsing, PAdES signing, incremental save, form filling. |
| **mupdf** (MuPDF.js) | 1.28.1 (2026-09-06) | AGPL-3.0-or-later **or** commercial | wasm 10.2 MB raw / **4.6 MB gzip** / 3.6 MB brotli (ships `.br`) | Artifex, releases tracking MuPDF core; `mupdf.js` docs repo 608★ pushed 2026-07-01; 299k wk dl | **Yes, via primitives.** No `insertText` — the `mupdf/mupdfjs` and `mupdf/tasks` submodules were **deprecated** and reduced to copyable examples. What you get: raw stream R/W, `applyRedactions()`, `Page.run(device)` with a JS `Device` (`fillText(Text, ctm, cs, color, alpha)`) to walk/re-emit content, `Text.showString/showGlyph/walk`, `addSimpleFont/addFont/addCJKFont/subsetFonts`, `enableJournal/undo/redo`. ESM-only. |
| **`@embedpdf/pdfium`** | 2.15.0 (2026-08-04) | MIT wrapper + BSD-3 PDFium | wasm 4.53 MB raw / **2.04 MB gzip**; 7.5 MB unpacked | 513k wk dl, active | **Yes — full API exposed.** Verified: `FPDFPageObj_NewTextObj`/`CreateTextObj`, `FPDFText_SetText`, `FPDFText_SetCharcodes`, `FPDFText_LoadFont`/`LoadStandardFont`/`LoadCidType2Font`, `FPDFPage_InsertObject(AtIndex)`, `FPDFPage_RemoveObject`, `FPDFPage_GenerateContent`, `FPDFPageObj_Set/GetMatrix`, `FPDFPageObj_SetFillColor`, `FPDFText_GetTextObject` (char index → text object), `FPDFText_GetLooseCharBox/GetCharBox/GetMatrix/GetFontInfo`, `FPDFFont_GetFontData/GetIsEmbedded/GetGlyphPath/GetGlyphWidth/GetFamilyName/GetFlags/GetWeight/GetItalicAngle`. Plus ~130 custom `EPDF*` extensions in their PDFium fork (incl. `EPDFText_RedactInQuads`, `EPDFText_RedactInRect`, `EPDFPage_ApplyRedactions`). |
| `@hyzyla/pdfium` | 2.1.13 (2026-05-12) | MIT | wasm 3.9 MB / 1.98 MB gzip | 186★, pushed 2026-06-20 | **No.** Only **35** `FPDF*` functions exported — render + `FPDFText_GetText` + image extraction. No `NewTextObj`, no `SetText`, no `GenerateContent`. Render-focused by design. |
| `pdfium-wasm` | 0.0.2 (2018) | ISC | — | dead | No. |
| `paulocoutinhox/pdfium-lib` | — | MIT | — | 1,070★, pushed 2026-06-20 | Build toolchain — use it if you need your own PDFium WASM with a custom export list. |
| **EmbedPDF** (`embed-pdf-viewer`) | 2.15.0 stable (2026-08-04); v3 on `next` = `3.0.0-next.11` (2026-09-01, *not production-ready*) | Apache-2.0 for all `@embedpdf/*` (only `@cloudpdf/server` is Fair Core FCL-1.0-ALv2) | `@embedpdf/snippet` 9.7 MB | 4,455★, pushed 2026-09-01, 210 open issues | **No text editing.** 23+ plugins: text selection, annotations (highlight/sticky/freetext/ink), forms, signatures, stamps, search, thumbnails, print, export, capture, layout analysis, and **true redaction (content actually removed)** — implemented as `EPDFText_RedactInQuads` + `FPDFPage_GenerateContent`. First-class React (drop-in viewer + headless hooks). |
| **pdfjs-dist** | 6.3.289 (2026-08-29) | Apache-2.0 | `pdf.min.mjs` 447 KB + `pdf.worker.min.mjs` 1.24 MB (minified, pre-gzip); 34.8 MB unpacked | 53,840★, pushed 2026-09-07, 18.2M wk dl | **No.** Verified `AnnotationEditorType` = `DISABLE, NONE, FREETEXT, HIGHLIGHT, STAMP, INK, POPUP, SIGNATURE, COMMENT` — no content-edit mode. `saveDocument(): Promise<Uint8Array>` writes those as real PDF annotation objects (not rasterized), so they remain editable elsewhere. Issue #16688 "Text layer editing" **closed as not planned**; editing *pre-existing* annotations is still tracked in #15403/#16883. Useful for locating text: `getTextContent()` → `TextItem { str, dir, transform[6], width, height, fontName, hasEOL }` + `TextStyle { ascent, descent, vertical, fontFamily }`; `getOperatorList()` is public. New in v6: `extractPages()`. |
| **qpdf** / `@neslinesli93/qpdf-wasm` 0.3.0 (2025-06-27, ISC, 1.38 MB); `qpdf-wasm` 0.1.0 (2025-07-26) | qpdf 12.x | Apache-2.0 | small | qpdf 5,390★ pushed 2026-09-06 | **No.** Content-*preserving* structural transformer: xref, encryption, linearization, page ops. Great for repair/save pipelines, useless for text. |
| **pdfcpu** | Go | Apache-2.0 | — | 8,825★, pushed 2026-09-07 | **No text editing.** No official npm/WASM package; only community Go→WASM demos. Watermarks, stamps, forms, page ops. |
| **HexaPDF** | Ruby, 1.4.x | AGPL-3.0 + commercial | — | 1,382★, pushed 2026-08-17 | Server-side only. Has `HexaPDF::Content::Processor` for operator-level content-stream parsing plus `decode_text` / `decode_text_with_positioning` — a genuine rewrite substrate, but Ruby. |
| **PDFBox** | Java 3.x | Apache-2.0 | — | 3,112★, pushed 2026-09-07 | Server only. `PDFStreamParser` + `ContentStreamWriter` token-splicing is the classic recipe; notoriously fragile with subset/CID fonts. |
| **PyMuPDF** | Python | AGPL-3.0 + commercial | — | 10,660★, pushed 2026-09-04 | Server only, but the **best-documented technique**: `search_for` → `add_redact_annot` → `apply_redactions` → `insert_text`/`insert_textbox`. Artifex explicitly recommends the redaction route. |
| **PDF Oxide** (bonus find) | crate 0.3.77 (2026-07-28); `pdf-oxide-wasm` 0.3.77 | **MIT OR Apache-2.0** | wasm **17.6 MB** raw; 54 MB unpacked | new (npm since 2026-04), 760 wk dl for wasm | **Claim unverified.** Docs say DOM-style `find_text_containing`/`set_text`/`save_page` are "exposed in Python, Rust, and WASM", but the published `pdf-oxide-wasm@0.3.77` `.d.ts` shows `WasmPdfDocument` with 148 methods including `addRedaction`, `applyRedactionsDestructive`, `eraseRegion`, `repositionImage`, forms — and **no** `setText`/`findText`/`savePage`. Treat as Rust/Python-only for now. Worth re-checking later; the license is the most attractive of any engine here. |

### Commercial benchmarks

| SDK | npm / version | In-browser true content edit? | Notes |
|---|---|---|---|
| **Apryse WebViewer** | `@pdftron/webviewer` 12.1.0 (2026-08-19), 183 MB unpacked | **Yes** — "PDF Editor"; edit text and images in-place, rearrange paragraphs; runs client-side via WASM, content never leaves the browser | Base + à-la-carte modules; entry packages from **$1,500** on their public pricing page, enterprise custom-quoted, consumption-based |
| **Nutrient (ex-PSPDFKit)** | `@nutrient-sdk/viewer` 1.21.0 (2026-08-26), 162 MB | **Yes** — Content Editor component. API: `beginContentEditingSession()`, `getTextBlocks(pageIndex)`, `updateTextBlocks([{id, text, anchor, maxWidth}])`, `commit()`, `discard()`. `maxWidth` triggers wrapping | Requires a license *including* the Content Editor component (contact sales). Documented limitation: **LTR text only.** Legacy `pspdfkit` npm frozen at 2024.8.2 (2025-02-13) |
| **ComPDFKit Web** | `@compdfkit_pdf_sdk/webviewer` | **Yes** — add/select/modify text paragraphs, one-click search & replace, font/color/size/opacity; auto-highlights editable text boxes | Perpetual licensing; free tier 200 API calls/mo, 30-day trial, "Community License" for startups. Client-vs-server architecture not disclosed |
| **Foxit PDF SDK for Web** | `@foxitsoftware/…-web-library` 11.1.1 (2026-06-10), 107 MB, Commercial | **Yes, two tiers** — *Std Edit*: content-object level (text/image/shape objects, font style). *Adv Edit*: adds **text block** editing | Quote-based |
| **PDF.js Express** | `@pdftron/pdfjs-express` 8.7.5 (2024-07-04) | **No** — annotations only | Effectively EOL; Apryse steers customers to WebViewer and offers no custom license agreements for it |

---

## 3. Technique deep-dive: editing text when the engine won't

### 3.1 Locating the text run

Two layers, and you need both.

**Semantic layer (for hit-testing the user's click).** All three engines give chars + boxes; the important part is the *bridge back to the drawing object*:
- **PDFium: `FPDFText_GetTextObject(textpage, charIndex)`** → the `FPDF_PAGEOBJECT` that drew that character. This is the single most valuable call for a text editor. Combine with `FPDFText_GetLooseCharBox` (layout box) and `FPDFText_GetCharBox` (tight box — Chrome uses tight boxes for `FPDFText_GetCharIndexAtPos`, so match that for consistent hit-testing).
- **MuPDF:** `Page.run(device, matrix)` with a JS `Device` whose `fillText(text, ctm, colorspace, color, alpha)` hands you an `fz_text` you can `walk()` — glyph id, unicode, and transform per glyph. Or `toStructuredText()` → `walk()` / `search()` → quads.
- **pdf.js:** `getTextContent()` items carry a 6-element `transform` (that's the text rendering matrix, so `[4]`,`[5]` are the baseline origin and `[0]`,`[3]` encode scale) plus device-space `width`/`height` and `fontName`. `getOperatorList()` gives semantic ops (`setFont`, `showText`, …). No object identity — pdf.js is read-only by design.

**Raw layer (for a real rewrite).** Inflate `/Contents` (may be an array of streams — concatenate them; splits can occur mid-token) and tokenize. Text lives strictly between `BT` … `ET`:
- **State:** `/F1 12 Tf` selects a font from the page `/Resources /Font` dict + size. `Tc` char spacing, `Tw` word spacing, `Tz` horizontal scale %, `TL` leading, `Ts` rise, `Tr` render mode.
- **Position:** `Tm` sets text matrix *and* text line matrix (absolute); `Td`/`TD` translate relative to the line matrix; `T*` newline by `TL`.
- **Show:** `(str) Tj`; `[(ab) -120 (cd)] TJ` where bare numbers are kerning adjustments in **thousandths of a text-space unit, subtracted** from the advance; `'` = newline-then-show; `aw ac (str) "` = set word/char spacing then show.

**The trap that kills naive implementations:** the bytes inside `( )` are *font codes, not Unicode*. Simple fonts map code→glyph via a base encoding plus `/Differences`; composite Type0/Identity-H fonts use 2-byte CIDs with reverse mapping only through `/ToUnicode`. Word spaces are frequently not encoded at all — the gap is an x-coordinate jump. So you cannot search-and-replace on visible text, and "the string looks like ASCII" is only true for WinAnsi-encoded fonts.

### 3.2 Redact-and-redraw vs. true content-stream rewrite

**Do not use a white rectangle.** Covering text leaves the glyphs in the content stream: still extractable, searchable, and copy-pasteable. Acceptable only as a transient visual preview.

**Redact-and-redraw (recommended default).** Remove the drawing operators, then draw replacement text:
- *PDFium:* `FPDFPage_RemoveObject(page, textObj)` then `FPDFPageObj_Destroy(textObj)` (removal transfers ownership — otherwise you leak), or EmbedPDF's `EPDFText_RedactInQuads` for sub-object precision, then **`FPDFPage_GenerateContent(page)`**.
- *MuPDF:* create a `Redact` annotation over the quad, then `applyRedactions(false /* no black boxes */, imageMethod, lineArtMethod, PDFPage.REDACT_TEXT_REMOVE)`.
- *PyMuPDF (the documented reference implementation):* `search_for` → `add_redact_annot` → `apply_redactions` → `insert_textbox`. Artifex's own guidance is to do removal and re-insertion as **two separate steps** rather than relying on the built-in replacement parameter.

**True rewrite.** Splice the operand of a specific `Tj`/`TJ`, re-encoded into the same font's codes, and re-serialize. Only safe when every replacement glyph already exists in the embedded subset, and you accept losing the original per-glyph kerning. The much better version of this: if the edited run *is* an entire text object, use **`FPDFText_SetText(textObj, utf16le)`** — "Set the text for a text object. If it had text, it will be replaced." PDFium handles the encoding for you. Same for `FPDFText_SetCharcodes` (experimental) when you want to drive codes directly.

**Two documented caveats you must design around:**
1. `FPDFPage_GenerateContent` **regenerates the whole page content stream** from PDFium's object model. Anything PDFium doesn't fully model round-trips imperfectly, so unedited pages should never be touched. And: "Before you save the page to a file, or reload the page, you must call `FPDFPage_GenerateContent` or any changes to `page` will be lost."
2. "When removing a `page_object` of type `FPDF_PAGEOBJ_TEXT`, all `FPDF_TEXTPAGE` handles for `page` are no longer valid." Re-`FPDFText_LoadPage` after every text removal — a stale text page is a use-after-free.

---

## 4. Font handling

**The core problem:** PDFs store positioned glyph IDs against *subset* fonts. Embedded subsets contain only the glyphs actually used; glyph IDs are arbitrary and non-standardized (glyph 79 may be "P" in one font and "f" in another). Type the letter "ü" into a document whose subset never used it and there is no glyph to draw. Simple fonts are additionally capped at 255 codes, which is why subsetting and `/Differences` exist at all. And PDF requires kerning to be specified inline — the font's GPOS/GSUB tables are *not* applied by the viewer — so re-laying-out text yourself will not reproduce the original look.

**Detecting glyph coverage (cheapest first):**
- MuPDF: `Font.encodeCharacter(codepoint)` → glyph id; **`0` means no glyph**. Fastest reliable probe available in JS.
- fontkit (`fontkit` 2.0.4, MIT; `@pdf-lib/fontkit` 1.1.1 is the pinned pdf-lib build): `font.hasGlyphForCodePoint(cp)`.
- PDFium: pull the font program with `FPDFFont_GetFontData` (check `FPDFFont_GetIsEmbedded` first) and probe with fontkit, or use `FPDFFont_GetGlyphPath`, which yields nothing for unmapped glyphs.

**Do not try to extend an existing subset.** Adding a glyph to a simple font means finding a free code in 0–255, adding a `/Differences` entry, patching `/Widths`, *and* rebuilding the embedded font program. Adding to Identity-H means a new CID plus `/W`, `/ToUnicode`, and `CIDToGIDMap` updates. This is where hand-rolled editors go to die.

**Fallback ladder that actually works:**
1. **Glyphs present in original font** → re-encode in place. Best fidelity, no new font object.
2. **Glyphs missing** → substitute a *full* font matched on metrics. Read the original's identity: `FPDFFont_GetFamilyName` / `GetBaseFontName` / `GetFlags` / `GetWeight` / `GetItalicAngle` (PDFium) or `Font.isSerif/isBold/isItalic/isMono` (MuPDF). Then either map to the nearest of the standard 14 via `FPDFText_LoadStandardFont("Helvetica-BoldItalic")` — note PDFium prefers dash-separated style names — or embed a real TrueType with `FPDFText_LoadFont(..., FPDF_FONT_TRUETYPE, ...)`, which **auto-generates the `ToUnicode` map**, or `FPDFText_LoadCidType2Font` for wide-Unicode work. With MuPDF: `PDFDocument.addSimpleFont(font, encoding)` / `addFont(font)` / `addCJKFont(...)` then `subsetFonts()` before save. With pdf-lib: `registerFontkit(fontkit)` + `embedFont(bytes, { subset: true })`.
3. **Tell the user.** This is exactly Sejda's model: it surfaces "The original font is missing some of the characters you typed" and offers replacement candidates tagged "Very similar." Copy that UX — silent substitution produces mystifying output.

**Measuring to fit the original box:**
- pdf-lib: `font.widthOfTextAtSize(text, size)`.
- fontkit: `font.layout(str).advanceWidth / font.unitsPerEm * size`.
- PDFium: `FPDFFont_GetGlyphWidth` (1/1000 em); MuPDF: `Font.advanceGlyph(gid)`.
- Target box: `FPDFPageObj_GetBounds` / `GetRotatedBounds`, EmbedPDF's `PdfTextRun.rect`, or pdf.js `TextItem.width`.
- When it doesn't fit: shrink font size, apply `Tz` horizontal scaling, tighten `Tc`, or wrap. Nutrient's `maxWidth` does the last one: "If the new width is smaller than the current text, it'll wrap to fit within the new constraints."

**No reflow, ever.** PDF has no paragraph concept. Longer replacement text overruns whatever follows. The commercial SDKs all solve this with block detection (Nutrient `getTextBlocks`, ComPDFKit's auto-highlighted editable paragraphs, Apryse's paragraph rearranging). To match them you must cluster runs into blocks yourself using baseline y, leading, and x-extent — and EmbedPDF's `getPageTextRuns()` + `getPageGlyphs()` is the correct raw input for that clustering. Budget real time here; it is the hardest *product* problem in the project, distinct from the hardest *technical* one (fonts).

**Scanned pages have no text objects.** Nothing to edit; you need OCR or nothing. Sejda states this outright: "Changing existing text inside scans not supported."

---

## 5. Licensing matrix

| Component | License | Commercial implication |
|---|---|---|
| pdf-lib + all forks | MIT / ISC | Free, no obligations |
| `@libpdf/core` | MIT | Free |
| pdfjs-dist | Apache-2.0 | Free |
| PDFium core | BSD-3-Clause | Free, attribution only |
| `@embedpdf/pdfium` wrapper | MIT (`LICENSE`: "Copyright (c) 2024 CloudPDF, Ji Chang"); ships `LICENSE.pdfium` (BSD-3) | Free. **Note the inconsistency:** package.json/LICENSE say MIT while repo `LICENSING.md` says all `@embedpdf/*` are Apache-2.0 and GitHub reports NOASSERTION. Both are permissive; get it in writing if it matters. |
| EmbedPDF `@embedpdf/*` | Apache-2.0 | Free. Only `@cloudpdf/server` is Fair Core (FCL-1.0-ALv2) |
| **mupdf / MuPDF.js** | **AGPL-3.0-or-later** or commercial | AGPL is viral **over the network** — a hosted SaaS PDF editor must publish its source. Commercial license required otherwise; third-party reports put MuPDF core commercial licensing from ~$1,500 to $50,000+, quote-based (Artifex publishes no price list — verify directly). |
| PyMuPDF, HexaPDF | AGPL-3.0 + commercial | Same AGPL network trap |
| qpdf, pdfcpu, PDFBox | Apache-2.0 | Free |
| PDF Oxide | MIT OR Apache-2.0 | Free — best license of any engine here, but WASM text mutation unverified |
| Apryse / Nutrient / ComPDFKit / Foxit | Proprietary | Quote-based; Apryse entry from $1,500, Nutrient requires the Content Editor component explicitly |

---

## 6. Honest uncertainties

- **How well `FPDFText_SetText` preserves appearance on real-world documents is unmeasured.** The API exists and is documented; whether it round-trips a heavily-kerned justified paragraph acceptably needs a spike against the actual corpus before committing. Test this in week one.
- `FPDFText_SetCharcodes` and `FPDFText_LoadStandardFont` are marked **experimental** in PDFium's own headers.
- PDF Oxide's text-editing claim contradicts its shipped WASM `.d.ts`. Either the docs are ahead of the release or the surface is behind a feature not visible. Ask the maintainer before betting on it.
- ComPDFKit does not disclose whether its Web content editor is client-side WASM or server-round-trip; that matters if document confidentiality is a requirement.
- No public pricing exists for Nutrient's or Foxit's content-edit tiers.
- pdf.js maintainers closed the text-layer-editing request as "not planned" without a visible rationale in the issue body.

---

## Sources

- https://registry.npmjs.org/pdf-lib · https://registry.npmjs.org/mupdf · https://registry.npmjs.org/pdfjs-dist · https://registry.npmjs.org/@cantoo/pdf-lib · https://registry.npmjs.org/@pdfme/pdf-lib · https://registry.npmjs.org/@embedpdf/pdfium · https://registry.npmjs.org/@hyzyla/pdfium · https://registry.npmjs.org/@libpdf/core · https://registry.npmjs.org/pdf-oxide-wasm · https://registry.npmjs.org/@pdftron/webviewer · https://registry.npmjs.org/@nutrient-sdk/viewer · https://registry.npmjs.org/@foxitsoftware/foxit-pdf-sdk-for-web-library (metadata, licenses, dates, unpacked sizes)
- https://api.github.com/repos/Hopding/pdf-lib · /mozilla/pdf.js · /ArtifexSoftware/mupdf.js · /embedpdf/embed-pdf-viewer · /hyzyla/pdfium · /qpdf/qpdf · /pdfcpu/pdfcpu · /gettalong/hexapdf · /apache/pdfbox · /pymupdf/PyMuPDF · /paulocoutinhox/pdfium-lib (stars, pushed_at, licenses)
- https://github.com/ArtifexSoftware/mupdf.js/blob/master/README.md
- https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFPage.html
- https://mupdfjs.readthedocs.io/en/latest/how-to-guide/migration/index.html (mupdfjs/tasks deprecation)
- https://mupdf.readthedocs.io/en/1.27.0/license.html
- https://raw.githubusercontent.com/chromium/pdfium/main/public/fpdf_edit.h (API docs and caveats)
- https://raw.githubusercontent.com/embedpdf/embed-pdf-viewer/main/LICENSING.md · .../README.md
- https://www.embedpdf.com/docs/react/introduction · https://www.embedpdf.com/docs/react/headless/plugins/plugin-redaction
- https://github.com/mozilla/pdf.js/issues/16688 · /15403 · /16883
- https://www.nutrient.io/guides/web/editor/content-editor-api/ · https://www.nutrient.io/guides/web/editor/edit-text/ · https://www.nutrient.io/blog/pdfjs-annotation-editor-layer/
- https://apryse.com/products/webviewer · https://apryse.com/pricing · https://verdocs.com/apryse-pricing/
- https://www.compdf.com/pdf-sdk/web/content-editor
- https://developers.foxit.com/products/web/ · https://webviewer-demo.foxit.com/docs/developer-guide/main/features/the-edit-modules.html
- https://pdfjs.community/t/when-is-eol-end-of-life-for-pdf-js-express/3211 · https://pdfjs.express/pricing
- https://www.sejda.com/pdf-editor
- https://artifex.com/blog/how-to-search-and-replace-text-in-pdfs-using-pymupdf
- https://github.com/pymupdf/PyMuPDF/discussions/3422 · /3396 · /3499
- https://blog.idrsolutions.com/understanding-pdf-text-objects/
- https://nibblestew.blogspot.com/2023/01/pdf-text-and-fonts-design-by-devil.html
- https://www.syncfusion.com/succinctly-free-ebooks/pdf/text-operators
- https://www.prepressure.com/pdf/basics/fonts
- https://github.com/Hopding/pdf-lib/issues/374 · /564 · /950 · /1247
- https://github.com/neslinesli93/qpdf-wasm · https://github.com/jsscheller/qpdf-wasm · https://github.com/wcchoi/go-wasm-pdfcpu
- https://www.rubydoc.info/gems/hexapdf/HexaPDF/Content/Processor · https://hexapdf.gettalong.org/
- https://crates.io/crates/pdf_oxide · https://pdf.oxide.fyi/rust/docs/editing/overview · https://pdf.oxide.fyi/rust/docs/editing/text
- https://documenso.com/blog/introducing-libpdf-the-pdf-library-typescript-deserves
