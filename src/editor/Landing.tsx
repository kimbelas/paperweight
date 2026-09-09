'use client';

import {
  ANSWER,
  ARCHITECTURE,
  ARCHITECTURE_COLUMNS,
  ARCHITECTURE_HEADING,
  ARCHITECTURE_HINT,
  AUTHOR,
  CONTENT_UPDATED,
  CONTENT_UPDATED_LABEL,
  CREDITS,
  FAQ,
  FEATURES,
  FINE_PRINT,
  HEADLINE,
  LEAD,
  LIMITS,
  NAV_LABEL,
  NOSCRIPT,
  PRIVACY,
  REPO_URL,
  SECTIONS,
  STEPS,
  TRUST,
  type FeatureIcon,
} from '@/site';
import {
  IconAddText,
  IconCover,
  IconEditText,
  IconField,
  IconImage,
  IconMark,
  IconPages,
  IconPrint,
  IconScanText,
  IconSelect,
  IconSignature,
} from './Icons';

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
 * That constraint is also why nothing here collapses, tabs, counts up or
 * reveals on scroll: every affordance is a link, a button, or plain CSS.
 *
 * `onOpen` is absent in the prerendered copy, and the button is then genuinely
 * `disabled` rather than merely styled as such. That is what the browser tests
 * wait on: the heading now exists before any script has run, so it no longer
 * proves the editor is ready, and an enabled button does.
 *
 * ## What this page is allowed to look like
 *
 * The rest of the app is a tool: hairlines, one accent, no ornament, nothing
 * on screen that is not doing a job. This page is the first thing anyone sees
 * of it, so it has to be built to the same rule, and the rule is easier to
 * state as a list of things that are not here:
 *
 * - **No badge or eyebrow pill.** The headline says what this is. A tinted
 *   capsule above it repeating the category is decoration wearing a label.
 * - **No tick icons beside claims.** A green tick is a picture of
 *   trustworthiness; the sentence next to it is the evidence. Only one of
 *   those survives being quoted, so only one is worth the space.
 * - **No icon in a tinted rounded tile.** The feature glyphs are the
 *   toolbar's own, set inline at text size and in text colour, because their
 *   job is to match a button the reader will press later — not to give each
 *   paragraph a coloured square.
 * - **No cards.** Every group here is separated by a hairline rule instead.
 *   Boxes inside boxes cost a border, a background and a shadow to express a
 *   grouping that a rule and some space already express.
 * - **No drop-zone rectangle.** The whole pane accepts a drop, so drawing a
 *   dashed box in one corner of it is a smaller and less truthful target than
 *   the one that actually exists. `Editor` tints the pane while a file is
 *   over it; the button and the line beside it are what the page shows.
 *
 * What is left is type, one accent on one button, and rules. That is also the
 * arrangement an extractor reads best, so the restraint costs nothing: the
 * definitional answer opens the page, every claim carries its evidence, the
 * headings name the product, each section has a stable `id` to be cited by,
 * and the comparison, the steps and the features are a table, an ordered list
 * and a list.
 */
export function Landing({
  onOpen,
  loading = false,
  status,
}: {
  onOpen?: () => void;
  loading?: boolean;
  status?: string;
}) {
  const ready = Boolean(onOpen);

  return (
    <div
      // Full width up to 1440, then it stops: past that the page would grow
      // without anything to fill it. A container wider than its own longest
      // line is only safe where structure fills the gap, which is why the
      // prose below keeps its own measure while the grids, the table and the
      // question columns take the width the container gives them.
      className="mx-auto w-full max-w-[1440px] px-5 pb-20 sm:px-8 lg:px-10"
      data-landing={ready ? 'ready' : 'loading'}
    >
      {/* --- The answer, then the way in -------------------------------- */}

      {/* Below 1280 this is one column, exactly as it was. Above it the
          headline and the paragraph sit side by side — type in both, no panel
          and no picture between them — because that is what lets the hero
          reach the width the rest of the page now uses without stretching a
          line of prose past reading length. */}
      <section className="pt-12 pb-12 sm:pt-16 sm:pb-14 xl:grid xl:grid-cols-[1.05fr_1fr] xl:items-start xl:gap-x-16 xl:gap-y-10">
        <h1 className="text-[2rem] leading-[1.08] font-semibold tracking-[-0.02em] text-balance sm:text-[2.6rem] xl:col-start-1 xl:row-start-1 xl:text-[3.4rem] xl:leading-[1.04]">
          {HEADLINE}
        </h1>

        {/* The `speakable` target in the structured data. Keep the id.
            It follows the headline in the source at every width; the grid
            puts it beside rather than beneath on a wide screen, which is
            placement, not reordering. */}
        <p
          id="answer"
          className="mt-6 max-w-[40rem] text-[17px] leading-[1.6] text-pretty xl:col-start-2 xl:row-start-1 xl:mt-0 xl:pt-2"
        >
          {ANSWER}
        </p>

        {/* Row two: the way in under the headline, the small print under the
            paragraph. Splitting them is what stops the headline column from
            trailing off into empty space at 1440. */}
        <div className="xl:col-start-1 xl:row-start-2">
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 xl:mt-0">
            <button
              type="button"
              onClick={onOpen}
              disabled={!ready || loading}
              // Deliberately larger than any control in the toolbar. This is
              // the one thing on the page a first-time visitor has to find, and
              // it is competing with a headline set at 42px.
              className="focus-ring btn-solid rounded-lg px-6 py-3.5 text-[15px] font-semibold"
              style={{
                color: '#fff',
                border: 'none',
                cursor: loading ? 'progress' : 'pointer',
                opacity: ready && !loading ? 1 : 0.7,
              }}
            >
              {loading ? 'Opening…' : 'Choose a PDF'}
            </button>

            <span className="text-sm" style={{ color: 'var(--app-text-dim)' }}>
              {LEAD}
            </span>
          </div>

          {status && (
            <p className="mt-3 text-xs" role="status" style={{ color: 'var(--app-text-faint)' }}>
              {status}
            </p>
          )}
        </div>

        <div className="xl:col-start-2 xl:row-start-2">
          <p
            className="mt-6 max-w-[62ch] text-xs leading-relaxed xl:mt-0"
            style={{ color: 'var(--app-text-faint)' }}
          >
            {FINE_PRINT}
          </p>

          <noscript>
            <p
              className="mt-3 max-w-[62ch] text-xs leading-relaxed"
              style={{ color: 'var(--app-text-faint)' }}
            >
              {NOSCRIPT}
            </p>
          </noscript>
        </div>
      </section>

      {/* --- The claims, as terms and their evidence --------------------- */}

      <dl className="grid gap-x-10 border-t sm:grid-cols-2 xl:grid-cols-4" style={rule}>
        {TRUST.map((claim) => (
          <div key={claim.label} className="border-b py-4 sm:py-5" style={rule}>
            <dt className="text-sm font-semibold">{claim.label}</dt>
            <dd
              className="mt-1 max-w-[52ch] text-sm leading-relaxed"
              style={{ color: 'var(--app-text-dim)' }}
            >
              {claim.detail}
            </dd>
          </div>
        ))}
      </dl>

      {/* --- Anchors, so a passage can be cited by fragment -------------- */}

      <nav
        aria-label={NAV_LABEL}
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-5 text-xs"
        style={{ color: 'var(--app-text-faint)' }}
      >
        <span>{NAV_LABEL}</span>
        {SECTIONS.map((entry, index) => (
          <span key={entry.id} className="flex items-baseline gap-x-3">
            {index > 0 && <span aria-hidden="true">·</span>}
            <a
              href={`#${entry.id}`}
              className="focus-ring underline decoration-1 underline-offset-2"
              style={{ color: 'var(--app-text-dim)' }}
            >
              {entry.nav}
            </a>
          </span>
        ))}
      </nav>

      {/* --- What it does ------------------------------------------------ */}

      <Section id="what-it-does">
        <ul
          className="grid border-t sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-3 xl:grid-cols-4"
          style={rule}
        >
          {FEATURES.map((feature) => {
            const Icon = FEATURE_ICONS[feature.icon];
            return (
              <li key={feature.label} className="border-b py-4" style={rule}>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Icon size={14} />
                  {feature.label}
                </h3>
                <p
                  className="mt-1.5 text-sm leading-relaxed"
                  style={{ color: 'var(--app-text-dim)' }}
                >
                  {feature.text}
                </p>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* --- How it works ------------------------------------------------ */}

      <Section id="how-it-works">
        <ol className="grid border-t sm:grid-cols-3 sm:gap-x-10" style={rule}>
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-2 border-b py-4" style={rule}>
              {/* Hung beside the heading rather than set inside it. Inside,
                  the heading's text — the thing a crawler lists and a screen
                  reader announces — becomes "1Open", and stops matching the
                  step name in the structured data. */}
              <span
                aria-hidden="true"
                className="w-3 shrink-0 text-sm font-semibold tabular-nums"
                style={{ color: 'var(--app-text-faint)' }}
              >
                {index + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold">{step.title}</h3>
                <p
                  className="mt-1.5 text-sm leading-relaxed"
                  style={{ color: 'var(--app-text-dim)' }}
                >
                  {step.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* --- Privacy, and the architecture it follows from ---------------- */}

      <Section id="privacy">
        <p
          className="max-w-[68ch] text-sm leading-relaxed"
          style={{ color: 'var(--app-text-dim)' }}
        >
          {PRIVACY}
        </p>

        <h3 id="architecture-heading" className="mt-9 text-sm font-semibold">
          {ARCHITECTURE_HEADING}
        </h3>

        <p className="mt-1 text-xs md:hidden" style={{ color: 'var(--app-text-faint)' }}>
          {ARCHITECTURE_HINT}
        </p>

        {/* A wide table scrolls inside its own box. The page must never
            scroll sideways on a phone because of it. */}
        <div className="mt-3 overflow-x-auto">
          <table
            aria-labelledby="architecture-heading"
            className="w-full min-w-[38rem] border-collapse text-left text-sm"
          >
            <thead>
              <tr className="border-y" style={rule}>
                <th scope="col" className="py-2.5 pr-6 font-semibold">
                  <span className="sr-only">{ARCHITECTURE_COLUMNS.aspect}</span>
                </th>
                <th scope="col" className="py-2.5 pr-6 font-semibold">
                  {ARCHITECTURE_COLUMNS.here}
                </th>
                <th
                  scope="col"
                  className="py-2.5 font-semibold"
                  style={{ color: 'var(--app-text-faint)' }}
                >
                  {ARCHITECTURE_COLUMNS.uploaded}
                </th>
              </tr>
            </thead>
            <tbody>
              {ARCHITECTURE.map((row) => (
                <tr key={row.aspect} className="border-b" style={rule}>
                  <th scope="row" className="py-3 pr-6 align-top font-medium">
                    {row.aspect}
                  </th>
                  <td className="py-3 pr-6 align-top leading-relaxed">{row.here}</td>
                  <td
                    className="py-3 align-top leading-relaxed"
                    style={{ color: 'var(--app-text-dim)' }}
                  >
                    {row.uploaded}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* --- Questions ---------------------------------------------------- */}

      <Section id="questions">
        {/* Two columns by flow rather than by grid, so a long answer does not
            leave a hole beside a short one. Deliberately not a <details>: an
            answer a crawler has to open is an answer some crawlers never
            read. */}
        <div className="gap-x-10 md:columns-2 xl:columns-3">
          {FAQ.map((entry) => (
            <div key={entry.question} className="mb-6 break-inside-avoid last:mb-0">
              <h3 className="text-sm font-semibold text-balance">{entry.question}</h3>
              <p
                className="mt-1.5 text-sm leading-relaxed"
                style={{ color: 'var(--app-text-dim)' }}
              >
                {entry.answer}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* --- Limits -------------------------------------------------------- */}

      <Section id="limits">
        <ul className="grid border-t sm:grid-cols-2 sm:gap-x-10 xl:grid-cols-4" style={rule}>
          {LIMITS.map((limit) => (
            <li
              key={limit}
              className="border-b py-3 text-sm leading-relaxed"
              style={{ ...rule, color: 'var(--app-text-dim)' }}
            >
              {limit}
            </li>
          ))}
        </ul>
      </Section>

      {/* --- Footer --------------------------------------------------------- */}

      <footer
        className="mt-14 border-t pt-6 text-xs leading-relaxed"
        style={{ ...rule, color: 'var(--app-text-faint)' }}
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
        <p className="mt-1">
          This page was last updated on{' '}
          <time dateTime={CONTENT_UPDATED}>{CONTENT_UPDATED_LABEL}</time>.
        </p>
      </footer>
    </div>
  );
}

/**
 * The one border colour on the page.
 *
 * Tailwind's `border-*` utilities set a width and a style; the colour is a
 * theme token, which cannot be written as a class here, so it is spread onto
 * every ruled element from one place rather than retyped a dozen times.
 */
const rule = { borderColor: 'var(--app-border)' } as const;

type SectionId = 'what-it-does' | 'how-it-works' | 'privacy' | 'questions' | 'limits';

/**
 * The sections by `id`, so a heading is written once in `site.ts` and read
 * from there by the section itself, by the anchor nav above it, and by the
 * test that compares the page to the structured data.
 */
const SECTION = Object.fromEntries(SECTIONS.map((entry) => [entry.id, entry])) as Record<
  SectionId,
  (typeof SECTIONS)[number]
>;

/**
 * The glyph on each feature, mapped from the key `site.ts` names.
 *
 * These are the toolbar's own icons, set inline at text size and inheriting
 * text colour, so an entry here and the button it describes carry the same
 * mark.
 */
const FEATURE_ICONS: Record<FeatureIcon, React.ComponentType<{ size?: number }>> = {
  'edit-text': IconEditText,
  'add-text': IconAddText,
  field: IconField,
  signature: IconSignature,
  mark: IconMark,
  cover: IconCover,
  image: IconImage,
  select: IconSelect,
  scan: IconScanText,
  pages: IconPages,
  print: IconPrint,
};

function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const { heading, lead } = SECTION[id];

  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-4 pt-12">
      <h2 id={`${id}-heading`} className="text-base font-semibold tracking-tight">
        {heading}
      </h2>
      {lead && (
        <p
          className="mt-1.5 max-w-[68ch] text-sm leading-relaxed"
          style={{ color: 'var(--app-text-dim)' }}
        >
          {lead}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}
