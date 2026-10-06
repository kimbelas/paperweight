import { describe, expect, it, vi } from 'vitest';
import { dragThreshold, trackPointer } from '@/editor/pointer';

function pointerEvent(type: string, init: Record<string, number>): Event {
  return Object.assign(new Event(type), init);
}

const start = { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, button: 0 };

describe('trackPointer', () => {
  it('uses a larger threshold for a finger than for a mouse', () => {
    expect(dragThreshold('mouse')).toBe(3);
    expect(dragThreshold('touch')).toBe(10);
    expect(dragThreshold('pen')).toBe(10);
  });

  it('treats a shaky finger tap as a tap', () => {
    const win = new EventTarget() as unknown as Window;
    const onEnd = vi.fn();
    trackPointer(start, { onEnd }, { win });
    win.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 106, clientY: 104 }));
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 106, clientY: 104 }));
    expect(onEnd).toHaveBeenCalledWith(6, 4, false);
  });

  it('reports a drag once past the threshold', () => {
    const win = new EventTarget() as unknown as Window;
    const onMove = vi.fn();
    const onEnd = vi.fn();
    trackPointer(start, { onMove, onEnd }, { win });
    win.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 140 }));
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 140 }));
    expect(onMove).toHaveBeenCalledWith(0, 40);
    expect(onEnd).toHaveBeenCalledWith(0, 40, true);
  });

  it('ignores other pointers', () => {
    const win = new EventTarget() as unknown as Window;
    const onEnd = vi.fn();
    trackPointer(start, { onEnd }, { win });
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 0, clientY: 0 }));
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('abandons the drag on pointercancel', () => {
    const win = new EventTarget() as unknown as Window;
    const onEnd = vi.fn();
    const onCancel = vi.fn();
    trackPointer(start, { onEnd, onCancel }, { win });
    win.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 160 }));
    win.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1, clientX: 100, clientY: 160 }));
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 160 }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('ignores a non-primary button', () => {
    const win = new EventTarget() as unknown as Window;
    const onEnd = vi.fn();
    expect(trackPointer({ ...start, button: 2 }, { onEnd }, { win })).toBe(false);
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 100 }));
    expect(onEnd).not.toHaveBeenCalled();
  });
});
