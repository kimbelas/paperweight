# Research 02 — Signatures inside PDFs: detection, removal, insertion

> Deep-dive research for the pdf-editor plan. Researched 2026-09-07. All claims cite sources in the final section.

## Summary

"Signature" in a PDF is not one thing — it's at least six structurally different things, and they need six different code paths. Only one of them (the `/FT /Sig` AcroForm field) is a *cryptographic* signature; the rest are ordinary drawing or annotation objects that merely *look* like a signature. The practical consequence for a browser editor: **detection is tractable and mostly reliable for annotation-based signatures, degrades to heuristics for flattened image signatures, and is impossible-in-principle for signatures baked into a scanned raster page.** Removal follows the same gradient. Adding a signature is comparatively easy, and the compatibility-safe default is to embed a PNG as an image XObject and draw it with `page.drawImage`.

One hard constraint governs everything: any byte-level modification outside an incremental update invalidates an existing cryptographic signature. There is no way to "remove someone else's digital signature and keep the document cryptographically valid" — that is the whole point of the mechanism. pdf-lib's `save()` rewrites the file wholesale, so *every* pdf-lib edit breaks existing signatures. Be explicit about this in the UI.

---

## 1. Signature taxonomy and detection heuristics

A digital signature is embedded as a form field whose field type `/FT` is `/Sig`, and whose field value `/V` is a signature dictionary holding the signature in its `/Contents` entry (iText, *Digital Signatures for PDF documents*). The `/ByteRange` array — typically `[0, a, b, c]`, meaning bytes `0..a-1` and `b..b+c-1` — declares which slice of the file the signature covers, and `/Contents` holds a DER-encoded PKCS#7 `SignedData` blob with the signer certificate and digest (PDF Association, *PDF Signature Validation*). Under PAdES, if `/SubFilter` is `/ETSI.CAdES.detached` or `/ETSI.RFC3161`, `/ByteRange` must cover the entire file except the `/Contents` value.

Annotation subtypes are enumerated in ISO 32000-2 §12.5.6.1, Table 171: `Text, Link, FreeText, Line, Square, Circle, Polygon, PolyLine, Highlight, Underline, Squiggly, StrikeOut, Stamp, Caret, Ink, Popup, FileAttachment, Widget, PrinterMark, TrapNet, Watermark, Redact, Projection`.

| # | Kind | Structure | Detection | Confidence |
|---|---|---|---|---|
| a | **Digital signature field** | AcroForm field `/FT /Sig`; `/V` → sig dict with `/Type /Sig`, `/Filter`, `/SubFilter`, `/ByteRange`, `/Contents`; visible ones have a `/Subtype /Widget` annot on the page with `/AP /N` | Walk `/Root /AcroForm /Fields` for `/FT /Sig`; or scan all objects for `/Type /Sig`. In pdf.js: `a.subtype === 'Widget' && a.fieldType === 'Sig'` | **Certain** |
| b | **Stamp annotation** | `/Subtype /Stamp` in page `/Annots`, `/AP /N` is a Form XObject usually wrapping an image XObject. What DocuSign / Adobe Fill&Sign typically emit | Enumerate `/Annots`, filter `Subtype === 'Stamp'`. Corroborate with `/Name` (`/Sig`-ish), `/T` title, `/NM`, aspect ratio | **High** |
| c | **Ink annotation** | `/Subtype /Ink`, `/InkList` = array of stroke point arrays | Filter `Subtype === 'Ink'`; count points/strokes | **High** |
| d | **FreeText (typed)** | `/Subtype /FreeText`, `/DA` default appearance with a script/cursive font | Filter `Subtype === 'FreeText'`; inspect `/DA` font name for cursive families | **Medium** — indistinguishable from an ordinary text note |
| e | **Flattened / drawn on page** | Image XObject `/Subtype /Image` invoked by `/Name Do` inside the page content stream, usually wrapped in `q … cm … Do … Q`; or raw vector path operators | Heuristics only (below) | **Low–Medium** |
| f | **Part of a scanned raster page** | One full-page image; signature is just pixels | Page has a single image XObject covering ~the whole MediaBox and little/no text | **Detectable as "unremovable"** |

### Heuristics for case (e), flattened image signatures

There is no reliable marker. Layer several weak signals:

1. **Aspect ratio and size.** Signatures are wide and short — roughly 2:1 to 6:1 — and typically 80–300 pt wide, well under a quarter page.
2. **Alpha / soft mask.** Signature PNGs almost always carry `/SMask` or `/Mask`; body illustrations often don't.
3. **Colorspace.** `/DeviceGray` or 1-bit `/ImageMask` is common for scanned ink.
4. **Proximity to a label.** Extract text with positions and look for `Signature`, `Signed by`, `Sgd.`, `/s/`, `Date`, or a long underscore run within ~40 pt above/below the image rect.
5. **Position.** Bottom third of the last page is the strongest single positional prior.
6. **Resource name hints.** Names like `/Sig`, `/Signature`, `/Im_sig`.
7. **Count.** A page with exactly one small transparent image near a signature label is a much stronger hit than one of forty images.

Get geometry from pdf.js by walking the operator list and tracking the CTM: watch for `pdfjsLib.OPS.transform` to capture the matrix and `pdfjsLib.OPS.paintImageXObject` to mark the paint, then `width = Math.abs(m[0])`, `height = Math.abs(m[3])` (pdf.js discussion #17919). Handle `OPS.save`/`OPS.restore` as a real matrix stack — the naive "last transform wins" version in that thread breaks on nested `q`/`Q`.

Note also a pdf.js quirk worth designing around: `annotation.js` marks `data.fieldType === 'Sig'` widgets as HIDDEN, so signature widgets don't render in the default viewer; and since ~v2.15, `fieldValue` for a `Sig` field is always `null`, so you cannot use it to distinguish signed from unsigned (pdf.js #15301). Test against `getAnnotations()` hanging on signature pages too (pdf.js #10347). To tell signed from unsigned, read `/V` yourself via pdf-lib or MuPDF.

---

## 2. Removal approach per type

### (a) Digital signature fields

Two objects to remove: the field entry in `/Root /AcroForm /Fields`, and the widget in the page's `/Annots`. In pdf-lib, `PDFForm.getFields()`, `getField(name)` and `removeField(field)` cover the field side; `form.acroForm` exposes the low-level `PDFAcroForm` when you need to edit `/Fields` directly. Also delete the now-orphaned signature dictionary from the indirect object table, and clear `/Root /Perms /DocMDP` if present.

Be honest in the UI: this destroys verifiability. PDF's mechanism for *non*-destructive change is the incremental update — appending changes after the signed bytes, which leaves the signed data untouched and is how multiple signatures are layered. Removal is not an appendable change. And under a certification signature the DocMDP level (part of the signed data, so untamperable) sets what's permitted: **P=1** no changes at all; **P=2** form fill-in, page templates, signing; **P=3** the above plus annotation create/delete/modify. In practice Acrobat Pro invalidates a certification on *any* post-certification change — even a DSS or document timestamp that ISO 32000-2 explicitly permits.

pdf-lib itself is deliberately out of the crypto business: *"pdf-lib does not currently provide any specialized APIs for creating digital signatures or reading the contents of existing digital signatures"* (PDFSignature docs).

### (b)–(d) Stamp / Ink / FreeText annotations

The easy tier. In pdf-lib, look up the array and splice it:

```ts
const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
// find index by inspecting each entry's Subtype/Rect, then:
annots.remove(idx);
// optionally: pdfDoc.context.delete(annotRef)
```

`page.node.Annots()` is the typed accessor; `pdfDoc.context.delete(ref)` drops the indirect object (pdf-lib #482, #529, #79).

MuPDF.js is cleaner and safer here: `page.getAnnotations()` then `page.deleteAnnotation(annot)`, with `getType()`, `getRect()`, `getOpacity()` for inspection (MuPDF.js annotations guide, PDFPage reference).

### (e) Flattened image / vector signatures — the hard case

You must edit the page content stream. Removing the XObject resource alone is not enough: the `Do` operator remains and readers may error or render nothing predictably. The correct edit removes the whole `q … cm … /Name Do … Q` block, then optionally drops the `/Resources /XObject /Name` entry once no other `Do` references it.

Complications documented in the wild: a page can have **multiple** `/Contents` streams; whitespace between `/Name` and `Do` is arbitrary; and the two tokens can even straddle a stream boundary — so **do not use a naive regex** (PyMuPDF discussions #1667, #2116). Concatenate all `/Contents` streams first, tokenize properly, then rewrite as a single stream.

pdf-lib **can** do this mechanically — `page.node.Contents()`, decode the stream, and write a replacement via `PDFRawStream`/flate stream — but it gives you **no content-stream parser**; pdf-lib does not expose text or operator content at all (pdf-lib #296). You would hand-roll a PDF operator tokenizer. That is a real, non-trivial subproject.

The alternatives:

- **MuPDF.js redaction** — the pragmatic winner. `page.createAnnotation("Redact")`, `annot.setRect([x0,y0,x1,y1])`, then `page.applyRedactions(blackBoxes, imageMethod, lineArtMethod, textMethod)`, which permanently removes content in the rect and then deletes the redaction annots. Crucially it has real image and line-art policies: `REDACT_IMAGE_NONE | REMOVE | PIXELS | UNLESS_INVISIBLE`, `REDACT_LINE_ART_NONE | REMOVE_IF_COVERED | REMOVE_IF_TOUCHED`, `REDACT_TEXT_NONE | REMOVE`. Pass `blackBoxes = false` and `REDACT_IMAGE_REMOVE` to delete a signature image without leaving a black rectangle. Licensing caveat: `npm i mupdf` is **AGPL v3 or a commercial licence from Artifex** — for a proprietary product, budget for the commercial licence.
- **PDFium WASM** — has `FPDFPage_RemoveObject` (ownership transfers to you; call `FPDFPageObj_Destroy`) and requires `FPDFPage_GenerateContent` before save. But there is a long-standing bug: removed objects reappear after save, because `FPDFPage_GenerateContent()` only regenerates streams for objects marked dirty by `FPDFPage_InsertObject()` and leaves pre-existing stream content untouched (pdfium bug 1051). Verify this on your build before betting on PDFium for removal.

### (f) Scanned raster pages

Not removable as an object — the ink is pixels. Only options: draw an opaque white rectangle over the region (cosmetic; the original pixels survive underneath), or genuinely re-encode. MuPDF's `applyRedactions` with `REDACT_IMAGE_PIXELS` does the honest version by rewriting the image data itself. Use that, not a white box, whenever the user's intent is redaction rather than visual tidying.

---

## 3. Adding signatures

**Input modes.** *Draw*: `signature_pad` (HTML5 canvas, variable-width Bézier interpolation; `toDataURL()`, `toSVG()`, `toData()`, `fromDataURL()`, `clear()`); or `perfect-freehand` when you want pressure-aware outlines as SVG paths. Capture Pointer Events (not mouse) and scale the canvas by `devicePixelRatio` — the single most common cause of blurry exported signatures. *Type*: render a cursive Google Font (Dancing Script, Great Vibes, Pacifico) and embed the TTF with `pdfDoc.registerFontkit(fontkit)` then `pdfDoc.embedFont(bytes, { subset: true })`; fontkit handles TTF/OTF/WOFF/WOFF2/TTC. Registering fontkit before embedding is mandatory, and a common error source (pdf-lib discussion #1480). *Upload*: accept PNG with alpha; for photographed signatures, draw to a canvas, read `getImageData`, and set `a = 0` where `min(r,g,b) > ~200` — but do it with a soft ramp (alpha proportional to darkness) rather than a hard threshold, or you get jagged aliased edges.

**Save strategies.**

| Strategy | API | Pros | Cons |
|---|---|---|---|
| **Flatten as image XObject** (default) | `pdfDoc.embedPng(bytes)` → `page.drawImage(img, { x, y, width, height, rotate, opacity })` | Renders and prints identically everywhere; can't be dragged off | Not later editable/removable by object deletion; raster |
| **Stamp annotation with `/AP /N`** | Build with `pdfDoc.context.obj({ Type:'Annot', Subtype:'Stamp', Rect:[…], AP: { N: apRef } })`; the AP is a Form XObject `{ Type:'XObject', Subtype:'Form', FormType:1, BBox:[0,0,w,h], Resources:{ XObject:{ Im0: image.ref } } }` created via `PDFRawStream.of(dict, bytes)` + `context.register(stream)`, then pushed onto `page.node.lookup(PDFName.of('Annots'), PDFArray)` (pdf-lib #475) | Cleanly removable/movable later; matches what DocuSign emits | Some viewers hide annots when printing; more code; you must get BBox/Matrix right |
| **Ink annotation from strokes** | `/Subtype /Ink` + `/InkList`; or MuPDF `page.createAnnotation("Ink")` | True vector, crisp at any zoom, small | Stroke width/appearance varies by viewer; needs an `/AP` for reliable rendering |

Recommendation: offer Stamp-annotation while the user is editing (so it stays movable), and flatten to an image XObject on final export, with a "keep editable" toggle. For the flatten step, `PDFForm.flatten()` makes each widget's current appearance part of its page's content stream and then removes all form fields and annotations — after which "its fields can no longer be accessed or edited". Filter out `/Sig` fields before calling it, and expect rough edges: `removeField` fails on some multiline fields (#1168), and flattened output can break subsequent certificate signing (#1757). Server-side, `qpdf --flatten-annotations=all` is a robust fallback — and its docs state plainly that it "invalidates and disables any digital signatures but leaves their visual appearances intact".

---

## 4. Digital signing note (advanced / recommend out of scope for v1)

Real cryptographic signing needs a two-pass dance: write a signature dictionary with a zero-filled `/Contents` placeholder and a provisional `/ByteRange`, serialize, compute the digest over the two byte ranges, build a **detached** PKCS#7 (`detached: true`, as Adobe requires), then patch the DER hex into the placeholder without changing file length. `@signpdf/signpdf` implements exactly this and ships placeholder helpers `@signpdf/placeholder-plain` and `@signpdf/placeholder-pdf-lib`; `pkijs` or `node-forge` can build the CMS in-browser, and `pdfsign.js` and `zgapdfsigner` are prior art. See also pdf-lib #112 on computing `/ByteRange`.

The blocker isn't the code, it's the key. You need an X.509 certificate from a CA in Adobe's AATL/EUTL trust list plus its private key. Shipping a `.p12` and passphrase into a browser tab is a security anti-pattern; WebCrypto non-extractable keys, smartcards and PKCS#11/HSM tokens are not reachable from page JS. If you need trusted signatures, do the signing server-side (or delegate to a remote signing service) and keep the browser as the placement UI. Also: pdf-lib's `save()` performs a full rewrite, so signing must be the *last* operation, appended as an incremental update.

## 5. Legal / UX notes

Across the US ESIGN Act (2000), EU eIDAS, and the Philippine E-Commerce Act, the shared principle is non-discrimination: a signature or contract cannot be denied legal effect solely because it is electronic. Under RA 8792 §8 a Philippine e-signature is valid where the method is unique to the signer, under the signer's sole control, linked to the record such that alteration is detectable, and shows intent to authenticate — so a drawn or typed signature generally suffices for ordinary commercial documents, and eIDAS reserves automatic wet-ink equivalence for *qualified* signatures only. Two UX obligations follow: capture an audit trail (timestamp, IP, consent, document hash) since the image itself carries no evidentiary weight, and warn clearly before any edit that would invalidate an existing cryptographic signature.

## Unverified caveat

The widely-repeated `n0`/`n2`/`FRM` layer naming for Adobe signature appearance XObjects — a useful detection hint — could **not** be confirmed on an official Adobe source. Adobe's *Custom Signature Appearances* documents only three user-facing components (signature graphic, signature details, watermark/logo) and notes that transparent backgrounds let the underlying watermark layer show through. Treat `FRM`/`n2` name matching as a soft heuristic, not a contract.

## Sources

- https://pdfa.org/wp-content/uploads/2020/07/2020-10-07_PDF-Signature-Validation_comp.pdf
- https://itextpdf.com/sites/default/files/2018-12/digitalsignatures20130304.pdf
- https://cdn.standards.iteh.ai/samples/75839/b0970522e8464fffa9081aa71b03ca6c/ISO-32000-2-2020.pdf
- https://www.adobe.com/devnet-docs/acrobatetk/tools/DigSigDC/Acrobat_DigitalSignatures_in_PDF.pdf
- https://www.adobe.com/devnet-docs/acrobatetk/tools/DigSigDC/appearances.html
- https://itextpdf.com/blog/itext-news-technical-notes/attacks-pdf-certification-and-what-you-can-do-about-them
- https://community.adobe.com/questions-9/acrobat-rejects-dss-additions-after-a-certification-signature-docmdp-p-1-no-changes-allowed-contrary-to-iso-32000-2-is-a-fix-on-the-roadmap-1625101
- https://www.gdpicture.com/blog/modify-signed-pdf/
- https://pdf-lib.js.org/docs/api/classes/pdfform
- https://pdf-lib.js.org/docs/api/classes/pdfpage
- https://pdf-lib.js.org/docs/api/classes/pdfsignature
- https://github.com/Hopding/pdf-lib
- https://github.com/Hopding/pdf-lib/issues/79
- https://github.com/Hopding/pdf-lib/issues/112
- https://github.com/Hopding/pdf-lib/issues/124
- https://github.com/Hopding/pdf-lib/issues/296
- https://github.com/Hopding/pdf-lib/issues/475
- https://github.com/Hopding/pdf-lib/issues/482
- https://github.com/Hopding/pdf-lib/issues/529
- https://github.com/Hopding/pdf-lib/issues/1168
- https://github.com/Hopding/pdf-lib/issues/1757
- https://github.com/Hopding/pdf-lib/discussions/1480
- https://www.npmjs.com/package/@pdf-lib/fontkit
- https://github.com/mozilla/pdf.js/discussions/17919
- https://github.com/mozilla/pdf.js/issues/10347
- https://github.com/mozilla/pdf.js/issues/15301
- https://github.com/mozilla/pdf.js/issues/16376
- https://medium.com/@4rn4udf/pdf-js-signature-not-showing-in-pdf-viewer-6113646760eb
- https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFPage.html
- https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFAnnotation.html
- https://mupdfjs.readthedocs.io/en/latest/how-to-guide/annotations/getting-started/index.html
- https://mupdfjs.readthedocs.io/en/latest/how-to-guide/annotations/redactions/index.html
- https://github.com/ArtifexSoftware/mupdf.js/blob/master/README.md
- https://groups.google.com/g/pdfium-bugs/c/RBwhmdbejRk
- https://github.com/klokantech/pdfium/blob/master/public/fpdf_edit.h
- https://pdfium.patagames.com/help/html/WorkingSDK_PageObjects.htm
- https://github.com/pymupdf/PyMuPDF/discussions/1667
- https://github.com/pymupdf/PyMuPDF/discussions/2116
- https://qpdf.readthedocs.io/en/stable/cli.html
- https://www.npmjs.com/package/signature_pad
- https://github.com/szimek/signature_pad
- https://github.com/CaptainCodeman/svelte-signature-pad
- https://www.npmjs.com/package/@signpdf/signpdf
- https://github.com/vbuch/node-signpdf
- https://github.com/Communication-Systems-Group/pdfsign.js
- https://github.com/zboris12/zgapdfsigner
- https://batasnatin.com/laws/e-commerce-act-ra-8792-electronic-contracts-and-digital-signatures
- https://helpx.adobe.com/legal/esignatures/regulations/philippines.html
- https://www.docusign.com/products/electronic-signature/legality/philippines
- https://www.scrive.com/resources/trust-centre/eidas-electronic-signatures
- https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/467109069/What+is+eSignature
- https://signb.ee/blog/e-signatures-law-eidas-esign-eca
