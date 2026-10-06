import type React from 'react';

/**
 * Handlers for a button that must not take focus from a text input.
 *
 * `preventDefault` on press keeps the input focused, so its blur does not
 * commit and close the editor before the button acts. WebKit then never
 * sends the click, which is how "Widen to fit" did nothing at all on an
 * iPhone, so the action runs on release. A keyboard activation has no
 * pointer events and arrives as a click with `detail` 0, which is the one
 * click acted on.
 */
export function pressHandlers(action: () => void) {
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerUp: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      action();
    },
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onClick: (event: React.MouseEvent) => {
      if (event.detail === 0) action();
    },
  };
}
