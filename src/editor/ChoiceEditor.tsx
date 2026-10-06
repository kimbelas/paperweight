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
      onChange={(event) => void onCommit(event.target.value)}
      onBlur={onCancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        event.stopPropagation();
      }}
    >
      {!options.includes(field.value) && <option value={field.value}>{field.value}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
