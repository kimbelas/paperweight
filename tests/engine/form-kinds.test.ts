import { describe, expect, it } from 'vitest';
import { fixtureBytes, loadEngine, withBytes, withFixture } from '../helpers';
import { drawnAppearanceStyle, formFieldAt, formFieldByName, listFormFields } from '@/engine/forms';
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
    await session.toggleFormFieldValue(0, female.ref);
    const saved = session.save();
    session.close();

    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Sex')!.value)).toBe('F');
  });

  it('moves the widget that was dragged, not its twin', async () => {
    const session = await openSession();
    const [first, second] = session.formFields(0).filter((f) => f.name === 'Shared');
    await session.moveFormField(0, second.ref, 0, -40);
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
    await session.removeFormField(0, code.ref);
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
    await session.removeFormField(0, code.ref);
    await session.toggleFormFieldValue(0, female.ref);
    const saved = session.save();
    session.close();

    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Sex')!.value)).toBe('F');
  });

  it('says so when a ref is no longer on the page', async () => {
    const session = await openSession();
    await expect(session.toggleFormFieldValue(0, 999999)).rejects.toThrow(
      /no longer on this page/i,
    );
    session.close();
  });
});

describe('commit order', () => {
  // The interface does not wait for one edit before sending the next: on iOS
  // the next field's tap commits the last one, and Undo can follow at once.
  it('runs edits and undo one at a time, in the order they arrive', async () => {
    const session = await openSession();
    const fields = session.formFields(0);
    const inherited = fields.find((f) => f.name === 'Inherited')!;
    const formDefault = fields.find((f) => f.name === 'FormDefault')!;

    const first = session.setFormFieldValue(0, inherited.ref, 'ONE');
    const second = session.setFormFieldValue(0, formDefault.ref, 'TWO');
    const undone = session.undo();
    await Promise.all([first, second]);
    expect(await undone).not.toBeNull();
    const saved = session.save();
    session.close();

    const values = await withBytes(saved, (doc) => ({
      inherited: formFieldByName(doc, 0, 'Inherited')?.value,
      formDefault: formFieldByName(doc, 0, 'FormDefault')?.value,
    }));
    expect(values).toEqual({ inherited: 'ONE', formDefault: 'FROM ACROFORM' });
  });

  it('lands both of two overlapping edits that draw into the page', async () => {
    await loadEngine();
    const session = new EditorSession();
    await session.open(await fixtureBytes('autosize-no-appearance.pdf'));
    const fields = session.formFields(0);
    const surname = fields.find((f) => f.name === 'Surname')!;
    const given = fields.find((f) => f.name === 'GivenNames')!;

    const first = session.setFormFieldValue(0, surname.ref, 'WHITFIELD');
    const second = session.setFormFieldValue(0, given.ref, 'HARTLEY');
    await Promise.all([first, second]);
    const saved = session.save();
    session.close();

    const text = await withBytes(saved, (doc) =>
      getTextLines(doc, 0)
        .map((l) => l.text)
        .join('\n'),
    );
    expect(text).toContain('WHITFIELD');
    expect(text).toContain('HARTLEY');
  });

  it('keeps running after an edit fails', async () => {
    const session = await openSession();
    const country = session.formFields(0).find((f) => f.name === 'Country')!;
    const failed = session.setFormFieldValue(0, country.ref, 'Narnia');
    const next = session.setFormFieldValue(0, country.ref, 'Canada');
    await expect(failed).rejects.toThrow(/not one of the choices/i);
    await next;
    const saved = session.save();
    session.close();
    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Country')?.value)).toBe(
      'Canada',
    );
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

  it('says how to fix a value that will be cut off, naming only real controls', async () => {
    const session = await openSession();
    const field = session.formFields(0).find((f) => f.name === 'Inherited')!;
    const result = await session.setFormFieldValue(0, field.ref, 'W'.repeat(60));
    session.close();

    const message = result.badges.find((b) => b.kind === 'text-overflows')?.message;
    expect(message).toMatch(/cut off when printed\. Use Widen to fit, or shorten it\.$/);
    expect(message).not.toMatch(/drag/i);
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
    // It stays a field, so it clips and gets Widen to fit like any other.
    expect(pin.clips).toBe(true);

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

describe('combo boxes', () => {
  it('lists the options and says whether typing is allowed', async () => {
    await withFixture('form-kinds.pdf', (doc) => {
      const country = formFieldByName(doc, 0, 'Country')!;
      expect(country.options).toEqual(['Philippines', 'Japan', 'Canada']);
      expect(country.editableChoice).toBe(false);
      expect(formFieldByName(doc, 0, 'City')!.editableChoice).toBe(true);
    });
  });

  it('chooses an option, and the choice is in the saved file', async () => {
    const session = await openSession();
    const country = session.formFields(0).find((f) => f.name === 'Country')!;
    await session.setFormFieldValue(0, country.ref, 'Canada');
    const saved = session.save();
    session.close();
    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Country')?.value)).toBe(
      'Canada',
    );
  });

  it('accepts typed text in an editable combo', async () => {
    const session = await openSession();
    const city = session.formFields(0).find((f) => f.name === 'City')!;
    await session.setFormFieldValue(0, city.ref, 'Cebu');
    const saved = session.save();
    session.close();
    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'City')?.value)).toBe('Cebu');
  });

  it('keeps an auto-sized combo at its neighbours size when an option is chosen', async () => {
    const session = await openSession();
    const size = session.formFields(0).find((f) => f.name === 'Size')!;
    // The box is 24pt tall; left to itself PDFium sizes the type to that.
    expect(size.textSize).toBeLessThanOrEqual(10);
    await session.setFormFieldValue(0, size.ref, 'Large');
    const saved = session.save();
    session.close();

    const after = await withBytes(saved, (doc) => {
      const field = formFieldByName(doc, 0, 'Size')!;
      return { value: field.value, size: field.textSize, drawn: drawnAppearanceStyle(doc, field) };
    });
    expect(after.value).toBe('Large');
    expect(after.size).toBe(size.textSize);
    expect(after.drawn?.size).toBe(size.textSize);
  });

  it('refuses a value a fixed combo does not offer', async () => {
    const session = await openSession();
    const country = session.formFields(0).find((f) => f.name === 'Country')!;
    await expect(session.setFormFieldValue(0, country.ref, 'Narnia')).rejects.toThrow(
      /not one of the choices/i,
    );
    const saved = session.save();
    session.close();
    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Country')?.value)).toBe(
      'Japan',
    );
  });
});
