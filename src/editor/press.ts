import type React from 'react';

/**
 * The pointer pressed on each button, until it is released.
 *
 * Kept on the element rather than in the handlers' closure, because the
 * handlers are built afresh on every render and a render can land between
 * press and release.
 */
const pressed = new WeakMap<EventTarget, number>();

/**
 * Handlers for a button that must not take focus from a text input.
 *
 * `preventDefault` on press keeps the input focused, so its blur does not
 * commit and close the editor before the button acts. WebKit then never
 * sends the click, which is how "Widen to fit" did nothing at all on an
 * iPhone, so the action runs on release, and only on the release of the
 * pointer that pressed this button: a drag-select in the input that ends
 * over the button is not a press of it. A keyboard activation has no
 * pointer events and arrives as a click with `detail` 0, which is the one
 * click acted on.
 */
export function pressHandlers(action: () => void) {
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      pressed.set(event.currentTarget, event.pointerId);
    },
    onPointerUp: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const id = pressed.get(event.currentTarget);
      pressed.delete(event.currentTarget);
      if (id !== event.pointerId) return;
      event.stopPropagation();
      action();
    },
    onPointerCancel: (event: React.PointerEvent) => {
      pressed.delete(event.currentTarget);
    },
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onClick: (event: React.MouseEvent) => {
      if (event.detail === 0) action();
    },
  };
}
