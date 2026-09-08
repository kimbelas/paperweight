import { describe, expect, it } from 'vitest';
import { withBytes, withFixture } from '../helpers';
import { insertImage, insertRect, insertText, sampleBackgroundColour } from '@/engine/insert';
import { renderPage } from '@/engine/render';
import { getTextRuns } from '@/engine/text';
import { listPageObjects } from '@/engine/objects';
import { ObjType } from '@/engine/constants';

/** A signature-shaped RGBA bitmap: opaque dark ink on a transparent ground. */
function inkStrip(w = 80, h = 24): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let x = 0; x < w; x++) {
    const y = Math.round((Math.sin((x / w) * Math.PI * 2) * 0.5 + 0.5) * (h - 5)) + 2;
    for (const dy of [-1, 0, 1]) {
      const i = ((y + dy) * w + x) * 4;
      data[i] = 20;
      data[i + 1] = 30;
      data[i + 2] = 160;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe('inserting images', () => {
  it('places an image and it survives a save', async () => {
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      insertImage(doc, {
        type: 'image',
        page: 0,
        rect: { left: 120, bottom: 150, right: 300, top: 200 },
        data: inkStrip(),
        pixelWidth: 80,
        pixelHeight: 24,
      });
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const images = listPageObjects(doc, 0).filter((o) => o.type === ObjType.Image);
      expect(images.length).toBe(1);
      expect(images[0].bounds.left).toBeCloseTo(120, 0);
      expect(images[0].bounds.bottom).toBeCloseTo(150, 0);
      expect(images[0].bounds.right).toBeCloseTo(300, 0);
      expect(images[0].bounds.top).toBeCloseTo(200, 0);
    });
  });

  /**
   * Spike S5. A signature is dark ink on a transparent background. If alpha
   * is dropped the result is a white box over the document, which looks
   * catastrophic and is a common failure when the bitmap format is wrong.
   */
  it('preserves transparency so a signature does not arrive as a white box', async () => {
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      insertImage(doc, {
        type: 'image',
        page: 0,
        // Placed over the existing rule and label near the bottom.
        rect: { left: 80, bottom: 130, right: 260, top: 180 },
        data: inkStrip(),
        pixelWidth: 80,
        pixelHeight: 24,
      });
      return doc.save();
    });

    const after = await withBytes(bytes, (doc) => renderPage(doc, 0, { scale: 1 }));

    // Inside the image rect, count pixels by kind. PDF y is up, bitmap y down.
    let white = 0;
    let ink = 0;
    for (let y = 792 - 180; y < 792 - 130; y++) {
      for (let x = 80; x < 260; x++) {
        const i = (y * after.width + x) * 4;
        const [r, g, b] = [after.data[i], after.data[i + 1], after.data[i + 2]];
        if (r > 245 && g > 245 && b > 245) white++;
        // The ink is blue-dominant, which also confirms the channel order
        // survived the RGBA-to-BGRA swizzle.
        if (b > 100 && b > r + 40 && r < 120) ink++;
      }
    }

    expect(ink).toBeGreaterThan(100);
    // Most of the rect must still be page, not a filled block.
    expect(white).toBeGreaterThan(ink * 3);
  });

  it('rejects an image whose data is incomplete', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      expect(() =>
        insertImage(doc, {
          type: 'image',
          page: 0,
          rect: { left: 0, bottom: 0, right: 10, top: 10 },
          data: new Uint8ClampedArray(4),
          pixelWidth: 80,
          pixelHeight: 24,
        }),
      ).toThrow(/incomplete/i);
    });
  });
});

describe('inserting rectangles', () => {
  it('covers content with an opaque rectangle', async () => {
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      insertRect(doc, {
        type: 'rect',
        page: 0,
        rect: { left: 70, bottom: 630, right: 400, top: 652 },
        colour: { r: 255, g: 255, b: 255, a: 255 },
      });
      return doc.save();
    });

    const after = await withBytes(bytes, (doc) => renderPage(doc, 0, { scale: 1 }));

    // The "Amount due" line sat at y=640 and should now be hidden.
    let dark = 0;
    for (let y = 792 - 652; y < 792 - 630; y++) {
      for (let x = 70; x < 400; x++) {
        const i = (y * after.width + x) * 4;
        if (after.data[i] < 120) dark++;
      }
    }
    expect(dark).toBe(0);
  });

  it('leaves the covered text in the file, which is why it is not called redaction', async () => {
    // Documents the honest limitation. A cover is a visual patch; the words
    // are still extractable underneath, and the UI must never imply otherwise.
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      insertRect(doc, {
        type: 'rect',
        page: 0,
        rect: { left: 70, bottom: 630, right: 400, top: 652 },
        colour: { r: 255, g: 255, b: 255, a: 255 },
      });
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const text = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' ');
      expect(text).toContain('Amount due');
    });
  });

  it('draws a coloured rectangle in the colour asked for', async () => {
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      insertRect(doc, {
        type: 'rect',
        page: 0,
        rect: { left: 400, bottom: 400, right: 500, top: 450 },
        colour: { r: 0, g: 128, b: 0, a: 255 },
      });
      return doc.save();
    });

    const after = await withBytes(bytes, (doc) => renderPage(doc, 0, { scale: 1 }));
    const i = ((792 - 425) * after.width + 450) * 4;
    expect(after.data[i]).toBeLessThan(60);
    expect(after.data[i + 1]).toBeGreaterThan(100);
    expect(after.data[i + 2]).toBeLessThan(60);
  });
});

describe('inserting text', () => {
  it('adds new text that is extractable after saving', async () => {
    const bytes = await withFixture('simple-text.pdf', async (doc) => {
      await insertText(doc, {
        type: 'text',
        page: 0,
        x: 72,
        y: 400,
        text: 'Paid in full',
        fontSize: 14,
        colour: { r: 200, g: 0, b: 0, a: 255 },
        fontKey: 'sans-bold',
      });
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const runs = getTextRuns(doc, 0);
      const added = runs.find((r) => r.text.includes('Paid in full'));
      expect(added).toBeDefined();
      expect(added!.fontSize).toBeCloseTo(14, 0);
      // The pen position is exactly where it was asked for. The ink box starts
      // a fraction later because of the left side bearing of "P".
      expect(added!.matrix.e).toBeCloseTo(72, 3);
      expect(added!.bounds.left).toBeGreaterThanOrEqual(72);
      expect(added!.bounds.left).toBeLessThan(74);
      expect(added!.font.isBold).toBe(true);
    });
  });

  it('rejects an unknown font key', async () => {
    await withFixture('simple-text.pdf', async (doc) => {
      await expect(
        insertText(doc, {
          type: 'text',
          page: 0,
          x: 10,
          y: 10,
          text: 'x',
          fontSize: 12,
          colour: { r: 0, g: 0, b: 0, a: 255 },
          fontKey: 'not-a-font',
        }),
      ).rejects.toThrow(/Unknown font/i);
    });
  });
});

describe('background sampling', () => {
  it('reads white on a plain page', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const colour = sampleBackgroundColour(doc, 0, {
        left: 300,
        bottom: 300,
        right: 400,
        top: 340,
      });
      expect(colour.r).toBeGreaterThan(240);
      expect(colour.g).toBeGreaterThan(240);
      expect(colour.b).toBeGreaterThan(240);
    });
  });

  it('picks up a coloured background rather than assuming white', async () => {
    // Lay down a green band, then sample a rectangle inside it. Defaulting to
    // white here would leave an obvious white patch on the band.
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      insertRect(doc, {
        type: 'rect',
        page: 0,
        rect: { left: 200, bottom: 280, right: 520, top: 380 },
        colour: { r: 0, g: 160, b: 0, a: 255 },
      });
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const colour = sampleBackgroundColour(doc, 0, {
        left: 260,
        bottom: 310,
        right: 400,
        top: 350,
      });
      expect(colour.g).toBeGreaterThan(colour.r + 40);
      expect(colour.g).toBeGreaterThan(colour.b + 40);
    });
  });
});
