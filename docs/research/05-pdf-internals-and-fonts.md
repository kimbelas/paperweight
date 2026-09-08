# Research 05 — PDF internals and font engineering for text editing / redaction

> Deep-dive research for the pdf-editor plan. Researched 2026-09-07. All claims cite sources in the final section.

## Summary

Editing existing PDF text is not a text operation — it is a **glyph-stream** operation. Page marking instructions live in a content stream whose text-showing operators carry *character codes for a specific font's encoding*, not Unicode. Any "edit text" feature therefore needs four capabilities: (1) tokenize the content stream, (2) resolve the font's encoding and widths to locate and measure the run you want to change, (3) re-encode the replacement using either the original font (if its subset covers the new glyphs) or a newly embedded fallback, and (4) rewrite the stream without disturbing anything else. Whiteout is trivially easy and legally dangerous; true redaction requires glyph removal. The pragmatic architecture for a TypeScript browser app is **pdf.js as the reader/tokenizer, pdf-lib as the writer, and a WASM engine (MuPDF.js) for true redaction** — because pdf-lib explicitly does not support removing or editing existing page text (pdf-lib README).

## Content stream text model

A page's `/Contents` is a stream or an array of streams; the content stream is a sequence of *operands followed by an operator* (pikepdf docs). Text lives inside `BT … ET` blocks. The full operator set a tokenizer must recognize is enumerated verbatim in pdf-lib's own `PDFOperatorNames.ts`: text `BT ET Td TD T* Tc Tf Tz TL Tr Ts Tw Tj TJ ' "`, graphics state `q Q cm gs`, XObject `Do`, Type3 glyph metrics `d0 d1`, and compatibility `BX EX`.

Positioning is matrix-based. Per ISO 32000-2 §9.4.4 the text rendering matrix is
`Trm = [Tfs×Th, 0, 0; 0, Tfs, 0; 0, Trise, 1] × Tm × CTM`. After each glyph the text matrix advances by

```
tx = ((w0 − Tj/1000) × Tfs + Tc + Tw) × Th
```

where `w0` is the glyph width in glyph space, `Tj` the numeric adjustment from a `TJ` array, `Tfs` the font size, `Tc`/`Tw` char/word spacing, `Th` horizontal scale (§9.4.4). This is *the* equation your layout code must implement: `TJ` numbers are subtracted, expressed in thousandths of text space, so `[(O)-16(ther i)-20(nformati)-11(on )] TJ` is one word split by kerning (replace-text-pdf). `T*` is exactly `0 -TL TD` (Table 106), `Tz` is a percentage with 100 = normal (§9.3.4), and — a PDF 2.0 change worth knowing — `q`/`Q` now also push and pop `Tm` and `Tlm`.

`cm` and the enclosing `q/Q` nesting scale and translate everything, so a glyph's page position is only computable by simulating the whole graphics-state stack. Text also hides inside **Form XObjects**, invoked by `Do`: each has its own content stream *and its own `/Resources`*, and they nest arbitrarily. Annotation appearance streams are Form XObjects too. A text editor that only walks `/Contents` will silently miss text in stamps, headers built as forms, and filled form fields.

## Encoding and fonts in existing PDFs

**Simple fonts (Type1/TrueType).** One byte per code. The code→glyph-name table is `/BaseEncoding` (`WinAnsiEncoding`, `MacRomanEncoding`, `MacExpertEncoding`) patched by `/Differences`; if `/BaseEncoding` is absent the implicit base is *the embedded font program's built-in encoding*, else `StandardEncoding` for non-symbolic and the built-in encoding for symbolic fonts. Widths come from `/FirstChar`, `/LastChar`, `/Widths` in units where 1000 = 1 text-space unit, with `/MissingWidth` from the descriptor as the fallback (PdfPig font notes).

**Composite fonts (Type0/CID).** With `/Encoding /Identity-H`, two-byte codes 0–65535 map to the identical CID, high byte first, and `/CIDToGIDMap /Identity` makes the CID the raw glyph index. **The bytes in `Tj` are glyph IDs of one specific font file.** Widths come from `/W`, in the two forms `c [w1 w2 … wn]` and `cfirst clast w`, defaulting to `/DW` (default 1000).

**`/ToUnicode`** is a CMap stream of `begin/endbfchar` and `begin/endbfrange` sections mapping codes to UTF-16BE; it is required only for extraction, not display, and is normally compressed. It is one-directional and often lossy (ligatures, many-to-one), so **never** invert `/ToUnicode` to produce codes for new text — go through the font program instead.

**Subsets.** A `BAAAAA+Helvetica` style prefix is exactly six uppercase letters and signals a subset; different subsets of the same font in one file must use different tags. Practical consequence: a subset embedded for the word "Invoice" contains glyphs for I,n,v,o,i,c,e only. Typing "Payment" fails.

**Type 3 fonts** define each glyph as a mini content stream in `/CharProcs` with a `/FontMatrix`; the character code carries no reliable Unicode meaning at all. Treat Type 3 as read-only.

### Practical parsing

- **pdf-lib has no content-stream parser.** `PDFOperator`/`PDFOperatorNames` are write-side helpers, and the README states the library cannot "extract plain text on a page outside of a form field" nor supports "removing or editing text on a page outside of a form field." The community workaround is raw-bytes surgery: `page.node.dict.get(PDFName.of('Contents'))` → `pdfDoc.context.lookup(ref)` → `decodePDFRawStream(stream).decode()` (pdf-lib already bundles pako) — see discussion #1627 and issues #296, #564, #950, #1247. Commenters in #1627 flag exactly the two blockers: CMap-encoded text and Form XObjects.
- **pdf.js `getOperatorList()`** is the most robust free tokenizer in JS. `OPS` values are stable integers in `src/shared/util.js`: `save:10, restore:11, transform:12, beginText:31, endText:32, setCharSpacing:33, setWordSpacing:34, setHScale:35, setLeading:36, setFont:37, setTextRenderingMode:38, setTextRise:39, moveText:40, setLeadingMoveText:41, setTextMatrix:42, nextLine:43, showText:44, showSpacedText:45, paintXObject:66, paintFormXObjectBegin:74, paintFormXObjectEnd:75`. Caveat: `showText` args are **already-decoded glyph objects** (`fontChar`, `unicode`, `width`, `isSpace`, `isInFont`) with `TJ` numbers interleaved — not raw bytes (pdf.js #10939). Great for *finding* text, useless for reproducing original bytes.
- **pdf.js `getTextContent()`** yields items `{str, dir, width, height, transform:[a,b,c,d,e,f], fontName, hasEOL}`; `fontName` keys into the page's loaded-font objects. `height` is unreliable and `transform[3]` scaling is ambiguous (#8276, #8096, #15922).
- **MuPDF.js structured text** gives what you actually want for hit-testing: `page.toStructuredText("preserve-whitespace").asJSON()` returns `blocks[] → {type, bbox:{x,y,w,h}, lines[] → {wmode, bbox, font:{name, family, weight, style, size}, x, y, text}}`; a `preserve-spans` option and per-char output exist in the C core.

## Editing strategies

### Strategy A — Overlay whiteout + new text

Draw an opaque rect over the bbox, then `drawText` on top with an embedded font.

**Pros:** ~50 lines with pdf-lib, works on any PDF, never corrupts the file. **Cons:** the original glyphs remain — selectable, searchable, copyable, OCR-able, and revealed by deleting the rect. Also requires an exact bbox, and fails visually over table shading, gradients, or images. Sampling the background pixel from the pdf.js canvas is a decent mitigation for flat fills; it cannot work over patterns.

### Strategy B — Stream surgery (remove/replace the show operators)

```ts
type Tok = { op: string; args: (number|Uint8Array|Tok[])[] };
// 1. decode /Contents (concatenating an array of streams)
// 2. tokenize; simulate q/Q, cm, BT/ET, Tf, Tm/Td/TD/T*, Tc/Tw/Tz
// 3. for each Tj/TJ/'/" compute a per-glyph advance via
//    tx = ((w0 - adj/1000)*Tfs + Tc + Tw) * Th  and Trm
// 4. intersect glyph boxes with the user's selection
// 5. rewrite that show-op: split into  [keptPrefix] TJ ... [keptSuffix] TJ
//    (dropping only the selected glyph codes; preserve kern numbers you keep)
// 6. serialise; write back UNCOMPRESSED (drop /Filter, fix /Length)
```

Key details: a `Tj` that only partially overlaps the selection must be **split into up to three show ops**, and the surviving tail needs an explicit `Td`/`Tm` (or an inserted `TJ` adjustment) because you removed advance width. When *replacing* rather than deleting, re-encode the new string with the same font's encoding (byte per code for simple fonts, 2-byte GID for Identity-H) — only if every glyph exists in the subset. The `replace-text-pdf` tool is instructive here: it is "`TJ` aware" and, on a match, **discards the kerning numbers** and emits a single plain string, accepting the resulting spacing change. Keep every byte you did not target byte-identical (do not reformat, do not renumber resources), and remember `/Contents` arrays: token boundaries may fall on stream boundaries, so concatenate with whitespace before tokenizing. Recurse into `Do`-referenced Form XObjects with their own `/Resources`.

### Strategy C — Native engine editing

**MuPDF.js** (WASM, ESM-only, npm `mupdf`) is the only browser-viable *true redaction*:

```ts
const r = page.createAnnotation("Redact");
r.setRect([x0, y0, x1, y1]); r.update();
page.applyRedactions();   // irreversible
```

Signature: `applyRedactions(blackBoxes, imageMethod, lineArtMethod, textMethod)` with defaults `REDACT_IMAGE_PIXELS`, `REDACT_LINE_ART_REMOVE_IF_COVERED`, `REDACT_TEXT_REMOVE`; other constants are `REDACT_IMAGE_NONE|REMOVE|UNLESS_INVISIBLE`, `REDACT_LINE_ART_NONE|REMOVE_IF_TOUCHED`, `REDACT_TEXT_NONE`. Docs state redaction "permanently remove[s]" content and is "an irreversible action," and that any letter the rect *touches* is removed entirely. MuPDF has no text-*replacement* API — it is an eraser, not an editor.

**PDFium** (`fpdf_edit.h`) does have a page-object model: `FPDFPage_CountObjects` / `FPDFPage_GetObject` / `FPDFPageObj_GetType`, `FPDFTextObj_GetText` (experimental, UTF-16LE, needs an `FPDF_TEXTPAGE`), `FPDFText_SetText` ("Set the text for a textobject. If it had text, it will be replaced"), `FPDFText_SetCharcodes` (experimental), `FPDFPageObj_NewTextObj` (standard fonts only), `FPDFText_LoadFont` + `FPDFPageObj_CreateTextObj` (embedded font — the recommended path), `FPDFPageObj_Transform`, `FPDFPage_InsertObject`, `FPDFPage_RemoveObject` (experimental). **Hard requirement:** "Before you save the page to a file, or reload the page, you must call `FPDFPage_GenerateContent` or any changes will be lost." Documented rough edges: `FPDFPageObj_NewTextObj` can yield PDFs with no embedded font, regenerated content gets appended to the end of `/Contents`, and `FPDFPage_InsertObject` cannot insert at an index (chromium 389726697).

### Recommended default

**Redact/erase → Strategy C (MuPDF `applyRedactions`).** Cosmetic whiteout is a compliance liability, not a feature; ship real removal and label the cosmetic variant "cover" if you offer it at all. **Edit text → Strategy B with an A fallback.** Attempt in-place code substitution when the original font is embedded, non-Type3, and covers every new code point; otherwise delete the original show ops (B) and re-draw with an embedded fallback (which is A's rendering path without A's leak). Fall back to pure A only for Type 3 fonts, encrypted-permission cases, or unparseable streams — and warn the user.

## Font engineering

**Embedding (pdf-lib).** `pdfDoc.registerFontkit(fontkit)` then `await pdfDoc.embedFont(bytes, { subset: true })`. Measure with `font.widthOfTextAtSize(text, size)`, `font.heightAtSize(size, { descender })`, `font.sizeAtHeight(h)`; `font.getCharacterSet()` returns the supported code points and `font.encodeText()` produces the `PDFHexString`. Note the silent footgun: misspelling the option (`subSet`) type-checks in JS and yields a full, unsubsetted font (#1492).

The **standard 14** (Helvetica/Times/Courier × 4, Symbol, ZapfDingbats) need no embedding but only reach WinAnsi's ~218 Latin characters — anything else throws `Error: WinAnsi cannot encode "Ω" (0x03a9)` (#217, #548, #1152, #1759). Never use them as the fallback for user-typed text.

**Detection.** Combine pdf.js `getTextContent().items[].fontName` with the page's loaded font objects for name/type/embedded-ness, then read the font descriptor for the substitution decision: `/Flags` bits `FixedPitch`, `Serif`, `Symbolic`, `Italic`; `/ItalicAngle` (non-zero ⇒ oblique); `/StemV` (dominant vertical stem thickness ⇒ weight proxy) (PDF Reference §5.7.1). Name-substring heuristics ("Bold", "Semibold", "Italic", "Oblique", "Mono") are still worth running first because they are usually more accurate than `/StemV`.

**Coverage check.**

```ts
const prog = descriptor.get('FontFile2') ?? descriptor.get('FontFile3'); // TrueType | CFF/OpenType
const f = fontkit.create(decode(prog));           // Uint8Array is fine
const ok = [...newText].every(ch => f.hasGlyphForCodePoint(ch.codePointAt(0)!));
```

fontkit exposes `create(buffer)`, `hasGlyphForCodePoint`, `glyphForCodePoint`, `glyphsForString`, `layout(str, features)`, `characterSet`, `widthOfGlyph`, `unitsPerEm`, `italicAngle`, `capHeight`, and reads TTF/OTF/WOFF/WOFF2/TTC/dfont plus CFF outlines; MIT-licensed. Two caveats: (1) `/FontFile3` with `/Subtype /Type1C` or `/CIDFontType0C` is a **bare CFF table, not an sfnt** — fontkit and opentype.js generally need it wrapped in an OTTO sfnt shell first (pdfcpu #180, XeTeX RFE #8); (2) with opentype.js, `charToGlyph` throws and `charToGlyphIndex` returns `null` rather than 0 for default-encoding fonts (#735) — always guard. Also: for an Identity-H subset, `hasGlyphForCodePoint` is the wrong question unless the subset kept its `cmap`; verify against `characterSet`, and be ready to fall back.

**Bundled fallbacks** (lazy-load from `/public`, one family at a time):

| Font | Metric-compatible with | License | Size |
|---|---|---|---|
| Liberation Sans / Serif / Mono | Arial / Times New Roman / Courier New | SIL OFL 1.1 | ~108–136 KB per face |
| Carlito | Calibri (~2782 glyphs, Latin/Greek/Cyrillic) | OFL 1.1 / Apache-2.0 — **sources disagree**; verify the shipped `LICENSE` file | ~250 KB |
| Caladea | Cambria (~2000 glyphs) | same ambiguity | ~200 KB |
| Noto Sans | wide Unicode coverage | SIL OFL 1.1 | ~300 KB regular |

Metric compatibility is the point: Liberation glyphs are identical in width to their Monotype counterparts, so replacement text in an Arial document reflows identically (ArchWiki, Debian wiki). Do **not** rely on the license summaries above — Carlito/Caladea licensing is reported inconsistently across Google Fonts, Debian, and the crosextra package; read the bundled file.

**Fitting.** Given a target box width `W`: try `size` as-is; if `widthOfTextAtSize(t, size) > W`, first apply negative `Tc` down to about −2% of em, then shrink-to-fit by binary search on size with a floor (e.g. 60% of original, or 6 pt), then wrap or truncate with an ellipsis and surface an overflow badge. pdf-lib's `DrawTextOptions` officially documents only `x, y, size, font, color, rotate, xSkew, ySkew, graphicsState`; `characterSpacing`/`wordSpacing`/`horizontalScaling`/`textRise`/`textRenderingMode` came via PR #1216 — **check your installed version** before depending on them, or emit the `Tc`/`Tz` operators yourself via `page.pushOperators`.

## Coordinates

PDF user space: origin bottom-left, Y up, 1 unit = 1/72 inch. Page boxes (`/MediaBox`, `/CropBox`, `/BleedBox`, `/TrimBox`, `/ArtBox`) are `[llx lly urx ury]` rectangles defined in ISO 32000 §14.11.2; US Letter is `[0 0 612 792]`. `/Rotate` (multiple of 90) rotates the page for display *without changing the box dimensions* — so a 90°-rotated page has swapped visual width/height while `/MediaBox` is unchanged.

pdf.js: `page.getViewport({ scale, rotation, offsetX, offsetY, dontFlip })` builds a `PageViewport` from `viewBox` with a flipping transform like `[1, 0, 0, -1, 0, 841.89]`. Round-trip with `viewport.convertToPdfPoint(x, y)` (screen → PDF) and `convertToViewportPoint` / `convertToViewportRectangle` (PDF → screen).

```ts
function screenRectToPdf(r: DOMRect, vp: PageViewport) {
  const [ax, ay] = vp.convertToPdfPoint(r.left, r.top);
  const [bx, by] = vp.convertToPdfPoint(r.right, r.bottom);
  return { x: Math.min(ax,bx), y: Math.min(ay,by),
           width: Math.abs(bx-ax), height: Math.abs(by-ay) };
}
```

The `Math.min/max` normalization is mandatory: on rotated pages `convertToPdfPoint` can return `x1 > x2` (Nutrient blog, pdf.js #12003, #6471). Derive device pixel ratio as `canvas.width / canvas.clientWidth` rather than `window.devicePixelRatio`, since pdf.js caps render scale. Store all annotation/edit geometry in **PDF space**, and recompute on `scalechanging` / `rotationchanging` events.

## Known gotchas checklist

1. `/Contents` may be an array — concatenate with whitespace; tokens can straddle stream boundaries.
2. Streams are Flate-compressed; decode, edit, then either re-deflate or write uncompressed **and fix `/Length`** (and remove `/Filter`).
3. `Tj` bytes are font codes / 2-byte GIDs, never UTF-8. Never invert `/ToUnicode` to build them.
4. Subset fonts (`ABCDEF+Name`) lack most glyphs — check coverage before in-place replacement.
5. Text inside Form XObjects and annotation appearance streams needs recursive handling with per-XObject `/Resources`.
6. `Tf` names a resource key, valid only in the current resource dictionary — a new font must be added to `/Resources /Font`.
7. Partial-selection edits must split show ops and repair the advance (`Td`/`Tm`/`TJ` adjustment) or text after the edit shifts.
8. Kerning: dropping `TJ` numbers changes appearance even when the string is unchanged.
9. `Tz`, `Tc`, `Tw`, `Tr`, `Ts` all affect the advance and must be simulated; `Tw` applies only to single-byte code 32.
10. pdf.js `showText` args are decoded glyphs with interleaved numbers, not bytes (#10939); `getTextContent().height` is unreliable (#8276).
11. pdf.js `viewBox` derives from CropBox while pdf-lib draws relative to MediaBox — when `CropBox ≠ MediaBox` you must offset by the CropBox origin. **Verify this against your target files before shipping.**
12. Type 3 fonts: no reliable Unicode, glyphs are content streams — read-only.
13. Bare CFF (`/FontFile3`, `Type1C`/`CIDFontType0C`) needs sfnt wrapping before fontkit/opentype.js will parse it.
14. Standard-14 fonts throw on any non-WinAnsi character.
15. `subset: true` typos silently ship the whole font (#1492).
16. PDFium: `FPDFPage_GenerateContent()` is mandatory or edits vanish; regenerated content appends to `/Contents`.
17. MuPDF `applyRedactions` removes any glyph the rect *touches* and is irreversible — build a preview overlay first.
18. Whiteout ≠ redaction. Hidden text is searchable, copyable, and OCR-recoverable; treat the two as distinct product features with distinct UI language.
19. Encrypted PDFs: check `/Perms` before offering edit; pdf-lib requires `ignoreEncryption` and cannot re-encrypt.
20. Tagged PDF / `/StructTreeRoot` marked content (`BDC`/`BMC`/`EMC`) goes stale after stream surgery — accessibility regression risk.

## Flagged for verification before implementation

1. **Carlito/Caladea license** — OFL 1.1 vs Apache-2.0 is reported inconsistently across Google Fonts, Debian, and crosextra. Read the LICENSE in the actual files you bundle.
2. **pdf.js CropBox vs pdf-lib MediaBox origin mismatch** — could not be confirmed from a primary source; would silently offset every drawn rectangle on cropped pages. Test with a CropBox ≠ MediaBox fixture in the first spike.

## Sources

- https://pdf-issues.pdfa.org/32000-2-2020/clause09.html
- https://pdf-issues.pdfa.org/32000-2-2020/clause07.html
- https://github.com/mmorga/topobook/blob/master/documentation/PDF%20Text%20Handling%20and%20Metrics.md
- https://www.syncfusion.com/succinctly-free-ebooks/pdf/text-operators
- https://www.verypdf.com/document/pdf-format-reference/pg_0427.htm
- https://www.verypdf.com/document/pdf-format-reference/pg_0439.htm
- https://www.verypdf.com/document/pdf-format-reference/pg_0458.htm
- https://groups.google.com/g/adobe.acrobat.windows/c/6LZkdC7Thao
- https://pdfa.org/wp-content/uploads/2018/06/1530_Seggern.pdf
- https://wiki.pdftalk.de/doku.php?id=cmap
- https://www.glyphandcog.com/textext.html
- https://github.com/UglyToad/PdfPig/blob/master/font-notes.md
- https://github.com/LibrePDF/OpenPDF/issues/623
- https://pikepdf.readthedocs.io/en/latest/topics/content_streams.html
- https://blog.idrsolutions.com/what-are-form-xobjects/
- https://raw.githubusercontent.com/mozilla/pdf.js/master/src/shared/util.js
- https://raw.githubusercontent.com/Hopding/pdf-lib/master/src/core/operators/PDFOperatorNames.ts
- https://github.com/Hopding/pdf-lib/blob/master/README.md
- https://pdf-lib.js.org/docs/api/classes/pdffont
- https://pdf-lib.js.org/docs/api/interfaces/drawtextoptions
- https://github.com/Hopding/pdf-lib/discussions/1627
- https://github.com/Hopding/pdf-lib/issues/296
- https://github.com/Hopding/pdf-lib/issues/564
- https://github.com/Hopding/pdf-lib/issues/950
- https://github.com/Hopding/pdf-lib/issues/1247
- https://github.com/Hopding/pdf-lib/issues/1492
- https://github.com/Hopding/pdf-lib/issues/217
- https://github.com/Hopding/pdf-lib/issues/548
- https://github.com/Hopding/pdf-lib/issues/1152
- https://github.com/Hopding/pdf-lib/issues/1759
- https://github.com/Hopding/pdf-lib/pull/1216
- https://github.com/mozilla/pdf.js/issues/10939
- https://github.com/mozilla/pdf.js/issues/8096
- https://github.com/mozilla/pdf.js/issues/8276
- https://github.com/mozilla/pdf.js/issues/8598
- https://github.com/mozilla/pdf.js/issues/15922
- https://github.com/mozilla/pdf.js/issues/12003
- https://github.com/mozilla/pdf.js/issues/6471
- https://github.com/mozilla/pdf.js/issues/16127
- https://mozilla.github.io/pdf.js/api/draft/api.js.html
- https://www.nutrient.io/blog/pdfjs-coordinate-systems-pdf-to-screen/
- https://mupdfjs.readthedocs.io/en/latest/how-to-guide/annotations/redactions/index.html
- https://mupdfjs.readthedocs.io/en/latest/how-to-guide/document.html
- https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFPage.html
- https://github.com/ArtifexSoftware/mupdf.js/
- https://github.com/ArtifexSoftware/mupdf/commit/74cded5f48bee0bba964a0b6b040566e18f48055
- https://www.npmjs.com/package/mupdf
- https://artifex.com/blog/mupdfjs-with-npm
- https://raw.githubusercontent.com/prepare/pdfium/master/public/fpdf_edit.h
- https://groups.google.com/g/pdfium-reviews/c/iEJLh3oJwno/m/Vr78DEYNCwAJ
- https://groups.google.com/g/pdfium/c/VitvR3GgFX4
- https://issues.chromium.org/issues/389726697
- https://github.com/foliojs/fontkit
- https://www.npmjs.com/package/@pdf-lib/fontkit
- https://github.com/opentypejs/opentype.js/issues/735
- https://github.com/opentypejs/opentype.js/issues/480
- https://github.com/pdfcpu/pdfcpu/issues/180
- https://sourceforge.net/p/xetex/feature-requests/8/
- https://github.com/liberationfonts/liberation-fonts
- https://wiki.archlinux.org/title/Metric-compatible_fonts
- https://wiki.debian.org/SubstitutingCalibriAndCambriaFonts
- https://fonts.google.com/specimen/Carlito
- https://github.com/google/fonts/issues/1441
- https://www.fontsquirrel.com/fonts/noto-sans
- https://notofonts.github.io/noto-docs/website/use/
- https://www.fontsaddict.com/font/liberation-sans-regular.html
- https://github.com/rdp/replace-text-pdf
- https://wpsauce.com/how-to-white-out-information-in-a-pdf-without-accidentally-exposing-hidden-text/
- https://www.redactable.com/blog/how-to-white-out-on-pdf
- https://mapsoft.com/posts/pdf-page-boxes.html
- https://www.prepressure.com/pdf/basics/page-boxes
