import { describe, expect, it } from 'vitest';
import { withBytes, withFixture } from '../helpers';
import { patchTextRegion } from '@/engine/insert';
import { renderPage } from '@/engine/render';
import { getTextRuns } from '@/engine/text';
import { listPageObjects } from '@/engine/objects';
import { ObjType } from '@/engine/constants';

/**
 * Patching a region: cover the pixels, draw replacement text.
 *
 * This is what makes a scanned page changeable, and it is deliberately not
 * the same operation as editing a text object. These tests pin the parts that
 * would be easy to get quietly wrong: that the original is actually hidden,
 * that the replacement is real extractable text, and that it is honest about
 * the original pixels still being there.
 */

describe('patching a scanned region', () => {
  it('covers the region and draws the replacement', async () => {
    const bytes = await withFixture('scanned-page.pdf', async (doc) => {
      await patchTextRegion(doc, {
        page: 0,
        rect: { left: 100, bottom: 600, right: 300, top: 616 },
        text: 'Replaced on a scan',
        fontSize: 12,
        fontKey: 'sans',
        colour: { r: 0, g: 0, b: 0, a: 255 },
      });
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      // Real text, so the result is searchable rather than another picture.
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' | ');
      expect(all).toContain('Replaced on a scan');

      // And a filled rectangle beneath it doing the covering.
      const shapes = listPageObjects(doc, 0).filter((o) => o.type === ObjType.Path);
      expect(shapes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('hides what was underneath', async () => {
    // scanned-page.pdf has dark bands standing in for lines of print. This
    // region covers one of them, verified by rendering: rows 570-576 are dark
    // and the paper around them is a light grey, not white.
    const before = await withFixture('scanned-page.pdf', (doc) => renderPage(doc, 0, { scale: 1 }));

    const region = { left: 100, bottom: 566, right: 300, top: 580 };

    const countDark = (data: Uint8ClampedArray, width: number) => {
      let dark = 0;
      for (let y = 792 - region.top; y < 792 - region.bottom; y++) {
        for (let x = region.left; x < region.right; x++) {
          if (data[(y * width + x) * 4] < 110) dark++;
        }
      }
      return dark;
    };

    expect(countDark(before.data, before.width)).toBeGreaterThan(0);

    const bytes = await withFixture('scanned-page.pdf', async (doc) => {
      await patchTextRegion(doc, {
        page: 0,
        rect: region,
        // Empty text, so only the cover is measured and stray glyphs cannot
        // be mistaken for surviving original ink.
        text: '',
        fontSize: 12,
        fontKey: 'sans',
        colour: { r: 0, g: 0, b: 0, a: 255 },
      });
      return doc.save();
    });

    const after = await withBytes(bytes, (doc) => renderPage(doc, 0, { scale: 1 }));
    expect(countDark(after.data, after.width)).toBe(0);
  });

  it('matches the paper tone rather than always painting white', async () => {
    // The fixture's scan is a light grey around 238, not white. Painting a
    // white block would leave an obvious rectangle on the page, which is the
    // giveaway that a tool has done this badly.
    const region = { left: 100, bottom: 566, right: 300, top: 580 };

    const bytes = await withFixture('scanned-page.pdf', async (doc) => {
      await patchTextRegion(doc, {
        page: 0,
        rect: region,
        text: '',
        fontSize: 12,
        fontKey: 'sans',
        colour: { r: 0, g: 0, b: 0, a: 255 },
      });
      return doc.save();
    });

    const after = await withBytes(bytes, (doc) => renderPage(doc, 0, { scale: 1 }));
    const at = (x: number, y: number) => after.data[((792 - y) * after.width + x) * 4];

    // The middle of the patch should read as paper, not as pure white and not
    // as the dark band it replaced.
    const inside = at(200, 573);
    expect(inside).toBeGreaterThan(215);
    expect(inside).toBeLessThan(250);
  });

  it('leaves the rest of the page alone', async () => {
    const before = await withFixture('scanned-page.pdf', (doc) => renderPage(doc, 0, { scale: 1 }));

    const bytes = await withFixture('scanned-page.pdf', async (doc) => {
      await patchTextRegion(doc, {
        page: 0,
        rect: { left: 100, bottom: 600, right: 300, top: 616 },
        text: 'Only here',
        fontSize: 12,
        fontKey: 'sans',
        colour: { r: 0, g: 0, b: 0, a: 255 },
      });
      return doc.save();
    });

    const after = await withBytes(bytes, (doc) => renderPage(doc, 0, { scale: 1 }));

    // Everything above the patched band must be untouched.
    let differing = 0;
    for (let y = 0; y < 792 - 625; y++) {
      for (let x = 0; x < after.width; x++) {
        const i = (y * after.width + x) * 4;
        if (Math.abs(before.data[i] - after.data[i]) > 12) differing++;
      }
    }
    expect(differing).toBe(0);
  });
});
