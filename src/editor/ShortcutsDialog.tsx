'use client';

import { useEffect } from 'react';
import { IconClose } from './Icons';

/**
 * The keyboard shortcuts sheet.
 *
 * The shortcuts existed before this did, which meant they were effectively
 * secret. It also doubles as the place to state the things about the app that
 * are worth knowing before you trust it with a document, since that is what
 * someone opening a help panel is often actually looking for.
 */

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Document',
    items: [
      ['Ctrl O', 'Open a PDF'],
      ['Ctrl S', 'Save, or download a copy'],
      ['Ctrl Shift S', 'Save as a new file'],
      ['Ctrl P', 'Print'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['Ctrl Z', 'Undo'],
      ['Ctrl Shift Z', 'Redo'],
      ['Delete', 'Remove what is selected'],
      ['Enter', 'Apply the text you are editing'],
      ['Esc', 'Cancel the text you are editing'],
    ],
  },
  {
    title: 'Tools',
    items: [
      ['V', 'Select'],
      ['T', 'Edit existing text'],
      ['A', 'Add text'],
      ['M', 'Mark — cross, tick, ring, dot or rule'],
      ['C', 'Cover'],
      ['S', 'Signature'],
      ['I', 'Image'],
    ],
  },
  {
    title: 'View',
    items: [
      ['Ctrl scroll', 'Zoom in and out'],
      ['Ctrl 0', 'Fit the page width'],
      ['Ctrl 9', 'Fit the whole page'],
    ],
  },
  {
    title: 'Pointer',
    items: [
      ['Click', 'A form field opens for editing, whichever tool is armed'],
      ['Right-click', 'What can be done to the thing under the cursor'],
      ['Right-click', 'On a page in the rail: rotate, reorder, insert, delete'],
      ['Drag', 'Move whatever is selected'],
    ],
  },
];

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgb(0 0 0 / 0.45)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl"
        style={{
          background: 'var(--app-panel)',
          border: '1px solid var(--app-border)',
          boxShadow: 'var(--app-shadow)',
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--app-border)' }}
        >
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring grid h-6 w-6 place-items-center rounded"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--app-text-dim)',
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>

        <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3
                className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--app-text-faint)' }}
              >
                {group.title}
              </h3>
              <dl className="m-0 grid gap-1">
                {group.items.map(([keys, what]) => (
                  <div key={`${keys}:${what}`} className="flex items-baseline justify-between gap-3">
                    <dt className="flex shrink-0 gap-1">
                      {keys.split(' ').map((k) => (
                        <kbd
                          key={k}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            background: 'var(--app-panel-2)',
                            border: '1px solid var(--app-border-strong)',
                            color: 'var(--app-text-dim)',
                            fontFamily: 'inherit',
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </dt>
                    <dd
                      className="m-0 text-right text-[11px]"
                      style={{ color: 'var(--app-text-dim)' }}
                    >
                      {what}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div
          className="px-4 py-3 text-[11px] leading-relaxed"
          style={{ borderTop: '1px solid var(--app-border)', color: 'var(--app-text-faint)' }}
        >
          <p className="m-0">
            <strong style={{ color: 'var(--app-text-dim)' }}>Worth knowing.</strong> Everything runs
            on this device and no file is ever uploaded. Editing a line rewrites it in the
            document&apos;s own font where possible, and substitutes a close match where the
            original font cannot render the new characters. Text is never reflowed, so a longer
            replacement is condensed rather than pushing the next line down. Cover hides content
            without removing it. Editing a digitally signed document invalidates the signature,
            which is unavoidable.
          </p>
        </div>
      </div>
    </div>
  );
}
