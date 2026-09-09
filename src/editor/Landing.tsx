'use client';

import {
  AUTHOR,
  CREDITS,
  FAQ,
  FEATURES,
  FINE_PRINT,
  HEADLINE,
  LEAD,
  LIMITS,
  PRIVACY,
  REPO_URL,
  STEPS,
} from '@/site';

/**
 * The page as it looks with no document open — and the only thing a crawler,
 * a link preview or a language model ever sees.
 *
 * The editor cannot be server-rendered: it wants `window`, a `Worker` and a
 * WebAssembly module on the way up. So the static HTML is whatever the
 * dynamic import's fallback renders, and for most of this app's life that was
 * the words "Starting the editor…" and nothing else. Every description of
 * what Paperweight does lived inside the client bundle, where a search engine
 * that does not run scripts — and every social scraper, and most crawlers
 * feeding answer engines — could not reach it.
 *
 * This component is therefore rendered twice: once as that fallback, so it is
 * prerendered into `out/index.html`, and once by the editor itself as the
 * empty state. Rendering it in both places is the load-bearing part. Google
 * indexes the DOM after scripts run, so content that appears in the source and
 * then vanishes when the app mounts counts for nothing; content that survives
 * the swap counts twice.
 *
 * It must touch no browser API and hold no state. It is prerendered at build
 * time under Node, where `window` does not exist, and it is rendered again on
 * the client inside a bailed-out Suspense boundary, which React renders fresh
 * rather than hydrating — identical markup is what keeps that swap invisible.
 *
 * `onOpen` is absent in the prerendered copy, and the button is then genuinely
 * `disabled` rather than merely styled as such. That is what the browser tests
 * wait on: the heading now exists before any script has run, so it no longer
 * proves the editor is ready, and an enabled button does.
 */
export function Landing({
  onOpen,
  loading = false,
  dragOver = false,
  status,
}: {
  onOpen?: () => void;
  loading?: boolean;
  dragOver?: boolean;
  status?: string;
}) {
  const ready = Boolean(onOpen);

  return (
    <div
      className="mx-auto w-full max-w-2xl px-4 pb-16 sm:px-6"
      data-landing={ready ? 'ready' : 'loading'}
    >
      <section className="grid min-h-[min(70vh,620px)] place-items-center py-8">
        <div
          className="w-full max-w-lg rounded-2xl px-6 py-12 text-center sm:px-8"
          style={{
            background: 'var(--app-panel)',
            border: `2px dashed ${dragOver ? 'var(--app-accent)' : 'var(--app-border-strong)'}`,
          }}
        >
          <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
            {HEADLINE}
          </h1>

          <p className="mx-auto mt-3 max-w-sm text-sm" style={{ color: 'var(--app-text-dim)' }}>
            {LEAD}
          </p>

          <button
            type="button"
            onClick={onOpen}
            disabled={!ready || loading}
            className="focus-ring btn-solid mt-6 rounded-lg px-4 py-2 text-sm font-medium"
            style={{
              color: '#fff',
              border: 'none',
              cursor: loading ? 'progress' : 'pointer',
              opacity: ready && !loading ? 1 : 0.7,
            }}
          >
            {loading ? 'Opening…' : 'Choose a PDF'}
          </button>

          {status && (
            <p className="mt-3 text-xs" role="status" style={{ color: 'var(--app-text-faint)' }}>
              {status}
            </p>
          )}

          <p
            className="mx-auto mt-8 max-w-sm text-xs leading-relaxed"
            style={{ color: 'var(--app-text-faint)' }}
          >
            {FINE_PRINT}
          </p>

          <noscript>
            <p
              className="mx-auto mt-4 max-w-sm text-xs leading-relaxed"
              style={{ color: 'var(--app-text-faint)' }}
            >
              Paperweight needs JavaScript, WebAssembly and Web Workers to run. Everything below
              describes what it does; the editor itself will not start without them.
            </p>
          </noscript>
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <Panel id="what-it-does" heading="What it does">
          <ul className="flex flex-col gap-3 text-sm">
            {FEATURES.map((feature) => (
              <li key={feature.label}>
                <strong className="font-semibold">{feature.label}</strong>{' '}
                <span style={{ color: 'var(--app-text-dim)' }}>{feature.text}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="how-it-works" heading="How it works">
          <ol className="flex flex-col gap-3 text-sm">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums"
                  style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
                >
                  {index + 1}
                </span>
                <span>
                  <strong className="font-semibold">{step.title}</strong>{' '}
                  <span style={{ color: 'var(--app-text-dim)' }}>{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel id="questions" heading="Questions">
          <div className="flex flex-col gap-5">
            {FAQ.map((entry) => (
              <div key={entry.question}>
                {/* Deliberately not a <details>: an answer a crawler has to
                    open is an answer some crawlers never read. */}
                <h3 className="text-sm font-semibold">{entry.question}</h3>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--app-text-dim)' }}>
                  {entry.answer}
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel id="privacy" heading="Privacy">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--app-text-dim)' }}>
            {PRIVACY}
          </p>
        </Panel>

        <Panel id="limits" heading="Deliberate limits">
          <p className="mb-3 text-sm leading-relaxed" style={{ color: 'var(--app-text-dim)' }}>
            Stated here rather than discovered later. Each one is a decision, not a gap waiting to
            be filled.
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {LIMITS.map((limit) => (
              <li key={limit} style={{ color: 'var(--app-text-dim)' }}>
                {limit}
              </li>
            ))}
          </ul>
        </Panel>

        <footer
          className="px-1 pt-2 text-xs leading-relaxed"
          style={{ color: 'var(--app-text-faint)' }}
        >
          <p>
            Made by{' '}
            <a className="focus-ring underline" href={AUTHOR.url} rel="noopener">
              {AUTHOR.name}
            </a>
            .{' '}
            <a className="focus-ring underline" href={REPO_URL} rel="noopener">
              Source on GitHub
            </a>
            .
          </p>
          <p className="mt-1">{CREDITS}</p>
        </footer>
      </div>
    </div>
  );
}

function Panel({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-2xl px-5 py-6 sm:px-7"
      style={{ background: 'var(--app-panel)', border: '1px solid var(--app-border)' }}
    >
      <h2 id={`${id}-heading`} className="mb-4 text-base font-semibold tracking-tight">
        {heading}
      </h2>
      {children}
    </section>
  );
}
