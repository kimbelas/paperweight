'use client';

import { confidenceLabel, type OcrLine } from '@/ocr/recognise';
import type { OcrProgress } from '@/ocr/recognise';
import { IconScanText } from './Icons';

/**
 * The scanned-text panel.
 *
 * Appears only for a page that has no text of its own. Its job is as much
 * explanation as control: OCR sounds like it makes a scan editable, and what
 * it actually does is guess at the words and let the app paint over the
 * originals. Both halves of that are stated here rather than discovered after
 * the fact.
 */

interface OcrPanelProps {
  page: number;
  isScanned: boolean;
  lines: OcrLine[];
  busy: boolean;
  progress: OcrProgress | null;
  error: string | null;
  onRun: () => void;
  onClear: () => void;
}

export function OcrPanel({
  page,
  isScanned,
  lines,
  busy,
  progress,
  error,
  onRun,
  onClear,
}: OcrPanelProps) {
  // Stays visible once there are recognised lines, even after an edit has
  // added a real text object and the page no longer counts as a pure scan.
  if (!isScanned && lines.length === 0) return null;

  const uncertain = lines.filter((l) => l.confidence < 60).length;
  const average =
    lines.length === 0
      ? 0
      : Math.round(lines.reduce((sum, l) => sum + l.confidence, 0) / lines.length);

  return (
    <section
      className="border-t p-3"
      style={{ borderColor: 'var(--app-border)' }}
      aria-label="Text on this scan"
    >
      <h2
        className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{ color: 'var(--app-text-faint)' }}
      >
        <IconScanText size={13} />
        Text on this scan
      </h2>

      {lines.length === 0 && !busy && (
        <>
          <p className="mb-2 text-xs leading-relaxed" style={{ color: 'var(--app-text-dim)' }}>
            Page {page + 1} is a picture, so there is no text to edit. Reading it finds the words
            and lets you change them.
          </p>
          <p
            className="mb-2 rounded px-2 py-1.5 text-[11px] leading-snug"
            style={{ background: 'var(--app-warn-soft)', color: 'var(--app-warn)' }}
          >
            Changing a word paints over the original and draws new text on top. It looks clean on a
            plain scan and patched on a grey or textured one, and it never matches the original
            typeface. The covered pixels stay in the file.
          </p>
          <button
            type="button"
            onClick={onRun}
            className="focus-ring w-full rounded-md px-3 py-2 text-xs font-medium"
            style={{
              background: 'var(--app-accent)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Read this page
          </button>
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--app-text-faint)' }}>
            Runs on this device. Nothing is uploaded.
          </p>
        </>
      )}

      {busy && (
        <div>
          <p className="mb-2 text-xs" style={{ color: 'var(--app-text-dim)' }}>
            {progress?.status ?? 'starting'}…
          </p>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--app-border)' }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((progress?.progress ?? 0) * 100)}
            aria-label="Reading the page"
          >
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{
                width: `${Math.max(4, Math.round((progress?.progress ?? 0) * 100))}%`,
                background: 'var(--app-accent)',
              }}
            />
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--app-text-faint)' }}>
            The first run loads the recogniser, which takes a few seconds.
          </p>
        </div>
      )}

      {lines.length > 0 && !busy && (
        <>
          <p className="mb-1.5 text-xs" style={{ color: 'var(--app-text-dim)' }}>
            Found <strong>{lines.length}</strong> {lines.length === 1 ? 'line' : 'lines'}.
            Pick the Edit text tool and click one to change it.
          </p>

          <dl className="mb-2 grid grid-cols-2 gap-1.5 text-[11px]">
            <div
              className="rounded px-2 py-1"
              style={{ background: 'var(--app-panel-2)' }}
            >
              <dt style={{ color: 'var(--app-text-faint)' }}>Confidence</dt>
              <dd className="m-0 font-medium" style={{ color: toneColour(average) }}>
                {average}%
              </dd>
            </div>
            <div className="rounded px-2 py-1" style={{ background: 'var(--app-panel-2)' }}>
              <dt style={{ color: 'var(--app-text-faint)' }}>Uncertain</dt>
              <dd
                className="m-0 font-medium"
                style={{ color: uncertain > 0 ? 'var(--app-warn)' : 'var(--app-ok)' }}
              >
                {uncertain} {uncertain === 1 ? 'line' : 'lines'}
              </dd>
            </div>
          </dl>

          {uncertain > 0 && (
            <p
              className="mb-2 rounded px-2 py-1.5 text-[11px] leading-snug"
              style={{ background: 'var(--app-warn-soft)', color: 'var(--app-warn)' }}
            >
              Some lines were read poorly and are outlined in amber on the page. Check them before
              relying on the text.
            </p>
          )}

          <details className="mb-2">
            <summary
              className="cursor-pointer text-[11px]"
              style={{ color: 'var(--app-text-faint)' }}
            >
              Show what was read
            </summary>
            <ul
              className="m-0 mt-1.5 max-h-52 list-none overflow-y-auto p-0"
              style={{ borderTop: '1px solid var(--app-border)' }}
            >
              {lines.map((line) => {
                const { label, tone } = confidenceLabel(line.confidence);
                return (
                  <li
                    key={line.id}
                    className="flex items-baseline justify-between gap-2 py-1 text-[11px]"
                    style={{ borderBottom: '1px solid var(--app-border)' }}
                  >
                    <span className="truncate" title={line.text}>
                      {line.text}
                    </span>
                    <span
                      className="shrink-0"
                      style={{
                        color:
                          tone === 'good'
                            ? 'var(--app-ok)'
                            : tone === 'fair'
                              ? 'var(--app-warn)'
                              : 'var(--app-danger)',
                      }}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>

          <button
            type="button"
            onClick={onClear}
            className="focus-ring w-full rounded px-2 py-1 text-[11px]"
            style={{
              background: 'transparent',
              border: '1px solid var(--app-border)',
              color: 'var(--app-text-dim)',
              cursor: 'pointer',
            }}
          >
            Discard what was read
          </button>
        </>
      )}

      {error && (
        <p
          className="mt-2 rounded px-2 py-1.5 text-[11px] leading-snug"
          style={{ background: 'var(--app-danger-soft)', color: 'var(--app-danger)' }}
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
}

function toneColour(confidence: number): string {
  if (confidence >= 85) return 'var(--app-ok)';
  if (confidence >= 60) return 'var(--app-warn)';
  return 'var(--app-danger)';
}
