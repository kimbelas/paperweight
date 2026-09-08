# Research 04 — Competitive and UX analysis of simple online PDF editors

> Deep-dive research for the pdf-editor plan. Researched 2026-09-07. All claims cite sources in the final section.

## Summary

The market splits cleanly into three groups, and the split is defined by one capability: **editing existing text**.

1. **True existing-text editors** — Sejda, Adobe Acrobat (Pro only), iLovePDF (recently added), Xodo, pdfFiller, Canva (via conversion), Stirling-PDF 2.0 (alpha, paid). None of them re-flow paragraphs; nearly all are line- or block-scoped, and all substitute fonts when the original isn't installed/embedded.
2. **Overlay-only editors marketed as "editors"** — PDFescape free, Smallpdf free, PDF24, SimplePDF, most pdf.js-based tools. You add text/whiteout/shapes *on top of* the page. PDF24 says so outright: "Editing the text in a PDF is not an easy thing to do, because the PDF format is not a good format for editing."
3. **Repurposed general tools** — LibreOffice Draw, Inkscape, Google Docs. Full text editing, catastrophic layout fidelity.

The single biggest strategic finding for a self-built app: **almost every hosted tool uploads your file to a server**, and the ones that don't (SimplePDF, Xodo's rendering layer, LocalPDF) are exactly the ones that *can't* edit existing text. A local-first app that does line-level existing-text editing would sit in a genuinely empty quadrant.

Second finding: **"remove an existing signature" is not one feature, it's three**, depending on whether the signature is an annotation, a flattened image in the content stream, or a cryptographic signature. Every competitor conflates them and users get burned.

---

## Per-product notes

### 1. Sejda PDF Editor — the closest model to replicate
Text tool: click directly on existing text to edit it, with bold/italic, font size, family, colour, plus find-and-replace across the document. It auto-detects the original typeface and offers substitutes when the font is rare.

**Critically, it does not re-flow.** Reviews report you can only select one line/sentence at a time; added text doesn't wrap to the next line but creates a new line that overlaps existing content, and editing a whole paragraph is "a nightmare" (thebusinessdive, techradar). Scanned documents are explicitly unsupported.

Other tools: whiteout rectangles, shapes (ellipse/rect/line/arrow), images (drag to move, corner-drag to resize), hyperlink add/edit, annotations (highlight/underline/strikeout/freehand), form filling **and** form-field creation with tab-order editing, signatures via type-in-handwriting-style / draw / upload image, page reorganisation.

Free tier: "documents up to 200 pages or 50 MB and 3 tasks per hour", 5 MB per image, one file at a time, 10 pages for OCR, 20 pages for some conversions. Server-side; uploads and outputs are "permanently deleted after upload or processing", shared links auto-delete after 7 days. **Sejda Desktop processes locally and uses system fonts** — a tacit admission that server-side font access is the fidelity bottleneck. Pricing: $5 week pass, $7.50/mo web, $63/yr Desktop+Web.

### 2. PDFescape
Free online tier: add text, shapes, **whiteout**, form filling, basic form design, annotations, links, images, password protection, page crop/deskew/move/delete/insert. **"Edit existing text and images" is explicitly a Premium Desktop feature**, and redaction/e-signatures are Ultimate Desktop. Free limits: 10 MB and 100 pages. Ad-supported. UX is a legacy tabbed ribbon (Insert / Annotate / Page) with a left page-thumbnail rail — dated but the tab metaphor is very discoverable.

### 3. Smallpdf Edit PDF
Free = "add text, images, highlights, and drawings"; **"direct PDF text editing requires a Pro subscription"** via a separate *Edit Text* tab. Free plan is capped at **two tasks/documents per day**; files auto-delete after 1 hour. Pro is $15/mo or $108/yr ($12/user/mo for teams) and adds unlimited tasks, no ads, no watermarks, batch, desktop app, 24-hour retention. Server-side over TLS. Their own signature-removal guide is the canonical overlay workflow: select the signature, press Delete or the trash icon; if the PDF blocks editing, Unlock first; if nothing is selectable, Flatten then cover the area.

### 4. iLovePDF Edit PDF
Historically overlay-only, but the advanced editor now claims you can **"modify text already inside the PDF"** including font type, size, colour and hyperlinks *without conversion*, plus create form fields (signature, text, checkbox, radio, list), attachments, bookmarks and annotations. Third-party analysis disputes the depth, reporting you can only place new elements over embedded text. Free tier has per-tool size caps (15–200 MB) and per-tool monthly task counts (e.g. 1 split, 2 compress); Premium is $4/mo billed annually ($48/yr) or $7/mo, raising caps to 4 GB. Server-side. UX includes z-order controls (send to back/front) — worth copying.

### 5. Adobe Acrobat online / web
Not signed in: annotate but **cannot download or share**. Signed-in free: comments, sticky notes, highlight/underline/strikeout, text boxes, freehand, Fill & Sign, download/share, 25+ tools. **Editing existing text is Pro-only.** Pricing: Standard $14.99/mo and Pro $19.99/mo on annual billing, $24.99/$29.99 month-to-month; 7-day trial.

Adobe documents the font rule everyone else hides: *you can edit text only if the font is installed on your system; if it's embedded but not installed you can only change colour or size; if it's neither installed nor embedded you can't edit at all* — producing the notorious "All or part of the selection has no available system font" error, with Minion Pro as the Roman-script fallback. UX: centred document pane at optimal zoom, a customisable right rail split into navigation (top) and zoom/view (bottom), and a **floating quick-tools widget**.

### 6. pdfFiller
Type or delete text, highlight, blackout, add images, draw; signatures by draw/type/upload plus role-based eSignature routing. 30-day trial **requires a credit card** and auto-renews; $8/$12/$15 per month annually vs $20/$30/$40 monthly. Reputationally the weakest: sustained complaints about surprise charges, cancellation difficulty and refunds (Trustpilot, PissedConsumer, ComplaintsBoard).

### 7. Xodo
Add **and edit** text, insert images, annotate, fill forms, sign, merge/split/delete/rotate/rearrange, crop, redact, compress — built on the commercial Apryse SDK with "fully client-side rendering". Free web is **one action per day**; the 3-day trial requires a payment method; $7.99/mo billed yearly (~$96/yr) or $10.99 monthly.

### 8. Canva & Google Docs (conversion approaches)
Canva decomposes an imported PDF into editable elements: up to 500 pages, 300 MB, 1,400 elements; **unsupported fonts are replaced with similar fonts**; scanned PDFs import as a single flattened image and can't be edited; elements often land in the wrong place. Google Docs (right-click → Open with → Google Docs) gives full text editing but complex layouts, special fonts and graphics don't survive — a recurring support-forum complaint. Both are *reconstruction*, not editing.

### 9. Open-source / self-hosted
- **Stirling-PDF**: 50+ tools, runs as desktop app, in-browser, or self-hosted, "without sending documents to external services"; open-core. The Content & Editing docs list Add Text, Add Stamp, Add/Extract/Remove Images, Remove Annotations, metadata — **no edit-existing-text**. v2.0 (Dec 2025) shipped text editing as an **alpha, paid-users-first** feature alongside a UI redesign with upload-once/multi-action, undo/redo and version history; free for individuals and teams ≤5, server licence $99/mo or $1,000/yr. Their own maintainers call full text editing one of the hardest features to implement (discussion #1262).
- **PDF24 Tools**: 25+ tools, "free of charge and without any restrictions", "no artificial limits", no registration; editor does text/images/forms/freehand with brush controls. Server-side (Germany), SSL, files deleted after 1 hour; **PDF24 Creator desktop keeps everything on your PC**.
- **LibreOffice Draw**: text fragments into many boxes; no auto-wrap, so added words push past the margin or overlap and you must manually resize boxes and shift lines; missing proprietary fonts get substituted, changing spacing; hyperlinks and form fields often don't survive.
- **Inkscape**: SVG is single-page, so one page at a time; the Poppler/Cairo importer outlines text to paths (uneditable as text), the internal importer gives editable text but shifts complex fonts.
- **EmbedPDF**: MIT-licensed, framework-agnostic (vanilla/React/Vue/Svelte), fully client-side, ships both a ready-made viewer and headless components.
- **pdf.js**: renders annotations and now offers basic annotation *editing* (FreeText, Highlight, Ink, Stamp) but no content-text editing; richer annotation/signature stacks require extensions or commercial PDF.js Express.
- **pdf-lib**: creates/modifies PDFs in-browser but does not render or extract formatted text layout; a feature-rich editor "requires significant effort".

### 10. SimplePDF
The purest local-first reference point: **"All processing happens in your browser — your documents never leave your device"**, 100% free, no signup, no ads, no data collection. Tools: text, signature, image, checkbox, form fill — plus a **"Backgrounds"** tool described as a way to "white out existing text before adding your own", i.e. the honest overlay workaround. It is additive only; there is no existing-text editing. Monetisation is entirely B2B embedding: Basic $99/mo, Pro $349/mo, Premium $899/mo, delivered as a React component or iframe.

---

## Feature matrix

Y = yes/free · P = partial, paid-gated, or workaround · N = no

| Feature | Sejda | PDFescape | Smallpdf | iLovePDF | Acrobat web | pdfFiller | Xodo | Canva | Stirling | PDF24 | SimplePDF |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Edit **existing** text | Y | P (paid desktop) | P (Pro) | P (claimed) | P (Pro) | Y | Y | P (reconstructed) | P (alpha, paid) | N | N |
| Text re-flow / wrap | N | N | N | N | P (in-box) | N | P | Y | N | – | – |
| Add new text overlay | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Whiteout / erase | Y | Y | P | P | P | Y | Y | Y | P | P | Y |
| Add signature (draw/type/upload) | Y | P (Ultimate) | Y | Y | Y | Y | Y | P | Y | P | Y |
| Remove existing signature | P | P | P | P | P | P | Y | P | P | P | P |
| Add images | Y | Y | Y | Y | P (Pro) | Y | Y | Y | Y | Y | Y |
| Annotate (highlight/draw/shapes) | Y | Y | Y | Y | Y | Y | Y | P | P | Y | P |
| Fill forms | Y | Y | P | Y | Y | Y | Y | N | P | P | Y |
| Create form fields | Y | Y | N | Y | P (Pro) | Y | P | N | P | Y | N |
| Reorder / delete / rotate pages | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | N |
| Merge / split | Y | P (Premium) | Y | Y | Y | Y | Y | N | Y | Y | N |
| Compress | Y | P | Y | Y | Y | N | Y | N | Y | Y | N |
| Print | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Download without account | Y | Y | Y | Y | **N** | N | P | N | Y | Y | Y |
| Client-side only (no upload) | N (desktop: Y) | N | N | N | N | N | P | N | Y (self-host) | N (desktop: Y) | **Y** |
| Free, no watermark, no signup | P | P | P | P | N | N | P | N | Y | **Y** | **Y** |

---

## UX conventions users will expect

**Layout.** A three-zone shell is universal: top horizontal tool strip, centred document canvas at fit-width zoom, and a collapsible **left page-thumbnail rail** for navigation/reordering. Adobe moved navigation to a customisable right rail and added a **draggable floating quick-tools widget**; users pushed back and asked for thumbnails on the left, which tells you which convention to follow.

**Toolbar tool set.** The near-universal ordered list is: Select/Hand → Text → Image → Signature → Whiteout/Erase → Shapes → Draw/Freehand → Highlight/Underline/Strikeout → Links → Form fields → Pages. Sejda and PDFescape both group these; PDFescape's tabbed ribbon (Insert / Annotate / Page) is the most discoverable framing for non-experts.

**Entering edit-text mode.** Pick the Text tool, then **single-click directly on existing text** — the run under the cursor becomes an editable box with a caret; a floating context toolbar appears near the selection with font family, size, colour, B/I/U. Clicking empty canvas with the Text tool creates a *new* box instead. Users expect double-click-to-edit on an object they created. Expect complaints if selection granularity is a single line rather than a paragraph.

**Whiteout/erase.** Drag a rectangle; it fills with white (or sampled page background) and sits above content as a movable, resizable object — not a destructive edit. Users assume it's a real erase; it isn't, which matters for redaction claims. SimplePDF's "Backgrounds → white out existing text before adding your own" is the pattern named most plainly.

**Signature placement.** A modal with three tabs — **Draw** (canvas), **Type** (pick a handwriting font), **Upload** (transparent PNG) — plus "save for reuse". Insert drops the signature as a floating object; drag to position, corner handles to scale proportionally, a rotate handle sometimes, and a trash/× badge on selection. Removal of an existing signature is the same interaction inverted: click it, press Delete or hit the trash icon.

**Editing chrome.** Ctrl/Cmd+Z / Shift+Z undo-redo, marquee and shift-click multi-select, arrow-key nudge, z-order controls (iLovePDF's send-to-back/bring-to-front), zoom −/+/fit-width/fit-page with Ctrl+scroll, and page X of Y with prev/next.

**Save/download/print.** A single primary green/blue button top-right labelled "Apply changes" or "Save" that resolves to a download step; a secondary Print action; and no auto-save (these are one-shot task tools). Stirling 2.0's "upload once, run many actions without re-uploading" plus version history is the newest and best convention here.

---

## User pain points — your differentiators

1. **Upload/privacy.** Every mainstream free tool ships your document to someone's server. Testers put it bluntly about Smallpdf/iLovePDF: free tiers "limit daily tasks and push hard toward subscriptions — and your files travel to their servers". Practitioners note that uploaded documents may be readable by the operator, are not necessarily stored encrypted, and are exposed if breached — which is why sensitive-document workflows go desktop. An entire micro-category (LocalPDF, PDFtool.org) now exists purely on the "never uploads" promise — but none of them edit existing text.
2. **The paywall ambush.** "You spend twenty minutes carefully adjusting the layout… You click 'Export,' only to find a giant, colorful vendor logo stamped right across the center." Roughly half of the top-ranked "free PDF editor" results watermark output, and others gate download behind an account. Adobe's web editor is the canonical sign-up wall: you can edit without an account but **cannot download**.
3. **Task quotas that don't survive one real job.** Xodo: 1 action/day. Smallpdf: 2/day. Sejda: 3/hour + 200 pages + 50 MB. iLovePDF: 1 split/month on free. A single invoice fix can burn the whole allowance.
4. **Font substitution destroying layout.** The most-reported quality failure. Acrobat refuses outright ("no available system font") when a font is neither installed nor embedded; LibreOffice silently substitutes and shifts character spacing; Canva "may replace unsupported fonts with similar fonts"; Sejda's font library "might not offer an exact match".
5. **No re-flow, so any real edit breaks the page.** Sejda creates an overlapping new line rather than wrapping; LibreOffice pushes text past the margin and requires manual box resizing. Users expect Word and get a layout engine that can't wrap.
6. **Scanned PDFs silently fail.** Sejda says changing existing text in scanned documents is unsupported; Canva flattens them to one image. Users don't know their PDF is a scan until nothing is selectable.
7. **Billing dark patterns.** pdfFiller's credit-card-required 30-day trial with auto-renewal generates persistent complaints about surprise charges and hard cancellation; Xodo's trial also demands a payment method.
8. **Signature removal is a trap.** Users can delete their *own* drawn/typed/image signature by selecting it and pressing delete — but flattened signatures require unlock-then-flatten-then-cover, and certificate-based digital signatures cannot be removed at all; you must ask the signer or get a fresh copy.

**Positioning:** local-only processing, no account, no watermark, no quota, honest labelling of what erase vs. redact actually does, and line-level existing-text editing that reuses the PDF's *embedded* font rather than substituting.

---

## Recommended MVP scope

**Architecture decision first:** render with **pdf.js** (or EmbedPDF's headless components, MIT) for display and `getTextContent()` geometry; keep every user change as an **immutable operation list** (command pattern) over an overlay layer; only "bake" into the PDF with **pdf-lib** + `@pdf-lib/fontkit` at export. This gives free undo/redo, non-destructive editing, and a trivial print path (export bytes → blob URL → print), and keeps everything client-side.

**Phase 1 — Shell (high value, low difficulty)**
1. Local file open (drag-drop + File System Access API), never uploaded. *This is the whole differentiator; ship it first and say so on the canvas.*
2. Render, page nav, zoom (fit-width/fit-page/Ctrl+scroll), left thumbnail rail.
3. **Download** (pdf-lib save) and **Print** (export → browser print of the real PDF, not the DOM).
4. Undo/redo over the operation list.

**Phase 2 — The must-haves (high value, low-to-moderate)**
5. **Whiteout rectangle** — `drawRectangle` in white; near-trivial and unblocks every hard case below. Label it "cover", not "redact".
6. **Add text box** — bundled standard-14 + Liberation/Noto, embedded as subsets.
7. **Add signature** — draw (canvas → transparent PNG), type (bundled script font), upload image; insert as a draggable object with proportional corner handles and a saved-signatures list.
8. **Remove existing signature** — implement as a *tiered* feature and be explicit in the UI: (a) if it's a widget/stamp **annotation**, delete it from the page's annotation array — clean and truly removed; (b) if it's an image XObject drawn in the content stream, offer real removal by dropping the `Do` operator for that XObject; (c) otherwise fall back to whiteout, and warn that the pixels remain in the file. Detect and refuse gracefully on certified/digitally-signed PDFs.

**Phase 3 — Existing-text editing (highest value, highest difficulty)**
9. Extract text runs from pdf.js (`str`, `transform`, `width`, `fontName`), cluster into lines by baseline and x-order, hit-test clicks, and show an editable overlay box with a floating font/size/colour toolbar.
10. On export: cover the original run's bounding box, then draw the replacement string. **Try to extract and re-embed the PDF's own embedded font** for the run (best fidelity); fall back to a metric-compatible bundled font and surface a visible "font substituted" badge rather than failing silently like Acrobat or lying like LibreOffice.
11. Ship **line-scoped, no re-flow** — same contract as Sejda, which reviewers accept for typo fixes. Do not promise paragraph editing.
12. Detect image-only pages and tell the user up front: "this page is a scan; text editing is unavailable."

**Phase 4 — Cheap wins (moderate value, low difficulty via pdf-lib)**
13. Page operations: delete, rotate, reorder (drag in the thumbnail rail), insert blank.
14. Merge and split.
15. Add image.

**Phase 5 — Later**
16. Annotations (highlight/underline/strikeout/freehand/shapes) — moderate; highlight over real text needs the same run geometry as #9, so it's cheap once #9 exists.
17. Form filling — pdf-lib has an AcroForm API; moderate.
18. Compress (canvas re-encode/downsample of embedded images) — feasible but fiddly.
19. True redaction (remove glyphs/pixels then rasterise the region) — hard; only ship if you'll stand behind the word.
20. OCR (tesseract.js) — heavy bundle; defer.

**Explicitly out of MVP:** re-flowing paragraph editing, digital-certificate signing/validation, cloud sync, collaboration.

---

## Sources

- https://www.sejda.com/pdf-editor
- https://www.sejda.com/help
- https://www.sejda.com/privacy
- https://www.sejda.com/desktop
- https://www.sejda.com/upgrade
- https://www.capterra.com/p/164130/Sejda-PDF/pricing/
- https://www.trustradius.com/products/sejda/pricing
- https://www.techradar.com/reviews/sejda
- https://thebusinessdive.com/sejda-pdf-editor-review
- https://updf.com/edit-pdf/sejda-pdf-editor/
- https://www.oreateai.in/productivity/how-to-use-sejdacom-pdf-editor-to-edit-existing-text-and-sign-documents
- https://www.pdfescape.com/
- https://www.pdfescape.com/what/features/
- https://www.pdfescape.com/what/premium/
- https://support.pdfescape.com/hc/en-us/articles/360028432531-Are-there-any-Limits-for-PDFescape-Online-File-Size-Page-Count-Images
- https://en.wikipedia.org/wiki/PDFescape
- https://smallpdf.com/edit-pdf
- https://smallpdf.com/pricing
- https://smallpdf.com/blog/how-to-remove-signature-from-pdf
- https://aiproductivity.ai/pricing/smallpdf/
- https://www.g2.com/products/smallpdf/pricing
- https://www.ilovepdf.com/edit-pdf
- https://www.ilovepdf.com/pricing
- https://www.ilovepdf.com/blog/new-advanced-pdf-editing-ilovepdf
- https://www.ilovepdf.com/blog/edit-pdf-text
- https://www.pdftechno.com/blogs/ilovepdf-vs-smallpdf-vs-pdftechno-which-one-makes-the-most-sense
- https://www.adobe.com/acrobat/online/pdf-editor.html
- https://helpx.adobe.com/acrobat/using/edit-text-pdfs1.html
- https://helpx.adobe.com/acrobat/kb/error-no-available-system-font.html
- https://helpx.adobe.com/acrobat/learn-new-acrobat.html
- https://www.adobe.com/acrobat/hub/cant-remove-signature-from-pdf.html
- https://xodo.com/blog/adobe-acrobat-pricing-explained
- https://www.pdffiller.com/
- https://www.capterra.com/p/162654/PDFfiller/pricing/
- https://ecommerceparadise.com/pdffiller-pricing-2026-paying-monthly-costs-2-5x-more/
- https://www.trustpilot.com/review/pdffiller.com
- https://pdffiller.pissedconsumer.com/review.html
- https://www.complaintsboard.com/pdffiller-b124811
- https://xodo.com/pdf-editor
- https://xodo.com/pricing
- https://xodo.com/blog/xodo-plans-explained
- https://xodo.com/blog/how-to-remove-signature-from-pdf
- https://www.canva.com/pdf-editor/
- https://www.canva.com/help/import-and-edit-pdfs-canva/
- https://talkbitz.com/how-to-edit-a-pdf-file-in-canva/
- https://support.google.com/docs/thread/420400403/pdf-formatting-breaks-when-opening-in-google-docs-after-conversion?hl=en
- https://support.google.com/docs/thread/19391461/how-can-i-retain-formatting-when-importing-a-pdf-into-google-docs?hl=en
- https://tomsguide.com/computing/how-to-edit-a-pdf-in-google-docs
- https://github.com/Stirling-Tools/Stirling-PDF
- https://docs.stirlingpdf.com/Functionality/Content-Editing/
- https://github.com/Stirling-Tools/Stirling-PDF/discussions/1262
- https://www.opensourceforu.com/2025/12/stirling-pdf-2-0-brings-text-editing-and-enterprise-tools-to-open-source/
- https://stirlingpdf.io/
- https://www.swifdoo.com/blog/stirling-pdf
- https://tools.pdf24.org/en/
- https://tools.pdf24.org/en/edit-pdf
- https://updf.com/edit-pdf/edit-pdf-with-libreoffice/
- https://www.wps.com/blog/libreoffice-pdf-editor-how-to-edit-pdfs-free-in-draw/
- https://www.dedoimedo.com/computers/pdf-edit-files-libreoffice-draw.html
- https://bugs.launchpad.net/bugs/1506043
- https://inkscape.org/forums/beyond/importing-multi-page-pdf-with-cairo-importer/
- https://answers.launchpad.net/inkscape/+question/142135
- https://logosbynick.com/edit-a-pdf-in-inkscape/
- https://www.embedpdf.com/
- https://pdfjs.express/
- https://pdfjs.express/documentation/signature/overview
- https://github.com/Laomai-codefee/pdfjs-annotation-extension
- https://pdf-lib.js.org/
- https://github.com/Hopding/pdf-lib
- https://www.nutrient.io/blog/how-to-build-a-javascript-pdf-editor/
- https://www.nutrient.io/blog/javascript-pdf-libraries/
- https://simplepdf.com/
- https://simplepdf.com/help
- https://simplepdf.com/help/faq/how-to-edit-pdf
- https://techno360.in/best-free-pdf-editors-windows-no-watermark/
- https://techjournal.org/best-free-pdf-editors-2026
- https://www.raptorpdf.com/blog/best-free-pdf-editor-online-2026.html
- https://localpdf.org/
- https://local-pdf.com/about/
- https://news.ycombinator.com/item?id=45508184
- https://alternativeto.net/software/pdftool-org/
- https://pdf.net/blog/how-to-remove-signature-from-pdf
