'use client';

import { useEditor } from './store';
import type { SignatureCandidate } from '@/engine/types';

/**
 * The signatures panel.
 *
 * Signature removal is the feature people come to a PDF editor for and the
 * one they are most often let down by, because "signature" means four
 * different things in a PDF and only three of them can actually be removed.
 *
 * So the panel lists what was found, says how confident the guess is, gives
 * the reasons behind it, and states plainly what removal will and will not
 * do. A single button that sometimes silently draws a white box would be
 * easier to build and would mislead people about whether their document is
 * safe to send.
 */

interface SignaturePanelProps {
  onRemove: (id: string) => void;
  onAddSignature: () => void;
}

export function SignaturePanel({ onRemove, onAddSignature }: SignaturePanelProps) {
  const candidates = useEditor((s) => s.signatures);
  const savedSignatures = useEditor((s) => s.savedSignatures);

  return (
    <section
      className="border-t p-3"
      style={{ borderColor: 'var(--app-border)' }}
      aria-label="Signatures"
    >
      <h2
        className="mb-2 flex items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--app-text-faint)' }}
      >
        Signatures
        {candidates.length > 0 && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal"
            style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
          >
            {candidates.length} found
          </span>
        )}
      </h2>

      {/*
        Adding one comes first, because it is what someone opening this section
        usually came to do. The list of what was found used to sit above it and
        take the whole panel even when it was empty — a wall of explanation in
        the place where the button should have been.
      */}
      <button
        type="button"
        onClick={onAddSignature}
        className="focus-ring btn-solid w-full rounded-md px-3 py-2 text-xs font-medium"
        style={{ color: '#fff', border: 'none', cursor: 'pointer' }}
      >
        Draw, type or upload
      </button>

      {savedSignatures.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-[11px]" style={{ color: 'var(--app-text-faint)' }}>
            Used recently
          </p>
          <div className="flex flex-wrap gap-2">
            {savedSignatures.slice(-4).map((saved) => (
              <div
                key={saved.id}
                className="grid place-items-center rounded p-1"
                style={{
                  // Signature ink is dark, always. The swatch keeps a light
                  // ground in both themes so it stays legible instead of
                  // disappearing into a dark panel.
                  background: '#ffffff',
                  border: '1px solid var(--app-border-strong)',
                }}
                title={`Captured ${saved.label}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={saved.dataUrl} alt="A signature you captured" style={{ height: 26 }} />
              </div>
            ))}
          </div>
        </>
      )}

      {candidates.length === 0 ? (
        <details className="mt-3">
          <summary
            className="cursor-pointer text-[11px]"
            style={{ color: 'var(--app-text-faint)' }}
          >
            Nothing in this file looks like a signature
          </summary>
          <p
            className="mt-1.5 text-[11px] leading-relaxed"
            style={{ color: 'var(--app-text-faint)' }}
          >
            Anything drawn straight into the page as plain shapes, or printed and scanned, cannot be
            told apart from the rest of the page.
          </p>
        </details>
      ) : (
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <SignatureCard candidate={candidate} onRemove={() => onRemove(candidate.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SignatureCard({
  candidate,
  onRemove,
}: {
  candidate: SignatureCandidate;
  onRemove: () => void;
}) {
  const removable = candidate.kind !== 'raster';

  return (
    <div
      className="rounded-md p-2.5"
      style={{ background: 'var(--app-panel-2)', border: '1px solid var(--app-border)' }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{title(candidate)}</span>
        <ConfidenceTag confidence={candidate.confidence} />
      </div>

      <p className="mb-1.5 text-[11px]" style={{ color: 'var(--app-text-faint)' }}>
        Page {candidate.page + 1}
      </p>

      <ul className="m-0 mb-2 list-none p-0">
        {candidate.reasons.map((reason, index) => (
          <li
            key={index}
            className="text-[11px] leading-snug"
            style={{ color: 'var(--app-text-dim)' }}
          >
            {reason}
          </li>
        ))}
      </ul>

      {candidate.invalidatesSignature && (
        <p
          className="mb-2 rounded px-2 py-1 text-[11px] leading-snug"
          style={{ background: 'var(--app-warn-soft)', color: 'var(--app-warn)' }}
        >
          Removing this invalidates the document&apos;s digital signature. That cannot be avoided:
          the signature certifies the original bytes.
        </p>
      )}

      {removable ? (
        <button
          type="button"
          onClick={onRemove}
          className="focus-ring w-full rounded px-2 py-1 text-[11px] font-medium"
          style={{
            background: 'transparent',
            color: 'var(--app-danger)',
            border: '1px solid var(--app-danger)',
            cursor: 'pointer',
          }}
        >
          Remove from the file
        </button>
      ) : (
        <p
          className="rounded px-2 py-1 text-[11px] leading-snug"
          style={{ background: 'var(--app-panel)', color: 'var(--app-text-faint)' }}
        >
          Use the Cover tool to hide it. The pixels stay in the file, so do not treat that as
          redaction.
        </p>
      )}
    </div>
  );
}

function ConfidenceTag({ confidence }: { confidence: SignatureCandidate['confidence'] }) {
  const styles: Record<
    SignatureCandidate['confidence'],
    { bg: string; fg: string; label: string }
  > = {
    certain: { bg: 'var(--app-ok-soft)', fg: 'var(--app-ok)', label: 'certain' },
    high: { bg: 'var(--app-ok-soft)', fg: 'var(--app-ok)', label: 'likely' },
    medium: { bg: 'var(--app-warn-soft)', fg: 'var(--app-warn)', label: 'maybe' },
    low: { bg: 'var(--app-panel)', fg: 'var(--app-text-faint)', label: 'guess' },
  };
  const style = styles[confidence];

  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: style.bg, color: style.fg }}
    >
      {style.label}
    </span>
  );
}

function title(candidate: SignatureCandidate): string {
  switch (candidate.kind) {
    case 'digital':
      return 'Digital signature';
    case 'annotation':
      return 'Signature annotation';
    case 'image':
      return 'Signature image';
    case 'raster':
      return 'Scanned page';
  }
}
