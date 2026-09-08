/**
 * A form field's name, made fit to show someone.
 *
 * A field's `/T` is an identifier, not a caption, and on forms filled by an
 * online tool it is routinely machine-generated: `dhFormfield-6597933572`,
 * `topmostSubform[0].Page1[0].f1_07[0]`, a bare GUID. Putting that in front of
 * the user tells them nothing and reads like a bug, so an opaque name is
 * replaced by the kind of field it is.
 *
 * Deliberately not in `forms.ts`: the interface needs this too, and importing
 * that module would pull PDFium and fontkit into the page bundle.
 */

import type { FormFieldKind } from './types';

/** Names that are plainly generated rather than written by a person. */
const GENERATED = [
  /^dhformfield[-_]?\d+$/i,
  /^form(field)?[-_]?\d+$/i,
  /^field[-_]?\d+$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{16,}$/i,
  /^\d+$/,
];

/** What to call each kind when its own name is no use. */
const KIND_LABEL: Record<FormFieldKind, string> = {
  text: 'form field',
  choice: 'dropdown',
  list: 'list',
  checkbox: 'tick box',
  radio: 'option',
  button: 'button',
  signature: 'signature field',
  unknown: 'form field',
};

/** True when a name would mean nothing to the person reading it. */
export function isOpaqueFieldName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return true;
  if (GENERATED.some((pattern) => pattern.test(trimmed))) return true;

  // A long run of digits is an id with a word stuck on the front.
  if (/\d{6,}/.test(trimmed)) return true;

  // Full XFA-style paths: legible in isolation, useless in a sentence.
  if (/\[\d+\]/.test(trimmed)) return true;

  // Nothing a person would recognise as a word.
  if (!/[A-Za-z]{3}/.test(trimmed)) return true;

  return trimmed.length > 40;
}

/**
 * A short label for a field.
 *
 * Returns the field's own name when that name is meaningful, since "Surname"
 * is far more useful than "form field"; otherwise the kind of field.
 */
export function formFieldLabel(field: { name: string; kind: FormFieldKind }): string {
  if (isOpaqueFieldName(field.name)) return KIND_LABEL[field.kind] ?? 'form field';

  // Split camel case and separators so `GivenNames` reads as `Given Names`.
  return field.name
    .replace(/[_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The label as it appears mid-sentence, quoted when it is a real name.
 *
 * `the “Surname” field` reads as a name; `the form field` reads as a
 * description. Quoting the latter would imply the document calls it that.
 */
export function formFieldPhrase(field: { name: string; kind: FormFieldKind }): string {
  const label = formFieldLabel(field);
  return isOpaqueFieldName(field.name) ? `this ${label}` : `the “${label}” field`;
}
