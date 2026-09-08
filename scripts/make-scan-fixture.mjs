/**
 * Build a realistic scanned-document fixture.
 *
 * `scanned-page.pdf` is grey bars standing in for lines of print, which is
 * fine for testing that a scan is *detected* and that a region can be painted
 * over. It is useless for testing OCR: there are no glyph shapes in it, so a
 * recogniser correctly finds nothing, which looks exactly like a broken
 * recogniser.
 *
 * So this renders a text document to a bitmap through the real engine and
 * wraps that bitmap as a full-page image. The result is a page whose words are
 * genuine glyph shapes with no text objects behind them — the same thing a
 * flatbed scanner produces, and the only honest way to test reading one.
 *
 * Run with `node scripts/make-scan-fixture.mjs`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { init } from '@embedpdf/pdfium';

const require = createRequire(import.meta.url);
const FIXTURES = join(process.cwd(), 'fixtures');

// --- Render the source document to pixels ---------------------------------

const wasm = await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
const mod = await init({
  wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
});
mod.FPDF_InitLibrary();

const source = new Uint8Array(await readFile(join(FIXTURES, 'simple-text.pdf')));
const dataPtr = mod.pdfium.wasmExports.malloc(source.byteLength);
mod.pdfium.HEAPU8.set(source, dataPtr);
const doc = mod.FPDF_LoadMemDocument(dataPtr, source.byteLength, '');
if (!doc) throw new Error('Could not open simple-text.pdf');

const page = mod.FPDF_LoadPage(doc, 0);
const pointWidth = mod.FPDF_GetPageWidthF(page);
const pointHeight = mod.FPDF_GetPageHeightF(page);

// 150 DPI, which is what a document scanner typically produces and enough for
// the recogniser to work with.
const scale = 150 / 72;
const width = Math.round(pointWidth * scale);
const height = Math.round(pointHeight * scale);

const bitmap = mod.FPDFBitmap_Create(width, height, 1);
mod.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
// LCD text off: subpixel colour fringing is noise to a recogniser.
mod.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0);

const bufferPtr = mod.FPDFBitmap_GetBuffer(bitmap);
const rgba = new Uint8Array(width * height * 4);
rgba.set(mod.pdfium.HEAPU8.subarray(bufferPtr, bufferPtr + rgba.length));

mod.FPDFBitmap_Destroy(bitmap);
mod.FPDF_ClosePage(page);
mod.FPDF_CloseDocument(doc);
mod.pdfium.wasmExports.free(dataPtr);

// --- Flatten to greyscale, with a little scanner-like noise ---------------

const grey = Buffer.alloc(width * height);
for (let i = 0, n = width * height; i < n; i++) {
  // PDFium's native order here is BGRA.
  const b = rgba[i * 4];
  const g = rgba[i * 4 + 1];
  const r = rgba[i * 4 + 2];
  let luma = 0.299 * r + 0.587 * g + 0.114 * b;

  // A faint, deterministic mottle and a slightly off-white paper tone, so the
  // fixture is not a pristine bitonal image. A real scan never is, and code
  // that only works on a perfect one is not worth having.
  const x = i % width;
  const y = (i / width) | 0;
  luma = luma * 0.97 + 6 + (((x * 7 + y * 13) % 5) - 2);
  grey[i] = Math.max(0, Math.min(255, Math.round(luma)));
}

// --- Wrap it as a single full-page image ----------------------------------

function buildPdf(objects, rootRef) {
  const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let offset = chunks[0].length;

  objects.forEach((body, i) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'binary');
    const objBuf = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'binary'),
      buf,
      Buffer.from('\nendobj\n', 'binary'),
    ]);
    offsets.push(offset);
    chunks.push(objBuf);
    offset += objBuf.length;
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${rootRef} 0 R >>\n`;
  xref += `startxref\n${offset}\n%%EOF\n`;

  chunks.push(Buffer.from(xref, 'binary'));
  return Buffer.concat(chunks);
}

function stream(dict, content) {
  const data = deflateSync(Buffer.isBuffer(content) ? content : Buffer.from(content, 'binary'));
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, 'binary'),
    data,
    Buffer.from('\nendstream', 'binary'),
  ]);
}

const pdf = buildPdf(
  [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pointWidth.toFixed(0)} ${pointHeight.toFixed(0)}] ` +
      '/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
    stream('', `q ${pointWidth.toFixed(0)} 0 0 ${pointHeight.toFixed(0)} 0 0 cm /Im0 Do Q`),
    stream(
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        '/ColorSpace /DeviceGray /BitsPerComponent 8',
      grey,
    ),
  ],
  1,
);

const out = join(FIXTURES, 'scanned-text.pdf');
await writeFile(out, pdf);
console.log(
  `scanned-text.pdf → ${width}x${height} px at 150 DPI, ${(pdf.length / 1024).toFixed(0)} KB`,
);
console.log('  Real glyph shapes, no text objects. Use this to test reading a scan.');
