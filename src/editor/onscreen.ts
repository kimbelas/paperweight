import { useLayoutEffect, useRef, useState } from 'react';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How to move a floating chip so it stays on screen.
 *
 * Chips are anchored to the field they describe, and a field on the right
 * half of a phone pushed its chip off the edge with half of what it said out
 * of sight. Shift it back in horizontally; flip it below its box when there
 * is no room above.
 */
export function placeOnScreen(
  rect: Box,
  viewport: { left: number; top: number; width: number; height: number },
  margin = 8,
): { dx: number; below: boolean } {
  const right = viewport.left + viewport.width - margin;
  const left = viewport.left + margin;
  let dx = 0;
  if (rect.right > right) dx = right - rect.right;
  if (rect.left + dx < left) dx = left - rect.left;
  return { dx, below: rect.top < viewport.top + margin };
}

/** `placeOnScreen` for an element, against the visual viewport. */
export function useOnScreen(ref: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [place, setPlace] = useState({ dx: 0, below: false });
  const applied = useRef(place);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    // Measured where it would sit without the current shift. Once flipped
    // below, its own top says nothing about the room above, so that is taken
    // from the box it is anchored to, or it would flip back on the next pass.
    const anchor = node.parentElement?.getBoundingClientRect();
    const top = applied.current.below && anchor ? anchor.top - 4 - r.height : r.top;
    const natural = {
      left: r.left - applied.current.dx,
      right: r.right - applied.current.dx,
      top,
      bottom: top + r.height,
    };
    const vv = window.visualViewport;
    const next = placeOnScreen(natural, {
      left: vv?.offsetLeft ?? 0,
      top: vv?.offsetTop ?? 0,
      width: vv?.width ?? window.innerWidth,
      height: vv?.height ?? window.innerHeight,
    });
    if (next.dx !== applied.current.dx || next.below !== applied.current.below) {
      applied.current = next;
      setPlace(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return place;
}
