# Paperweight

A local-first PDF editor. Edit the text that is already in a document, remove
and add signatures, print and save. Everything runs in the browser on your own
machine: no upload, no account, no watermark, no quota.

**<https://paperweight.itskimmatthewbelas.workers.dev>**

**Status:** working. The editing engine is complete and tested; several UI
conveniences are still open. See `TASKS.md`.

## What works

- **Edit existing text.** Click a line and retype it. The original font is
  reused when it can render the new characters; otherwise a metric-compatible
  face is substituted and the substitution is reported rather than hidden.
- **Remove signatures.** Annotation signatures, signature form fields and
  signatures flattened into the page are all genuinely removed from the file.
  Signatures inside a scanned image cannot be, and the app says so instead of
  drawing a white box and calling it done.
- **Add signatures.** Draw, type in a script face, or upload a photo. The
  background is made transparent so it sits on the page rather than in a box.
- **Read a scan.** A scanned page has no text at all. It can be read on this
  device, with a confidence score per line, and a recognised line can be
  replaced by covering it and drawing over it. That is a patch, not an edit,
  and the app says so.
- **Move things.** Select any text or image and drag it.
- **Cover, add text, delete objects, rotate, print, save.**

## Deliberate limits

Text edits are line-scoped and never reflow, because PDF has no paragraph
model. On a scan, replacing text paints over the original: it looks clean on
plain paper, patched on a grey or textured scan, never matches the original
typeface, and leaves the covered pixels in the file. Editing a digitally
signed document invalidates the signature, which is the mechanism working as
designed. Saving over the original file needs the File System Access API, so
outside Chromium the app downloads a copy instead. Nested images and shapes
cannot be moved, only nested text.

## Running it

```
pnpm install
pnpm dev          # http://localhost:3000
```

```
pnpm test         # 163 engine tests, driving the real PDFium WASM
pnpm test:e2e     # 55 browser tests against the built static export
pnpm build        # produces out/, a folder of static files
```

`pnpm build` emits a plain static site. It can be hosted anywhere, and one of
the browser tests serves it with nothing but a static file server to prove it.

## Deploying

`out/` deploys to Cloudflare Workers as static assets. The Worker is described
in `wrangler.jsonc`. Response headers, including a Content-Security-Policy that
pins the build's inline scripts by hash, come from `out/_headers`, which
`scripts/write-headers.mjs` writes after every build.

```
pnpm test:e2e:deploy   # the browser suite against wrangler dev, headers included
pnpm preview           # serve the last build the way Cloudflare will
pnpm exec wrangler deploy
```

CI (`.github/workflows/ci.yml`) does the same on every push: typecheck, engine
tests, build, browser tests against `wrangler dev`, then `wrangler deploy` of
the tested `out/` on `main`, or a preview URL posted on a pull request. It
needs two repository secrets: `CLOUDFLARE_API_TOKEN`, a token with the
"Workers Scripts: Edit" permission, and `CLOUDFLARE_ACCOUNT_ID`.

## Layout

| Path | What it is |
|---|---|
| `PLAN.md` | The plan: decisions, architecture, roadmap |
| `CLAUDE.md` | Hard rules for working in this codebase |
| `docs/spikes.md` | What the risk-reduction spikes found |
| `docs/research/` | Five research reports, ~250 cited sources |
| `src/engine/` | PDFium, in a worker. The only place that touches PDFium |
| `src/editor/` | React UI |
| `src/ocr/` | Reading scans with tesseract.js |
| `src/io/` | Files, printing and local storage |
| `src/site.ts` | Every public-facing string: landing copy, head, structured data |
| `fixtures/` | Hand-built PDFs pinning the structural edge cases |
| `tests/deploy/` | Browser tests that only make sense with the deployment's headers |
| `wrangler.jsonc` | The Cloudflare deployment, as code |
| `.github/workflows/ci.yml` | Test, build and deploy on every push |

## Licences

PDFium is BSD-3-Clause and its wrapper `@embedpdf/pdfium` is MIT. tesseract.js
and its OCR core are Apache-2.0. The bundled fonts (Liberation, Dancing
Script, Great Vibes, Caveat) are SIL OFL 1.1, with their licence files in
`public/fonts/`. No AGPL dependencies, which is why PDFium is used rather than
MuPDF.

Both engines would fetch assets from a CDN by default. All of them — the PDF
WASM, the OCR worker, its core and its language model — are served from
`public/`, so the app works offline and makes no outbound requests. Three
browser tests hold that in place.
