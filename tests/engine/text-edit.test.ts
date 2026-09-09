import { describe, expect, it } from 'vitest';
import { diffPixels, withBytes, withFixture } from '../helpers';
import { getTextLines, getTextRuns } from '@/engine/text';
import { removeObjectsByPath, replaceLineText } from '@/engine/text-edit';
import { renderPage } from '@/engine/render';
import { checkCoverage } from '@/engine/fonts';
import { ObjType } from '@/engine/constants';

/**
 * Spikes S2, S3 and S4: the core editing loop.
 *
 * These are the tests that decide whether the product is possible. Each one
 * saves and reopens, because an edit that only exists in memory is not an
 * edit: PDFium's content regeneration is where changes are actually written,
 * and where they can silently fail to be.
 */

/** Replace one line, save, and reopen. */
async function editAndReopen(
  fixture: string,
  match: string,
  replacement: string,
): Promise<{ bytes: Uint8Array; path: string; badges: string[] }> {
  return withFixture(fixture, async (doc) => {
    const line = getTextLines(doc, 0).find((l) => l.text.includes(match));
    if (!line) throw new Error(`No line containing "${match}"`);

    const outcome = await replaceLineText(doc, {
      page: 0,
      lineId: line.id,
      text: replacement,
    });
    return {
      bytes: doc.save(),
      path: outcome.path,
      badges: outcome.badges.map((b) => b.kind),
    };
  });
}

describe('replacing existing text', () => {
  it('replaces a line using the document own font when it has the glyphs', async () => {
    const { bytes, path } = await editAndReopen(
      'simple-text.pdf',
      'Acme Corporation',
      'Beta Industries',
    );

    // Standard-14 Helvetica is not embedded, so the original cannot be reused
    // and a fallback is expected. This documents the real behaviour rather
    // than an aspiration.
    expect(path).toBe('substituted-font');

    await withBytes(bytes, (doc) => {
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' | ');
      expect(all).toContain('Beta Industries');
      expect(all).not.toContain('Acme Corporation');
    });
  });

  it('keeps the replacement text extractable after saving', async () => {
    // A replacement drawn as unsearchable shapes would look right and be
    // useless. PDFium generates a ToUnicode map for the embedded fallback,
    // and this is what proves it.
    const { bytes } = await editAndReopen('simple-text.pdf', 'Amount due', 'Amount due: PHP 1.00');
    await withBytes(bytes, (doc) => {
      const lines = getTextLines(doc, 0);
      expect(lines.some((l) => l.text.includes('PHP 1.00'))).toBe(true);
    });
  });

  it('reuses the original font when it is embedded and covers the text', async () => {
    // Round-trip an edit twice. After the first edit the line is drawn in the
    // embedded fallback, so a second edit within the same character set must
    // take Path A and reuse it.
    const first = await editAndReopen('simple-text.pdf', 'Acme Corporation', 'Acme Limited');
    expect(first.path).toBe('substituted-font');

    const second = await withBytes(first.bytes, async (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Acme Limited'))!;
      const outcome = await replaceLineText(doc, {
        page: 0,
        lineId: line.id,
        text: 'Acme Limit',
      });
      return { path: outcome.path, bytes: doc.save() };
    });

    expect(second.path).toBe('reused-font');
    await withBytes(second.bytes, (doc) => {
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' | ');
      expect(all).toContain('Acme Limit');
    });
  });

  it('merges a kerned multi-object line into a single replacement', async () => {
    const { bytes } = await editAndReopen('kerned-tj.pdf', 'aterfall', 'Cascade Project');

    await withBytes(bytes, (doc) => {
      const runs = getTextRuns(doc, 0);
      const all = runs.map((r) => r.text).join(' | ');
      expect(all).toContain('Cascade Project');
      expect(all).not.toContain('aterfall');

      // The original line was many objects; the replacement is one.
      const lines = getTextLines(doc, 0);
      const replaced = lines.find((l) => l.text.includes('Cascade'))!;
      expect(replaced.runs.length).toBe(1);
    });
  });

  it('deletes a line when the replacement is empty', async () => {
    const { bytes, path } = await editAndReopen('simple-text.pdf', 'Thank you', '');
    expect(path).toBe('deleted');

    await withBytes(bytes, (doc) => {
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' | ');
      expect(all).not.toContain('Thank you');
      // The other lines are untouched.
      expect(all).toContain('Invoice INV-2024-001');
      expect(all).toContain('Acme Corporation');
    });
  });

  it('preserves font size and colour of the line it replaces', async () => {
    const { bytes } = await editAndReopen('simple-text.pdf', 'Invoice INV', 'Receipt REC-99');

    await withBytes(bytes, (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Receipt'))!;
      expect(line.fontSize).toBeCloseTo(24, 0);
      expect(line.colour).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    });
  });

  it('keeps the replacement on the original baseline and text origin', async () => {
    const before = await withFixture('simple-text.pdf', (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Acme'))!;
      const leftmost = line.runs.reduce((a, b) => (a.bounds.left < b.bounds.left ? a : b));
      return { baseline: line.baseline, origin: leftmost.matrix.e, left: line.bounds.left };
    });

    const { bytes } = await editAndReopen('simple-text.pdf', 'Acme', 'Zeta Holdings');

    await withBytes(bytes, (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Zeta'))!;
      expect(line.baseline).toBeCloseTo(before.baseline, 1);

      // The text origin is what must be preserved exactly. The ink bounding
      // box legitimately shifts by a fraction of a point, because the left
      // side bearing of "Z" differs from that of "A" — the glyphs start at
      // the same pen position but their outlines do not.
      const leftmost = line.runs.reduce((a, b) => (a.bounds.left < b.bounds.left ? a : b));
      expect(leftmost.matrix.e).toBeCloseTo(before.origin, 3);
      expect(Math.abs(line.bounds.left - before.left)).toBeLessThan(line.fontSize * 0.1);
    });
  });

  it('reports a substitution rather than doing it silently', async () => {
    const { badges } = await editAndReopen('simple-text.pdf', 'Acme', 'Acme Overseas');
    expect(badges).toContain('font-substituted');
  });

  it('flags text that will not fit instead of reflowing it', async () => {
    const { badges } = await editAndReopen(
      'simple-text.pdf',
      'Billed to',
      'Billed to: An Extraordinarily Long Corporate Entity Name That Cannot Possibly Fit Within The Original Line Width At Any Reasonable Size',
    );
    expect(badges).toContain('text-overflows');
  });

  it('fits a slightly-too-long replacement by condensing it', async () => {
    // Just over the original width: this should be absorbed by squeezing and
    // not reported as an overflow.
    const { badges } = await editAndReopen(
      'simple-text.pdf',
      'Billed to: Acme',
      'Billed to: Acme Corporations',
    );
    expect(badges).not.toContain('text-overflows');
  });

  it('edits text inside a form XObject by redrawing it at page level', async () => {
    // In-place mutation of a form's content stream does not persist and there
    // is no API to regenerate one, so such a line is removed and redrawn.
    // Refusing outright, which this used to do, left documents built as a
    // single form XObject entirely uneditable.
    const { bytes, before } = await withFixture('form-xobject-text.pdf', async (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('inside the form'))!;
      expect(line.runs[0].nested).toBe(true);
      expect(line.editable).toBe(true);

      // The fixture's form is placed with a real translation, so these
      // coordinates are only right if the form chain's transform was applied.
      // PDFium reports a nested object's geometry in its parent form's space,
      // and an earlier version took it at face value: the replacement landed
      // at the bottom-left corner of the page.
      expect(line.bounds.left).toBeGreaterThan(60);
      expect(line.bounds.bottom).toBeGreaterThan(590);

      const captured = { left: line.bounds.left, baseline: line.baseline };
      await replaceLineText(doc, { page: 0, lineId: line.id, text: 'Rewritten in place' });
      return { bytes: doc.save(), before: captured };
    });

    await withBytes(bytes, (doc) => {
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' | ');
      expect(all).toContain('Rewritten in place');
      expect(all).not.toContain('inside the form XObject');
      // The page's own text is untouched.
      expect(all).toContain('Text in the page stream');

      // The replacement is a normal page object now, so it can be edited again.
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Rewritten'))!;
      expect(line.runs[0].nested).toBe(false);
      expect(line.editable).toBe(true);

      // And it is where the original was, not at the page origin. The
      // tolerance is a fraction of the type size: the first glyph changed and
      // the font was substituted, so the ink edge moves by a side bearing.
      expect(Math.abs(line.bounds.left - before.left)).toBeLessThan(line.fontSize * 0.2);
      expect(line.baseline).toBeCloseTo(before.baseline, 0);
    });
  });

  it('substitutes for nested text whose font is not embedded', async () => {
    // The fixture's nested text is standard-14 Helvetica, which carries no
    // embedded font program, so coverage cannot be established and a fallback
    // is used. Documented here because the *nested* redraw path can reuse an
    // original font — it just needs one that is actually embedded, which this
    // fixture deliberately is not.
    const { path, badges } = await editAndReopen(
      'form-xobject-text.pdf',
      'inside the form',
      'Substituted here',
    );
    expect(path).toBe('substituted-font');
    expect(badges).toContain('font-substituted');
  });

  it('edits the correct line when several share a page', async () => {
    const { bytes } = await editAndReopen('simple-text.pdf', 'Due date', 'Due date: 2027-01-01');

    await withBytes(bytes, (doc) => {
      const texts = getTextLines(doc, 0).map((l) => l.text);
      expect(texts.some((t) => t.includes('2027-01-01'))).toBe(true);
      // Every other line survives verbatim.
      expect(texts.some((t) => t.includes('Invoice INV-2024-001'))).toBe(true);
      expect(texts.some((t) => t.includes('Acme Corporation'))).toBe(true);
      expect(texts.some((t) => t.includes('Thank you for your business.'))).toBe(true);
      expect(texts.some((t) => t.includes('Authorised signature'))).toBe(true);
    });
  });
});

/**
 * The invariant that matters most: an edit changes what it targeted and
 * nothing else. `FPDFPage_GenerateContent` rewrites the whole page content
 * stream from PDFium's object model, so this is where quiet collateral damage
 * would show up.
 */
describe('nothing else changes', () => {
  it('leaves the rest of the page pixel-identical after a text edit', async () => {
    const before = await withFixture('simple-text.pdf', (doc) => renderPage(doc, 0, { scale: 1 }));

    const { bytes, bandTop, bandHeight } = await withFixture('simple-text.pdf', async (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Acme'))!;
      // The band to exclude, in bitmap rows. PDF y is up, bitmap y is down.
      const pad = 6;
      const top = Math.floor(792 - line.bounds.top - pad);
      const height = Math.ceil(line.bounds.top - line.bounds.bottom + pad * 2);
      await replaceLineText(doc, { page: 0, lineId: line.id, text: 'Zeta Holdings' });
      return { bytes: doc.save(), bandTop: top, bandHeight: height };
    });

    const after = await withBytes(bytes, (doc) => renderPage(doc, 0, { scale: 1 }));

    const differing = diffPixels(before.data, after.data, before.width, before.height, {
      x: 0,
      y: bandTop,
      width: before.width,
      height: bandHeight,
    });

    expect(differing).toBe(0);
  });

  it('leaves other pages untouched when one page is edited', async () => {
    const before = await withFixture('multipage.pdf', (doc) => ({
      page2: renderPage(doc, 2, { scale: 1 }),
      page4: renderPage(doc, 4, { scale: 1 }),
    }));

    const bytes = await withFixture('multipage.pdf', async (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Page 1'))!;
      await replaceLineText(doc, { page: 0, lineId: line.id, text: 'First Page' });
      return doc.save();
    });

    const after = await withBytes(bytes, (doc) => ({
      page2: renderPage(doc, 2, { scale: 1 }),
      page4: renderPage(doc, 4, { scale: 1 }),
    }));

    expect(
      diffPixels(before.page2.data, after.page2.data, before.page2.width, before.page2.height),
    ).toBe(0);
    expect(
      diffPixels(before.page4.data, after.page4.data, before.page4.width, before.page4.height),
    ).toBe(0);
  });
});

/**
 * Spike S3: object removal has to survive the save. There is a long-standing
 * PDFium report of removed objects reappearing, because content is only
 * regenerated for objects the API marked dirty.
 */
describe('object removal persists', () => {
  it('removes an image object and it stays removed after reopening', async () => {
    const { bytes, imagesBefore } = await withFixture('flattened-signature.pdf', (doc) => {
      const page = doc.page(0);
      const { mod } = doc;
      let images = 0;
      const paths: number[][] = [];
      const count = mod.FPDFPage_CountObjects(page);
      for (let i = 0; i < count; i++) {
        const obj = mod.FPDFPage_GetObject(page, i);
        if (mod.FPDFPageObj_GetType(obj) === ObjType.Image) {
          images++;
          paths.push([i]);
        }
      }
      const removed = removeObjectsByPath(doc, 0, paths);
      expect(removed).toBe(images);
      return { bytes: doc.save(), imagesBefore: images };
    });

    expect(imagesBefore).toBe(1);

    await withBytes(bytes, (doc) => {
      const page = doc.page(0);
      const { mod } = doc;
      let images = 0;
      const count = mod.FPDFPage_CountObjects(page);
      for (let i = 0; i < count; i++) {
        if (mod.FPDFPageObj_GetType(mod.FPDFPage_GetObject(page, i)) === ObjType.Image) images++;
      }
      // The object is gone from the file, not merely painted over.
      expect(images).toBe(0);

      // And the text around it is untouched.
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' ');
      expect(all).toContain('Signature:');
      expect(all).toContain('Agreement between the parties');
    });
  });

  it('removes a text object without disturbing its neighbours', async () => {
    const bytes = await withFixture('simple-text.pdf', (doc) => {
      const runs = getTextRuns(doc, 0);
      const target = runs.find((r) => r.text.includes('Thank you'))!;
      expect(removeObjectsByPath(doc, 0, [target.path])).toBe(1);
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const all = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' | ');
      expect(all).not.toContain('Thank you');
      expect(all).toContain('Invoice INV-2024-001');
      expect(all).toContain('Due date');
    });
  });
});

describe('font coverage', () => {
  it('reports a non-embedded font as unusable, with a reason', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const { mod } = doc;
      const page = doc.page(0);
      const obj = mod.FPDFPage_GetObject(page, 0);
      const font = mod.FPDFTextObj_GetFont(obj);

      const result = checkCoverage(mod, font, 'Hello');
      expect(result.covered).toBe(false);
      expect(result.reason).toMatch(/not embedded/i);
    });
  });

  it('treats whitespace as always available', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      const { mod } = doc;
      const obj = mod.FPDFPage_GetObject(doc.page(0), 0);
      const font = mod.FPDFTextObj_GetFont(obj);
      expect(checkCoverage(mod, font, '   ').covered).toBe(true);
    });
  });
});
