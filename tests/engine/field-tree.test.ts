import { describe, expect, it } from 'vitest';
import { diffPixels, fixtureBytes, loadEngine, withBytes, withFixture } from '../helpers';
import { listAnnotations, removeAnnotations } from '@/engine/annotations';
import { detachFieldsFromForm } from '@/engine/field-tree';
import { convertFieldToText, formFieldByName, listFormFields } from '@/engine/forms';
import { renderPage } from '@/engine/render';
import { EditorSession } from '@/engine/session';
import { removeSignature, scanPageForSignatures } from '@/engine/signatures';
import type { PdfDocument } from '@/engine/document';

/**
 * Removing a widget has to remove its field from `/AcroForm /Fields`.
 *
 * `FPDFPage_RemoveAnnot` only edits the page's `/Annots`. PDFium draws from
 * that array, so the editor showed the field gone; Acrobat builds its form
 * from the field tree, so the download showed it back, with its old value.
 * The user's report was exactly that: deleted in the editor, still there in
 * Adobe. These tests read the saved bytes, because the saved bytes are what
 * Adobe reads.
 *
 * The inspection helpers below are regexes over PDFium's own output rather
 * than the parser in `field-tree.ts`, so the module is not being asked to
 * grade its own work.
 */

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** Object numbers referenced from a stretch of PDF syntax. */
function refs(text: string): number[] {
  return [...text.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
}

/** The body of an indirect object in a saved file. */
function objectBody(bytes: Uint8Array, num: number): string {
  const match = latin1(bytes).match(new RegExp(`[\\r\\n]${num} 0 obj\\s*([^]*?)\\s*endobj`));
  if (!match) throw new Error(`Object ${num} is not in the file.`);
  return match[1];
}

/**
 * Whether the file still carries this object at all.
 *
 * PDFium writes only what is reachable from the catalog, so a field that has
 * left the tree is not merely unreferenced after the next save: it is gone.
 */
function hasObject(bytes: Uint8Array, num: number): boolean {
  return new RegExp(`[\\r\\n]${num} 0 obj`).test(latin1(bytes));
}

/** What `/AcroForm /Fields` refers to, whether inline or an indirect array. */
function fieldRefs(bytes: Uint8Array): number[] {
  const text = latin1(bytes);
  const acroForm = text.match(/\/AcroForm\s*(?:<<|(\d+) 0 R)/);
  if (!acroForm) throw new Error('No /AcroForm.');
  const dict = acroForm[1] ? objectBody(bytes, Number(acroForm[1])) : text.slice(acroForm.index!);
  const inline = dict.match(/\/Fields\s*\[([^\]]*)\]/);
  if (inline) return refs(inline[1]);
  const indirect = dict.match(/\/Fields\s+(\d+) 0 R/);
  if (!indirect) throw new Error('No /Fields.');
  return refs(objectBody(bytes, Number(indirect[1])));
}

/** What a field's `/Kids` refers to. */
function kidRefs(bytes: Uint8Array, num: number): number[] {
  const kids = objectBody(bytes, num).match(/\/Kids\s*\[([^\]]*)\]/);
  return kids ? refs(kids[1]) : [];
}

/** The calculation order, `/AcroForm /CO`. */
function calculationOrder(bytes: Uint8Array): number[] {
  const text = latin1(bytes);
  const acroForm = text.match(/\/AcroForm\s+(\d+) 0 R/);
  const dict = acroForm ? objectBody(bytes, Number(acroForm[1])) : text;
  const co = dict.match(/\/CO\s*\[([^\]]*)\]/);
  return co ? refs(co[1]) : [];
}

/** The object number behind an annotation, by index. */
function objectNumberOf(doc: PdfDocument, pageIndex: number, index: number): number {
  const annot = doc.mod.FPDFPage_GetAnnot(doc.page(pageIndex), index);
  try {
    return doc.mod.EPDFAnnot_GetObjectNumber(annot);
  } finally {
    doc.mod.FPDFPage_CloseAnnot(annot);
  }
}

/** The index of the widget drawn at this left edge, after earlier removals. */
function widgetIndexAt(doc: PdfDocument, left: number, bottom: number): number {
  const found = listAnnotations(doc, 0).find(
    (a) => Math.abs(a.bounds.left - left) < 0.5 && Math.abs(a.bounds.bottom - bottom) < 0.5,
  );
  if (!found) throw new Error(`No widget at ${left},${bottom}.`);
  return found.index;
}

// field-tree.pdf, by object number. See scripts/make-fixtures.mjs.
const NAME_FIELD = 5;
const NAME_WIDGET = 6;
const SEX_GROUP = 7;
const SEX_F = 8;
const SEX_M = 9;
const SUBFORM = 10;
const PAGE1 = 11;
const F1 = 14;

describe('removing a widget detaches its field from the form', () => {
  it('takes a root field out of /Fields, and changes nothing else on the page', async () => {
    // filled-form.pdf: four merged field-and-widget dictionaries, all listed
    // in /Fields directly. Surname is object 5.
    const { before, after, bytes } = await withFixture('filled-form.pdf', (doc) => {
      expect(fieldRefs(doc.save())).toEqual([5, 6, 8, 10]);
      const before = renderPage(doc, 0, { scale: 1, annotations: true });

      expect(removeAnnotations(doc, 0, [0])).toBe(1);

      const after = renderPage(doc, 0, { scale: 1, annotations: true });
      return { before, after, bytes: doc.save() };
    });

    // This is the line Adobe reads.
    expect(fieldRefs(bytes)).toEqual([6, 8, 10]);
    // And the field's dictionary -- rectangle, page, value -- is not in the
    // file to be found by anything else either.
    expect(hasObject(bytes, 5)).toBe(false);

    // The other three fields are untouched, values included: the reload
    // behind the removal must not disturb how they draw.
    const surname = { x: 250, y: 792 - 674, width: 210, height: 18 };
    expect(diffPixels(before.data, after.data, before.width, before.height, surname)).toBe(0);

    await withBytes(bytes, (doc) => {
      const names = listFormFields(doc, 0).map((f) => f.name);
      expect(names).toEqual(['GivenNames', 'Nationality', 'Female']);
      expect(formFieldByName(doc, 0, 'GivenNames')?.value).toBe('JANE ANNE ELIZABETH DOE');
    });
  });

  it('removes a field whose only widget was a separate kid', async () => {
    const bytes = await withFixture('field-tree.pdf', (doc) => {
      expect(fieldRefs(doc.save())).toEqual([NAME_FIELD, SEX_GROUP, SUBFORM]);
      removeAnnotations(doc, 0, [widgetIndexAt(doc, 250, 656)]);
      return doc.save();
    });

    expect(fieldRefs(bytes)).toEqual([SEX_GROUP, SUBFORM]);
    // The field was left with no kids, so it went too, and with nothing
    // referring to either, neither the field nor its widget is in the file.
    expect(hasObject(bytes, NAME_FIELD)).toBe(false);
    expect(hasObject(bytes, NAME_WIDGET)).toBe(false);
    // And it has left the calculation order.
    expect(calculationOrder(bytes)).toEqual([F1]);

    await withBytes(bytes, (doc) => {
      const names = listFormFields(doc, 0).map((f) => f.name);
      expect(names).not.toContain('Name');
      expect(names).toContain('Sex');
    });
  });

  it('leaves a radio group standing while it has a widget, and removes it with the last', async () => {
    const { afterOne, afterBoth } = await withFixture('field-tree.pdf', (doc) => {
      removeAnnotations(doc, 0, [widgetIndexAt(doc, 250, 616)]);
      const afterOne = doc.save();
      removeAnnotations(doc, 0, [widgetIndexAt(doc, 300, 616)]);
      return { afterOne, afterBoth: doc.save() };
    });

    expect(kidRefs(afterOne, SEX_GROUP)).toEqual([SEX_M]);
    expect(fieldRefs(afterOne)).toContain(SEX_GROUP);
    expect(hasObject(afterOne, SEX_F)).toBe(false);

    expect(fieldRefs(afterBoth)).toEqual([NAME_FIELD, SUBFORM]);
    expect(hasObject(afterBoth, SEX_GROUP)).toBe(false);
    expect(hasObject(afterBoth, SEX_M)).toBe(false);
  });

  it('prunes the groups a nested field leaves empty', async () => {
    const bytes = await withFixture('field-tree.pdf', (doc) => {
      removeAnnotations(doc, 0, [widgetIndexAt(doc, 250, 576)]);
      return doc.save();
    });

    expect(fieldRefs(bytes)).toEqual([NAME_FIELD, SEX_GROUP]);
    // Page1 lost its only kid and topmostSubform lost its only kid in turn,
    // so neither group is left in the file as an empty shell.
    expect(hasObject(bytes, F1)).toBe(false);
    expect(hasObject(bytes, PAGE1)).toBe(false);
    expect(hasObject(bytes, SUBFORM)).toBe(false);
    expect(calculationOrder(bytes)).toEqual([NAME_FIELD]);
  });

  it('empties the tree when every widget on the page goes at once', async () => {
    const bytes = await withFixture('field-tree.pdf', (doc) => {
      removeAnnotations(doc, 0, [0, 1, 2, 3]);
      return doc.save();
    });

    expect(fieldRefs(bytes)).toEqual([]);
    expect(calculationOrder(bytes)).toEqual([]);
    await withBytes(bytes, (doc) => {
      expect(listAnnotations(doc, 0)).toEqual([]);
      expect(listFormFields(doc, 0)).toEqual([]);
    });
  });

  it('applies to a signature field removed through the signature path', async () => {
    const { bytes, signaturesLeft } = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = scanPageForSignatures(doc, 0).find((c) => c.kind === 'annotation')!;
      removeSignature(doc, field);
      return {
        bytes: doc.save(),
        // PDFium's own count walks /AcroForm /Fields, not /Annots.
        signaturesLeft: doc.mod.FPDF_GetSignatureCount(doc.handle),
      };
    });

    expect(fieldRefs(bytes)).toEqual([6]);
    expect(signaturesLeft).toBe(0);
  });

  it('applies to a field converted into page text', async () => {
    const { removed, bytes } = await withFixture('autosize-no-appearance.pdf', async (doc) => {
      const field = formFieldByName(doc, 0, 'Surname')!;
      const removed = objectNumberOf(doc, 0, listAnnotations(doc, 0)[0].index);
      const fieldsBefore = fieldRefs(doc.save());
      expect(fieldsBefore).toContain(removed);

      await convertFieldToText(doc, field, 'DOE');
      doc.flushDirty();
      return { removed, bytes: doc.save() };
    });

    // Otherwise Acrobat would show the drawn text and the rebuilt field, with
    // its old value, on top of each other.
    expect(fieldRefs(bytes)).not.toContain(removed);
  });
});

describe('detachFieldsFromForm on its own', () => {
  it('changes no byte offsets and leaves the input alone', async () => {
    const saved = await withFixture('field-tree.pdf', (doc) => doc.save());
    const copy = saved.slice();

    const out = detachFieldsFromForm(saved, [NAME_WIDGET]);

    expect(out.byteLength).toBe(saved.byteLength);
    expect(saved).toEqual(copy);
    // Only spaces were written: every byte that differs is now 0x20.
    let differing = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== saved[i]) {
        differing++;
        expect(out[i]).toBe(0x20);
      }
    }
    // "6 0 R" in /Kids, then "5 0 R" in /Fields and in /CO: three characters
    // of each token were not already spaces.
    expect(differing).toBe(9);
  });

  it('is a no-op for an object the tree never referred to', async () => {
    const saved = await withFixture('field-tree.pdf', (doc) => doc.save());
    expect(detachFieldsFromForm(saved, [999, 0, -1])).toEqual(saved);
  });

  it('is a no-op for a document with no form', async () => {
    const saved = await withFixture('simple-text.pdf', (doc) => doc.save());
    expect(detachFieldsFromForm(saved, [4])).toEqual(saved);
  });

  it('produces a file PDFium reads back with the same pages and text', async () => {
    const saved = await withFixture('field-tree.pdf', (doc) => doc.save());
    const out = detachFieldsFromForm(saved, [NAME_WIDGET, SEX_F, SEX_M, F1]);
    await withBytes(out, (doc) => {
      expect(doc.pageCount).toBe(1);
      expect(fieldRefs(doc.save())).toEqual([]);
    });
  });
});

describe('through the session', () => {
  async function openSession(fixture: string): Promise<EditorSession> {
    await loadEngine();
    const session = new EditorSession();
    await session.open(await fixtureBytes(fixture));
    return session;
  }

  it('deletes a field, repaints its page, and undoes cleanly', async () => {
    const session = await openSession('filled-form.pdf');
    const surname = session.formFields(0).find((f) => f.name === 'Surname')!;
    const target = session.annotations(0).find((a) => a.bounds.left === surname.rect.left)!;

    const result = session.removeAnnotationsAt(0, [target.index]);
    expect(result.changedPages).toEqual([0]);
    expect(session.formFields(0).map((f) => f.name)).not.toContain('Surname');
    expect(fieldRefs(session.save())).toEqual([6, 8, 10]);

    await session.undo();
    expect(session.formFields(0).map((f) => f.name)).toContain('Surname');
    expect(fieldRefs(session.save())).toEqual([5, 6, 8, 10]);

    await session.redo();
    expect(fieldRefs(session.save())).toEqual([6, 8, 10]);
    session.close();
  });
});
