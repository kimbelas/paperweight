'use client';

import { useEditor, type Notice } from './store';

/**
 * Notices.
 *
 * These carry the things the editor must be honest about: a font it had to
 * substitute, text that no longer fits, a digital signature the edit
 * invalidated. They stack in a corner and stay until dismissed, because the
 * whole point is that the user sees them — a toast that disappears after
 * three seconds is a way of appearing to disclose something.
 */

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
        <div
          key={notice.id}
          className="pointer-events-auto flex items-start gap-2 rounded-lg px-3 py-2"
          style={{
            background: 'var(--app-panel)',
            border: `1px solid ${accent(notice.kind)}`,
            boxShadow: 'var(--app-shadow)',
          }}
        >
          <span
            aria-hidden="true"
            className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold"
            style={{ background: accent(notice.kind), color: '#fff' }}
          >
            {glyph(notice.kind)}
          </span>

          <p className="m-0 flex-1 text-[11px] leading-snug" style={{ color: 'var(--app-text)' }}>
            {notice.message}
          </p>

          <button
            type="button"
            onClick={() => dismiss(notice.id)}
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
      ))}
    </div>
  );
}

function accent(kind: Notice['kind']): string {
  switch (kind) {
    case 'error':
      return 'var(--app-danger)';
    case 'signature-invalidated':
    case 'text-overflows':
    case 'partial-removal':
      return 'var(--app-warn)';
    case 'font-substituted':
    case 'kerning-lost':
      return 'var(--app-accent)';
    default:
      return 'var(--app-accent)';
  }
}

function glyph(kind: Notice['kind']): string {
  switch (kind) {
    case 'error':
      return '!';
    case 'signature-invalidated':
    case 'text-overflows':
    case 'partial-removal':
      return '!';
    default:
      return 'i';
  }
}
