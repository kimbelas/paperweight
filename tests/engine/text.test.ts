import { describe, expect, it } from 'vitest';
import { withFixture } from '../helpers';
import { getGlyphs, getTextLines, getTextRuns, hitTestLine } from '@/engine/text';

describe('text extraction', () => {
  it('reads the text objects on a page', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const runs = getTextRuns(doc, 0);
      expect(runs.length).toBe(6);
      const joined = runs.map((r) => r.text).join(' | ');
      expect(joined).toContain('Invoice INV-2024-001');
      expect(joined).toContain('Acme Corporation');
      expect(joined).toContain('PHP 45,000.00');
    });
  });

  it('reports font size, family and colour per run', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const runs = getTextRuns(doc, 0);
      const heading = runs.find((r) => r.text.includes('Invoice'))!;
      expect(heading.fontSize).toBeCloseTo(24, 0);
      expect(heading.font.family.toLowerCase()).toContain('helvetica');
      expect(heading.colour).toEqual({ r: 0, g: 0, b: 0, a: 255 });

      const bold = runs.find((r) => r.text.includes('Due date'))!;
      expect(bold.font.isBold).toBe(true);

      const serif = runs.find((r) => r.text.includes('Thank you'))!;
      expect(serif.font.isSerif).toBe(true);
      expect(serif.font.isBold).toBe(false);
    });
  });

  it('gives every run a sane bounding box', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      for (const run of getTextRuns(doc, 0)) {
        expect(run.bounds.right).toBeGreaterThan(run.bounds.left);
        expect(run.bounds.top).toBeGreaterThan(run.bounds.bottom);
        expect(run.bounds.left).toBeGreaterThanOrEqual(0);
        expect(run.bounds.top).toBeLessThanOrEqual(792);
      }
    });
  });

  it('reads glyphs with tight and loose boxes', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const glyphs = getGlyphs(doc, 0);
      expect(glyphs.length).toBeGreaterThan(50);

      const capitalI = glyphs.find((g) => g.unicode === 'I'.codePointAt(0))!;
      expect(capitalI).toBeDefined();
      // The layout box includes ascent and descent, so it is at least as tall
      // as the ink box.
      const tight = capitalI.box.top - capitalI.box.bottom;
      const loose = capitalI.looseBox.top - capitalI.looseBox.bottom;
      expect(loose).toBeGreaterThanOrEqual(tight - 0.01);
    });
  });

  it('finds text inside a form XObject as well as the page stream', async () => {
    // A reader that only walks the page's own content stream misses this.
    await withFixture('form-xobject-text.pdf', (doc) => {
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' ');
      expect(all).toContain('Text in the page stream');
      expect(all).toContain('Text inside the form XObject');
    });
  });

  it('reads text split across a contents array', async () => {
    await withFixture('contents-array.pdf', (doc) => {
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' ');
      expect(all).toContain('First stream text');
      expect(all).toContain('Second stream text');
      expect(all).toContain('Third stream text');
    });
  });
});

describe('line clustering', () => {
  it('groups each visual line into one editable unit', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const lines = getTextLines(doc, 0);
      // Six separate BT/ET blocks at six different y positions.
      expect(lines.length).toBe(6);
      for (const line of lines) {
        expect(line.runs.length).toBeGreaterThanOrEqual(1);
        expect(line.editable).toBe(true);
      }
    });
  });

  it('orders lines top to bottom', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const lines = getTextLines(doc, 0);
      for (let i = 1; i < lines.length; i++) {
        expect(lines[i - 1].baseline).toBeGreaterThan(lines[i].baseline);
      }
      expect(lines[0].text).toContain('Invoice');
    });
  });

  it('merges kerned runs on one baseline into a single line', async () => {
    // The point of clustering. A kerned TJ array is many text objects at the
    // same baseline; the user thinks of it as one line and must be able to
    // edit it as one.
    await withFixture('kerned-tj.pdf', (doc) => {
      const lines = getTextLines(doc, 0);
      expect(lines.length).toBe(3);

      const waterfall = lines.find((l) => l.text.includes('aterfall'))!;
      expect(waterfall).toBeDefined();
      expect(waterfall.text).toBe('Waterfall Project');

      const avatar = lines.find((l) => l.text === 'AVATAR')!;
      expect(avatar).toBeDefined();
    });
  });

  it('assigns the dominant font from the widest run', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const lines = getTextLines(doc, 0);
      const heading = lines[0];
      expect(heading.fontSize).toBeCloseTo(24, 0);
    });
  });

  it('finds no lines on a scanned page', async () => {
    await withFixture('scanned-page.pdf', (doc) => {
      expect(getTextLines(doc, 0)).toEqual([]);
    });
  });
});

describe('hit testing', () => {
  it('returns the line under a point inside the text', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const lines = getTextLines(doc, 0);
      const target = lines.find((l) => l.text.includes('Acme'))!;

      const midX = (target.bounds.left + target.bounds.right) / 2;
      const midY = (target.bounds.bottom + target.bounds.top) / 2;

      const hit = hitTestLine(doc, 0, midX, midY);
      expect(hit).not.toBeNull();
      expect(hit!.text).toContain('Acme');
    });
  });

  it('resolves a click to the right line among several', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      for (const line of getTextLines(doc, 0)) {
        const x = line.bounds.left + 2;
        const y = (line.bounds.bottom + line.bounds.top) / 2;
        const hit = hitTestLine(doc, 0, x, y);
        expect(hit?.id).toBe(line.id);
      }
    });
  });

  it('returns null for empty space far from any text', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      expect(hitTestLine(doc, 0, 560, 400)).toBeNull();
    });
  });

  it('returns null on a page with no text', async () => {
    await withFixture('scanned-page.pdf', (doc) => {
      expect(hitTestLine(doc, 0, 300, 400)).toBeNull();
    });
  });
});
