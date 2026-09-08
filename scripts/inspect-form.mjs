/**
 * Report the *structure* of a PDF's form fields, and nothing else.
 *
 *   node scripts/inspect-form.mjs "path/to/form.pdf"
 *
 * Deliberately prints no field values and no page text. A filled form is
 * somebody's passport number, address and date of birth; none of that is
 * needed to work out why a field draws the way it does. What is needed is the
 * geometry and the three dictionary entries that decide how an appearance is
 * rebuilt:
 *
 *   /DA      the default appearance. `0 Tf` means auto-size, which PDFium
 *            resolves to the box height — the cause of an edited field coming
 *            back in much larger type than its neighbours.
 *   /Ff      field flags. Bit 25 is Comb: with /MaxLen it spreads one
 *            character per cell across the whole box, which is what evenly
 *            spaced letters look like.
 *   /AP      the existing appearance stream. Its own `Tf` says the size the
 *            value is really drawn at today.
 *
 * Field names are shown only when they are not machine-generated; otherwise
 * they are replaced by an index, since a name like `dhFormfield-6597933572`
 * identifies nothing anyway.
 */

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const require = createRequire(import.meta.url);
const { init } = await import('@embedpdf/pdfium');

const AP_NORMAL = 0;
const FLAG_READONLY = 1 << 0;
const FLAG_MULTILINE = 1 << 12;
const FLAG_COMB = 1 << 24;

const FIELD_KIND = {
  0: 'unknown',
  1: 'push button',
  2: 'checkbox',
  3: 'radio',
  4: 'combo box',
  5: 'list box',
  6: 'text',
  7: 'signature',
};

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/inspect-form.mjs "path/to/form.pdf"');
  process.exit(2);
}

const wasm = await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
const mod = await init({
  wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
});
mod.FPDF_InitLibrary();

const bytes = new Uint8Array(await readFile(path));
const dataPtr = mod.pdfium.wasmExports.malloc(bytes.byteLength);
mod.pdfium.HEAPU8.set(bytes, dataPtr);
const doc = mod.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, '');
if (!doc) {
  console.error(`Could not open that file (error ${mod.FPDF_GetLastError()}).`);
  process.exit(1);
}

// A form-fill environment is required for the field accessors to work at all.
const infoPtr = mod.pdfium.wasmExports.malloc(256);
mod.pdfium.HEAPU8.fill(0, infoPtr, infoPtr + 256);
let form = 0;
for (const version of [2, 1]) {
  mod.pdfium.setValue(infoPtr, version, 'i32');
  form = mod.FPDFDOC_InitFormFillEnvironment(doc, infoPtr);
  if (form) break;
}

const formType = mod.FPDF_GetFormType(doc);
console.log(`\n${basename(path)}`);
console.log(`  pages: ${mod.FPDF_GetPageCount(doc)}`);
console.log(
  `  form type: ${['none', 'AcroForm', 'XFA (full)', 'XFA (foreground)'][formType] ?? formType}`,
);
console.log(`  form-fill environment: ${form ? 'ready' : 'FAILED TO INITIALISE'}`);

if (!form || formType === 0) {
  console.log('\n  No interactive form, so nothing to report.\n');
  process.exit(0);
}

/** Read a two-call UTF-16 string. */
function readWide(read) {
  const needed = read(0, 0);
  if (needed <= 2) return '';
  const buf = mod.pdfium.wasmExports.malloc(needed);
  read(buf, needed);
  const out = mod.pdfium.UTF16ToString(buf);
  mod.pdfium.wasmExports.free(buf);
  return out;
}

const GENERATED = [
  /^dhformfield[-_]?\d+$/i,
  /^form(field)?[-_]?\d+$/i,
  /^field[-_]?\d+$/i,
  /^[0-9a-f]{16,}$/i,
  /^\d+$/,
];
const opaque = (name) =>
  name.trim() === '' ||
  GENERATED.some((p) => p.test(name.trim())) ||
  /\d{6,}/.test(name) ||
  /\[\d+\]/.test(name);

const TF = /\/([A-Za-z0-9_.+#-]+)\s+([\d.]+)\s+Tf/;

let total = 0;
const autoSized = [];
const comb = [];

for (let p = 0; p < mod.FPDF_GetPageCount(doc); p++) {
  const page = mod.FPDF_LoadPage(doc, p);
  if (!page) continue;
  mod.FORM_OnAfterLoadPage(page, form);

  const count = mod.FPDFPage_GetAnnotCount(page);
  const rows = [];

  for (let i = 0; i < count; i++) {
    const annot = mod.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;

    const type = mod.FPDFAnnot_GetFormFieldType(form, annot);
    if (type < 0) {
      mod.FPDFPage_CloseAnnot(annot);
      continue;
    }

    const rawName = readWide((b, n) => mod.FPDFAnnot_GetFormFieldName(form, annot, b, n));
    const flags = mod.FPDFAnnot_GetFormFieldFlags(form, annot);
    const da = readWide((b, n) => mod.FPDFAnnot_GetStringValue(annot, 'DA', b, n));
    const ap = readWide((b, n) => mod.FPDFAnnot_GetAP(annot, AP_NORMAL, b, n));

    // Geometry only: width and height, not position.
    const rectPtr = mod.pdfium.wasmExports.malloc(16);
    let w = 0;
    let h = 0;
    if (mod.FPDFAnnot_GetRect(annot, rectPtr)) {
      const g = (o) => mod.pdfium.getValue(rectPtr + o, 'float');
      w = Math.abs(g(8) - g(0));
      h = Math.abs(g(4) - g(12));
    }
    mod.pdfium.wasmExports.free(rectPtr);

    const maxLenPtr = mod.pdfium.wasmExports.malloc(4);
    const hasMaxLen = mod.FPDFAnnot_GetNumberValue(annot, 'MaxLen', maxLenPtr);
    const maxLen = hasMaxLen ? mod.pdfium.getValue(maxLenPtr, 'float') : null;
    mod.pdfium.wasmExports.free(maxLenPtr);

    const daTf = TF.exec(da);
    const apTf = TF.exec(ap);
    const daSize = daTf ? Number(daTf[2]) : null;
    const apSize = apTf ? Number(apTf[2]) : null;

    const label = opaque(rawName) ? `#${i} <generated name>` : rawName;
    const isComb = (flags & FLAG_COMB) !== 0;

    total++;
    if (daSize === 0) autoSized.push(label);
    if (isComb) comb.push(label);

    rows.push(
      `    ${label}\n` +
        `        kind=${FIELD_KIND[type] ?? type}` +
        ` box=${w.toFixed(0)}x${h.toFixed(0)}pt` +
        ` Ff=${flags}${isComb ? ' COMB' : ''}` +
        `${(flags & FLAG_MULTILINE) !== 0 ? ' MULTILINE' : ''}` +
        `${(flags & FLAG_READONLY) !== 0 ? ' READONLY' : ''}` +
        `${maxLen !== null ? ` MaxLen=${maxLen}` : ''}\n` +
        `        DA font=${daTf ? daTf[1] : '(none)'} size=${daSize ?? '(none)'}` +
        `${daSize === 0 ? '  <-- AUTO' : ''}\n` +
        `        AP font=${apTf ? apTf[1] : '(no Tf found)'} size=${apSize ?? '(none)'}` +
        ` apBytes=${ap.length}`,
    );

    mod.FPDFPage_CloseAnnot(annot);
  }

  if (rows.length > 0) {
    console.log(`\n  page ${p + 1} — ${rows.length} field(s)`);
    console.log(rows.join('\n'));
  }

  mod.FORM_OnBeforeClosePage(page, form);
  mod.FPDF_ClosePage(page);
}

console.log(`\n  ---- summary ----`);
console.log(`  fields: ${total}`);
console.log(`  auto-sized (/DA "0 Tf"): ${autoSized.length}`);
console.log(`  comb (one character per cell): ${comb.length}${comb.length ? ` -> ${comb.slice(0, 8).join(', ')}` : ''}`);
console.log(
  `  NOTE: comb fields re-space per character whenever their appearance is\n` +
    `        rebuilt, which no /DA change can prevent.\n`,
);

mod.FPDFDOC_ExitFormFillEnvironment(form);
mod.FPDF_CloseDocument(doc);
mod.pdfium.wasmExports.free(infoPtr);
mod.pdfium.wasmExports.free(dataPtr);
