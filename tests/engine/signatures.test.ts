import { describe, expect, it } from 'vitest';
import { diffPixels, withBytes, withFixture } from '../helpers';
import { listAnnotations, listDigitalSignatures } from '@/engine/annotations';
import { removeSignature, scanForSignatures, scanPageForSignatures } from '@/engine/signatures';
import { renderPage } from '@/engine/render';
import { getTextRuns } from '@/engine/text';
import { AnnotSubtype, ObjType } from '@/engine/constants';

/**
 * Spike S10, and the signature feature as a whole.
 *
 * Each removal saves and reopens, because the question is whether the
 * signature is gone from the file, not whether it stopped being painted.
 */

describe('reading annotations', () => {
  it('lists stamp and ink annotations with their titles', async () => {
    await withFixture('annotation-signatures.pdf', (doc) => {
      const annots = listAnnotations(doc, 0);
      expect(annots.length).toBe(2);

      const stamp = annots.find((a) => a.subtype === AnnotSubtype.Stamp)!;
      expect(stamp.title).toBe('Approved signature');
      expect(stamp.name).toBe('sig-stamp-1');

      const ink = annots.find((a) => a.subtype === AnnotSubtype.Ink)!;
      expect(ink.title).toBe('Hand-drawn');
    });
  });

  it('distinguishes an empty signature field from a signed one', async () => {
    // The distinction that matters: an unsigned field is a placeholder, and
    // removing it invalidates nothing. Tools that conflate the two warn
    // people about destroying a signature that was never there.
    await withFixture('acroform-sig-field.pdf', (doc) => {
      const annots = listAnnotations(doc, 0);

      const sig = annots.find((a) => a.fieldType === 'Sig')!;
      expect(sig).toBeDefined();
      expect(sig.title).toBe('Signature1');
      expect(sig.hasValue).toBe(false);
      expect(sig.isEmptySignatureField).toBe(true);
      expect(sig.isSignedSignatureField).toBe(false);

      const text = annots.find((a) => a.fieldType === 'Tx')!;
      expect(text.title).toBe('FullName');
      expect(text.hasValue).toBe(true);
    });
  });

  it('reads field types without a form-fill environment', async () => {
    await withFixture('acroform-sig-field.pdf', (doc) => {
      const types = listAnnotations(doc, 0).map((a) => a.fieldType);
      expect(types).toContain('Sig');
      expect(types).toContain('Tx');
    });
  });

  it('reports no digital signatures in an unsigned document', async () => {
    await withFixture('annotation-signatures.pdf', (doc) => {
      expect(listDigitalSignatures(doc)).toEqual([]);
    });
  });
});

describe('detecting signatures', () => {
  it('finds annotation signatures and says why', async () => {
    await withFixture('annotation-signatures.pdf', (doc) => {
      const found = scanPageForSignatures(doc, 0);
      expect(found.length).toBe(2);

      for (const c of found) {
        expect(c.kind).toBe('annotation');
        expect(c.reasons.length).toBeGreaterThan(0);
      }

      // Ink is nearly always a signature, and the title corroborates it.
      const ink = found.find((c) => c.reasons.some((r) => /ink/i.test(r)))!;
      expect(ink.confidence).toBe('high');
    });
  });

  it('finds a flattened image signature next to its label', async () => {
    await withFixture('flattened-signature.pdf', (doc) => {
      const found = scanPageForSignatures(doc, 0);
      const image = found.find((c) => c.kind === 'image');
      expect(image).toBeDefined();
      expect(image!.objectPath).toBeDefined();
      // The label is the strongest signal, so it should be cited.
      expect(image!.reasons.join(' ')).toMatch(/Signature/i);
      expect(['high', 'medium']).toContain(image!.confidence);
    });
  });

  it('does not mistake body text or rules for signatures', async () => {
    await withFixture('simple-text.pdf', (doc) => {
      // simple-text.pdf has an "Authorised signature" label and a rule, but
      // no image and no annotation, so there is nothing to remove.
      const found = scanPageForSignatures(doc, 0);
      expect(found).toEqual([]);
    });
  });

  it('reports a scanned page as carrying an unremovable signature', async () => {
    await withFixture('scanned-page.pdf', (doc) => {
      const found = scanPageForSignatures(doc, 0);
      expect(found.length).toBe(1);
      expect(found[0].kind).toBe('raster');
      expect(found[0].reasons.join(' ')).toMatch(/cannot be removed/i);
    });
  });

  it('flags an empty signature field as harmless to remove', async () => {
    await withFixture('acroform-sig-field.pdf', (doc) => {
      const found = scanPageForSignatures(doc, 0);
      const field = found.find((c) => c.annotationIndex !== undefined)!;
      expect(field.invalidatesSignature).toBe(false);
      expect(field.reasons.join(' ')).toMatch(/nothing in it|does not invalidate/i);
    });
  });

  it('sorts candidates most-certain first', async () => {
    await withFixture('annotation-signatures.pdf', (doc) => {
      const scan = scanForSignatures(doc);
      const order = ['certain', 'high', 'medium', 'low'];
      const positions = scan.candidates.map((c) => order.indexOf(c.confidence));
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
      }
    });
  });
});

describe('removing signatures', () => {
  it('removes a stamp annotation and it stays gone after saving', async () => {
    const bytes = await withFixture('annotation-signatures.pdf', (doc) => {
      const stamp = scanPageForSignatures(doc, 0).find((c) =>
        c.reasons.some((r) => /stamp/i.test(r)),
      )!;
      const result = removeSignature(doc, stamp);
      expect(result.removed).toBe(true);
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const annots = listAnnotations(doc, 0);
      expect(annots.length).toBe(1);
      expect(annots.some((a) => a.subtype === AnnotSubtype.Stamp)).toBe(false);
      // The ink signature is untouched.
      expect(annots.some((a) => a.subtype === AnnotSubtype.Ink)).toBe(true);
    });
  });

  it('removes an ink annotation', async () => {
    const bytes = await withFixture('annotation-signatures.pdf', (doc) => {
      const ink = scanPageForSignatures(doc, 0).find((c) => c.reasons.some((r) => /ink/i.test(r)))!;
      removeSignature(doc, ink);
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      expect(listAnnotations(doc, 0).some((a) => a.subtype === AnnotSubtype.Ink)).toBe(false);
    });
  });

  it('removes a flattened image signature from the file, not just the view', async () => {
    const bytes = await withFixture('flattened-signature.pdf', (doc) => {
      const image = scanPageForSignatures(doc, 0).find((c) => c.kind === 'image')!;
      const result = removeSignature(doc, image);
      expect(result.removed).toBe(true);
      return doc.save();
    });

    await withBytes(bytes, (doc) => {
      const { mod } = doc;
      const page = doc.page(0);
      let images = 0;
      const count = mod.FPDFPage_CountObjects(page);
      for (let i = 0; i < count; i++) {
        if (mod.FPDFPageObj_GetType(mod.FPDFPage_GetObject(page, i)) === ObjType.Image) images++;
      }
      // Gone as an object. A white rectangle over it would leave this at 1.
      expect(images).toBe(0);

      // And the agreement text is intact.
      const text = getTextRuns(doc, 0)
        .map((r) => r.text)
        .join(' ');
      expect(text).toContain('Agreement between the parties');
      expect(text).toContain('Signature:');
    });
  });

  it('removes an empty signature field without a warning badge', async () => {
    const { bytes, badges } = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = scanPageForSignatures(doc, 0).find((c) => c.kind === 'annotation')!;
      const result = removeSignature(doc, field);
      return { bytes: doc.save(), badges: result.badges.map((b) => b.kind) };
    });

    expect(badges).not.toContain('signature-invalidated');

    await withBytes(bytes, (doc) => {
      expect(listAnnotations(doc, 0).some((a) => a.fieldType === 'Sig')).toBe(false);
      // The other form field survives.
      expect(listAnnotations(doc, 0).some((a) => a.fieldType === 'Tx')).toBe(true);
    });
  });

  it('refuses to remove a raster signature instead of covering it silently', async () => {
    await withFixture('scanned-page.pdf', (doc) => {
      const raster = scanPageForSignatures(doc, 0)[0];
      expect(() => removeSignature(doc, raster)).toThrow(/cannot be removed as an object/i);
      expect(() => removeSignature(doc, raster)).toThrow(/Cover tool/i);
    });
  });

  it('leaves the rest of the page untouched when a signature is removed', async () => {
    const before = await withFixture('flattened-signature.pdf', (doc) =>
      renderPage(doc, 0, { scale: 1 }),
    );

    const { bytes, band } = await withFixture('flattened-signature.pdf', (doc) => {
      const image = scanPageForSignatures(doc, 0).find((c) => c.kind === 'image')!;
      const pad = 4;
      const band = {
        x: Math.floor(image.bounds.left - pad),
        y: Math.floor(792 - image.bounds.top - pad),
        width: Math.ceil(image.bounds.right - image.bounds.left + pad * 2),
        height: Math.ceil(image.bounds.top - image.bounds.bottom + pad * 2),
      };
      removeSignature(doc, image);
      return { bytes: doc.save(), band };
    });

    const after = await withBytes(bytes, (doc) => renderPage(doc, 0, { scale: 1 }));

    expect(diffPixels(before.data, after.data, before.width, before.height, band)).toBe(0);
  });
});
