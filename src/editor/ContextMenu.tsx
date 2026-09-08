'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The right-click menu.
 *
 * What you can usefully do to a thing in a PDF depends almost entirely on what
 * that thing turns out to be: a tick box is toggled, a text line is rewritten,
 * a stray shape is deleted, a form field can be widened but a drawn one
 * cannot. A permanent panel listing all of that would be mostly disabled
 * buttons, so the offer is made where the user already pointed at the thing.
 *
 * The menu is placed where it was asked for and then nudged back inside the
 * viewport. Without that, a right-click on the last thumbnail in the rail or
 * near the bottom of a page opens a menu whose lower half cannot be reached —
 * and the items that get pushed off are the destructive ones at the end, which
 * is the worst half to lose.
 */

export interface MenuAction {
  id: string;
  label: string;
  /** A second line, for saying what the action will actually do. */
  hint?: string;
  icon?: React.ReactNode;
  /** Right-aligned, for a keyboard shortcut. */
  accel?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type MenuEntry =
  | MenuAction
  | { id: string; separator: true }
  | { id: string; heading: string };

function isAction(entry: MenuEntry): entry is MenuAction {
  return 'onSelect' in entry;
}

export interface MenuRequest {
  /** Viewport coordinates, as `clientX` / `clientY` give them. */
  x: number;
  y: number;
  entries: MenuEntry[];
}

const WIDTH = 232;
const MARGIN = 8;

export function ContextMenu({ request, onClose }: { request: MenuRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);

  const actionable = request.entries.filter(
    (entry): entry is MenuAction => isAction(entry) && !entry.disabled,
  );

  // Measured rather than estimated: the entries carry optional hint lines, so
  // the height is not something this component can predict.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();

    // Flip rather than clamp when there is no room below, so the menu never
    // covers the thing it was opened on.
    const overflowsBelow = request.y + height + MARGIN > window.innerHeight;
    const top = overflowsBelow
      ? Math.max(MARGIN, Math.min(request.y - height, window.innerHeight - height - MARGIN))
      : request.y;

    const left = Math.max(
      MARGIN,
      Math.min(request.x, window.innerWidth - width - MARGIN),
    );

    setPos({ left, top });
  }, [request.x, request.y, request.entries]);

  useEffect(() => {
    // Capture phase, so a click on something that stops propagation still
    // dismisses the menu rather than leaving it stranded.
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((current) => {
          if (actionable.length === 0) return -1;
          const step = event.key === 'ArrowDown' ? 1 : -1;
          return (current + step + actionable.length) % actionable.length;
        });
        return;
      }
      if (event.key === 'Enter' && active >= 0) {
        event.preventDefault();
        const chosen = actionable[active];
        onClose();
        chosen?.onSelect();
      }
    };

    // A menu anchored to a point in the document is wrong the moment that
    // point moves, so scrolling dismisses it instead of leaving it hovering
    // over unrelated content.
    const dismiss = () => onClose();

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [onClose, active, actionable]);

  let actionIndex = -1;

  return (
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      className="fixed z-[60] overflow-hidden rounded-lg py-1"
      style={{
        left: pos?.left ?? request.x,
        top: pos?.top ?? request.y,
        minWidth: WIDTH,
        maxWidth: 320,
        background: 'var(--app-panel)',
        border: '1px solid var(--app-border-strong)',
        boxShadow: 'var(--app-menu-shadow)',
        // Hidden for the one frame between mounting and being measured, so the
        // menu never appears at the wrong place and jumps.
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {request.entries.map((entry) => {
        if ('separator' in entry) {
          return (
            <div
              key={entry.id}
              role="separator"
              className="my-1 h-px"
              style={{ background: 'var(--app-border)' }}
            />
          );
        }

        if ('heading' in entry) {
          return (
            <div
              key={entry.id}
              className="truncate px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--app-text-faint)' }}
            >
              {entry.heading}
            </div>
          );
        }

        if (!entry.disabled) actionIndex += 1;
        const highlighted = !entry.disabled && actionIndex === active;

        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onMouseEnter={() => setActive(entry.disabled ? -1 : actionIndex)}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left text-[13px]"
            style={{
              background: highlighted ? 'var(--app-hover)' : 'transparent',
              color: entry.disabled
                ? 'var(--app-text-faint)'
                : entry.danger
                  ? 'var(--app-danger)'
                  : 'var(--app-text)',
              border: 'none',
              cursor: entry.disabled ? 'default' : 'pointer',
            }}
          >
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center opacity-80">
              {entry.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate leading-5">{entry.label}</span>
              {entry.hint && (
                <span
                  className="block text-[11px] leading-snug"
                  style={{ color: 'var(--app-text-faint)' }}
                >
                  {entry.hint}
                </span>
              )}
            </span>
            {entry.accel && (
              <span
                className="mt-px shrink-0 text-[11px] tabular-nums"
                style={{ color: 'var(--app-text-faint)' }}
              >
                {entry.accel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
