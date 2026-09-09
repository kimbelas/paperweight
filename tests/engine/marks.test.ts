import { describe, expect, it } from 'vitest';
import { withBytes, withFixture } from '../helpers';
import { ObjType } from '@/engine/constants';
import { insertPath } from '@/engine/insert';
import { MARK_ORDER, MARKS, markPathData, markStrokeWidth } from '@/engine/marks';
import { listPageObjects } from '@/engine/objects';
import { renderPage } from '@/engine/render';

/**
 * Marks: a cross or a tick drawn onto the page as a real path.
 *
 * The two things worth pinning are that the mark lands where it was put and
 * that it is a path object rather than a picture — the whole reason for
 * drawing it this way is that it stays sharp on paper, and a regression to a
 * rasterised mark would look identical on screen and only show up in print.
 */

/** Dark pixels in a rendered page, as a crude "did anything get drawn". */
function ink(data: Uint8ClampedArray): number {
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && data[i] < 140) dark++;
  }
  return dark;
}

describe('mark geometry', () => {
  it('every mark stays inside its unit box', () => {
    for (const shape of MARK_ORDER) {
      for (const subpath of MARKS[shape].subpaths) {
        const points = [
          subpath.from,
          ...subpath.segments.flatMap((s) => ('c1' in s ? [s.c1, s.c2, s.to] : [s.to])),
        ];
        for (const [x, y] of points) {
          expect(x, `${shape} x`).toBeGreaterThanOrEqual(0);
          expect(x, `${shape} x`).toBeLessThanOrEqual(1);
          expect(y, `${shape} y`).toBeGreaterThanOrEqual(0);
          expect(y, `${shape} y`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('renders SVG path data with the y axis flipped', () => {
    // The definitions are y-up like PDF space; SVG's y runs down the screen.
    // A tick starts at y=0.52 of the way up, so in a 100px box its first
    // command must be at 48 from the top.
    const d = markPathData('tick', 100, 100);
    expect(d.startsWith('M 10.00 48.00')).toBe(true);
  });

  it('keys the stroke to the shorter side, so a stretched rule is not fattened', () => {
    expect(markStrokeWidth(20, 20, 'medium')).toBeCloseTo(2, 5);
    // Six times as wide, same height: the pen stays the same.
    expect(markStrokeWidth(120, 20, 'medium')).toBeCloseTo(2, 5);
    expect(markStrokeWidth(20, 20, 'bold')).toBeGreaterThan(markStrokeWidth(20, 20, 'thin'));
  });
});

describe('drawing a mark onto a page', () => {
  /** Path objects the fixture already has, so a mark is counted as a delta. */
  async function basePathCount(): Promise<number> {
    return withFixture(
      'simple-text.pdf',
      (doc) => listPageObjects(doc, 0).filter((o) => o.type === ObjType.Path).length,
    );
  }

  it('adds one path object per mark, at the rectangle given', async () => {
    const base = await basePathCount();
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      insertPath(doc, {
        type: 'path',
        page: 0,
        rect: { left: 100, bottom: 400, right: 116, top: 416 },
        shape: 'cross',
        weight: 'medium',
        colour: { r: 0, g: 0, b: 0, a: 255 },
      });
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const paths = listPageObjects(doc, 0).filter((o) => o.type === ObjType.Path);

      // Both strokes of the cross are one object, so it selects, moves and
      // deletes as a single thing rather than coming apart.
      expect(paths.length).toBe(base + 1);

      const cross = paths.find((o) => o.bounds.left >= 95 && o.bounds.right <= 121);
      expect(cross).toBeDefined();
      expect(cross!.bounds.left).toBeGreaterThanOrEqual(99);
      expect(cross!.bounds.right).toBeLessThanOrEqual(117);
      expect(cross!.bounds.bottom).toBeGreaterThanOrEqual(399);
      expect(cross!.bounds.top).toBeLessThanOrEqual(417);
    });
  });

  it('actually paints, rather than building a path nothing draws', async () => {
    // The trap `insertRect` documents: without an explicit draw mode the path
    // is constructed and never painted, which looks like the tool silently
    // doing nothing.
    for (const shape of MARK_ORDER) {
      const bytes = await withFixture('simple-text.pdf', (doc) => {
        insertPath(doc, {
          type: 'path',
          page: 0,
          rect: { left: 100, bottom: 400, right: 160, top: 440 },
          shape,
          weight: 'bold',
          colour: { r: 0, g: 0, b: 0, a: 255 },
        });
        return doc.save();
      });

      const before = await withFixture('simple-text.pdf', (doc) =>
        ink(renderPage(doc, 0, { scale: 2 }).data),
      );
      const after = await withBytes(bytes, (doc) => ink(renderPage(doc, 0, { scale: 2 }).data));

      expect(after, `${shape} drew nothing`).toBeGreaterThan(before);
    }
  });

  it('survives a save and reopen as a path, not a picture', async () => {
    const base = await basePathCount();
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      insertPath(doc, {
        type: 'path',
        page: 0,
        rect: { left: 200, bottom: 300, right: 212, top: 312 },
        shape: 'tick',
        weight: 'medium',
        colour: { r: 20, g: 70, b: 190, a: 255 },
      });
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const objects = listPageObjects(doc, 0);
      expect(objects.filter((o) => o.type === ObjType.Path).length).toBe(base + 1);
      // Rasterising it would render the same on screen and soft on paper,
      // which is the whole reason a mark is drawn as a path.
      expect(objects.filter((o) => o.type === ObjType.Image).length).toBe(0);
    });
  });

  it('refuses a mark with no size rather than writing a degenerate path', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      expect(() =>
        insertPath(doc, {
          type: 'path',
          page: 0,
          rect: { left: 100, bottom: 400, right: 100, top: 400 },
          shape: 'cross',
          weight: 'medium',
          colour: { r: 0, g: 0, b: 0, a: 255 },
        }),
      ).toThrow(/no size/i);
      return null;
    });
  });
});
