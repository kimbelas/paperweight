# Research index

Five parallel deep dives, researched 2026-09-07 against live npm registry data, GitHub, MDN browser-compat-data, published `.wasm`/`.d.ts` files and vendor documentation. Every report ends with its full source list.

| # | Report | One-line conclusion |
|---|---|---|
| 01 | [Editing engines](01-editing-engines.md) | No open-source library edits existing text out of the box. `@embedpdf/pdfium` is the only permissive WASM build verified to expose PDFium's mutation API. MuPDF is AGPL. pdf-lib is unmaintained. Commercial SDKs do it, quote-priced. |
| 02 | [Signatures](02-signatures.md) | Six structurally different things are called "a signature". Annotations are cleanly removable; flattened images need content-stream editing; scans are pixels. Any edit invalidates a cryptographic signature by design. |
| 03 | [Viewer, print, save, packaging](03-viewer-print-save-packaging.md) | pdf.js 6.3 details and why not `react-pdf`; hidden-iframe print with canvas fallback; File System Access is Chromium-only, OPFS is everywhere; static export cannot set COOP/COEP so WASM stays single-threaded; Tauri v2 has no print API. |
| 04 | [Competitors and UX](04-competitors-and-ux.md) | Feature matrix of 11 editors; universal UI conventions; user pain points (upload, quotas, watermarks, font substitution, no reflow); a value-vs-difficulty MVP ordering. |
| 05 | [PDF internals and fonts](05-pdf-internals-and-fonts.md) | Content-stream text model; `Tj` bytes are glyph codes, not Unicode; three editing strategies; fontkit coverage checks; bundled fallback fonts and licences; coordinate math; 20-item gotcha checklist. |

## Cross-cutting conclusions that shaped PLAN.md

1. **Editing existing text requires an engine with a page-object model.** Only PDFium (permissive) and MuPDF (AGPL) offer one from JS. pdf.js and pdf-lib cannot do it and never will.
2. **One engine should own the document.** Mixing pdf.js for viewing with PDFium for editing doubles the WASM payload and forces a save-reload-rerender loop after every commit.
3. **Font subsets are the hard technical problem; line clustering is the hard product problem.** Coverage must be checked before reusing an embedded font; paragraph reflow is not attempted by anyone and is out of scope.
4. **Honesty is a feature.** Cover is not redact. Substitution is badged. Digital-signature invalidation is announced. Scans are labelled.
5. **Local-first is both the differentiator and the constraint.** Static export, no server, no headers, single-threaded WASM, Chromium-only save-in-place with download fallback elsewhere.

## Items flagged for verification during Phase 0

- `FPDFText_SetText` fidelity on real-world documents (spike S2).
- The old PDFium "removed objects reappear after save" bug (spike S3).
- Whether the `EPDF*` redaction functions are callable from the raw `@embedpdf/pdfium` module (spike S9).
- `CropBox ≠ MediaBox` coordinate handling (spike S7).
- Carlito/Caladea licence text in the actual font files before bundling.
- `@embedpdf/pdfium` licence wording (package says MIT, repo says Apache-2.0; both permissive).
