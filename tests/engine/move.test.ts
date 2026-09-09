import { describe, expect, it } from 'vitest';
import { withBytes, withFixture } from '../helpers';
import { moveObjects } from '@/engine/move';
import { getTextLines, getTextRuns } from '@/engine/text';
import { listPageObjects } from '@/engine/objects';
import { ObjType } from '@/engine/constants';

/**
 * Moving existing content.
 *
 * Every case saves and reopens, because a move that only exists in PDFium's
 * object model is not a move: the nested path in particular looked like it
 * worked before it was written this way.
 */

describe('moving top-level text', () => {
  it('moves a line and the move survives a save', async () => {
    const before = await withFixture('simple-text.pdf', (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Acme'))!;
      return { left: line.bounds.left, bottom: line.bounds.bottom, text: line.text };
    });

    const bytes = await withFixture('simple-text.pdf', (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Acme'))!;
      const result = moveObjects(
        doc,
        0,
        line.runs.map((r) => r.path),
        40,
        -25,
      );
      expect(result.moved).toBe(line.runs.length);
      expect(result.badges).toEqual([]);
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Acme'))!;
      // Trimmed, because PDFium's extraction inserts *generated* whitespace
      // based on geometry: moving a line changes its position relative to its
      // neighbours and a trailing space can appear that is not in the file.
      // The glyphs that were drawn are unchanged, which is what matters.
      expect(line.text.trim()).toBe(before.text.trim());
      expect(line.bounds.left).toBeCloseTo(before.left + 40, 0);
      expect(line.bounds.bottom).toBeCloseTo(before.bottom - 25, 0);
    });
  });

  it('keeps the font and size when moving', async () => {
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Invoice'))!;
      moveObjects(
        doc,
        0,
        line.runs.map((r) => r.path),
        10,
        10,
      );
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Invoice'))!;
      expect(line.fontSize).toBeCloseTo(24, 0);
      // Moving must not substitute anything: the text is unchanged, so the
      // original font is still correct.
      expect(line.font.baseFont).toMatch(/Helvetica/i);
    });
  });

  it('moves an image', async () => {
    const before = await withFixture('flattened-signature.pdf', (doc) => {
      const image = listPageObjects(doc, 0).find((o) => o.type === ObjType.Image)!;
      return { left: image.bounds.left, bottom: image.bounds.bottom, path: image.path };
    });

    const bytes = await withFixture('flattened-signature.pdf', (doc) => {
      const image = listPageObjects(doc, 0).find((o) => o.type === ObjType.Image)!;
      moveObjects(doc, 0, [image.path], -30, 15);
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const image = listPageObjects(doc, 0).find((o) => o.type === ObjType.Image)!;
      expect(image.bounds.left).toBeCloseTo(before.left - 30, 0);
      expect(image.bounds.bottom).toBeCloseTo(before.bottom + 15, 0);
    });
  });

  it('does nothing for a delta of zero', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const line = getTextLines(doc, 0)[0];
      expect(
        moveObjects(
          doc,
          0,
          line.runs.map((r) => r.path),
          0,
          0,
        ).moved,
      ).toBe(0);
    });
  });

  it('leaves other lines where they were', async () => {
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Acme'))!;
      moveObjects(
        doc,
        0,
        line.runs.map((r) => r.path),
        60,
        0,
      );
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const texts = getTextLines(doc, 0).map((l) => l.text);
      expect(texts.some((t) => t.includes('Invoice INV-2024-001'))).toBe(true);
      expect(texts.some((t) => t.includes('Amount due'))).toBe(true);
      expect(texts.some((t) => t.includes('Thank you'))).toBe(true);
    });
  });
});

describe('moving nested text', () => {
  it('moves text out of a form XObject and onto the page', async () => {
    // The nested case cannot translate a matrix in place, so it is removed
    // and redrawn. The proof is that the text keeps its content and lands at
    // the offset position after a save.
    const before = await withFixture('form-xobject-text.pdf', (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('inside the form'))!;
      expect(line.runs[0].nested).toBe(true);
      return { left: line.bounds.left, bottom: line.bounds.bottom, size: line.fontSize };
    });

    const bytes = await withFixture('form-xobject-text.pdf', (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('inside the form'))!;
      const result = moveObjects(
        doc,
        0,
        line.runs.map((r) => r.path),
        25,
        40,
      );
      expect(result.moved).toBe(1);
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('inside the form'));
      expect(line).toBeDefined();
      expect(line!.bounds.left).toBeCloseTo(before.left + 25, 0);
      expect(line!.bounds.bottom).toBeCloseTo(before.bottom + 40, 0);
      // Redrawn at page level, so it is a normal editable object now.
      expect(line!.runs[0].nested).toBe(false);
      expect(line!.editable).toBe(true);
      expect(line!.fontSize).toBeCloseTo(before.size, 0);
    });
  });

  it('keeps the original font when moving nested text', async () => {
    // The text is unchanged, so the embedded subset certainly covers it.
    // Substituting here would be a needless downgrade.
    const bytes = await withFixture('form-xobject-text.pdf', (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('inside the form'))!;
      moveObjects(
        doc,
        0,
        line.runs.map((r) => r.path),
        5,
        5,
      );
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('inside the form'))!;
      expect(line.font.baseFont).toMatch(/Helvetica/i);
    });
  });

  it('leaves the page-level text alone', async () => {
    const bytes = await withFixture('form-xobject-text.pdf', (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('inside the form'))!;
      moveObjects(
        doc,
        0,
        line.runs.map((r) => r.path),
        20,
        20,
      );
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' | ');
      expect(all).toContain('Text in the page stream');
    });
  });
});
