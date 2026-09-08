import { describe, expect, it } from 'vitest';
import { fixtureBytes, loadEngine, withBytes, withFixture } from '../helpers';
import { PdfDocument } from '@/engine/document';
import { renderPage, deviceToPage, pageToDevice } from '@/engine/render';

/**
 * Spike S1: PDFium loads, parses, renders and saves.
 *
 * Everything else in the engine rests on this, so it is checked first and in
 * isolation.
 */
describe('engine bootstrap', () => {
  it('loads the PDFium module', async () => {
    const mod = await loadEngine();
    expect(typeof mod.FPDF_GetPageCount).toBe('function');
    expect(typeof mod.FPDFText_SetText).toBe('function');
    expect(typeof mod.FPDFPage_GenerateContent).toBe('function');
  });

  it('opens a document and reports its pages', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      expect(doc.pageCount).toBe(1);
      const info = doc.info();
      expect(info.pageCount).toBe(1);
      expect(info.pages[0].width).toBeCloseTo(612, 0);
      expect(info.pages[0].height).toBeCloseTo(792, 0);
      expect(info.pages[0].rotation).toBe(0);
      expect(info.pages[0].textObjectCount).toBeGreaterThan(0);
      expect(info.pages[0].isScanned).toBe(false);
    });
  });

  it('reports a helpful error for a file that is not a PDF', async () => {
    const mod = await loadEngine();
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => PdfDocument.open(mod, junk)).toThrow(/not a valid PDF|could not be read/i);
  });

  it('counts pages in a multi-page document', async () => {
    await withFixture('multipage.pdf', (doc) => {
      expect(doc.pageCount).toBe(5);
    });
  });

  it('reads a Flate-compressed content stream', async () => {
    await withFixture('compressed-stream.pdf', (doc) => {
      expect(doc.pageInfo(0).textObjectCount).toBeGreaterThan(0);
    });
  });
});

describe('rendering', () => {
  it('renders a page to RGBA pixels with a white background', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const out = renderPage(doc, 0, { scale: 1 });
      expect(out.width).toBe(612);
      expect(out.height).toBe(792);
      expect(out.data.length).toBe(612 * 792 * 4);

      // The top-left corner is margin, so it should be opaque white. If the
      // channel order were wrong this would still pass, so the ink check
      // below is the one that actually pins the format.
      expect(out.data[0]).toBe(255);
      expect(out.data[1]).toBe(255);
      expect(out.data[2]).toBe(255);
      expect(out.data[3]).toBe(255);

      // Some pixels must be dark, or nothing was drawn.
      let dark = 0;
      for (let i = 0; i < out.data.length; i += 4) {
        if (out.data[i] < 100 && out.data[i + 1] < 100 && out.data[i + 2] < 100) dark++;
      }
      expect(dark).toBeGreaterThan(200);
    });
  });

  it('renders colour in RGBA order, not BGRA', async () => {
    // cropbox-offset.pdf strokes a pure red rectangle (1 0 0 RG). Red in RGBA
    // is high in byte 0; in BGRA it would be high in byte 2. This is the test
    // that would catch a swapped channel order, which is otherwise invisible
    // on black text.
    await withFixture('cropbox-offset.pdf', (doc) => {
      const out = renderPage(doc, 0, { scale: 1 });
      let redish = 0;
      let blueish = 0;
      for (let i = 0; i < out.data.length; i += 4) {
        const [r, g, b] = [out.data[i], out.data[i + 1], out.data[i + 2]];
        if (r > 180 && g < 90 && b < 90) redish++;
        if (b > 180 && g < 90 && r < 90) blueish++;
      }
      expect(redish).toBeGreaterThan(50);
      expect(blueish).toBe(0);
    });
  });

  it('scales the bitmap', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const out = renderPage(doc, 0, { scale: 2 });
      expect(out.width).toBe(1224);
      expect(out.height).toBe(1584);
    });
  });

  it('swaps reported width and height on a rotated page', async () => {
    await withFixture('rotated-90.pdf', (doc) => {
      const info = doc.pageInfo(0);
      expect(info.rotation).toBe(90);
      // /Rotate 90 on a 612x792 media box presents as 792x612.
      expect(info.width).toBeCloseTo(792, 0);
      expect(info.height).toBeCloseTo(612, 0);

      const out = renderPage(doc, 0, { scale: 1 });
      expect(out.width).toBe(792);
      expect(out.height).toBe(612);
    });
  });
});

/**
 * Spike S7: coordinate mapping on the two page shapes that break naive
 * implementations. A rectangle drawn where the user clicked must land there.
 */
describe('coordinate mapping', () => {
  it('round-trips a point through device and page space', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const w = 612;
      const h = 792;
      const start = { x: 100, y: 150 };
      const inPage = deviceToPage(doc, 0, w, h, start.x, start.y);
      const back = pageToDevice(doc, 0, w, h, inPage.x, inPage.y);
      expect(back.x).toBeCloseTo(start.x, 0);
      expect(back.y).toBeCloseTo(start.y, 0);
    });
  });

  it('flips y between device and page space', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      // Device y grows downward, PDF y upward, so the top of the view is the
      // high-y end of the page.
      const top = deviceToPage(doc, 0, 612, 792, 306, 0);
      const bottom = deviceToPage(doc, 0, 612, 792, 306, 792);
      expect(top.y).toBeGreaterThan(bottom.y);
      expect(top.y).toBeCloseTo(792, 0);
      expect(bottom.y).toBeCloseTo(0, 0);
    });
  });

  it('accounts for a crop box offset from the media box', async () => {
    // The crop box is [36 36 576 756], so the visible origin is (36, 36) in
    // media-box terms. Mapping the bottom-left of the view must yield that,
    // not (0, 0). Getting this wrong offsets every edit by 36 points on
    // cropped pages, which was flagged as unverified during research.
    await withFixture('cropbox-offset.pdf', (doc) => {
      const info = doc.pageInfo(0);
      expect(info.width).toBeCloseTo(540, 0);
      expect(info.height).toBeCloseTo(720, 0);

      const bottomLeft = deviceToPage(doc, 0, 540, 720, 0, 720);
      expect(bottomLeft.x).toBeCloseTo(36, 0);
      expect(bottomLeft.y).toBeCloseTo(36, 0);

      const topRight = deviceToPage(doc, 0, 540, 720, 540, 0);
      expect(topRight.x).toBeCloseTo(576, 0);
      expect(topRight.y).toBeCloseTo(756, 0);
    });
  });

  it('round-trips on a rotated page', async () => {
    await withFixture('rotated-90.pdf', (doc) => {
      const w = 792;
      const h = 612;
      const start = { x: 200, y: 100 };
      const inPage = deviceToPage(doc, 0, w, h, start.x, start.y);
      const back = pageToDevice(doc, 0, w, h, inPage.x, inPage.y);
      expect(back.x).toBeCloseTo(start.x, 0);
      expect(back.y).toBeCloseTo(start.y, 0);
    });
  });
});

describe('saving', () => {
  it('saves a document that can be reopened', async () => {
    const saved = await withFixture('simple-text.pdf', (doc) => doc.save());
    expect(saved.byteLength).toBeGreaterThan(400);
    expect(new TextDecoder().decode(saved.subarray(0, 5))).toBe('%PDF-');

    await withBytes(saved, (doc) => {
      expect(doc.pageCount).toBe(1);
      expect(doc.pageInfo(0).textObjectCount).toBeGreaterThan(0);
    });
  });

  it('renders a saved copy identically to the original', async () => {
    // A save with no edits must be visually lossless. If this drifts, then
    // every later "nothing else changed" assertion is measuring save damage
    // rather than the edit under test.
    const original = await withFixture('simple-text.pdf', (doc) =>
      renderPage(doc, 0, { scale: 1 }),
    );
    const saved = await withFixture('simple-text.pdf', (doc) => doc.save());
    const reRendered = await withBytes(saved, (doc) => renderPage(doc, 0, { scale: 1 }));

    expect(reRendered.width).toBe(original.width);
    let differing = 0;
    for (let i = 0; i < original.data.length; i += 4) {
      if (Math.abs(original.data[i] - reRendered.data[i]) > 12) differing++;
    }
    expect(differing).toBe(0);
  });

  it('preserves a contents array through a save', async () => {
    const saved = await withFixture('contents-array.pdf', (doc) => doc.save());
    await withBytes(saved, (doc) => {
      // All three streams must survive, including the operator split across
      // the second and third.
      expect(doc.pageInfo(0).textObjectCount).toBe(3);
    });
  });

  it('detects a scanned page', async () => {
    await withFixture('scanned-page.pdf', (doc) => {
      const info = doc.pageInfo(0);
      expect(info.textObjectCount).toBe(0);
      expect(info.isScanned).toBe(true);
    });
  });

  it('reports cryptographic signature count', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      expect(doc.info().signatureCount).toBe(0);
    });
  });
});
