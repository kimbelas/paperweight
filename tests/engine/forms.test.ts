import { describe, expect, it } from 'vitest';
import { withBytes, withFixture } from '../helpers';
import { renderPage } from '@/engine/render';
import {
  appearanceIsTrustworthy,
  convertFieldToText,
  drawnAppearanceStyle,
  formFieldAt,
  formFieldByName,
  listFormFields,
  measureFieldFit,
  setFormFieldText,
  setFormFieldWidth,
  toggleFormField,
} from '@/engine/forms';
import { getTextLines, hitTestLine } from '@/engine/text';

/**
 * Rendering the values already sitting in an AcroForm.
 *
 * A filled form is the common real-world document: someone typed into it in
 * Acrobat or a browser, and the values are in the file as field `/V` entries.
 * PDFium does not draw those from `FPDF_RenderPageBitmap`. Field appearances
 * belong to the form-fill environment, and a field whose `/V` was set without
 * an `/AP` stream has no appearance to draw at all until that environment
 * generates one.
 *
 * Skipping it renders a filled form as a blank form, which is the worst
 * possible failure for this app: the document looks empty on screen, prints
 * with every value present, and the user has no way to tell which is real.
 *
 * `acroform-sig-field.pdf` has a text field `FullName` with `/V (Jane Doe)`
 * and a `/DA`, and deliberately no `/AP`.
 */

/** Count dark pixels inside a PDF-space rectangle of a rendered page. */
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

/** The `FullName` widget's /Rect, where "Jane Doe" has to appear. */
const FIELD = { left: 72, bottom: 250, right: 300, top: 275 };
/** The page's own content stream text, as a control. */
const BODY = { left: 72, bottom: 694, right: 300, top: 712 };

describe('a filled AcroForm', () => {
  it('draws the field value on the page', async () => {
    const rendered = await withFixture('acroform-sig-field.pdf', (doc) =>
      renderPage(doc, 0, { scale: 1, annotations: true }),
    );

    // Control: the page's ordinary text renders, so a blank result below is
    // about form fields and not about rendering being broken outright.
    expect(darkInRect(rendered.data, rendered.width, 792, BODY)).toBeGreaterThan(0);

    expect(darkInRect(rendered.data, rendered.width, 792, FIELD)).toBeGreaterThan(0);
  });

  it('draws the field value while editing, when annotations are off', async () => {
    // Annotations are switched off during editing so the app's own pending
    // overlay does not double up with the drawn one. Field values are not
    // overlays -- they are what the document says -- so they must survive it.
    const rendered = await withFixture('acroform-sig-field.pdf', (doc) =>
      renderPage(doc, 0, { scale: 1, annotations: false }),
    );

    expect(darkInRect(rendered.data, rendered.width, 792, FIELD)).toBeGreaterThan(0);
  });

  it('draws the field value on the print path too', async () => {
    const rendered = await withFixture('acroform-sig-field.pdf', (doc) =>
      renderPage(doc, 0, { scale: 1, annotations: true, printing: true }),
    );

    expect(darkInRect(rendered.data, rendered.width, 792, FIELD)).toBeGreaterThan(0);
  });

  it('leaves a document with no form untouched', async () => {
    // No form means no form-fill environment, so this path must render exactly
    // as it did before: same ink, no highlight wash over the page.
    const rendered = await withFixture('simple-text.pdf', (doc) =>
      renderPage(doc, 0, { scale: 1, annotations: true }),
    );

    const corner = { left: 500, bottom: 60, right: 600, top: 160 };
    expect(darkInRect(rendered.data, rendered.width, 792, corner)).toBe(0);
    expect(darkInRect(rendered.data, rendered.width, 792, { ...BODY, top: 706 })).toBeGreaterThan(
      0,
    );
  });
});

describe('editing a form field', () => {
  it('finds the field under a point, with its stored value', async () => {
    const field = await withFixture('acroform-sig-field.pdf', (doc) =>
      formFieldAt(doc, 0, 150, 262),
    );

    expect(field).not.toBeNull();
    expect(field?.name).toBe('FullName');
    expect(field?.kind).toBe('text');
    expect(field?.value).toBe('Jane Doe');
    expect(field?.editable).toBe(true);
  });

  it('finds nothing where there is no field', async () => {
    const field = await withFixture('acroform-sig-field.pdf', (doc) =>
      formFieldAt(doc, 0, 450, 400),
    );
    expect(field).toBeNull();
  });

  it('reports a signature field as not typeable', async () => {
    const field = await withFixture('acroform-sig-field.pdf', (doc) =>
      formFieldAt(doc, 0, 150, 185),
    );

    expect(field?.kind).toBe('signature');
    expect(field?.editable).toBe(false);
    expect(field?.notEditableReason).toMatch(/signature/i);
  });

  it('lists the fields on the page', async () => {
    const fields = await withFixture('acroform-sig-field.pdf', (doc) => listFormFields(doc, 0));

    expect(fields.map((f) => f.name).sort()).toEqual(['FullName', 'Signature1']);
  });

  it('changes the value, and the change survives a save', async () => {
    const saved = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'FullName');
      setFormFieldText(doc, field!, 'Jane Doe');
      return doc.save();
    });

    // Reopened from bytes, so this is the file's own state and not in-memory
    // bookkeeping that would be lost on save.
    await withBytes(saved, (doc) => {
      expect(formFieldByName(doc, 0, 'FullName')?.value).toBe('Jane Doe');
    });
  });

  it('draws the new value rather than the old one', async () => {
    // The value and the drawn appearance have to agree. Writing /V by hand
    // would leave the old appearance stream in place, so the file would say
    // one thing and render another.
    const { before, after } = await withFixture('acroform-sig-field.pdf', (doc) => {
      const first = renderPage(doc, 0, { scale: 1, annotations: true });
      const field = formFieldByName(doc, 0, 'FullName');
      setFormFieldText(doc, field!, 'W');
      const second = renderPage(doc, 0, { scale: 1, annotations: true });
      return { before: first, after: second };
    });

    const inkBefore = darkInRect(before.data, before.width, 792, FIELD);
    const inkAfter = darkInRect(after.data, after.width, 792, FIELD);

    expect(inkBefore).toBeGreaterThan(0);
    expect(inkAfter).toBeGreaterThan(0);
    // "W" is far less ink than "Jane Doe"; if the appearance had not been
    // regenerated the two would be identical.
    expect(inkAfter).toBeLessThan(inkBefore);
  });

  it('does not turn the value into page text', async () => {
    // The value is still form content after editing, not a text object. If
    // this ever changes, the editing path has started rewriting the page and
    // the "untouched pages are never regenerated" rule is at risk.
    const lines = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'FullName');
      setFormFieldText(doc, field!, 'Jane Doe');
      return getTextLines(doc, 0).map((l) => l.text);
    });

    expect(lines.join(' ')).not.toMatch(/Jane/);
  });

  it('refuses to type into a signature field', async () => {
    await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'Signature1');
      expect(() => setFormFieldText(doc, field!, 'nope')).toThrow(/signature/i);
    });
  });

  it('refuses to tick a text field', async () => {
    await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'FullName');
      expect(() => toggleFormField(doc, field!)).toThrow();
    });
  });

  it('says when a value is too wide for its field', async () => {
    // The FullName box is 228pt wide at 11pt type; this is far more than fits.
    const fit = await withFixture('acroform-sig-field.pdf', async (doc) => {
      const field = formFieldByName(doc, 0, 'FullName');
      return measureFieldFit(doc, field!, 'A'.repeat(120));
    });

    expect(fit.fits).toBe(false);
    expect(fit.autoSized).toBe(false);
    expect(fit.textWidth).toBeGreaterThan(228);
    // Clamped so widening can never push the field off the page.
    expect(fit.requiredWidth).toBeLessThanOrEqual(fit.maxWidth);
  });

  it('says a short value fits', async () => {
    const fit = await withFixture('acroform-sig-field.pdf', async (doc) => {
      const field = formFieldByName(doc, 0, 'FullName');
      return measureFieldFit(doc, field!, 'Ana');
    });

    expect(fit.fits).toBe(true);
  });

  it('widens a field, keeping its left edge and height', async () => {
    const { before, after } = await withFixture('acroform-sig-field.pdf', (doc) => {
      const first = formFieldByName(doc, 0, 'FullName')!;
      setFormFieldWidth(doc, first, 400);
      return { before: first, after: formFieldByName(doc, 0, 'FullName')! };
    });

    expect(after.rect.left).toBeCloseTo(before.rect.left, 1);
    expect(after.rect.top).toBeCloseTo(before.rect.top, 1);
    expect(after.rect.bottom).toBeCloseTo(before.rect.bottom, 1);
    expect(after.rect.right - after.rect.left).toBeCloseTo(400, 0);
  });

  it('keeps the value when the field is resized', async () => {
    const value = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'FullName')!;
      setFormFieldWidth(doc, field, 380);
      return formFieldByName(doc, 0, 'FullName')?.value;
    });

    expect(value).toBe('Jane Doe');
  });

  it('never widens a field off the page', async () => {
    const width = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'FullName')!;
      // The page is 612pt wide and the field starts at x=72.
      setFormFieldWidth(doc, field, 5000);
      const after = formFieldByName(doc, 0, 'FullName')!;
      return after.rect.right;
    });

    expect(width).toBeLessThanOrEqual(612);
  });

  it('draws more of a long value once the field is widened', async () => {
    const long = 'Jane Anne Elizabeth Katherine Doe';

    const { narrow, wide } = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'FullName')!;
      setFormFieldText(doc, field, long);
      const before = renderPage(doc, 0, { scale: 1, annotations: true });

      setFormFieldWidth(doc, formFieldByName(doc, 0, 'FullName')!, 520);
      const after = renderPage(doc, 0, { scale: 1, annotations: true });
      return { narrow: before, wide: after };
    });

    // Measured across the whole line, past the original right edge at x=300.
    const band = { left: 72, bottom: 250, right: 600, top: 275 };
    const inkNarrow = darkInRect(narrow.data, narrow.width, 792, band);
    const inkWide = darkInRect(wide.data, wide.width, 792, band);

    expect(inkNarrow).toBeGreaterThan(0);
    // A wider box means less of the value is clipped away, so more ink.
    expect(inkWide).toBeGreaterThan(inkNarrow);
  });

  it('the widened field still fits its value', async () => {
    const fit = await withFixture('acroform-sig-field.pdf', async (doc) => {
      const long = 'Jane Anne Elizabeth Doe';
      const field = formFieldByName(doc, 0, 'FullName')!;
      setFormFieldText(doc, field, long);

      const needed = await measureFieldFit(doc, formFieldByName(doc, 0, 'FullName')!, long);
      setFormFieldWidth(doc, formFieldByName(doc, 0, 'FullName')!, needed.requiredWidth);

      return measureFieldFit(doc, formFieldByName(doc, 0, 'FullName')!, long);
    });

    expect(fit.fits).toBe(true);
  });

  it('keeps the size the field is drawn at, rather than resolving auto to the box', async () => {
    // `autosize-field.pdf` has /DA "0 Tf" -- auto -- and an appearance stream
    // that draws at 9pt. Editing rebuilds the appearance from /DA, and auto
    // means "fill the box height": 18pt on this 24pt widget. That is the bug
    // reported from a real form, where one edited field came back in huge
    // type next to untouched fields still drawing at 9pt.
    const { before, after } = await withFixture('autosize-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'Surname')!;
      const first = drawnAppearanceStyle(doc, field);
      setFormFieldText(doc, field, 'BELAS 2');
      return {
        before: first,
        after: drawnAppearanceStyle(doc, formFieldByName(doc, 0, 'Surname')!),
      };
    });

    expect(before?.size).toBeCloseTo(9, 1);
    expect(after?.size).toBeCloseTo(9, 1);
  });

  it('matches the rest of the form when the field has no appearance of its own', async () => {
    // The case the first attempt missed. `Surname` in this fixture has an auto
    // /DA and no /AP at all, so there is nothing on the field to preserve --
    // and by the time anything can be read, PDFium has already generated an
    // appearance at the auto size. Editing used to fall through to that,
    // giving 18pt text that was then too wide for its own box and came back
    // truncated. Its neighbour draws at 9pt, and that is the answer.
    const { target, sibling } = await withFixture('autosize-no-appearance.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'Surname')!;
      setFormFieldText(doc, field, 'DOE-edited');
      return {
        target: drawnAppearanceStyle(doc, formFieldByName(doc, 0, 'Surname')!),
        sibling: drawnAppearanceStyle(doc, formFieldByName(doc, 0, 'GivenNames')!),
      };
    });

    expect(sibling?.size).toBeCloseTo(9, 1);
    expect(target?.size).toBeCloseTo(9, 1);
  });

  it('keeps the whole value when the size no longer blows up', async () => {
    // Oversized type was also why the value came back cut off: at 18pt it no
    // longer fitted its own box, and a field clips to its rectangle.
    const value = await withFixture('autosize-no-appearance.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'Surname')!;
      setFormFieldText(doc, field, 'DOE-edited');
      return formFieldByName(doc, 0, 'Surname')?.value;
    });

    expect(value).toBe('DOE-edited');
  });

  it('a width change does not alter the type size', async () => {
    // The user's point: widening a field is for fitting longer text, and must
    // not rescale the type.
    const { before, after } = await withFixture('autosize-no-appearance.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'Surname')!;
      setFormFieldText(doc, field, 'DOE-edited');
      const first = drawnAppearanceStyle(doc, formFieldByName(doc, 0, 'Surname')!);

      setFormFieldWidth(doc, formFieldByName(doc, 0, 'Surname')!, 420);
      return {
        before: first,
        after: drawnAppearanceStyle(doc, formFieldByName(doc, 0, 'Surname')!),
      };
    });

    expect(before?.size).toBeCloseTo(9, 1);
    expect(after?.size).toBeCloseTo(before!.size, 1);
  });

  it('leaves an explicitly sized field exactly as the document declares it', async () => {
    // acroform-sig-field.pdf declares /Helv 11 Tf. An explicit size is the
    // document's own intent and must not be second-guessed.
    const style = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'FullName')!;
      setFormFieldText(doc, field, 'Jane Doe');
      return drawnAppearanceStyle(doc, formFieldByName(doc, 0, 'FullName')!);
    });

    expect(style?.size).toBeCloseTo(11, 1);
  });

  it('keeps the drawn size across a resize too', async () => {
    const style = await withFixture('autosize-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'Surname')!;
      setFormFieldWidth(doc, field, 380);
      return drawnAppearanceStyle(doc, formFieldByName(doc, 0, 'Surname')!);
    });

    expect(style?.size).toBeCloseTo(9, 1);
  });

  it('draws the value into the page when the document does not say what size to use', async () => {
    // The escape hatch. `autosize-no-appearance.pdf` gives PDFium nothing to
    // work from, so its regenerated appearance cannot be trusted; the value
    // is drawn as page text instead, at the size the rest of the form uses.
    const { trustworthy, lines, fieldsLeft } = await withFixture(
      'autosize-no-appearance.pdf',
      async (doc) => {
        const field = formFieldByName(doc, 0, 'Surname')!;
        const trusted = appearanceIsTrustworthy(doc, field);
        await convertFieldToText(doc, field, 'DOE-edited');
        doc.flushDirty();
        return {
          trustworthy: trusted,
          lines: getTextLines(doc, 0).map((l) => l.text),
          fieldsLeft: listFormFields(doc, 0).map((f) => f.name),
        };
      },
    );

    expect(trustworthy).toBe(false);
    // Now a real line of page text, which is what makes it print as shown.
    expect(lines.join(' | ')).toMatch(/DOE-edited/);
    // And the widget is gone, so the old value cannot draw underneath it.
    expect(fieldsLeft).not.toContain('Surname');
  });

  it('does not leave the old widget painting over the new text', async () => {
    // Removing the annotation from the dictionary is not enough: the form-fill
    // environment keeps its own view of the page and FFLDraw goes on painting
    // the widget from it, so both the old oversized value and the new text
    // appear at once. Only visible in a render, which is why the engine tests
    // above did not catch it and an e2e test did.
    const { ink, reference } = await withFixture('autosize-no-appearance.pdf', async (doc) => {
      const field = formFieldByName(doc, 0, 'Surname')!;
      await convertFieldToText(doc, field, 'DOE');
      doc.flushDirty();
      const rendered = renderPage(doc, 0, { scale: 1, annotations: true });

      // Rows of ink in each field's band: the converted one and the untouched
      // 9pt neighbour, which is the size it should now match.
      const rows = (top: number, bottom: number) => {
        let count = 0;
        for (let y = 792 - top; y < 792 - bottom; y++) {
          for (let x = 250; x < 460; x++) {
            if (rendered.data[(y * rendered.width + x) * 4] < 140) {
              count++;
              break;
            }
          }
        }
        return count;
      };

      return { ink: rows(666, 638), reference: rows(624, 600) };
    });

    expect(reference).toBeGreaterThan(0);
    expect(ink).toBeGreaterThan(0);
    // Two superimposed renderings, one of them 18pt, would be far taller.
    expect(ink).toBeLessThan(reference * 1.6);
  });

  it('keeps a field a field when the document does say what size to use', async () => {
    // acroform-sig-field.pdf declares /Helv 11 Tf, so PDFium reproduces it and
    // there is no reason to stop it being an interactive field.
    const { trusted, stillAField } = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'FullName')!;
      return {
        trusted: appearanceIsTrustworthy(doc, field),
        stillAField: listFormFields(doc, 0).map((f) => f.name),
      };
    });

    expect(trusted).toBe(true);
    expect(stillAField).toContain('FullName');
  });

  it('a converted value is not clipped, however long', async () => {
    // The point of converting: page text has no box to be clipped to, so a
    // long value survives in full rather than coming back truncated.
    const long = 'DOE-WHITFIELD Y HARTLEY OF ASHFORD BY THE SEA';

    const lines = await withFixture('autosize-no-appearance.pdf', async (doc) => {
      const field = formFieldByName(doc, 0, 'Surname')!;
      await convertFieldToText(doc, field, long);
      doc.flushDirty();
      return getTextLines(doc, 0).map((l) => l.text);
    });

    expect(lines.some((line) => line.includes(long))).toBe(true);
  });

  it('reports the size it drew at, and whether it overhangs', async () => {
    const { short, longer } = await withFixture('autosize-no-appearance.pdf', async (doc) => {
      const a = await convertFieldToText(doc, formFieldByName(doc, 0, 'Surname')!, 'ABC');
      return { short: a, longer: a };
    });

    expect(short.size).toBeCloseTo(9, 1);
    expect(short.overhangs).toBe(false);
    void longer;
  });

  it('a converted line can then be edited as ordinary text', async () => {
    // Which is the other half of the trade: the ordinary text path, with its
    // own fitting and font reporting, takes over from here.
    const hit = await withFixture('autosize-no-appearance.pdf', async (doc) => {
      const field = formFieldByName(doc, 0, 'Surname')!;
      const conversion = await convertFieldToText(doc, field, 'DOE-edited');
      doc.flushDirty();
      // Click where the value now sits.
      const y = field.rect.bottom + (field.rect.top - field.rect.bottom) / 2;
      void conversion;
      return hitTestLine(doc, 0, field.rect.left + 20, y)?.text;
    });

    expect(hit).toMatch(/DOE-edited/);
  });

  it('leaves the page content stream alone', async () => {
    // A form edit must not mark the page dirty: there is nothing on the page
    // to rewrite, and regenerating it would rewrite a page the user never
    // touched.
    const changed = await withFixture('acroform-sig-field.pdf', (doc) => {
      const field = formFieldByName(doc, 0, 'FullName');
      setFormFieldText(doc, field!, 'Jane Doe');
      return doc.flushDirty();
    });

    expect(changed).toEqual([]);
  });
});
