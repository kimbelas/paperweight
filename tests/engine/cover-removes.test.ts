import { describe, expect, it } from 'vitest';
import { fixtureBytes, loadEngine, withBytes } from '../helpers';
import { EditorSession } from '@/engine/session';
import { renderPage } from '@/engine/render';
import { listAnnotations } from '@/engine/annotations';
import { formFieldByName, listFormFields } from '@/engine/forms';

/**
 * Covering or typing over a signature or a form field takes it out.
 *
 * A cover rectangle and a line of added text are page content. A viewer paints
 * annotation appearance streams and form-field values on top of page content,
 * so an annotation left under a cover reappears in print, in Adobe and in the
 * saved file, however clean the editor looks -- the editor does not paint
 * annotations while editing. These tests assert against a *fresh* render with
 * annotations on, which is what a viewer does, and against the saved bytes.
 */

/** Dark pixels inside a PDF-space rectangle of a rendered page. */
function darkInRect(
  data: Uint8ClampedArray,
  width: number,
  pageHeight: number,
  rect: { left: number; bottom: number; right: number; top: number },
): number {
  let dark = 0;
  for (let y = Math.floor(pageHeight - rect.top); y < Math.ceil(pageHeight - rect.bottom); y++) {
    for (let x = Math.floor(rect.left); x < Math.ceil(rect.right); x++) {
      if (data[(y * width + x) * 4] < 140) dark++;
    }
  }
  return dark;
}

async function open(fixture: string): Promise<EditorSession> {
  await loadEngine();
  const s = new EditorSession();
  await s.open(await fixtureBytes(fixture));
  return s;
}

describe('a cover removes the annotation it hides', () => {
  it('takes out a signature that a viewer would draw over the cover', async () => {
    const s = await open('annotation-signatures.pdf');
    const sig = s.signatures().candidates[0];
    const height = s.info().pages[sig.page].height;

    const result = await s.apply([
      {
        type: 'rect',
        page: sig.page,
        rect: sig.bounds,
        colour: { r: 255, g: 255, b: 255, a: 255 },
      },
    ]);

    // The change is disclosed, not silent.
    expect(result.badges.some((b) => b.kind === 'covered-removed')).toBe(true);

    const saved = s.save();
    s.close();

    // A fresh viewer-style render (annotations on) shows nothing where the
    // signature was. Before this fix it showed every pixel of it.
    await withBytes(saved, (doc) => {
      const r = renderPage(doc, sig.page, { scale: 1, annotations: true });
      expect(darkInRect(r.data, r.width, height, sig.bounds)).toBe(0);
      expect(listAnnotations(doc, sig.page).length).toBe(1); // the other signature remains
    });
  });

  it('leaves an image signature working as before (it is page content)', async () => {
    const s = await open('flattened-signature.pdf');
    const sig = s.signatures().candidates[0];
    const height = s.info().pages[sig.page].height;
    // An image signature is page content, so covering it is non-destructive
    // and needs no annotation removal; the rect alone hides it.
    const result = await s.apply([
      {
        type: 'rect',
        page: sig.page,
        rect: sig.bounds,
        colour: { r: 255, g: 255, b: 255, a: 255 },
      },
    ]);
    expect(result.badges.some((b) => b.kind === 'covered-removed')).toBe(false);
    const saved = s.save();
    s.close();
    await withBytes(saved, (doc) => {
      const r = renderPage(doc, sig.page, { scale: 1, annotations: true });
      expect(darkInRect(r.data, r.width, height, sig.bounds)).toBe(0);
    });
  });
});

describe('covering or typing over a form field removes it', () => {
  it('a cover over a field detaches it, so its value cannot regenerate', async () => {
    const s = await open('filled-form.pdf');
    const field = s.formFields(0).find((f) => f.name === 'Surname')!;

    const result = await s.apply([
      { type: 'rect', page: 0, rect: field.rect, colour: { r: 255, g: 255, b: 255, a: 255 } },
    ]);
    expect(result.badges.some((b) => b.kind === 'covered-removed')).toBe(true);

    const saved = s.save();
    s.close();
    await withBytes(saved, (doc) => {
      const names = listFormFields(doc, 0).map((f) => f.name);
      expect(names).not.toContain('Surname');
      // The bytes a form-reader walks no longer hold the value.
      const text = new TextDecoder('latin1').decode(doc.save());
      expect(text).not.toContain('/T(Surname)');
    });
  });

  it('added text dropped on a field removes that field', async () => {
    const s = await open('filled-form.pdf');
    const field = s.formFields(0).find((f) => f.name === 'Surname')!;
    // Origin inside the field, as when the user types onto it.
    const x = field.rect.left + 4;
    const y = field.rect.bottom + 4;

    const result = await s.apply([
      {
        type: 'text',
        page: 0,
        x,
        y,
        text: 'N/A',
        fontSize: 10,
        colour: { r: 0, g: 0, b: 0, a: 255 },
        fontKey: 'sans',
      },
    ]);
    expect(result.badges.some((b) => b.kind === 'covered-removed')).toBe(true);

    const saved = s.save();
    s.close();
    await withBytes(saved, (doc) => {
      expect(listFormFields(doc, 0).map((f) => f.name)).not.toContain('Surname');
    });
  });

  it('added text in an empty area removes nothing', async () => {
    const s = await open('filled-form.pdf');
    const before = s.formFields(0).length;
    const result = await s.apply([
      {
        type: 'text',
        page: 0,
        x: 72,
        y: 60,
        text: 'a note',
        fontSize: 10,
        colour: { r: 0, g: 0, b: 0, a: 255 },
        fontKey: 'sans',
      },
    ]);
    expect(result.badges.some((b) => b.kind === 'covered-removed')).toBe(false);
    const after = s.formFields(0).length;
    s.close();
    expect(after).toBe(before);
  });
});

describe('covering page text stays non-destructive', () => {
  it('does not remove the text under a cover', async () => {
    const s = await open('simple-text.pdf');
    const line = s.textLines(0).find((l) => l.text.includes('Acme'))!;
    const result = await s.apply([
      { type: 'rect', page: 0, rect: line.bounds, colour: { r: 255, g: 255, b: 255, a: 255 } },
    ]);
    expect(result.badges.some((b) => b.kind === 'covered-removed')).toBe(false);
    // The covered text is still in the file: Cover is not redaction.
    expect(s.textLines(0).some((l) => l.text.includes('Acme'))).toBe(true);
    s.close();
  });
});
