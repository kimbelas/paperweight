import type React from 'react';
import { describe, expect, it } from 'vitest';
import { pressHandlers } from '@/editor/press';

/** Just enough of a React pointer event for the handlers. */
function pointer(target: object, pointerId: number, button = 0) {
  return {
    button,
    pointerId,
    currentTarget: target,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as React.PointerEvent;
}

function setup() {
  let calls = 0;
  const button = {};
  // Built afresh per call, as a component does on every render.
  const handlers = () => pressHandlers(() => calls++);
  return { button, handlers, calls: () => calls };
}

describe('pressHandlers', () => {
  it('acts on a press and release of the same pointer', () => {
    const { button, handlers, calls } = setup();
    handlers().onPointerDown(pointer(button, 1));
    // A re-render between the two must not lose the press.
    handlers().onPointerUp(pointer(button, 1));
    expect(calls()).toBe(1);
  });

  it('ignores a release with no press on the button, as at the end of a drag-select', () => {
    const { button, handlers, calls } = setup();
    handlers().onPointerUp(pointer(button, 1));
    expect(calls()).toBe(0);
  });

  it('ignores a release by a different pointer', () => {
    const { button, handlers, calls } = setup();
    handlers().onPointerDown(pointer(button, 1));
    handlers().onPointerUp(pointer(button, 2));
    expect(calls()).toBe(0);
  });

  it('acts once per press', () => {
    const { button, handlers, calls } = setup();
    handlers().onPointerDown(pointer(button, 1));
    handlers().onPointerUp(pointer(button, 1));
    handlers().onPointerUp(pointer(button, 1));
    expect(calls()).toBe(1);
  });

  it('still acts on a keyboard activation', () => {
    const { handlers, calls } = setup();
    handlers().onClick({ detail: 0 } as React.MouseEvent);
    handlers().onClick({ detail: 1 } as React.MouseEvent);
    expect(calls()).toBe(1);
  });
});
