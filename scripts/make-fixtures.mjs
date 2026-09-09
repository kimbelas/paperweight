/**
 * Build the synthetic test corpus.
 *
 * These PDFs are written byte by byte rather than produced by a generator
 * library, because the point of them is to pin down the structural edge cases
 * that break PDF editors: a `/Contents` array, a crop box offset from the
 * media box, a rotated page, text inside a form XObject. A generator gives you
 * whatever it happens to emit; hand-assembly gives you the case you meant to
 * test.
 *
 * Real-world files belong in `fixtures/local/`, which is gitignored: they are
 * other people's documents and have no business in version control.
 *
 * Run with `node scripts/make-fixtures.mjs`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = join(process.cwd(), 'fixtures');

/** Assemble a PDF from a list of object bodies, building the xref table. */
function buildPdf(objects, rootRef, extraTrailer = '') {
  const header = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const chunks = [Buffer.from(header, 'binary')];
  const offsets = [0];
  let offset = chunks[0].length;

  objects.forEach((body, i) => {
    const num = i + 1;
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'binary');
    const prefix = Buffer.from(`${num} 0 obj\n`, 'binary');
    const suffix = Buffer.from('\nendobj\n', 'binary');
    offsets.push(offset);
    const objBuf = Buffer.concat([prefix, bodyBuf, suffix]);
    chunks.push(objBuf);
    offset += objBuf.length;
  });

  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${rootRef} 0 R ${extraTrailer}>>\n`;
  xref += `startxref\n${xrefStart}\n%%EOF\n`;

  chunks.push(Buffer.from(xref, 'binary'));
  return Buffer.concat(chunks);
}

/** A stream object, optionally Flate-compressed. */
function stream(dict, content, compress = false) {
  const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'binary');
  const data = compress ? deflateSync(raw) : raw;
  const filter = compress ? ' /Filter /FlateDecode' : '';
  return Buffer.concat([
    Buffer.from(`<< ${dict}${filter} /Length ${data.length} >>\nstream\n`, 'binary'),
    data,
    Buffer.from('\nendstream', 'binary'),
  ]);
}

const HELV = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
const HELV_BOLD =
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
const TIMES = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>';

const fixtures = {};

// ---------------------------------------------------------------------------
// 1. The baseline. Plain standard-14 text, uncompressed, one content stream.
//    Every other fixture is a deviation from this one.
// ---------------------------------------------------------------------------
fixtures['simple-text.pdf'] = () => {
  const content = `BT /F1 24 Tf 72 700 Td (Invoice INV-2024-001) Tj ET
BT /F1 12 Tf 72 660 Td (Billed to: Acme Corporation) Tj ET
BT /F1 12 Tf 72 640 Td (Amount due: PHP 45,000.00) Tj ET
BT /F2 12 Tf 72 620 Td (Due date: 2026-10-15) Tj ET
BT /F3 12 Tf 72 600 Td (Thank you for your business.) Tj ET
BT /F1 10 Tf 72 120 Td (Authorised signature) Tj ET
0.5 w 72 140 m 250 140 l S`;
  return buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>',
      stream('', content),
      HELV,
      HELV_BOLD,
      TIMES,
    ],
    1,
  );
};

// ---------------------------------------------------------------------------
// 2. `/Contents` as an array of three streams, with a token boundary falling
//    mid-operator between streams 2 and 3. A naive reader that handles each
//    stream separately, or concatenates without whitespace, mis-parses this.
// ---------------------------------------------------------------------------
fixtures['contents-array.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 7 0 R >> >> /Contents [4 0 R 5 0 R 6 0 R] >>',
      stream('', 'BT /F1 18 Tf 72 700 Td (First stream text) Tj ET\n'),
      stream('', 'BT /F1 18 Tf 72 660 Td (Second stream text) Tj E'),
      stream('', 'T\nBT /F1 18 Tf 72 620 Td (Third stream text) Tj ET\n'),
      HELV,
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 3. A crop box inset from the media box. PDF viewers show the crop box, so
//    the visible origin is (36, 36) and not (0, 0). Any coordinate code that
//    assumes the media box origin puts everything 36 points out.
// ---------------------------------------------------------------------------
fixtures['cropbox-offset.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [36 36 576 756] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      stream(
        '',
        `BT /F1 14 Tf 72 700 Td (Text at media 72,700) Tj ET
BT /F1 14 Tf 72 100 Td (Near the bottom edge) Tj ET
1 0 0 RG 2 w 36 36 540 720 re S`,
      ),
      HELV,
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 4. `/Rotate 90`. Reported page width and height swap, while the media box
//    and all the content coordinates do not.
// ---------------------------------------------------------------------------
fixtures['rotated-90.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      stream(
        '',
        `BT /F1 20 Tf 72 700 Td (Rotated page heading) Tj ET
BT /F1 12 Tf 72 660 Td (This page declares Rotate 90.) Tj ET`,
      ),
      HELV,
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 5. Text inside a form XObject, which has its own resource dictionary. Code
//    that only walks the page's own content stream never sees this text.
// ---------------------------------------------------------------------------
fixtures['form-xobject-text.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 6 0 R >> /XObject << /Fm0 5 0 R >> >> /Contents 4 0 R >>',
      stream(
        '',
        `BT /F1 16 Tf 72 700 Td (Text in the page stream) Tj ET
q 1 0 0 1 72 600 cm /Fm0 Do Q`,
      ),
      stream(
        '/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 400 60] ' +
          '/Resources << /Font << /F1 6 0 R >> >>',
        'BT /F1 16 Tf 0 20 Td (Text inside the form XObject) Tj ET',
      ),
      HELV,
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 6. Kerned `TJ` arrays: one visual line split into many show operations with
//    per-glyph adjustments, which is what Word and InDesign emit. Replacing
//    this text loses the original kerning, and the loss must be measured
//    rather than assumed acceptable.
// ---------------------------------------------------------------------------
fixtures['kerned-tj.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      stream(
        '',
        `BT /F1 18 Tf 72 700 Td [(W) -60 (aterfall) -20 ( ) -15 (Pr) 20 (oject)] TJ ET
BT /F1 18 Tf 72 660 Td [(A) -80 (V) -60 (A) -40 (T) -30 (A) -20 (R)] TJ ET
BT /F1 12 Tf 72 620 Td (Ordinary unkerned line for comparison) Tj ET`,
      ),
      HELV,
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 7. A signature-shaped image with an alpha soft mask, sitting above a
//    "Signature" label in the bottom third. This is the flattened-signature
//    case the detection heuristics have to find.
// ---------------------------------------------------------------------------
fixtures['flattened-signature.pdf'] = () => {
  const w = 60;
  const h = 20;
  // A diagonal ink stroke: grey image, alpha where the "ink" is.
  const rgb = Buffer.alloc(w * h * 3, 0xff);
  const alpha = Buffer.alloc(w * h, 0x00);
  for (let x = 0; x < w; x++) {
    const y = Math.floor((Math.sin((x / w) * Math.PI * 2) * 0.5 + 0.5) * (h - 4)) + 2;
    for (const dy of [-1, 0, 1]) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      const i = yy * w + x;
      alpha[i] = 0xff;
      rgb[i * 3] = 0x10;
      rgb[i * 3 + 1] = 0x10;
      rgb[i * 3 + 2] = 0x60;
    }
  }
  return buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 7 0 R >> /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
      stream(
        '',
        `BT /F1 12 Tf 72 700 Td (Agreement between the parties) Tj ET
BT /F1 11 Tf 72 130 Td (Signature:) Tj ET
BT /F1 9 Tf 400 130 Td (Date: 2026-09-07) Tj ET
0.5 w 72 125 m 300 125 l S
q 180 0 0 60 130 135 cm /Im0 Do Q`,
      ),
      stream(
        `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
          '/ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 6 0 R',
        rgb,
        true,
      ),
      stream(
        `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
          '/ColorSpace /DeviceGray /BitsPerComponent 8',
        alpha,
        true,
      ),
      HELV,
    ],
    1,
  );
};

// ---------------------------------------------------------------------------
// 8. Signatures as annotations: a Stamp with an appearance stream, and an Ink
//    with an /InkList. These are the cleanly removable tier.
// ---------------------------------------------------------------------------
fixtures['annotation-signatures.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 8 0 R >> >> /Contents 4 0 R ' +
        '/Annots [5 0 R 7 0 R] >>',
      stream(
        '',
        `BT /F1 12 Tf 72 700 Td (Contract with annotation signatures) Tj ET
BT /F1 11 Tf 72 200 Td (Signed:) Tj ET`,
      ),
      '<< /Type /Annot /Subtype /Stamp /Rect [130 180 310 240] /F 4 ' +
        '/T (Approved signature) /NM (sig-stamp-1) /AP << /N 6 0 R >> >>',
      stream(
        '/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 180 60] ' +
          '/Resources << /Font << /F1 8 0 R >> >>',
        'BT /F1 28 Tf 0.05 0.05 0.4 rg 10 15 Td (J. Santos) Tj ET',
      ),
      '<< /Type /Annot /Subtype /Ink /Rect [350 180 520 240] /F 4 ' +
        '/T (Hand-drawn) /NM (sig-ink-1) /C [0 0 0.6] /BS << /W 2 >> ' +
        '/InkList [[360 200 380 225 400 190 420 220 440 195 460 215 480 200]] >>',
      HELV,
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 9. An AcroForm with a /Sig field plus ordinary fields. Removing the
//    signature has to clean up /AcroForm /Fields as well as the page's
//    /Annots, or the file keeps a dangling field reference.
// ---------------------------------------------------------------------------
fixtures['acroform-sig-field.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R] /SigFlags 3 >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [5 0 R 6 0 R] >>',
      stream('', 'BT /F1 12 Tf 72 700 Td (Form with a signature field) Tj ET'),
      '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [72 150 300 220] ' +
        '/F 4 /DA (/Helv 0 Tf 0 g) >>',
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (FullName) /Rect [72 250 300 275] ' +
        '/F 4 /V (Jane Doe) /DA (/Helv 11 Tf 0 g) >>',
      HELV,
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 9b. A filled application form: the values are in the form, not on the page.
//
//     Three cases on one page, because they fail differently. The two text
//     fields have a /V and a /DA but no /AP, so their appearance has to be
//     generated before anything can be drawn — this is the shape that renders
//     as a blank form if the form-fill environment is missing. The third
//     carries its own /AP, as a form filled by Acrobat would, which also
//     catches a value being drawn twice. The checkbox has /AS selecting one
//     of two appearance states.
// ---------------------------------------------------------------------------
fixtures['filled-form.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R 8 0 R 10 0 R] ' +
        '/DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 7 0 R >> >> /NeedAppearances true >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R ' +
        '/Annots [5 0 R 6 0 R 8 0 R 10 0 R] >>',
      stream(
        '',
        [
          'BT /F1 16 Tf 150 730 Td (VISA APPLICATION FORM TO ENTER JAPAN) Tj ET',
          'BT /F1 11 Tf 72 660 Td (Surname \\(as shown in passport\\)) Tj ET',
          '72 655 m 460 655 l S',
          'BT /F1 11 Tf 72 620 Td (Given and middle names) Tj ET',
          '72 615 m 460 615 l S',
          'BT /F1 11 Tf 72 580 Td (Nationality or citizenship) Tj ET',
          '72 575 m 460 575 l S',
          'BT /F1 11 Tf 72 540 Td (Sex: Male) Tj ET',
          'BT /F1 11 Tf 190 540 Td (Female) Tj ET',
        ].join('\n'),
      ),
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Surname) /V (DOE) ' +
        '/Rect [250 656 460 674] /F 4 /DA (/Helv 11 Tf 0 g) >>',
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (GivenNames) ' +
        '/V (JANE ANNE ELIZABETH DOE) /Rect [250 616 460 634] /F 4 /DA (/Helv 11 Tf 0 g) >>',
      HELV,
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Nationality) /V (FILIPINO) ' +
        '/Rect [250 576 460 594] /F 4 /DA (/Helv 11 Tf 0 g) /AP << /N 9 0 R >> >>',
      stream(
        '/Type /XObject /Subtype /Form /BBox [0 0 210 18] ' +
          '/Resources << /Font << /Helv 7 0 R >> >>',
        'BT /Helv 11 Tf 0 g 2 5 Td (FILIPINO) Tj ET',
      ),
      '<< /Type /Annot /Subtype /Widget /FT /Btn /T (Female) /V /On /AS /On ' +
        '/Rect [240 536 256 552] /F 4 /DA (/ZaDb 0 Tf 0 g) ' +
        '/AP << /N << /On 11 0 R /Off 12 0 R >> >> >>',
      stream(
        '/Type /XObject /Subtype /Form /BBox [0 0 16 16]',
        '0.6 w 0 G 1 1 14 14 re S 3 3 m 13 13 l S 13 3 m 3 13 l S',
      ),
      stream('/Type /XObject /Subtype /Form /BBox [0 0 16 16]', '0.6 w 0 G 1 1 14 14 re S'),
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 9c. A field whose /DA says "auto size" while its appearance stream draws at
//     9pt, and no /NeedAppearances — the shape a form filled by an online
//     tool actually has.
//
//     Nothing looks wrong until the field is edited. The original stream is
//     used as-is on open, but an edit rebuilds the appearance from /DA, where
//     `0 Tf` means "fill the box height": PDFium picks 18pt for this 24pt-tall
//     widget, and that one field comes back in huge type while every untouched
//     field around it still draws at 9pt. Reported from a real visa form.
// ---------------------------------------------------------------------------
fixtures['autosize-field.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] ' +
        '/DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 5 0 R >> >> >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R /Annots [4 0 R] >>',
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Surname) /V (BELAS) ' +
        '/Rect [250 640 460 664] /F 4 /DA (/Helv 0 Tf 0 g) /AP << /N 6 0 R >> >>',
      HELV,
      stream(
        '/Type /XObject /Subtype /Form /BBox [0 0 210 24] ' +
          '/Resources << /Font << /Helv 5 0 R >> >>',
        'BT /Helv 9 Tf 0 g 2 8 Td (BELAS) Tj ET',
      ),
      stream('', 'BT /F1 11 Tf 72 646 Td (Surname \\(as shown in passport\\)) Tj ET'),
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 9d. The harder auto-size case: a field with an auto `/DA` and *no*
//     appearance stream to learn a size from, sitting beside fields that do
//     have one at 9pt.
//
//     There is nothing on the field itself to preserve, so an edit used to
//     fall through to PDFium's auto size and come back at 18pt — too wide for
//     its own box, and therefore truncated as well as oversized. The
//     neighbours are the evidence: match what the rest of the form uses.
// ---------------------------------------------------------------------------
fixtures['autosize-no-appearance.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 8 0 R] ' +
        '/DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 5 0 R >> >> >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R /Annots [4 0 R 8 0 R] >>',
      // The awkward field: auto size, no /AP.
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Surname) /V (DOE) ' +
        '/Rect [250 640 460 664] /F 4 /DA (/Helv 0 Tf 0 g) >>',
      HELV,
      // A neighbour drawing at 9pt, which is what the form really looks like.
      stream(
        '/Type /XObject /Subtype /Form /BBox [0 0 210 24] ' +
          '/Resources << /Font << /Helv 5 0 R >> >>',
        'BT /Helv 9 Tf 0 g 2 8 Td (JANE ANNE ELIZABETH DOE) Tj ET',
      ),
      stream('', 'BT /F1 11 Tf 72 646 Td (Surname \\(as shown in passport\\)) Tj ET'),
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (GivenNames) ' +
        '/V (JANE ANNE ELIZABETH DOE) /Rect [250 600 460 624] /F 4 ' +
        '/DA (/Helv 0 Tf 0 g) /AP << /N 6 0 R >> >>',
    ],
    1,
  );

// ---------------------------------------------------------------------------
// 10. A scanned page: one full-bleed image, no text objects at all. Text
//     editing is impossible here and the app must detect that up front rather
//     than offering an editor that silently does nothing.
// ---------------------------------------------------------------------------
fixtures['scanned-page.pdf'] = () => {
  const w = 85;
  const h = 110;
  const grey = Buffer.alloc(w * h, 0xf2);
  // Fake scan texture plus a few dark bands standing in for lines of print.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (y % 9 === 3 && x > 8 && x < w - 8) grey[i] = 0x3a;
      else grey[i] = 0xf2 - ((x * 7 + y * 13) % 9);
    }
  }
  return buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
      stream('', 'q 612 0 0 792 0 0 cm /Im0 Do Q'),
      stream(
        `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
          '/ColorSpace /DeviceGray /BitsPerComponent 8',
        grey,
        true,
      ),
    ],
    1,
  );
};

// ---------------------------------------------------------------------------
// 11. Multi-page, for page operations and the thumbnail rail.
// ---------------------------------------------------------------------------
fixtures['multipage.pdf'] = () => {
  const pageCount = 5;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    '', // placeholder for the page tree, filled in below
  ];
  const kids = [];
  for (let i = 0; i < pageCount; i++) {
    const contentRef = objects.length + 1;
    objects.push(
      stream(
        '',
        `BT /F1 36 Tf 72 700 Td (Page ${i + 1}) Tj ET
BT /F1 12 Tf 72 650 Td (This is page ${i + 1} of ${pageCount}.) Tj ET`,
      ),
    );
    const pageRef = objects.length + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${3 + pageCount * 2} 0 R >> >> /Contents ${contentRef} 0 R >>`,
    );
    kids.push(`${pageRef} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  objects.push(HELV);
  return buildPdf(objects, 1);
};

// ---------------------------------------------------------------------------
// 12. Compressed content stream. Confirms the reader is not accidentally
//     depending on plain-text streams.
// ---------------------------------------------------------------------------
fixtures['compressed-stream.pdf'] = () =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      stream(
        '',
        `BT /F1 16 Tf 72 700 Td (Flate compressed content) Tj ET
BT /F1 12 Tf 72 670 Td (The stream carrying this text is deflated.) Tj ET`,
        true,
      ),
      HELV,
    ],
    1,
  );

await mkdir(OUT, { recursive: true });
await mkdir(join(OUT, 'local'), { recursive: true });

const written = [];
for (const [name, build] of Object.entries(fixtures)) {
  const bytes = build();
  await writeFile(join(OUT, name), bytes);
  written.push(`${name} (${(bytes.length / 1024).toFixed(1)} KB)`);
}

await writeFile(
  join(OUT, 'local', 'README.md'),
  `# Local fixtures

This folder is gitignored. Drop real-world PDFs here to test against them:
files from Word, InDesign, LaTeX, a scanner, DocuSign, Adobe Sign.

Real documents are not committed. They are other people's data, and a test
corpus in version control is the wrong place for it. The tests treat whatever
is here as an optional extra corpus and skip cleanly when the folder is empty.
`,
);

console.log(`Wrote ${written.length} fixtures to fixtures/:`);
for (const line of written) console.log(`  ${line}`);
