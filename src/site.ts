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

export const LEAD =
  'Drop a PDF here or choose one. Change the words already on the page, remove or add a signature, fill in a form, then print or save. The file never leaves this device.';

export const FINE_PRINT =
  'No upload, no account, no watermark, no quota. Scanned pages can be read here too, on this device.';

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
export const FEATURES: { label: string; text: string }[] = [
  {
    label: 'Edit text',
    text: 'Click a line and retype it. The font the document already uses is reused when it has the letters; otherwise a close match is used and a badge says so.',
  },
  {
    label: 'Add text',
    text: 'Place a new line of text anywhere on the page.',
  },
  {
    label: 'Fill in forms',
    text: 'Click a field to type into it, tick boxes, choose options. Widen a field when a value will not fit.',
  },
  {
    label: 'Signature',
    text: 'Remove a signature that is an annotation, a signature field or an image on the page. Add one by drawing, typing or uploading.',
  },
  {
    label: 'Mark',
    text: 'Put a cross, tick, ring, dot or rule on a checkbox that is printed rather than a real field.',
  },
  {
    label: 'Cover',
    text: 'Hide content under an opaque patch. The content stays in the file, so this is not redaction.',
  },
  {
    label: 'Image',
    text: 'Place a picture on the page.',
  },
  {
    label: 'Select',
    text: 'Move or delete text and images.',
  },
  {
    label: 'Read this page',
    text: 'Recognise the text on a scanned page, on this device, then patch a line by covering it and drawing over it. A labelled patch, not an edit.',
  },
  {
    label: 'Pages',
    text: 'Rotate a page, insert a blank one after it, delete it, or save it as its own PDF, from the thumbnail rail.',
  },
  {
    label: 'Print and save',
    text: 'Print with your changes. Save over the original in Chromium browsers; download a copy elsewhere.',
  },
];

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
      'The page has to load once from the network. After that nothing else is fetched: the engine, the fonts and the model that reads scans are all served from this site, so the tab keeps working if the connection drops. An installable offline mode is on the roadmap and not yet shipped.',
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
