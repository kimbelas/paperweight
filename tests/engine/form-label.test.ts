import { describe, expect, it } from 'vitest';
import { formFieldLabel, formFieldPhrase, isOpaqueFieldName } from '@/engine/form-label';

/**
 * A field's `/T` is an identifier, not a caption.
 *
 * On forms filled by an online tool it is machine-generated, and showing it
 * put `Enter to update the “dhFormfield-6597933572” field` in front of the
 * user — which says nothing and reads like a bug.
 */

describe('naming a form field', () => {
  it('uses a real name when the field has one', () => {
    expect(formFieldLabel({ name: 'Surname', kind: 'text' })).toBe('Surname');
    expect(formFieldPhrase({ name: 'Surname', kind: 'text' })).toBe('the “Surname” field');
  });

  it('splits run-together names into words', () => {
    expect(formFieldLabel({ name: 'GivenNames', kind: 'text' })).toBe('Given Names');
    expect(formFieldLabel({ name: 'place_of_birth', kind: 'text' })).toBe('place of birth');
  });

  it('replaces a generated id with the kind of field', () => {
    for (const name of [
      'dhFormfield-6597933572',
      'formfield_12',
      'field3',
      '2f8a1c3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
      'a3f9c2b8d4e6f1a7',
      '81726354',
      'topmostSubform[0].Page1[0].f1_07[0]',
    ]) {
      expect(isOpaqueFieldName(name), name).toBe(true);
      expect(formFieldLabel({ name, kind: 'text' })).toBe('form field');
    }
  });

  it('names the kind, not just "form field"', () => {
    expect(formFieldLabel({ name: 'dhFormfield-1234567', kind: 'checkbox' })).toBe('tick box');
    expect(formFieldLabel({ name: 'dhFormfield-1234567', kind: 'signature' })).toBe(
      'signature field',
    );
  });

  it('reads as a description rather than a quoted name when generated', () => {
    expect(formFieldPhrase({ name: 'dhFormfield-6597933572', kind: 'text' })).toBe(
      'this form field',
    );
  });

  it('treats an empty name as generated', () => {
    expect(isOpaqueFieldName('')).toBe(true);
    expect(isOpaqueFieldName('   ')).toBe(true);
  });

  it('keeps a name that merely contains a small number', () => {
    // "Address2" is a person's naming, not a generated id.
    expect(isOpaqueFieldName('Address2')).toBe(false);
    expect(formFieldLabel({ name: 'Address2', kind: 'text' })).toBe('Address2');
  });
});
