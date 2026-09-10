'use client';

import { useEffect, useState } from 'react';
import { useEditor, type Notice } from './store';

/**
 * Notices.
 *
 * These carry the things the editor must be honest about: a font it had to
 * substitute, text that no longer fits, a digital signature the edit
 * invalidated. They stack in a corner and then leave on their own.
 *
 * How long they stay is a question of severity, not a single constant. A
 * three-second toast is a way of appearing to disclose something, and a stack
 * that only ever grows is its own problem — after a dozen edits the corner is
 * a wall of stale acknowledgements, and the one that matters is the one
 * pushed out of the four that are shown. So: a confirmation goes at five
 * seconds, a disclosure holds for eight, and anything that went wrong or that
 * changed the document in a way the user did not ask for holds for ten.
 *
 * Two things keep that from swallowing a disclosure. Hovering or focusing a
 * notice stops its clock, so one being read is never taken away mid-sentence;
 * and a repeat restarts it, so the same warning raised again is seen again
 * rather than silently folding into an entry that is about to disappear.
 */

/** How long a notice of each severity stays, in milliseconds. */
const LIFETIME: Record<Severity, number> = {
  error: 10_000,
  warn: 10_000,
  note: 8_000,
  info: 5_000,
};

type Severity = 'error' | 'warn' | 'note' | 'info';

export function Notices() {
  const notices = useEditor((s) => s.notices);
  const dismiss = useEditor((s) => s.dismissNotice);

  if (notices.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-12 right-4 z-40 flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {notices.slice(-4).map((notice) => (
        <NoticeCard key={notice.id} notice={notice} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function NoticeCard({
  notice,
  onDismiss,
}: {
  notice: Notice;
  /**
   * Taken by id rather than pre-bound.
   *
   * An `() => dismiss(notice.id)` closure is a new function on every render
   * of the stack, and the clock below has it in its dependencies — so every
   * unrelated re-render of the editor would restart the countdown, and on a
   * busy document a notice would sit there for as long as anything kept
   * happening. The store's own action is stable.
   */
  onDismiss: (id: string) => void;
}) {
  const [held, setHeld] = useState(false);
  const level = severity(notice.kind);

  /**
   * The clock.
   *
   * Keyed on `raisedAt` as well as the id, so a repeat of a notice already on
   * screen — which the store folds into this one rather than stacking a
   * second copy — starts the countdown again from the moment it recurred.
   */
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => onDismiss(notice.id), LIFETIME[level]);
    return () => window.clearTimeout(timer);
  }, [held, level, notice.id, notice.raisedAt, onDismiss]);

  return (
    <div
      className="pointer-events-auto flex items-start gap-2 rounded-lg px-3 py-2"
      style={{
        background: 'var(--app-panel)',
        border: `1px solid ${accent(level)}`,
        boxShadow: 'var(--app-shadow)',
      }}
      // Reading one holds it. The capture-phase focus handlers cover the
      // keyboard: tabbing to the dismiss button must not start a race
      // against the thing being dismissed.
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold"
        style={{ background: accent(level), color: '#fff' }}
      >
        {level === 'error' || level === 'warn' ? '!' : 'i'}
      </span>

      <p className="m-0 flex-1 text-[11px] leading-snug" style={{ color: 'var(--app-text)' }}>
        {notice.message}
      </p>

      <button
        type="button"
        onClick={() => onDismiss(notice.id)}
        className="focus-ring -mr-1 -mt-1 grid h-5 w-5 shrink-0 place-items-center rounded"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--app-text-faint)',
          cursor: 'pointer',
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

/**
 * How serious a notice is.
 *
 * One answer, read by the colour, the glyph and the clock alike — they were
 * three switches over the same union, which is three places for them to
 * disagree about what a kind means.
 */
function severity(kind: Notice['kind']): Severity {
  switch (kind) {
    case 'error':
      return 'error';
    case 'signature-invalidated':
    case 'text-overflows':
    case 'partial-removal':
      return 'warn';
    case 'font-substituted':
    case 'kerning-lost':
      return 'note';
    default:
      return 'info';
  }
}

function accent(level: Severity): string {
  switch (level) {
    case 'error':
      return 'var(--app-danger)';
    case 'warn':
      return 'var(--app-warn)';
    default:
      return 'var(--app-accent)';
  }
}
