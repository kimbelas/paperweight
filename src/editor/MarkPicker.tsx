'use client';

import {
  MARK_ORDER,
  MARKS,
  markPathData,
  markStrokeWidth,
  type MarkShape,
  type MarkWeight,
} from '@/engine/marks';

/**
 * Choosing a mark, and drawing one small.
 *
 * The swatches are the marks themselves rather than icons standing in for
 * them, drawn through the same `markPathData` the overlay and the engine use.
 * That is not only tidiness: it means the thing you pick in the rail, the
 * thing you drag on the page and the thing written into the file are all one
 * definition, so a change to the tick's proportions cannot show up in two of
 * the three places and not the third.
 */

export function MarkGlyph({
  shape,
  size = 18,
  weight = 'medium',
}: {
  shape: MarkShape;
  size?: number;
  weight?: MarkWeight;
}) {
  const def = MARKS[shape];
  return (
    <svg width={size} height={size} className="overflow-visible" aria-hidden="true">
      <path
        d={markPathData(shape, size, size)}
        fill={def.filled ? 'currentColor' : 'none'}
        stroke={def.filled ? 'none' : 'currentColor'}
        strokeWidth={markStrokeWidth(size, size, weight)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MarkPicker({
  value,
  weight,
  onPick,
}: {
  value: MarkShape;
  weight: MarkWeight;
  onPick: (shape: MarkShape) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Which mark">
      {MARK_ORDER.map((shape) => {
        const active = shape === value;
        return (
          <button
            key={shape}
            type="button"
            onClick={() => onPick(shape)}
            title={`${MARKS[shape].label} — ${MARKS[shape].hint}`}
            aria-label={MARKS[shape].label}
            aria-pressed={active}
            className={`focus-ring grid h-8 flex-1 place-items-center rounded-md${active ? '' : ' btn-quiet'}`}
            style={{
              background: active ? 'var(--app-accent-soft)' : undefined,
              color: active ? 'var(--app-accent)' : 'var(--app-text-dim)',
              border: `1px solid ${active ? 'var(--app-accent)' : 'var(--app-border)'}`,
              cursor: 'pointer',
            }}
          >
            <MarkGlyph shape={shape} size={15} weight={weight} />
          </button>
        );
      })}
    </div>
  );
}

const WEIGHTS: { id: MarkWeight; label: string }[] = [
  { id: 'thin', label: 'Thin' },
  { id: 'medium', label: 'Medium' },
  { id: 'bold', label: 'Bold' },
];

export function WeightPicker({
  value,
  onPick,
}: {
  value: MarkWeight;
  onPick: (weight: MarkWeight) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Stroke weight">
      {WEIGHTS.map(({ id, label }) => {
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            aria-pressed={active}
            className={`focus-ring h-7 flex-1 rounded-md text-[11px] font-medium${active ? '' : ' btn-quiet'}`}
            style={{
              background: active ? 'var(--app-accent-soft)' : undefined,
              color: active ? 'var(--app-accent)' : 'var(--app-text-dim)',
              border: `1px solid ${active ? 'var(--app-accent)' : 'var(--app-border)'}`,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
