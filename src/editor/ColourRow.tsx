'use client';

/**
 * Picking an ink colour.
 *
 * Six swatches and a full picker. The swatches are the colours a document is
 * actually marked up in — black, grey, red, blue, green, white — because
 * hunting for "black" in a colour wheel is a poor trade for the one case that
 * covers most of the use.
 */

const SWATCHES = [
  { r: 0, g: 0, b: 0 },
  { r: 90, g: 90, b: 96 },
  { r: 200, g: 30, b: 30 },
  { r: 20, g: 70, b: 190 },
  { r: 20, g: 130, b: 60 },
  { r: 255, g: 255, b: 255 },
];

export function ColourRow({
  value,
  onChange,
}: {
  value: { r: number; g: number; b: number; a: number };
  onChange: (colour: { r: number; g: number; b: number; a: number }) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {SWATCHES.map((swatch) => {
        const active = swatch.r === value.r && swatch.g === value.g && swatch.b === value.b;
        return (
          <button
            key={`${swatch.r}-${swatch.g}-${swatch.b}`}
            type="button"
            onClick={() => onChange({ ...swatch, a: value.a })}
            className="focus-ring h-5 w-5 shrink-0 rounded"
            style={{
              background: `rgb(${swatch.r},${swatch.g},${swatch.b})`,
              border: active ? '2px solid var(--app-accent)' : '1px solid var(--app-border-strong)',
              cursor: 'pointer',
            }}
            aria-label={`Use ${describeColour(swatch)}`}
            aria-pressed={active}
          />
        );
      })}
      <input
        type="color"
        value={toHex(value)}
        onChange={(e) => onChange({ ...fromHex(e.target.value), a: value.a })}
        className="h-5 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        aria-label="Pick any colour"
      />
    </div>
  );
}

/**
 * A colour in a word, for the swatch's accessible name.
 *
 * Neutrality is decided by the spread between the channels rather than by
 * exact equality. The grey swatch is `#5a5a60` — six points more blue than
 * red — and testing for `r === g === b` let it fall through to the hue check
 * and announce itself as "blue", identically to the actual blue swatch beside
 * it. Two buttons with the same name is the whole of what a screen-reader user
 * has to choose between.
 */
function describeColour(c: { r: number; g: number; b: number }): string {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);

  if (max - min <= 24) {
    if (max < 60) return 'black';
    if (min > 200) return 'white';
    return 'grey';
  }

  if (c.r === max) return 'red';
  if (c.b === max) return 'blue';
  return 'green';
}

function toHex(c: { r: number; g: number; b: number }): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

function fromHex(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  };
}
