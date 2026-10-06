// src/editor/ChoiceEditor.tsx
'use client';

import { useLayoutEffect, useRef } from 'react';
import { formFieldPhrase } from '@/engine/form-label';
import type { FormFieldInfo } from '@/engine/types';
import { pdfRectToCss, type PageTransform } from './transform';

/**
 * A combo box, edited as a list of its options.
 *
 * A native `<select>` over the field, because the platform picker is the
 * right control on a phone and typing into a fixed combo cannot work: the
 * value has to be one of the options. An editable combo goes to the text
 * editor instead, since it takes free text.
 */
export function ChoiceEditor({
  field,
  transform,
  onCommit,
  onCancel,
}: {
  field: FormFieldInfo;
  transform: PageTransform;
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSelectElement | null>(null);
  /** Set once the choice is committed or cancelled, so neither happens twice. */
  const settled = useRef(false);
  /**
   * True while the keyboard is stepping through the options. On a closed
   * select each arrow press is a `change`, and committing each one made
   * every step its own edit and its own undo entry. A keyboard choice is
   * committed on Enter, or when focus moves elsewhere, instead.
   */
  const stepping = useRef(false);

  const commit = (value: string) => {
    if (settled.current) return;
    settled.current = true;
    if (value === field.value) onCancel();
    else void onCommit(value);
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  useLayoutEffect(() => {
    const select = ref.current as (HTMLSelectElement & { showPicker?: () => void }) | null;
    if (!select) return;
    select.focus();
    try {
      // Opens the list at once where the browser allows it; elsewhere the
      // focused select opens on the next tap.
      select.showPicker?.();
    } catch {
      /* Not allowed outside a user gesture in some browsers. */
    }
  }, []);

  const box = pdfRectToCss(transform, field.rect);
  const options = field.options ?? [];

  return (
    <select
      ref={ref}
      className="absolute rounded"
      aria-label={`Choose ${formFieldPhrase(field)}`}
      style={{
        left: box.left,
        top: box.top,
        width: Math.max(box.width, 44),
        minHeight: Math.max(box.height, 32),
        fontSize: 16,
        background: '#ffffff',
        color: '#000000',
        outline: '1.5px solid var(--app-accent)',
      }}
      defaultValue={field.value}
      // A finger or a mouse picking from the list chooses at once.
      onPointerDown={() => (stepping.current = false)}
      onChange={(event) => {
        if (!stepping.current) commit(event.target.value);
      }}
      onBlur={(event) => {
        // The platform picker can take focus from the window rather than from
        // this element; that is the list opening, not the user leaving.
        if (document.activeElement === event.currentTarget || !document.hasFocus()) return;
        // Focus really went elsewhere: keep a choice the keyboard made.
        if (stepping.current) commit(event.currentTarget.value);
        else cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel();
        else if (event.key !== 'Enter' && event.key !== 'Tab') stepping.current = true;
        event.stopPropagation();
      }}
      onKeyUp={(event) => {
        // On release, so the option Enter picked from an open list is already
        // the select's value.
        if (event.key === 'Enter') commit(event.currentTarget.value);
        event.stopPropagation();
      }}
    >
      {!options.includes(field.value) && <option value={field.value}>{field.value}</option>}
      {options.map((option, index) => (
        // Labels can repeat; positions cannot.
        <option key={index} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
