/**
 * Write `out/_headers` after `next build`.
 *
 * Cloudflare serves the `out/` folder as static assets and reads a `_headers`
 * file from it for response headers. The file cannot simply live in `public/`
 * because the Content-Security-Policy in it allow-lists inline scripts by
 * hash, and Next emits fresh inline scripts (the React Flight payload) on
 * every build. So the hashes are computed from the actual build output, here,
 * and the policy is regenerated with them. A stale hash would not fail the
 * build; it would fail in the browser as a blank page, which is why this runs
 * as `postbuild` rather than by hand.
 *
 * Why hashes and not 'unsafe-inline': this origin holds the user's documents
 * in IndexedDB and their File System Access handles. Script injection here is
 * the one thing that could make a document leave the machine, so inline
 * scripts are pinned to exactly the ones the build produced and everything
 * else must come from this origin.
 *
 * Every directive below is exercised by `tests/deploy/csp.spec.ts` and the
 * rest of the browser suite under `pnpm test:e2e:deploy`, which serves the
 * build through `wrangler dev` with these headers applied. Add a resource the
 * app loads — a font, a frame, a worker — and that suite is what tells you the
 * policy needs to follow.
 *
 * Run with `node scripts/write-headers.mjs`, after `next build`.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'out');

/** Every HTML file the export produced, recursively. */
async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(path)));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

/**
 * CSP hash sources for the inline scripts in one HTML document.
 *
 * The browser hashes the script element's text exactly as it appears between
 * the tags — script content is raw text, so there is no entity decoding — and
 * the bytes are taken verbatim here for the same reason. Scripts with a `src`
 * load by URL and are covered by 'self'.
 */
function inlineScriptHashes(html) {
  const hashes = new Set();
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const [, attrs, body] of html.matchAll(scripts)) {
    if (/\bsrc\s*=/i.test(attrs) || body.length === 0) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/** The policy, one directive per line so each can carry its reason. */
function contentSecurityPolicy(scriptHashes) {
  return [
    // Nothing loads from anywhere but this origin unless a directive says so.
    `default-src 'self'`,
    // Page scripts and both workers are same-origin files; inline scripts are
    // pinned by hash. 'wasm-unsafe-eval' lets PDFium and the OCR core compile
    // WebAssembly; it does not permit eval() of JavaScript, which nothing in
    // the shipped bundles needs.
    `script-src 'self' 'wasm-unsafe-eval' ${[...scriptHashes].sort().join(' ')}`,
    // React renders `style={{}}` as style attributes in the exported HTML, and
    // the stylesheet is same-origin. An injected style cannot run code.
    `style-src 'self' 'unsafe-inline'`,
    // Signature previews are data: URLs; an uploaded signature is a blob: URL.
    `img-src 'self' data: blob:`,
    // The signature faces are loaded with FontFace from /fonts/.
    `font-src 'self'`,
    // fetch() of the WASM binary, the fonts and the OCR model. No other
    // network, which is the app's privacy promise stated as a header.
    `connect-src 'self'`,
    // The engine worker and the OCR worker, both plain same-origin URLs.
    `worker-src 'self'`,
    // Printing renders the saved document in a blob: frame.
    `frame-src blob:`,
    // No plugins, no <base> tag redirecting the worker URL, no form posts.
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    // No *other* site may frame the editor. This is `'self'` rather than
    // `'none'` because printing frames a blob: URL of the document, and a
    // blob: frame inherits the policy of the document that created it —
    // whereupon WebKit enforces the inherited `frame-ancestors` against the
    // parent and refuses to load the frame. Chromium and Firefox do not, so
    // for most of this file's life the directive looked free. It was not: on
    // Safari it refused the print frame, from the app's own policy, and
    // printing is the feature this app exists to reach. `'self'` still
    // refuses every cross-origin framer, which is the clickjacking threat;
    // the only thing it now permits is this origin framing itself, which is
    // exactly what printing does.
    //
    // `X-Frame-Options: DENY` below stays as it is. It applies to the
    // top-level HTML response, where DENY is right, and it cannot apply to a
    // blob: frame at all, because a blob: URL has no response headers.
    `frame-ancestors 'self'`,
  ].join('; ');
}

/** The `_headers` file: a path pattern, then its headers indented under it. */
function headersFile(csp) {
  const rules = {
    '/*': {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      // Nothing is fetched cross-origin, so no referrer is ever needed.
      'Referrer-Policy': 'no-referrer',
      // The legacy form of frame-ancestors, for anything that predates CSP.
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
    /*
     * Keep the workers.dev copies out of search results.
     *
     * The Worker answers on its own `workers.dev` name as well as on the
     * site's domain, and every preview deployment gets one too — the same
     * bytes at a second and third address, which is a duplicate of the whole
     * site. The absolute canonical in `src/site.ts` says which one is real,
     * but a canonical is a hint and a preview URL has no business being a
     * candidate at all.
     *
     * The placeholder syntax is Cloudflare's own, from the "Prevent your
     * workers.dev URLs showing in search results" example: a `:name`
     * placeholder matches everything up to the next delimiter, which inside
     * a host is a dot. So this covers `paperweight.<subdomain>.workers.dev`
     * and `<version>-paperweight.<subdomain>.workers.dev` alike, and matches
     * nothing on the custom domain.
     *
     * A rule that matches inherits the headers of every other rule that
     * matches, so these pages still get the policy above.
     */
    'https://:version.:subdomain.workers.dev/*': {
      'X-Robots-Tag': 'noindex',
    },
  };

  let text = '';
  for (const [path, headers] of Object.entries(rules)) {
    text += `${path}\n`;
    for (const [name, value] of Object.entries(headers)) text += `  ${name}: ${value}\n`;
  }
  return text;
}

const files = await htmlFiles(outDir).catch(() => []);
if (files.length === 0) {
  throw new Error('No HTML found in out/. Run `next build` first; this script runs as postbuild.');
}

const hashes = new Set();
for (const file of files) {
  for (const hash of inlineScriptHashes(await readFile(file, 'utf8'))) hashes.add(hash);
}

const text = headersFile(contentSecurityPolicy(hashes));

// Cloudflare's limit is 2,000 characters per line. The policy is the only
// line that could approach it, and only if the export grew a lot of pages.
for (const line of text.split('\n')) {
  if (line.length > 2000) {
    throw new Error(
      `A _headers line is ${line.length} characters; Cloudflare allows 2,000. ` +
        `Split the policy per path in scripts/write-headers.mjs.`,
    );
  }
}

const target = join(outDir, '_headers');
await writeFile(target, text);
console.log(
  `_headers → ${relative(root, target)} (${hashes.size} inline script hashes from ${files.length} pages)`,
);
