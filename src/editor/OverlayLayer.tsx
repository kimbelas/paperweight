'use client';

import { useCallback, useEffect, useRef } from 'react';
import { MARKS, markPathData, markStrokeWidth } from '@/engine/marks';
import type { Rect } from '@/engine/types';
import { useEditor, type OverlayItem } from './store';
import { cssRectToPdf, pdfRectToCss, translatePdfRect, type PageTransform } from './transform';

/**
 * Pending additions, drawn on top of the page and freely movable.
 *
 * These are not in the document yet. Signatures, images, text boxes and cover
 * rectangles live here until "Apply", which is what lets them be dragged and
 * resized at interactive speed: committing each nudge would mean a
 * content-stream regeneration and a page re-render per mouse move.
 *
 * Geometry is stored in PDF points, so zooming and rotating need no
 * conversion and the item stays exactly where it was placed on the page.
 */

interface OverlayLayerProps {
  items: OverlayItem[];
  transform: PageTransform;
  zoom: number;
  onMove?: (id: string, dx: number, dy: number, rect: Rect) => Rect;
}

export function OverlayLayer({ items, transform, zoom }: OverlayLayerProps) {
  const selectedId = useEditor((s) => s.selectedOverlayId);

  return (
    <>
      {items.map((item) => (
        <OverlayBox
          key={item.id}
          item={item}
          transform={transform}
          zoom={zoom}
          selected={selectedId === item.id}
        />
      ))}
    </>
  );
}

type DragMode =
  | { kind: 'move' }
  | { kind: 'resize'; corner: 'nw' | 'ne' | 'se' | 'sw' };

function OverlayBox({
  item,
  transform,
  zoom,
  selected,
}: {
  item: OverlayItem;
  transform: PageTransform;
  zoom: number;
  selected: boolean;
}) {
  const updateOverlay = useEditor((s) => s.updateOverlay);
  const removeOverlay = useEditor((s) => s.removeOverlay);
  const selectOverlay = useEditor((s) => s.selectOverlay);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const box = pdfRectToCss(transform, item.rect);

  // Draw the bitmap for signatures and images.
  useEffect(() => {
    if (!item.bitmap) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = item.bitmap.width;
    canvas.height = item.bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(
      new ImageData(item.bitmap.data.slice(), item.bitmap.width, item.bitmap.height),
      0,
      0,
    );
  }, [item.bitmap]);

  /**
   * Drag to move or resize.
   *
   * Pointer capture keeps the gesture alive when the cursor leaves the page,
   * which happens constantly when dragging something near an edge. The
   * starting rect is captured once so the whole drag is computed from the
   * original position rather than accumulating rounding error.
   */
  const startDrag = useCallback(
    (event: React.PointerEvent, mode: DragMode) => {
      event.preventDefault();
      event.stopPropagation();
      selectOverlay(item.id);

      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = item.rect;
      const startBox = pdfRectToCss(transform, startRect);
      const aspect = startBox.height === 0 ? 1 : startBox.width / startBox.height;

      const move = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        if (mode.kind === 'move') {
          updateOverlay(item.id, { rect: translatePdfRect(transform, startRect, dx, dy) });
          return;
        }

        // Resize from the dragged corner, keeping the opposite one fixed.
        let { left, top, width, height } = startBox;
        const east = mode.corner === 'ne' || mode.corner === 'se';
        const south = mode.corner === 'se' || mode.corner === 'sw';

        if (east) width = startBox.width + dx;
        else {
          width = startBox.width - dx;
          left = startBox.left + dx;
        }

        if (south) height = startBox.height + dy;
        else {
          height = startBox.height - dy;
          top = startBox.top + dy;
        }

        // A signature stretched out of proportion looks forged, so its aspect
        // is locked and the dominant axis drives the other.
        if (item.lockAspect) {
          if (Math.abs(width - startBox.width) >= Math.abs(height - startBox.height)) {
            const next = Math.max(12, width);
            if (!south) top = startBox.top + (startBox.height - next / aspect);
            height = next / aspect;
            width = next;
          } else {
            const next = Math.max(8, height);
            if (!east) left = startBox.left + (startBox.width - next * aspect);
            width = next * aspect;
            height = next;
          }
        }

        width = Math.max(12, width);
        height = Math.max(8, height);

        updateOverlay(item.id, { rect: cssRectToPdf(transform, { left, top, width, height }) });
      };

      const up = () => {
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [item.id, item.rect, item.lockAspect, transform, updateOverlay, selectOverlay],
  );

  const fill =
    item.kind === 'cover' && item.colour
      ? `rgba(${item.colour.r}, ${item.colour.g}, ${item.colour.b}, ${item.colour.a / 255})`
      : undefined;

  return (
    <div
      className="absolute"
      // How the page's right-click handler recognises a pending addition. The
      // offer for one is about the placement rather than about the document,
      // since it has not been written into the file yet.
      data-overlay-id={item.id}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        cursor: 'move',
        background: fill,
        outline: selected
          ? '1.5px solid var(--app-accent)'
          : item.kind === 'cover'
            ? '1px dashed color-mix(in srgb, var(--app-accent) 50%, transparent)'
            : '1px dashed transparent',
      }}
      onPointerDown={(event) => startDrag(event, { kind: 'move' })}
      onClick={(event) => {
        event.stopPropagation();
        selectOverlay(item.id);
      }}
      role="group"
      aria-label={`${item.kind} placed on this page`}
    >
      {item.bitmap && (
        <canvas
          ref={canvasRef}
          className="pointer-events-none block h-full w-full"
          style={{ imageRendering: 'auto' }}
        />
      )}

      {item.kind === 'mark' && item.shape && (
        // Drawn from the same definition the engine will use, so what is
        // dragged into place is what gets written into the page rather than an
        // approximation of it.
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={box.width}
          height={box.height}
          aria-hidden="true"
        >
          <path
            d={markPathData(item.shape, box.width, box.height)}
            fill={MARKS[item.shape].filled ? inkOf(item) : 'none'}
            stroke={MARKS[item.shape].filled ? 'none' : inkOf(item)}
            strokeWidth={markStrokeWidth(box.width, box.height, item.weight ?? 'medium')}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {item.kind === 'text' && (
        <OverlayTextInput item={item} zoom={zoom} onChange={(text) => updateOverlay(item.id, { text })} />
      )}

      {selected && (
        <>
          {(['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
            <span
              key={corner}
              onPointerDown={(event) => startDrag(event, { kind: 'resize', corner })}
              className="absolute block h-2.5 w-2.5 rounded-sm"
              style={{
                background: 'var(--app-panel)',
                border: '1.5px solid var(--app-accent)',
                cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                left: corner === 'nw' || corner === 'sw' ? -5 : undefined,
                right: corner === 'ne' || corner === 'se' ? -5 : undefined,
                top: corner === 'nw' || corner === 'ne' ? -5 : undefined,
                bottom: corner === 'sw' || corner === 'se' ? -5 : undefined,
              }}
              aria-hidden="true"
            />
          ))}

          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              removeOverlay(item.id);
            }}
            className="absolute grid h-5 w-5 place-items-center rounded-full text-xs leading-none"
            style={{
              top: -26,
              right: -8,
              background: 'var(--app-danger)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
            title="Remove"
            aria-label="Remove this item"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

/** An overlay item's ink as a CSS colour, defaulting to black. */
function inkOf(item: OverlayItem): string {
  const c = item.colour ?? { r: 0, g: 0, b: 0, a: 255 };
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a / 255})`;
}

/** In-place editing for a placed text box. */
function OverlayTextInput({
  item,
  zoom,
  onChange,
}: {
  item: OverlayItem;
  zoom: number;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // A freshly placed box should be ready to type into without a second
    // click.
    if (item.text === '') ref.current?.focus();
  }, [item.text]);

  const colour = item.colour ?? { r: 0, g: 0, b: 0, a: 255 };

  return (
    <input
      ref={ref}
      className="text-edit-input absolute inset-0 w-full"
      style={{
        fontSize: (item.fontSize ?? 12) * zoom,
        fontFamily: '"Liberation Sans", Arial, sans-serif',
        color: `rgba(${colour.r}, ${colour.g}, ${colour.b}, ${colour.a / 255})`,
        lineHeight: 1.25,
      }}
      value={item.text ?? ''}
      placeholder="Type here"
      spellCheck={false}
      aria-label="Text to add to the page"
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
}
