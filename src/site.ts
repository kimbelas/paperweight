/**
 * Everything the outside world reads about Paperweight.
 *
 * The landing page, the document head, the structured data, the web manifest,
 * `robots.txt`, the sitemap and the tests all draw from here. One copy of each
 * string means the visible page and the machine-readable description of it
 * cannot drift apart — which matters most for the FAQ, where a mismatch
 * between the answers a person reads and the answers an answer engine is
 * handed is the kind of thing nobody notices for a year.
 *
 * This module deliberately imports nothing. It is pulled in by server
 * components, by a client component, by a build script and by Playwright, and
 * a single engine import would drag PDFium into the page bundle.
 */

/** The canonical origin. No trailing slash: paths are appended. */
export const SITE_URL = 'https://paperweight.itskimmatthewbelas.workers.dev';

export const SITE_NAME = 'Paperweight';

/** 56 characters, so a search result shows it whole. */
export const TITLE = 'Paperweight — Free PDF Editor in Your Browser, No Upload';

export const TITLE_TEMPLATE = '%s · Paperweight';

/** 149 characters. Long enough to say what it is, short enough to survive. */
export const DESCRIPTION =
  'Edit the text already in a PDF, remove or add signatures, fill forms and fix scans, all in your browser. No upload, no account, no watermark, no quota.';

/** The one `h1` on the page, and the headline on the share image. */
export const HEADLINE = 'Edit PDF text, signatures and forms in your browser';

/**
 * The first paragraph, and the one that gets quoted.
 *
 * Written to the shape an answer engine extracts: the entity, then its
 * category, then what separates it, in 47 words — short enough to be lifted
 * whole, long enough to stand alone when it is. It opens the page and it is
 * the `speakable` target in the structured data, so a summary of Paperweight
 * written by something that never ran the editor still comes out true.
 *
 * `LEAD` below is not a smaller version of this. It is the instruction on the
 * drop zone, and it tells you what to do rather than what this is.
 */
export const ANSWER =
  'Paperweight is a free PDF editor that runs entirely inside your browser tab. It changes the text already on the page, removes or adds signatures, fills in forms and reads scanned pages. There is no server to upload to, no account to make, and nothing to pay.';

/**
 * The line beside the button.
 *
 * The whole pane takes a drop, so this says so rather than drawing a small
 * box somewhere and implying the drop has to land inside it.
 */
export const LEAD = 'or drop one anywhere on this page';

export const FINE_PRINT =
  'Your file is opened here, on this device, and is never sent anywhere. Nothing is kept between visits unless you save it yourself.';

/**
 * Ownership tokens for the search consoles.
 *
 * Both are the bare `content` value of the meta tag the console offers, not
 * the whole tag. They live here because the alternative — a verification file
 * dropped in `public/` — is an unlabelled string in a filename that nobody
 * dares delete a year later, and because `layout.tsx` reads every other
 * public string from this module.
 *
 * Empty means the tag is not emitted at all, which is the right behaviour:
 * an empty `google-site-verification` is not a neutral tag, it is a claim of
 * ownership that fails. Verification survives a redeploy, so once a console
 * has checked the tag it can stay here forever; removing it later can
 * silently unverify the property.
 */
export const VERIFICATION = {
  /** Google Search Console → Add property → URL prefix → HTML tag. */
  google: '-r4MXpkDIM-42TjGeU-koULZjvtJmi3VAL-QHRWU4Bo',
  /** Bing Webmaster Tools → Add site → HTML meta tag (`msvalidate.01`). */
  bing: '',
};

export const AUTHOR = { name: 'Matt Belas', url: 'https://github.com/kimbelas' };

export const REPO_URL = 'https://github.com/kimbelas/paperweight';

/**
 * The date the landing copy last changed, as the sitemap's `lastmod`.
 *
 * Bumped by hand when the copy below changes. Deriving it from the build would
 * claim the page had changed on every deploy, which is a signal a crawler
 * learns to ignore.
 */
export const CONTENT_UPDATED = '2026-09-09';

/** The first commit. Paired with `CONTENT_UPDATED` in the structured data. */
export const CONTENT_PUBLISHED = '2026-09-08';

/**
 * The same date, written out, for the line a person reads in the footer.
 *
 * A literal rather than a formatted `Date`, because the landing page is
 * rendered twice from the same source — once under Node at build time and
 * once in the browser — and `toLocaleDateString` can disagree between the
 * two. A freshness signal that changes on hydration is a hydration mismatch
 * wearing a useful hat.
 */
export const CONTENT_UPDATED_LABEL = '9 September 2026';

/**
 * What people actually type.
 *
 * These go in `<meta name="keywords">`, which Google has ignored since 2009 —
 * but Bing reads it, and so do several of the crawlers that feed answer
 * engines. It costs one tag.
 */
export const KEYWORDS = [
  'free PDF editor',
  'edit PDF text',
  'edit PDF in browser',
  'PDF editor no upload',
  'PDF editor without uploading',
  'private PDF editor',
  'local PDF editor',
  'PDF editor no account',
  'PDF editor no watermark',
  'change text in a PDF',
  'edit existing text in a PDF',
  'remove signature from PDF',
  'add signature to PDF',
  'sign a PDF free',
  'fill PDF form',
  'fill in a PDF form online free',
  'edit scanned PDF',
  'OCR PDF in browser',
  'rotate PDF pages',
  'delete PDF pages',
  'PDFium WebAssembly PDF editor',
  'Paperweight PDF',
];

/**
 * What the app does, labelled the way the interface labels it.
 *
 * Someone who reads this list and then opens the app should find the same
 * words on the buttons. Each entry keeps the honesty the interface keeps:
 * cover is not redaction, a patched scan is not an edit, a substituted font
 * is announced.
 */
export const FEATURES: { label: string; text: string; icon: FeatureIcon }[] = [
  {
    label: 'Edit text',
    icon: 'edit-text',
    text: 'Click a line and retype it. The font the document already uses is reused when it has the letters; otherwise a close match is used and a badge says so.',
  },
  {
    label: 'Add text',
    icon: 'add-text',
    text: 'Place a new line of text anywhere on the page.',
  },
  {
    label: 'Fill in forms',
    icon: 'field',
    text: 'Click a field to type into it, tick boxes, choose options. Widen a field when a value will not fit.',
  },
  {
    label: 'Signature',
    icon: 'signature',
    text: 'Remove a signature that is an annotation, a signature field or an image on the page. Add one by drawing, typing or uploading.',
  },
  {
    label: 'Mark',
    icon: 'mark',
    text: 'Put a cross, tick, ring, dot or rule on a checkbox that is printed rather than a real field.',
  },
  {
    label: 'Cover',
    icon: 'cover',
    text: 'Hide content under an opaque patch. The content stays in the file, so this is not redaction.',
  },
  {
    label: 'Image',
    icon: 'image',
    text: 'Place a picture on the page.',
  },
  {
    label: 'Select',
    icon: 'select',
    text: 'Move or delete text and images.',
  },
  {
    label: 'Read this page',
    icon: 'scan',
    text: 'Recognise the text on a scanned page, on this device, then patch a line by covering it and drawing over it. A labelled patch, not an edit.',
  },
  {
    label: 'Pages',
    icon: 'pages',
    text: 'Rotate a page, insert a blank one after it, delete it, or save it as its own PDF, from the thumbnail rail.',
  },
  {
    label: 'Print and save',
    icon: 'print',
    text: 'Print with your changes. Save over the original in Chromium browsers; download a copy elsewhere.',
  },
];

/**
 * Which glyph a feature card carries.
 *
 * A key rather than a component, because this module must import nothing —
 * `Landing.tsx` maps these to the icons the toolbar already uses, so the card
 * and the button a reader will later press show the same mark. Naming the
 * icon here rather than keying a lookup off `label` means renaming a feature
 * cannot silently strand its icon.
 */
export type FeatureIcon =
  | 'edit-text'
  | 'add-text'
  | 'field'
  | 'signature'
  | 'mark'
  | 'cover'
  | 'image'
  | 'select'
  | 'scan'
  | 'pages'
  | 'print';

export const STEPS: { title: string; text: string }[] = [
  {
    title: 'Open',
    text: 'Drop a PDF onto the page or choose one. It is read by PDFium, compiled to WebAssembly and running in a worker inside this tab.',
  },
  {
    title: 'Edit',
    text: 'Click text to change it, a field to fill it, a signature to remove it. Every change is shown for what it is: a font substitution, a patch on a scan, a covered area.',
  },
  {
    title: 'Save or print',
    text: 'Save over the original, download a copy, or print. Only the pages you touched are rewritten; the rest of the file passes through unchanged.',
  },
];

/**
 * The four claims worth making early, each with the thing that backs it up.
 *
 * The claim is the term and the evidence is the definition, which is why this
 * renders as a `<dl>` rather than as four boxes. "No upload" is marketing;
 * "no upload, and the browser suite fails on any cross-origin request while a
 * document is open" is something somebody can go and check. Each `detail` has
 * to survive being quoted without its `label`, and neither may simply restate
 * `ANSWER` — a page that says the same thing three times in three shapes is
 * padding, however neatly it is arranged.
 */
export const TRUST: { label: string; detail: string }[] = [
  {
    label: 'Nothing is uploaded',
    detail:
      'No server, no upload path. The browser test suite fails if any cross-origin request is made while a document is open.',
  },
  {
    label: 'No account',
    detail: 'Nothing to sign up for. Preferences and any signatures you save stay in this browser.',
  },
  {
    label: 'No watermark, no quota',
    detail: 'Every page, every day, at full quality. There is no paid tier.',
  },
  {
    label: 'Open source',
    detail: 'PDFium under BSD-3-Clause, tesseract.js under Apache-2.0, the app itself on GitHub.',
  },
];

/**
 * The section headings, and the links that jump to them.
 *
 * One array so the two cannot disagree: the heading a reader sees, the `id`
 * an answer engine cites as a fragment, and the anchor at the top of the page
 * are all the same record. Headings name the product rather than the topic —
 * "What Paperweight does" rather than "Features" — because a heading is one
 * of the few places an extractor is confident about what the entity is.
 */
export const SECTIONS: { id: string; heading: string; nav: string; lead?: string }[] = [
  {
    id: 'what-it-does',
    heading: 'What Paperweight does',
    nav: 'What it does',
    lead: 'Eleven tools, named here exactly as they are named on the buttons.',
  },
  {
    id: 'how-it-works',
    heading: 'How Paperweight works',
    nav: 'How it works',
    lead: 'Three steps, and nothing between them reaches a network.',
  },
  {
    id: 'privacy',
    heading: 'Where your file goes',
    nav: 'Privacy',
  },
  {
    id: 'questions',
    heading: 'Questions people ask',
    nav: 'Questions',
    lead: 'Answered here in full, on the page, so no answer has to be expanded, clicked through or taken on trust.',
  },
  {
    id: 'limits',
    heading: 'What Paperweight will not do',
    nav: 'Limits',
    lead: 'Stated here rather than discovered later. Each one is a decision, not a gap waiting to be filled.',
  },
];

export const NAV_LABEL = 'Jump to';

export const NOSCRIPT =
  'Paperweight needs JavaScript, WebAssembly and Web Workers to run. Everything below describes what it does; the editor itself will not start without them.';

/**
 * The difference stated as architecture rather than as a boast.
 *
 * Rendered as a table, which is the shape this comparison actually is and the
 * shape a summariser reproduces most faithfully. It describes two ways of
 * building a PDF editor, and deliberately names no product: the claim is
 * about where a file ends up, which follows from the design, not about
 * anybody's conduct, which would not.
 */
export const ARCHITECTURE_HEADING = 'Two ways to build a PDF editor';

/**
 * Shown only where the table does not fit.
 *
 * Three columns of prose cannot be read on a phone, so the table scrolls
 * inside its own box — and a comparison whose second half is off-screen with
 * nothing to say so reads as a one-column list of boasts.
 */
export const ARCHITECTURE_HINT = 'Scroll the table sideways to see both columns.';

export const ARCHITECTURE_COLUMNS = {
  aspect: 'Aspect',
  here: 'Paperweight',
  uploaded: 'An editor that uploads',
};

export const ARCHITECTURE: { aspect: string; here: string; uploaded: string }[] = [
  {
    aspect: 'Where the file is opened',
    here: 'In this tab, by PDFium compiled to WebAssembly.',
    uploaded: 'On a machine you do not control, once a copy has been transmitted to it.',
  },
  {
    aspect: 'Who else ends up with a copy',
    here: 'Nobody. There is no server to hold one.',
    uploaded: 'The service and its host, for as long as their retention policy says.',
  },
  {
    aspect: 'What a breach there would expose',
    here: 'Nothing of yours. The document never left.',
    uploaded: 'Whatever had been uploaded and not yet deleted.',
  },
  {
    aspect: 'What it costs',
    here: 'Nothing, with no account and no limit.',
    uploaded: 'Commonly a free tier with a daily task limit, then a subscription.',
  },
];

/**
 * The questions people ask before trusting an editor with a document.
 *
 * Rendered as visible text and, from the same array, as `FAQPage` structured
 * data. Answers are plain strings with no markup, because `acceptedAnswer`
 * takes text — and because a test compares the two, so they cannot drift.
 */
export const FAQ: { question: string; answer: string }[] = [
  {
    question: 'Is my PDF uploaded anywhere?',
    answer:
      'No. There is no server behind this page: the editor is a folder of static files and the PDF engine runs in your browser. Nothing is sent, logged or analysed. The site refuses connections to any other origin, and the browser tests assert zero cross-origin requests while a document is open.',
  },
  {
    question: 'Is it free? Is there a watermark, a quota or an account?',
    answer:
      'Free, with no account, no watermark, no page limit and no tasks-per-day quota. There is no paid tier.',
  },
  {
    question: 'Can it edit the text already in a PDF, and in which font?',
    answer:
      'Yes. Click a line and retype it. The font embedded in the document is reused when it has the glyphs. Embedded fonts are usually subsets, so when it does not, a metric-compatible Liberation face is substituted and a badge tells you. Edits are line-scoped: PDF has no paragraphs, so a longer line is condensed, then shrunk, rather than reflowed.',
  },
  {
    question: 'Can it remove a signature? What about digital signatures?',
    answer:
      'It removes signatures that are annotations, signature form fields or images on the page, taking them out of the file rather than painting over them. A signature inside a scanned image cannot be removed, and the app says so. A digital (cryptographic) signature certifies the exact bytes of the original, so any edit invalidates it; you are told when the document opens.',
  },
  {
    question: 'Can it fill in PDF forms?',
    answer:
      'Yes. Click a field to type, tick a box or pick an option. Values are committed through the form itself, so the filled form prints correctly and other software can still read the values. A field clips to its own box; a value that would not fit can be widened, or drawn as page text with the trade-off stated.',
  },
  {
    question: 'Can it edit a scanned PDF?',
    answer:
      'A scan has no text, only pixels. Paperweight can read a scanned page on this device (English) with a confidence score per line, and replace a line by covering it and drawing new text on top. That is a patch, not an edit: the original pixels stay in the image and the result never matches the original typeface.',
  },
  {
    question: 'Does Cover redact?',
    answer:
      'No. Cover draws an opaque rectangle over content; the content underneath stays in the file and can still be extracted. Paperweight does not offer redaction and reserves the word for real content removal.',
  },
  {
    question: 'Which browsers can save over the original file?',
    answer:
      'Saving in place uses the File System Access API, which exists in Chromium browsers such as Chrome, Edge, Brave and Opera. In Firefox and Safari the button reads Download and produces a copy. Everything else works in current versions of all of them.',
  },
  {
    question: 'Does it work offline?',
    answer:
      'Yes, after the first visit. The app keeps itself in your browser: the page, the interface and the PDF engine are cached on that first load, so it opens and edits documents with no network at all, and it can be installed to a home screen or launcher and used like any other app. Two things are fetched when you first need them and kept from then on: the fonts used for substituted text and typed signatures, and the model that reads scans. Everything comes from this site, so there is nothing else to fetch and nowhere else for it to go.',
  },
  {
    question: 'What is it built on, and is the source available?',
    answer:
      'PDFium (BSD-3-Clause) compiled to WebAssembly and run in a Web Worker, tesseract.js (Apache-2.0) for reading scans, React and Next.js as a static export. The source is on GitHub at kimbelas/paperweight.',
  },
];

export const PRIVACY =
  'No server, no upload, no analytics, no cookies. Your preferences and any signatures you save live in this browser and never leave it. The security policy shipped with the site is that promise stated as a header: every origin it permits is this one, so a document opened here cannot be sent anywhere, even by an injected script.';

export const LIMITS: string[] = [
  'Text edits are line-scoped and never reflow, because PDF has no paragraph model.',
  'Text inside a form XObject is redrawn at page level rather than edited in place.',
  'Scanned pages are patched, not edited, and a patch never matches the original type.',
  'Reading a scan is English only.',
  'Nested images and shapes cannot be moved, only nested text.',
  'Editing a digitally signed document invalidates the signature.',
  'Saving over the original file is Chromium-only; elsewhere you get a copy.',
  'Cover hides content, it does not redact it.',
];

export const CREDITS =
  'Built on PDFium (BSD-3-Clause) via WebAssembly and tesseract.js (Apache-2.0). Liberation, Caveat, Dancing Script and Great Vibes fonts under SIL OFL 1.1.';
