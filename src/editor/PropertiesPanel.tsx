'use client';

import { FALLBACK_FONTS } from '@/engine/fonts';
import { MARKS } from '@/engine/marks';
import { ColourRow } from './ColourRow';
import { IconTrash } from './Icons';
import { useEditor, type OverlayItem } from './store';

/**
 * Properties for whatever is selected.
 *
 * Added text used to be black, 12pt Liberation Sans with no way to change any
 * of it, which made the Add text tool close to useless for anything but a
 * note. This panel is where those choices live, and it appears only when
 * there is something to configure so it does not sit empty.
 */

interface PropertiesPanelProps {
  onDeleteSelection?: () => void;
}

export function PropertiesPanel({ onDeleteSelection }: PropertiesPanelProps) {
  const overlay = useEditor((s) => s.overlay);
  const selectedId = useEditor((s) => s.selectedOverlayId);
  const selection = useEditor((s) => s.selection);
  const updateOverlay = useEditor((s) => s.updateOverlay);
  const removeOverlay = useEditor((s) => s.removeOverlay);

  const item = overlay.find((o) => o.id === selectedId) ?? null;

  if (!item && !selection) return null;

  return (
    <section className="border-t p-3" style={{ borderColor: 'var(--app-border)' }}>
      <h2
        className="mb-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: 'var(--app-text-faint)' }}
      >
        {item ? label(item) : 'Selected'}
      </h2>

      {item?.kind === 'text' && (
        <div className="mb-3 grid gap-2">
          <Field label="Size">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={6}
                max={72}
                step={1}
                value={item.fontSize ?? 12}
                onChange={(e) => updateOverlay(item.id, { fontSize: Number(e.target.value) })}
                className="flex-1"
                aria-label="Text size in points"
              />
              <span
                className="w-10 text-right text-[11px] tabular-nums"
                style={{ color: 'var(--app-text-dim)' }}
              >
                {item.fontSize ?? 12}pt
              </span>
            </div>
          </Field>

          <Field label="Typeface">
            <select
              value={item.fontKey ?? 'sans'}
              onChange={(e) => updateOverlay(item.id, { fontKey: e.target.value })}
              className="focus-ring w-full rounded px-2 py-1 text-xs"
              style={{
                background: 'var(--app-panel-2)',
                border: '1px solid var(--app-border)',
                color: 'var(--app-text)',
              }}
              aria-label="Typeface"
            >
              {FALLBACK_FONTS.map((font) => (
                <option key={font.key} value={font.key}>
                  {font.standsFor}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Colour">
            <ColourRow
              value={item.colour ?? { r: 0, g: 0, b: 0, a: 255 }}
              onChange={(colour) => updateOverlay(item.id, { colour })}
            />
          </Field>
        </div>
      )}

      {item?.kind === 'mark' && item.shape && (
        // Shape, weight and colour are all in the rail's mark panel, which
        // opens whenever a mark is selected. Repeating them here put two
        // identical pickers on screen at once, and there is no telling from
        // looking at them which one governs the next mark and which the one
        // already placed — they are the same control.
        <p className="mb-3 text-[11px] leading-snug" style={{ color: 'var(--app-text-faint)' }}>
          {Math.round(item.rect.right - item.rect.left)} ×{' '}
          {Math.round(item.rect.top - item.rect.bottom)} pt. Drawn as a line rather than a picture,
          so it stays sharp at any size and on paper. Change it in the mark panel above.
        </p>
      )}

      {item?.kind === 'cover' && (
        <div className="mb-3 grid gap-2">
          <Field label="Colour">
            <ColourRow
              value={item.colour ?? { r: 255, g: 255, b: 255, a: 255 }}
              onChange={(colour) => updateOverlay(item.id, { colour })}
            />
          </Field>
          <p className="text-[11px] leading-snug" style={{ color: 'var(--app-text-faint)' }}>
            Sampled from the page behind it. A cover hides content visually; the content is still in
            the file.
          </p>
        </div>
      )}

      {(item?.kind === 'signature' || item?.kind === 'image') && item.bitmap && (
        <p className="mb-3 text-[11px] leading-snug" style={{ color: 'var(--app-text-faint)' }}>
          {Math.round(item.rect.right - item.rect.left)} ×{' '}
          {Math.round(item.rect.top - item.rect.bottom)} pt on the page. Drag it to move, or use a
          corner to resize — the proportions stay locked.
        </p>
      )}

      {item && (
        <button
          type="button"
          onClick={() => removeOverlay(item.id)}
          className="focus-ring flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-medium"
          style={{
            background: 'transparent',
            border: '1px solid var(--app-border)',
            color: 'var(--app-text-dim)',
            cursor: 'pointer',
          }}
        >
          <IconTrash size={13} />
          Remove
        </button>
      )}

      {!item && selection && (
        <>
          <p className="mb-1.5 truncate text-xs" style={{ color: 'var(--app-text-dim)' }}>
            {selection.label}
          </p>

          {selection.bounds && (
            <dl className="mb-2 grid grid-cols-2 gap-1.5 text-[11px]">
              <Stat label="Size">
                {Math.round(selection.bounds.right - selection.bounds.left)} ×{' '}
                {Math.round(selection.bounds.top - selection.bounds.bottom)} pt
              </Stat>
              <Stat label="Position">
                {Math.round(selection.bounds.left)}, {Math.round(selection.bounds.bottom)}
              </Stat>
            </dl>
          )}

          <p className="mb-2 text-[11px] leading-snug" style={{ color: 'var(--app-text-faint)' }}>
            {selection.paths.length > 1
              ? `${selection.paths.length} objects draw this line. Drag it on the page to move them together, or right-click for everything else.`
              : 'Drag it on the page to move it, or right-click it for everything else.'}
          </p>

          {onDeleteSelection && (
            <button
              type="button"
              onClick={onDeleteSelection}
              className="focus-ring flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-medium"
              style={{
                background: 'var(--app-danger-soft)',
                border: '1px solid var(--app-danger)',
                color: 'var(--app-danger)',
                cursor: 'pointer',
              }}
            >
              <IconTrash size={13} />
              Delete from the document
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded px-2 py-1" style={{ background: 'var(--app-panel-2)' }}>
      <dt style={{ color: 'var(--app-text-faint)' }}>{label}</dt>
      <dd className="m-0 font-medium tabular-nums" style={{ color: 'var(--app-text-dim)' }}>
        {children}
      </dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="mb-1 block text-[11px] font-medium"
        style={{ color: 'var(--app-text-faint)' }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function label(item: OverlayItem): string {
  switch (item.kind) {
    case 'text':
      return 'Text';
    case 'cover':
      return 'Cover';
    case 'signature':
      return 'Signature';
    case 'image':
      return 'Image';
    case 'mark':
      return item.shape ? MARKS[item.shape].label : 'Mark';
  }
}
