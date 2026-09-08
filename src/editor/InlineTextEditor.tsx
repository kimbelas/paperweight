'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { Rect, Rgba } from '@/engine/types';
import { pdfRectToCss, type PageTransform } from './transform';

/**
 * The inline text editor.
 *
 * It sits directly on top of the line being edited, at the same size and in
 * the closest available typeface, over an opaque patch that hides the
 * original. The effect is that the document itself becomes editable, which is
 * the interaction every established PDF editor uses and the one users expect.
 *
 * The patch is necessary rather than decorative: the page underneath is a
 * bitmap, so without it the old and new text would be visible at once.
 *
 * It takes plain values rather than a line object because it serves two
 * sources — real text objects and lines recovered from a scan by OCR — which
 * share no type. Everything it needs is geometry, size and colour.
 */

interface InlineTextEditorProps {
  text: string;
  /** The line's box in PDF points. */
  bounds: Rect;
  /** Size as rendered on the page, in points. */
  fontSize: number;
  serif?: boolean;
  mono?: boolean;
  bold?: boolean;
  italic?: boolean;
  colour: Rgba;
  /** What pressing Enter will do, which differs for a scan. */
  hint: string;
  transform: PageTransform;
  zoom: number;
  /**
   * Let the box be widened by dragging its right edge.
   *
   * Only a form field can do this. A field clips its own appearance to its
   * rectangle, so a value wider than the box is cut off in the file itself,
   * and the width is a property of the document rather than of the view. A
   * line of page text has no such box: it simply runs on.
   */
  resizable?: boolean;
  /** Widest the box may become, in points. Stops it running off the page. */
  maxWidth?: number;
  /** Narrowest useful box, in points. */
  minWidth?: number;
  /** The committed width, in points, when it was changed. */
  onCommit: (text: string, width?: number) => void | Promise<void>;
  onCancel: () => void;
}

export function InlineTextEditor({
  text,
  bounds,
  fontSize,
  serif,
  mono,
  bold,
  italic,
  colour,
  hint,
  transform,
  zoom,
  resizable,
  maxWidth,
  minWidth = 24,
  onCommit,
  onCancel,
}: InlineTextEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(text);
  const [busy, setBusy] = useState(false);

  const originalWidth = bounds.right - bounds.left;
  /** Width in points. Undefined until the user actually changes it. */
  const [width, setWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const shownWidth = width ?? originalWidth;
  // The editor is drawn at the width being edited, so dragging the handle
  // shows the box the value will actually get.
  const box = pdfRectToCss(transform, { ...bounds, right: bounds.left + shownWidth });

  /** CSS pixels per PDF point, taken from the box itself. */
  const scale = box.width / Math.max(shownWidth, 0.001);

  /**
   * Does the value overrun the box?
   *
   * Measured from the input's own scroll width, which is the width of the
   * text as actually laid out in the preview face. That face is metric
   * compatible with the base-14 font a form's `/DA` almost always names, so
   * it answers the question the user is asking -- will this be cut off --
   * without a round trip to the engine on every keystroke. The engine still
   * has the last word when the value is committed.
   */
  useLayoutEffect(() => {
    if (!resizable) return;
    const input = inputRef.current;
    if (!input) return;
    setClipped(input.scrollWidth > input.clientWidth + 1);
  }, [value, shownWidth, resizable, zoom]);

  const clampWidth = (points: number): number => {
    const ceiling = maxWidth ?? Number.POSITIVE_INFINITY;
    return Math.min(Math.max(points, minWidth), ceiling);
  };

  /** Widen just enough for the text as it is currently laid out. */
  const fitToText = () => {
    const input = inputRef.current;
    if (!input) return;
    const needed = (input.scrollWidth + 4) / scale;
    setWidth(clampWidth(Math.ceil(needed)));
    input.focus();
  };

  // A little breathing room so ascenders and descenders of the replacement
  // are not clipped by the patch, and so the patch fully covers the original.
  const pad = Math.max(2, fontSize * zoom * 0.18);

  const widthChanged = width !== null && Math.round(width) !== Math.round(originalWidth);

  const submit = async () => {
    if (busy) return;
    if (value === text && !widthChanged) {
      onCancel();
      return;
    }
    setBusy(true);
    try {
      await onCommit(value, widthChanged ? width! : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute"
      style={{
        left: box.left - pad,
        top: box.top - pad,
        width: Math.max(box.width + pad * 2, 32),
        height: box.height + pad * 2,
      }}
    >
      {/* The patch hiding the original line. */}
      <div
        className="absolute inset-0"
        style={{ background: '#ffffff', outline: '1.5px solid var(--app-accent)' }}
      />

      <input
        ref={inputRef}
        className="text-edit-input absolute inset-0"
        style={{
          paddingLeft: pad,
          paddingRight: pad,
          fontSize: fontSize * zoom,
          fontFamily: cssFontFamily({ serif, mono }),
          fontWeight: bold ? 700 : 400,
          fontStyle: italic ? 'italic' : 'normal',
          color: `rgba(${colour.r}, ${colour.g}, ${colour.b}, ${colour.a / 255})`,
          // The box is the ink height plus padding; matching line-height to it
          // keeps the caret and text vertically where the original sat.
          lineHeight: `${box.height + pad * 2}px`,
          opacity: busy ? 0.5 : 1,
        }}
        value={value}
        disabled={busy}
        spellCheck={false}
        aria-label="Edit this line of text"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          // Arrow keys and Home/End must reach the input rather than reaching
          // the shell's shortcuts or scrolling the page behind it.
          event.stopPropagation();
        }}
        onBlur={() => void submit()}
      />

      {resizable && (
        <>
          {/*
            The right edge, draggable. `preventDefault` on pointer down is
            load-bearing: without it the press moves focus out of the input,
            the blur handler commits, and the editor closes the instant a
            resize begins.
          */}
          <div
            role="separator"
            aria-label="Drag to change the field width"
            aria-orientation="vertical"
            title="Drag to widen the field so long values are not cut off"
            className="absolute"
            style={{
              top: 0,
              bottom: 0,
              right: -4,
              width: 10,
              cursor: 'ew-resize',
              background: resizing ? 'var(--app-accent)' : 'transparent',
              borderRight: `3px solid var(--app-accent)`,
              opacity: resizing ? 1 : 0.8,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();

              const startX = event.clientX;
              const startWidth = shownWidth;
              const handle = event.currentTarget;
              handle.setPointerCapture(event.pointerId);
              setResizing(true);

              const move = (moveEvent: PointerEvent) => {
                setWidth(clampWidth(startWidth + (moveEvent.clientX - startX) / scale));
              };
              const done = () => {
                setResizing(false);
                handle.releasePointerCapture(event.pointerId);
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', done);
                handle.removeEventListener('pointercancel', done);
                inputRef.current?.focus();
              };

              handle.addEventListener('pointermove', move);
              handle.addEventListener('pointerup', done);
              handle.addEventListener('pointercancel', done);
            }}
          />
        </>
      )}

      <div
        className="absolute flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]"
        style={{ top: -22, left: 0, background: 'var(--app-accent)', color: '#fff' }}
      >
        <span className="pointer-events-none">
          {busy
            ? 'Applying…'
            : resizing || widthChanged
              ? `${Math.round(shownWidth)} pt wide · ${hint}`
              : hint}
        </span>

        {resizable && clipped && !busy && (
          <button
            type="button"
            // Same reason as the drag handle: keep focus in the input so the
            // blur handler does not commit before the width is applied.
            onPointerDown={(event) => event.preventDefault()}
            onClick={fitToText}
            className="rounded px-1 font-semibold underline"
            style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', cursor: 'pointer' }}
            title="Widen the field so the whole value is drawn"
          >
            Widen to fit
          </button>
        )}
      </div>

      {resizable && clipped && !busy && (
        <div
          className="pointer-events-none absolute whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]"
          style={{ top: box.height + pad * 2 + 4, left: 0, background: '#9a3412', color: '#fff' }}
        >
          Wider than the field — this will be cut off when printed
        </div>
      )}
    </div>
  );
}

/**
 * A CSS stack approximating the document's font.
 *
 * Only the category is reproduced — serif, sans or mono — because the actual
 * embedded font is not installed on the viewer's system and cannot be relied
 * on. This is a preview while typing; the committed result uses the real
 * embedded font or a metric-compatible substitute.
 */
function cssFontFamily({ serif, mono }: { serif?: boolean; mono?: boolean }): string {
  if (mono) return '"Liberation Mono", "Courier New", monospace';
  if (serif) return '"Liberation Serif", "Times New Roman", serif';
  return '"Liberation Sans", Arial, Helvetica, sans-serif';
}
