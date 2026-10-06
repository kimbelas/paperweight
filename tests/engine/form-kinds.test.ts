import { describe, expect, it } from 'vitest';
import { fixtureBytes, loadEngine, withBytes, withFixture } from '../helpers';
import { formFieldAt, formFieldByName, listFormFields } from '@/engine/forms';
import { getTextLines } from '@/engine/text';
import { EditorSession } from '@/engine/session';

/**
 * Field shapes that once broke because widgets were looked up by name.
 *
 * Every option of a radio group shares its name, as does every widget of a
 * field shown twice, so a lookup by name always found the first. Each test
 * here saves and reopens, because this class of bug hides in the object model.
 */

async function openSession(): Promise<EditorSession> {
  await loadEngine();
  const session = new EditorSession();
  await session.open(await fixtureBytes('form-kinds.pdf'));
  return session;
}

describe('widget identity', () => {
  it('gives every widget its own ref', async () => {
    const refs = await withFixture('form-kinds.pdf', (doc) =>
      listFormFields(doc, 0).map((f) => f.ref),
    );
    expect(refs.every((r) => r > 0)).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('keeps refs across a reload', async () => {
    await withFixture('form-kinds.pdf', (doc) => {
      const before = listFormFields(doc, 0).map((f) => [f.name, f.ref]);
      doc.reload(doc.save());
      expect(listFormFields(doc, 0).map((f) => [f.name, f.ref])).toEqual(before);
    });
  });

  it('ticks the radio option that was tapped, not the first in its group', async () => {
    const session = await openSession();
    const [, female] = session.formFields(0).filter((f) => f.name === 'Sex');
    session.toggleFormFieldValue(0, female.ref);
    const saved = session.save();
    session.close();

    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Sex')!.value)).toBe('F');
  });

  it('moves the widget that was dragged, not its twin', async () => {
    const session = await openSession();
    const [first, second] = session.formFields(0).filter((f) => f.name === 'Shared');
    session.moveFormField(0, second.ref, 0, -40);
    const saved = session.save();
    session.close();

    const shared = await withBytes(saved, (doc) =>
      listFormFields(doc, 0).filter((f) => f.name === 'Shared'),
    );
    expect(shared[0].rect.bottom).toBeCloseTo(first.rect.bottom, 1);
    expect(shared[1].rect.bottom).toBeCloseTo(second.rect.bottom - 40, 1);
  });

  it('removes a field by ref', async () => {
    const session = await openSession();
    const code = session.formFields(0).find((f) => f.name === 'Code')!;
    session.removeFormField(0, code.ref);
    const saved = session.save();
    session.close();

    const names = await withBytes(saved, (doc) => listFormFields(doc, 0).map((f) => f.name));
    expect(names).not.toContain('Code');
  });

  it('a ref still addresses its widget after another field is deleted', async () => {
    const session = await openSession();
    const fields = session.formFields(0);
    const code = fields.find((f) => f.name === 'Code')!;
    const [, female] = fields.filter((f) => f.name === 'Sex');

    // Deleting a widget reloads the whole document from bytes.
    session.removeFormField(0, code.ref);
    session.toggleFormFieldValue(0, female.ref);
    const saved = session.save();
    session.close();

    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Sex')!.value)).toBe('F');
  });

  it('says so when a ref is no longer on the page', async () => {
    const session = await openSession();
    expect(() => session.toggleFormFieldValue(0, 999999)).toThrow(/no longer on this page/i);
    session.close();
  });
});

describe('appearance sizes', () => {
  it('survive a reload of the document', async () => {
    await withFixture('autosize-no-appearance.pdf', (doc) => {
      expect(formFieldByName(doc, 0, 'Surname')!.textSize).toBe(9);
      doc.reload(doc.save());
      expect(formFieldByName(doc, 0, 'Surname')!.textSize).toBe(9);
    });
  });

  it('survive undo', async () => {
    await loadEngine();
    const session = new EditorSession();
    await session.open(await fixtureBytes('autosize-no-appearance.pdf'));
    const given = session.formFields(0).find((f) => f.name === 'GivenNames')!;

    await session.setFormFieldValue(0, given.ref, 'JANE');
    await session.undo();

    expect(session.formFields(0).find((f) => f.name === 'Surname')!.textSize).toBe(9);
    session.close();
  });
});

describe('field kinds', () => {
  it('reads a size declared on the parent field', async () => {
    const field = await withFixture('form-kinds.pdf', (doc) =>
      formFieldByName(doc, 0, 'Inherited')!,
    );
    expect(field.textSize).toBe(10);
    expect(field.clips).toBe(true);
  });

  it('reads a size declared on the form', async () => {
    const field = await withFixture('form-kinds.pdf', (doc) =>
      formFieldByName(doc, 0, 'FormDefault')!,
    );
    expect(field.textSize).toBe(9);
    expect(field.clips).toBe(true);
  });

  it('still treats an auto size as auto', async () => {
    const field = await withFixture('autosize-field.pdf', (doc) =>
      formFieldByName(doc, 0, 'Surname')!,
    );
    expect(field.clips).toBe(false);
  });

  it('keeps an edited inherited-size field a form field', async () => {
    const session = await openSession();
    const field = session.formFields(0).find((f) => f.name === 'Inherited')!;
    await session.setFormFieldValue(0, field.ref, 'EDITED');
    const saved = session.save();
    session.close();

    const after = await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Inherited'));
    expect(after?.value).toBe('EDITED');
  });

  it('does not list hidden or no-view widgets, or hit them', async () => {
    await withFixture('form-kinds.pdf', (doc) => {
      const names = listFormFields(doc, 0).map((f) => f.name);
      expect(names).not.toContain('HiddenBox');
      expect(names).not.toContain('NoViewBox');
      expect(formFieldAt(doc, 0, 250, 567)).toBeNull();
      expect(formFieldAt(doc, 0, 250, 537)).toBeNull();
      // And the text under them is still reachable.
      expect(getTextLines(doc, 0).some((l) => l.text.includes('UNDER HIDDEN'))).toBe(true);
    });
  });

  it('reports a password field, and never draws its value as page text', async () => {
    const session = await openSession();
    const pin = session.formFields(0).find((f) => f.name === 'Pin')!;
    expect(pin.password).toBe(true);

    await session.setFormFieldValue(0, pin.ref, 'hunter2');
    const saved = session.save();
    session.close();

    await withBytes(saved, (doc) => {
      expect(formFieldByName(doc, 0, 'Pin')?.value).toBe('hunter2');
      expect(getTextLines(doc, 0).some((l) => l.text.includes('hunter2'))).toBe(false);
    });
  });

  it('reports the length limit', async () => {
    const code = await withFixture('form-kinds.pdf', (doc) => formFieldByName(doc, 0, 'Code')!);
    expect(code.maxLen).toBe(5);
  });
});
