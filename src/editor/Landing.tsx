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
  FEATURES_MORE_LABEL,
  FINE_PRINT,
  HEADLINE,
  HERO_CLAIMS,
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
 * Two things have been tried here and the second is the one to keep.
 *
 * It began as type, one accent on one button, and hairline rules, on the
 * argument that the app is a tool and its front door should be built to the
 * same rule. It was reported as too boring to read, and it was — though not
 * for the reason it looked like. The rules were fine; the **ranking** was
 * missing. Eleven tools, five sections, ten questions and eight limits all
 * arrived at one volume, so the eye had nowhere to land.
 *
 * The obvious fix was applied next and was worse: every group became a
 * rounded card with a tinted icon tile in a four-column grid. It was rejected
 * on sight as looking generated, which was correct. A card grid is the house
 * style of every page a language model has ever been asked to write, and it
 * had converted a page with a voice into one without. It also did not fix the
 * problem, because eleven identical boxes rank no better than eleven
 * identical rows.
 *
 * So: no cards, no tinted icon tiles, and hierarchy built out of the things
 * that actually make it — space, order, rules and scale.
 *
 * - **The tool list has two tiers.** The three the headline claims get a rule,
 *   a hanging label and their prose at reading size; the other eight run
 *   underneath at two thirds the space. `FEATURES` is ordered accordingly, and
 *   that order is asserted, so it is not incidental.
 * - **Sections are numbered, over a rule, under a large heading.** That is
 *   what says "there are five of these and this is the second" without a box
 *   around anything.
 * - **Colour means something or it is neutral.** Three meanings, no more: blue
 *   for action and for tools that change the document, green for "your file
 *   stays here", amber for "this is not what it looks like" — the same amber
 *   the editor raises over a cover and a patched scan. It arrives as tinted
 *   glyphs, coloured labels and rules, never as a filled panel. See `TONES`.
 * - **No badge or eyebrow pill.** The headline says what this is. A tinted
 *   capsule above it repeating the category is decoration wearing a label.
 * - **No tick icons beside claims.** A green tick is a picture of
 *   trustworthiness; the sentence next to it is the evidence. Only one of
 *   those survives being quoted, and every site that has ever lost a file has
 *   green ticks. `TRUST` gets one green rule over the four instead.
 * - **No drop-zone rectangle.** The whole pane accepts a drop, so drawing a
 *   dashed box in one corner of it is a smaller and less truthful target than
 *   the one that actually exists. `Editor` tints the pane while a file is
 *   over it; the button and the line beside it are what the page shows.
 *
 * None of this touches what an extractor reads. The definitional answer still
 * opens the page, every claim still carries its evidence, each section keeps a
 * stable `id` to be cited by, and the comparison, the steps and the tools are
 * still a table, an ordered list and lists.
 *
 * `tests/e2e/seo.spec.ts` pins that structure hard: exactly one `h1`, exactly
 * five `h2` matching `SECTIONS`, and `#what-it-does h3` exactly the feature
 * labels **in order** — which is why the two tiers are two lists rather than a
 * reshuffle. It also measures the type scale, h1 against h2 and h2 against the
 * feature h3, at 1280 and again at 390, and those sizes move together or not
 * at all. The current set and the margin each ratio clears by:
 *
 * | | 390 | 1280 |
 * | --- | --- | --- |
 * | `h1` | 36.8px | 57.6px |
 * | section `h2` | 24px | 33.6px |
 * | tool/step `h3` | 16px | 16px |
 * | `#answer` | 18px | 18px |
 *
 * `h1 > 1.4×h2` at 390 is 36.8 against 33.6, the tightest of the four at about
 * 3px. `h2 > 1.25×h3` is 24 against 20. `h3 ≤ #answer` is 16 against 18. The
 * `h3` was 15px until the section `h2` grew; that is where the room to raise it
 * came from, and raising `h3` again means raising `h2` first.
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
      // The gutter the section rail sits in is reserved by `.landing` in
      // `globals.css` rather than by a class here, because it has to appear
      // only where the rail itself does — inside the same `@supports` guard.
      // It costs 144px of content width above 1280, which is the honest price
      // of it: enough for the longest label and its dash without either
      // reaching back over the tool grid or the comparison table, both of
      // which do run to the container's right edge.
      className="landing mx-auto w-full max-w-[1440px] px-5 pb-20 sm:px-8 lg:px-10"
      data-landing={ready ? 'ready' : 'loading'}
    >
      <SectionRail />

      {/* --- The answer, then the way in -------------------------------- */}

      {/* Below 1280 this is one column, exactly as it was. Above it the
          headline and the paragraph sit side by side — type in both, no panel
          and no picture between them — because that is what lets the hero
          reach the width the rest of the page now uses without stretching a
          line of prose past reading length. */}
      <section className="pt-14 pb-16 sm:pt-20 sm:pb-20 xl:grid xl:grid-cols-[1.05fr_1fr] xl:items-start xl:gap-x-16 xl:gap-y-10">
        {/* Bigger than it was at every width, and the sizes are not free:
            `seo.spec.ts` measures h1 against h2 and h2 against the feature
            h3. Raising the section h2 for the editorial rules meant raising
            this to keep the first ratio, and the numbers were checked at 390,
            640 and 1280 rather than guessed. */}
        <h1 className="text-[2.3rem] leading-[1.06] font-semibold tracking-[-0.025em] text-balance sm:text-[3rem] xl:col-start-1 xl:row-start-1 xl:text-[3.6rem] xl:leading-[1.02]">
          {HEADLINE}
        </h1>

        {/* The `speakable` target in the structured data. Keep the id.
            It follows the headline in the source at every width; the grid
            puts it beside rather than beneath on a wide screen, which is
            placement, not reordering. */}
        <p
          id="answer"
          className="mt-6 max-w-[40rem] text-[18px] leading-[1.6] text-pretty xl:col-start-2 xl:row-start-1 xl:mt-0 xl:pt-2"
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

          {/* The three-word form of the claims below, in the one colour that
              means "your file stays here". Text, not pills: a capsule around
              two words is a border and a background spent on emphasis the
              colour already provides. */}
          <ul className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium">
            {HERO_CLAIMS.map((claim) => (
              <li key={claim} style={{ color: 'var(--app-ok)' }}>
                {claim}
              </li>
            ))}
          </ul>

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

      {/* One green rule over the four, and vertical hairlines between them:
          the group is the unit, so it gets one line rather than four boxes.
          The labels carry the colour and the detail stays quiet, which is the
          order they should be read in. `dt` and `dd` text is untouched — both
          strings are asserted to appear exactly once as exact text, and
          `uppercase` is a style, not a change to what they say. */}
      <dl
        className="reveal grid gap-y-7 border-t-2 pt-6 sm:grid-cols-2 sm:gap-x-8 xl:grid-cols-4"
        style={{ borderTopColor: 'var(--app-ok)' }}
      >
        {TRUST.map((claim, index) => (
          <div
            key={claim.label}
            className={index > 0 ? 'xl:border-l xl:pl-8' : undefined}
            style={rule}
          >
            <dt
              className="text-[12px] font-semibold uppercase tracking-[0.09em]"
              style={{ color: 'var(--app-ok)' }}
            >
              {claim.label}
            </dt>
            <dd
              className="mt-2.5 max-w-[52ch] text-[15px] leading-relaxed"
              style={{ color: 'var(--app-text-dim)' }}
            >
              {claim.detail}
            </dd>
          </div>
        ))}
      </dl>

      {/* --- Anchors, so a passage can be cited by fragment -------------- */}

      {/* Sticky and centred, the way a section nav on a long page should be:
          it scrolls up with the hero, then stays. `position: sticky` needs no
          script, which matters because this component may not touch a browser
          API — and it sticks to the top of `main`, since that is the element
          the landing page scrolls inside, not the document.

          The negative margins take the bar's background out to the container's
          edges while its content stays on the same measure as everything else.

          There is exactly one of these on the page and there has to be: every
          browser spec resolves `nav[aria-label="Jump to"]` and each link name
          strictly, so a second copy — a mobile variant, say — would break the
          whole suite rather than just its own test.

          Not here, and not possible without script: the highlight on whichever
          section you are currently in. Knowing that means watching scroll
          position, which is a browser API and state. */}
      <nav
        aria-label={NAV_LABEL}
        className="sticky top-0 z-10 -mx-5 mt-14 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-y px-5 py-3 text-xs sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10"
        style={{ ...rule, background: 'var(--app-bg)', color: 'var(--app-text-faint)' }}
      >
        <span className="font-semibold uppercase tracking-[0.09em]">{NAV_LABEL}</span>
        {SECTIONS.map((entry) => (
          <a
            key={entry.id}
            href={`#${entry.id}`}
            className="focus-ring font-medium underline decoration-1 underline-offset-4"
            style={{ color: 'var(--app-text-dim)' }}
          >
            {entry.nav}
          </a>
        ))}
      </nav>

      {/* --- What it does ------------------------------------------------ */}

      <Section id="what-it-does">
        {/* Two tiers, because eleven tools at one volume is what made this
            page unreadable. The three the headline already claims get a rule,
            a hanging label and their prose at reading size; the other eight
            run underneath at two thirds the space. Nothing is hidden — every
            description is still here, and one of them carries the phrase
            "this is not redaction" that the SEO suite looks for in the body. */}
        <ul>
          {FEATURES.slice(0, 3).map((feature) => (
            <FeatureRow key={feature.label} feature={feature} lead />
          ))}
        </ul>

        <p
          className="mt-10 text-[12px] font-semibold uppercase tracking-[0.09em]"
          style={{ color: 'var(--app-text-faint)' }}
        >
          {FEATURES_MORE_LABEL}
        </p>

        <ul className="mt-5 grid border-t sm:grid-cols-2 sm:gap-x-12" style={rule}>
          {FEATURES.slice(3).map((feature) => (
            <FeatureRow key={feature.label} feature={feature} />
          ))}
        </ul>
      </Section>

      {/* --- How it works ------------------------------------------------ */}

      <Section id="how-it-works">
        <ol className="grid sm:grid-cols-3 sm:gap-x-12" style={rule}>
          {STEPS.map((step, index) => (
            <li key={step.title} className="border-t py-6 sm:py-7" style={rule}>
              {/* Hung above the heading rather than set inside it. Inside, the
                  heading's text — the thing a crawler lists and a screen
                  reader announces — becomes "1Open", and stops matching the
                  step name in the structured data. Big, because at three
                  steps the number is the thing the eye follows. */}
              <span
                aria-hidden="true"
                className="section-number block text-[2rem] leading-none font-semibold"
                style={{ color: 'var(--app-accent)' }}
              >
                {index + 1}
              </span>
              <h3 className="mt-4 text-[16px] font-semibold">{step.title}</h3>
              <p
                className="mt-2 max-w-[50ch] text-[15px] leading-relaxed"
                style={{ color: 'var(--app-text-dim)' }}
              >
                {step.text}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      {/* --- Privacy, and the architecture it follows from ---------------- */}

      <Section id="privacy">
        <p
          className="max-w-[72ch] text-[15px] leading-relaxed"
          style={{ color: 'var(--app-text-dim)' }}
        >
          {PRIVACY}
        </p>

        <h3 id="architecture-heading" className="mt-12 text-[16px] font-semibold">
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
                <th scope="col" className="py-3.5 pr-6 font-semibold">
                  <span className="sr-only">{ARCHITECTURE_COLUMNS.aspect}</span>
                </th>
                {/* Green: this is the column describing what happens here.
                    The other one is what happens everywhere else. */}
                <th
                  scope="col"
                  className="py-3.5 pr-6 font-semibold"
                  style={{ color: 'var(--app-ok)' }}
                >
                  {ARCHITECTURE_COLUMNS.here}
                </th>
                <th
                  scope="col"
                  className="py-3.5 font-semibold"
                  style={{ color: 'var(--app-text-faint)' }}
                >
                  {ARCHITECTURE_COLUMNS.uploaded}
                </th>
              </tr>
            </thead>
            <tbody>
              {ARCHITECTURE.map((row) => (
                <tr key={row.aspect} className="border-b" style={rule}>
                  <th scope="row" className="py-4 pr-6 align-top font-medium">
                    {row.aspect}
                  </th>
                  <td className="py-4 pr-6 align-top leading-relaxed">{row.here}</td>
                  <td
                    className="py-4 align-top leading-relaxed"
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
        {/* Two columns, not three: the section is split now, so this sits in
            about 816px at 1280 and a third column would be 250px wide. */}
        <div className="gap-x-10 md:columns-2">
          {FAQ.map((entry) => (
            <div
              key={entry.question}
              // Space, not a box: in a flowing column a box is cut in half
              // wherever the column breaks, and `break-inside-avoid` on ten of
              // very different heights leaves holes down the page.
              className="mb-8 break-inside-avoid last:mb-0"
            >
              <h3 className="text-[16px] font-semibold text-balance">{entry.question}</h3>
              <p
                className="mt-2 text-[15px] leading-relaxed"
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
        {/* An amber rule against each line, not a filled panel. Amber is the
            colour the editor already raises to say "this is not what it looks
            like" — over a cover, over a patched scan, over a value too wide
            for its field — and this section is that sentence eight times. A
            tinted block would have made it the loudest thing on the page,
            which inverts the point: these are things stated plainly, not
            warnings being shouted. */}
        <ul className="grid gap-y-4 sm:grid-cols-2 sm:gap-x-12">
          {LIMITS.map((limit) => (
            <li
              key={limit}
              className="border-l-2 pl-4 text-[15px] leading-relaxed"
              style={{ borderLeftColor: 'var(--app-warn)', color: 'var(--app-text-dim)' }}
            >
              {limit}
            </li>
          ))}
        </ul>
      </Section>

      {/* --- Footer --------------------------------------------------------- */}

      <footer
        className="mt-20 border-t pt-8 text-xs leading-relaxed"
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
/**
 * What each tool's colour says about it.
 *
 * The only information colour carries on this page, so it has to mean
 * something or be neutral:
 *
 * - `edit` — changes what is in the document. The app's accent.
 * - `care` — looks like editing and is not. Cover paints over content that
 *   stays in the file and stays extractable; reading a scan is a recogniser's
 *   guess with a confidence score. Both are the amber the editor itself uses
 *   when it warns about exactly these two, so the page and the tool agree.
 * - `doc` — moves the document about without touching its content. Neutral,
 *   because there is nothing to flag.
 */
const FEATURE_TONE: Record<FeatureIcon, 'edit' | 'care' | 'doc'> = {
  'edit-text': 'edit',
  'add-text': 'edit',
  field: 'edit',
  signature: 'edit',
  mark: 'edit',
  image: 'edit',
  cover: 'care',
  scan: 'care',
  select: 'doc',
  pages: 'doc',
  print: 'doc',
};

/**
 * The colour for each tone, as a theme token.
 *
 * The glyph itself is tinted rather than set in a tinted tile. A rounded
 * pastel square behind an icon is the most recognisable ornament on the
 * modern web and it says nothing; the same colour on the mark the toolbar
 * uses says which of three kinds of thing this tool is, and costs nothing.
 */
const TONES = {
  edit: 'var(--app-accent)',
  care: 'var(--app-warn)',
  doc: 'var(--app-text-faint)',
} as const;

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

/**
 * One tool: its label and its description.
 *
 * `lead` is the only difference between the two tiers, and it buys space and
 * reading-size prose rather than a different heading size. The `h3` stays at
 * 15px in both, because the heading-scale test wants the section `h2` at more
 * than 1.25× it on a 390px phone — 24 against 20, so there is room, but the
 * table in this file's own header note is where the four ratios are kept.
 *
 * There is no hanging-label column here any more. The section itself is now
 * split, with the heading pinned on the left, and a second split inside the
 * right-hand column left both halves too narrow to read.
 *
 * The glyph is the toolbar's own, at text size, tinted by what the tool does —
 * blue where it changes the document, amber where it does something that looks
 * like editing and is not. It is inside the heading and `aria-hidden`, so it
 * contributes no text: the heading still reads as the label alone, which is
 * what the structured data lists and a screen reader announces.
 */
function FeatureRow({
  feature,
  lead = false,
}: {
  feature: (typeof FEATURES)[number];
  lead?: boolean;
}) {
  const Icon = FEATURE_ICONS[feature.icon];
  const tone = TONES[FEATURE_TONE[feature.icon]];

  return (
    <li className={lead ? 'border-t py-6 xl:py-7' : 'border-b py-4 sm:py-4.5'} style={rule}>
      <h3 className="flex items-center gap-2.5 text-[16px] font-semibold">
        <span aria-hidden="true" className="shrink-0" style={{ color: tone }}>
          <Icon size={15} />
        </span>
        {feature.label}
      </h3>
      <p
        className={
          lead
            ? 'mt-2 max-w-[68ch] text-[16px] leading-[1.65]'
            : 'mt-1.5 max-w-[60ch] text-[15px] leading-relaxed'
        }
        style={{ color: 'var(--app-text-dim)' }}
      >
        {feature.text}
      </p>
    </li>
  );
}

/**
 * The rail down the right edge: one dash per section, the one you are in
 * extended, coloured and labelled.
 *
 * Decoration, and marked as such. The sticky "Jump to" strip is the real
 * navigation, and a second set of links carrying the same five names would
 * break every browser spec that resolves them strictly — so this carries no
 * links, no roles, and `aria-hidden`. A screen reader is told about the
 * section headings and the nav; it does not need a picture of them.
 *
 * All of the intelligence is in CSS — see `.rail-item` in `globals.css`, which
 * drives each dash from its own section's view timeline. Nothing here knows
 * about scrolling, which is what keeps this component free of browser APIs.
 *
 * Hidden below `xl`: there is no gutter to put it in on a narrow screen, and
 * a marker overlapping the text would be worse than no marker.
 */
function SectionRail() {
  return (
    // Fixed to the viewport's right edge and held at eye level, both set in
    // `globals.css` so they can live inside the same `@supports` guard as the
    // timelines that drive it.
    <div aria-hidden="true" className="rail pointer-events-none flex flex-col items-end gap-5 pr-5">
      {SECTIONS.map((entry, index) => (
        <span key={entry.id} className={`rail-item rail-${index + 1} flex items-center gap-2.5`}>
          <span
            className="rail-label text-[10px] font-semibold whitespace-nowrap uppercase tracking-[0.11em]"
            style={{ color: 'var(--app-accent)' }}
          >
            {entry.nav}
          </span>
          <span className="rail-dash" />
        </span>
      ))}
    </div>
  );
}

function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const { heading, lead } = SECTION[id];
  const number = String(SECTIONS.findIndex((entry) => entry.id === id) + 1).padStart(2, '0');

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      // `scroll-mt` clears the sticky nav above, or an anchor jump lands with
      // the heading hidden behind it.
      //
      // Two columns from `xl` and not from `lg`, which is a decision about the
      // table in `#privacy` rather than about taste. That table is 38rem wide
      // inside a horizontal scroller, and `seo.spec.ts` asserts that whenever
      // the scroller overflows, `ARCHITECTURE_HINT` is visible — while the
      // hint is `md:hidden`. At 1024 a 22rem title column would leave the
      // content about 528px, so the table would clip with nothing saying it
      // scrolls: a failing test and a real bug. At 1280, after the rail's
      // gutter, it has about 680px and fits.
      className="scroll-mt-16 mt-20 border-t pt-8 xl:mt-24 xl:grid xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:gap-x-16 xl:pt-10"
      style={rule}
    >
      {/*
        The title holds while its section's content goes past, then leaves with
        it. `self-start` is not optional: a grid item stretches to its row by
        default, so this column would already be as tall as the section and
        sticky would have nothing to travel through — it would do nothing at
        all, and say nothing about why.

        No z-index, so it passes under the jump nav rather than over it.
      */}
      <div className="xl:sticky xl:top-[4.5rem] xl:self-start">
        {/* The number is a sibling of the heading, never inside it. Inside,
            the heading's own text — which the structured data lists and the
            SEO suite compares against `SECTIONS` — would read "01What
            Paperweight does". */}
        <div className="flex items-baseline gap-4">
          <span
            aria-hidden="true"
            className="section-number text-xs font-semibold"
            style={{ color: 'var(--app-text-faint)' }}
          >
            {number}
          </span>
          <h2
            id={`${id}-heading`}
            className="text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl xl:text-[2.1rem]"
          >
            {heading}
          </h2>
        </div>
        {lead && (
          <p
            className="mt-4 max-w-[52ch] text-[16px] leading-relaxed"
            style={{ color: 'var(--app-text-dim)' }}
          >
            {lead}
          </p>
        )}
      </div>

      {/* The reveal lives here rather than on the section, because it animates
          a transform and a transformed ancestor becomes the containing block
          for its descendants — which is measured against, so a pinned child
          inside one stutters or stops sticking while the animation runs. */}
      <div className="reveal mt-10 xl:mt-0">{children}</div>
    </section>
  );
}
