import { describe, expect, it } from 'vitest';
import { diffPixels, withBytes, withFixture } from '../helpers';
import { ObjType } from '@/engine/constants';
import type { PdfDocument } from '@/engine/document';
import { moveObjects } from '@/engine/move';
import { listPageObjects } from '@/engine/objects';
import { renderPage } from '@/engine/render';
import { removeSignature, scanPageForSignatures } from '@/engine/signatures';
import { getTextLines, getTextRuns } from '@/engine/text';
import { removeObjectsByPath, replaceLineText } from '@/engine/text-edit';

/**
 * Objects two or more form XObjects deep.
 *
 * PDFium rewrites a form's content stream only when that form sits directly
 * on the page and has had an object removed from it. Deeper than that, a
 * removal shows on screen and is missing from the saved file — which is how a
 * visa form filled online printed an edited address twice and a removed
 * signature. Every test here saves and reopens, because the object model in
 * memory had every one of these changes; only the bytes did not.
 *
 * The fixture places its outer form at (40, 30), the middle form at (10, 20)
 * inside it with a /Matrix of (5, 5), so the middle form's contents land 55pt
 * from where they are drawn. A third form sits inside the middle one. The
 * /Matrix is the point: PDFium's own rewrite of a form stream applies it
 * twice, which is why the engine dissolves the forms rather than letting
 * PDFium rewrite them, and why every geometry here is checked after a save.
 */

const NESTED = 'form-xobject-nested.pdf';
const CLIPPED = 'form-xobject-clipped.pdf';

interface Geometry {
  left: number;
  right: number;
  baseline: number;
}

/** Where every line on the page sits, by its text. */
function geometry(doc: PdfDocument): Map<string, Geometry> {
  const out = new Map<string, Geometry>();
  for (const line of getTextLines(doc, 0)) {
    out.set(line.text, {
      left: line.bounds.left,
      right: line.bounds.right,
      baseline: line.baseline,
    });
  }
  return out;
}

/** Every line other than those named survives at exactly its old position. */
function expectUnmoved(
  before: Map<string, Geometry>,
  after: Map<string, Geometry>,
  except: string[],
): void {
  for (const [text, was] of before) {
    if (except.some((e) => text.includes(e))) continue;
    const now = after.get(text);
    expect(now, `"${text}" is still on the page`).toBeDefined();
    expect(now!.left).toBeCloseTo(was.left, 1);
    expect(now!.right).toBeCloseTo(was.right, 1);
    expect(now!.baseline).toBeCloseTo(was.baseline, 1);
  }
}

const allText = (doc: PdfDocument) =>
  getTextRuns(doc, 0)
    .map((r) => r.text)
    .join(' | ');

describe('objects nested two and three forms deep', () => {
  it('reports nested geometry through the whole form chain', async () => {
    await withFixture(NESTED, (doc, mod) => {
      // The page-sized clip around the outer form never reaches the engine:
      // PDFium drops a rectangular clip that contains the whole object while
      // parsing, and -1 is how it reports "no clip". The refusal logic in
      // `hoist.ts` leans on that, so it is pinned here.
      const outer = mod.FPDFPage_GetObject(doc.page(0), 1);
      expect(mod.FPDFPageObj_GetType(outer)).toBe(ObjType.Form);
      expect(mod.FPDFClipPath_CountPaths(mod.FPDFPageObj_GetClipPath(outer))).toBe(-1);

      const lines = getTextLines(doc, 0);
      const two = lines.find((l) => l.text.includes('Nested two levels deep'))!;
      expect(two.runs[0].nested).toBe(true);
      expect(two.bounds.left).toBeGreaterThan(84);
      expect(two.bounds.left).toBeLessThan(88);
      expect(two.baseline).toBeCloseTo(655, 0);

      const three = lines.find((l) => l.text.includes('Three levels deep'))!;
      expect(three.runs[0].nested).toBe(true);
      expect(three.baseline).toBeCloseTo(465, 0);
    });
  });

  it('writes a text edit two levels deep into the saved file', async () => {
    const { bytes, before } = await withFixture(NESTED, async (doc) => {
      const before = geometry(doc);
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Nested two levels deep'))!;
      await replaceLineText(doc, { page: 0, lineId: line.id, text: 'Edited two levels deep' });
      return { bytes: doc.save(), before };
    });

    await withBytes(bytes, (doc) => {
      const text = allText(doc);
      expect(text).toContain('Edited two levels deep');
      // Gone from the file, not merely from the view. This is the line that
      // used to fail: every other viewer drew the replacement over the
      // original.
      expect(text).not.toContain('Nested two levels deep');

      const after = geometry(doc);
      const was = before.get('Nested two levels deep')!;
      const now = after.get('Edited two levels deep')!;
      // The font was substituted, so the first glyph's side bearing may move
      // the ink edge by a point or so; the baseline is exact.
      expect(Math.abs(now.left - was.left)).toBeLessThan(3);
      expect(now.baseline).toBeCloseTo(was.baseline, 1);
      expectUnmoved(before, after, ['Nested two levels deep']);

      // The forms that held the line were dissolved into the page, so what
      // used to be beside it is ordinary page content now, and editable.
      const sibling = getTextLines(doc, 0).find((l) => l.text.includes('Stays where it is'))!;
      expect(sibling.runs[0].nested).toBe(false);
      expect(sibling.editable).toBe(true);
      // The form off the path was moved whole, not dissolved.
      const deeper = getTextLines(doc, 0).find((l) => l.text.includes('Three levels deep'))!;
      expect(deeper.runs[0].nested).toBe(true);
    });
  });

  it('writes a text edit three levels deep into the saved file', async () => {
    const { bytes, before } = await withFixture(NESTED, async (doc) => {
      const before = geometry(doc);
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Three levels deep'))!;
      await replaceLineText(doc, { page: 0, lineId: line.id, text: 'Deepest line edited' });
      return { bytes: doc.save(), before };
    });

    await withBytes(bytes, (doc) => {
      const text = allText(doc);
      expect(text).toContain('Deepest line edited');
      expect(text).not.toContain('Three levels deep');

      const after = geometry(doc);
      const was = before.get('Three levels deep')!;
      const now = after.get('Deepest line edited')!;
      expect(Math.abs(now.left - was.left)).toBeLessThan(3);
      expect(now.baseline).toBeCloseTo(was.baseline, 1);
      expectUnmoved(before, after, ['Three levels deep']);
    });
  });

  it('removes an image two levels deep from the file, and nothing else', async () => {
    const before = await withFixture(NESTED, (doc) => ({
      render: renderPage(doc, 0, { scale: 1 }),
      lines: geometry(doc),
    }));

    const { bytes, image } = await withFixture(NESTED, (doc) => {
      const image = listPageObjects(doc, 0).find((o) => o.type === ObjType.Image)!;
      expect(image.nested).toBe(true);
      expect(image.path).toHaveLength(3);
      expect(removeObjectsByPath(doc, 0, [image.path])).toBe(1);
      return { bytes: doc.save(), image };
    });

    await withBytes(bytes, (doc) => {
      expect(listPageObjects(doc, 0).some((o) => o.type === ObjType.Image)).toBe(false);
      expectUnmoved(before.lines, geometry(doc), []);

      // Only the image's own footprint may differ. Bitmap y runs down the page.
      const after = renderPage(doc, 0, { scale: 1 });
      const pad = 2;
      const exclude = {
        x: Math.floor(image.bounds.left) - pad,
        y: Math.floor(before.render.height - image.bounds.top) - pad,
        width: Math.ceil(image.bounds.right - image.bounds.left) + 2 * pad,
        height: Math.ceil(image.bounds.top - image.bounds.bottom) + 2 * pad,
      };
      const { data, width, height } = before.render;
      expect(diffPixels(data, after.data, width, height, exclude)).toBe(0);
      // And the image really was drawn there before.
      expect(diffPixels(data, after.data, width, height)).toBeGreaterThan(0);
    });
  });

  it('removes a signature found two levels deep from the file', async () => {
    const bytes = await withFixture(NESTED, (doc) => {
      const image = scanPageForSignatures(doc, 0).find((c) => c.kind === 'image');
      expect(image).toBeDefined();
      expect(image!.reasons.join(' ')).toMatch(/Signature/);
      expect(removeSignature(doc, image!).removed).toBe(true);
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      expect(scanPageForSignatures(doc, 0).some((c) => c.kind === 'image')).toBe(false);
      // The label it sat next to is untouched.
      expect(allText(doc)).toContain('Signature');
    });
  });

  it('moves text two levels deep and keeps it moved after a save', async () => {
    const { bytes, before } = await withFixture(NESTED, (doc) => {
      const before = geometry(doc);
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Nested two levels deep'))!;
      const result = moveObjects(
        doc,
        0,
        line.runs.map((r) => r.path),
        15,
        25,
      );
      expect(result.moved).toBe(1);
      return { bytes: doc.save(), before };
    });

    await withBytes(bytes, (doc) => {
      const after = geometry(doc);
      const was = before.get('Nested two levels deep')!;
      const now = after.get('Nested two levels deep')!;
      expect(now.left).toBeCloseTo(was.left + 15, 0);
      expect(now.baseline).toBeCloseTo(was.baseline + 25, 0);
      expectUnmoved(before, after, ['Nested two levels deep']);
    });
  });

  it('leaves the one-level case exactly as it was', async () => {
    // The lift only happens below the first level; a form directly on the
    // page is already written by PDFium, and must not be touched.
    const bytes = await withFixture('form-xobject-text.pdf', async (doc) => {
      const line = getTextLines(doc, 0).find((l) => l.text.includes('inside the form'))!;
      await replaceLineText(doc, { page: 0, lineId: line.id, text: 'One level down' });
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const text = allText(doc);
      expect(text).toContain('One level down');
      expect(text).not.toContain('inside the form XObject');
      expect(text).toContain('Text in the page stream');
    });
  });
});

describe('a form clipped to a frame', () => {
  it('refuses the edit rather than reveal what the clip hides', async () => {
    await withFixture(CLIPPED, async (doc) => {
      const before = { text: allText(doc), render: renderPage(doc, 0, { scale: 1 }) };
      const line = getTextLines(doc, 0).find((l) => l.text.includes('Nested and clipped'))!;

      await expect(
        replaceLineText(doc, { page: 0, lineId: line.id, text: 'Changed' }),
      ).rejects.toThrow(/clip/i);

      // The refusal came before anything was mutated, in memory and on disk.
      expect(allText(doc)).toBe(before.text);
      await withBytes(doc.save(), (reopened) => {
        expect(allText(reopened)).toBe(before.text);
        const after = renderPage(reopened, 0, { scale: 1 });
        const { data, width, height } = before.render;
        expect(diffPixels(data, after.data, width, height)).toBe(0);
      });
    });
  });
});
