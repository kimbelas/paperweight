import { describe, expect, it } from 'vitest';
import { fixtureBytes, loadEngine, withBytes, withFixture } from '../helpers';
import { formFieldByName, listFormFields } from '@/engine/forms';
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
