/**
 * Following one pointer from press to release.
 *
 * Shared by every drag on the page, because each of them got the same things
 * wrong on a phone. A touch that the browser decides is a pan arrives as
 * `pointercancel`, never `pointerup`, and nothing listened for it, so the drag
 * stayed half-finished with its listeners attached. A second finger's events
 * were taken for the first's. And a three-pixel threshold turned an ordinary
 * finger tap, which drifts, into a nudge with an undo entry.
 */

/** How far a press must travel to be a drag rather than a tap, in CSS pixels. */
export function dragThreshold(pointerType: string): number {
  return pointerType === 'mouse' ? 3 : 10;
}

interface Start {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button: number;
}

interface Handlers {
  onMove?: (dx: number, dy: number) => void;
  onEnd: (dx: number, dy: number, moved: boolean) => void;
  onCancel?: () => void;
}

interface Options {
  /** Element to capture the pointer to, so it keeps receiving events off it. */
  capture?: Element;
  /** Where to listen. The window, except in tests. */
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** Returns false, and does nothing, for any button but the primary one. */
export function trackPointer(start: Start, handlers: Handlers, options: Options = {}): boolean {
  if (start.button !== 0) return false;

  const win = options.win ?? window;
  const capture = options.capture;
  const threshold = dragThreshold(start.pointerType);
  let moved = false;
  let last = { x: 0, y: 0 };

  try {
    capture?.setPointerCapture(start.pointerId);
  } catch {
    /* Capture is a convenience; the window listeners still work without it. */
  }

  const onMove = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerId !== start.pointerId) return;
    last = { x: e.clientX - start.clientX, y: e.clientY - start.clientY };
    if (!moved && Math.hypot(last.x, last.y) >= threshold) moved = true;
    if (moved) handlers.onMove?.(last.x, last.y);
  };

  const finish = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerId !== start.pointerId) return;
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', finish);
    win.removeEventListener('pointercancel', finish);
    try {
      if (capture?.hasPointerCapture(start.pointerId))
        capture.releasePointerCapture(start.pointerId);
    } catch {
      /* The pointer may already be gone, which is fine. */
    }
    if (event.type === 'pointercancel') handlers.onCancel?.();
    else handlers.onEnd(last.x, last.y, moved);
  };

  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', finish);
  win.addEventListener('pointercancel', finish);
  return true;
}
