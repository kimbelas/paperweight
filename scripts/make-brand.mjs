/**
 * Generate the brand images: the share card, the Apple touch icon and the two
 * manifest icons.
 *
 * Run by hand with `pnpm brand`; the output is committed. It is deliberately
 * not part of the build, for a reason that is easy to get wrong.
 *
 * Next can generate these at build time from an `opengraph-image.tsx`, and
 * under a normal deployment that is the better answer. Under `output:
 * 'export'` it is a trap: a code-generated image route is written to `out/` as
 * a file with no extension — `out/opengraph-image`, not `.png` — because the
 * route's name is the whole of its identity once there is no server to set a
 * content type. Wrangler then uploads it with the type it can infer from the
 * filename, which is nothing, so it is served as `application/octet-stream`.
 * Every social scraper refuses that, and the failure is invisible from this
 * side: the build succeeds, the file is there, the tag points at it, and the
 * preview is blank. A committed `.png` beside the layout is a static metadata
 * file, keeps its extension, and is served as an image.
 *
 * The renderer is the copy of satori that ships inside Next, so this adds no
 * dependency, and the fonts are the Liberation faces already in `public/fonts`
 * under the OFL. Nothing here touches the network.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImageResponse } from 'next/dist/compiled/@vercel/og/index.node.js';
import { HEADLINE, SITE_NAME, SITE_URL } from '../src/site.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const INK = '#18181b';
const DIM = '#52525b';
const FAINT = '#71717a';
const GROUND = '#f4f4f5';
const ACCENT = '#2563eb';

/** satori takes React elements; these are the shape of one, without JSX. */
function h(type, props = {}, ...children) {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
}

async function main() {
  const [regular, bold, markSvg] = await Promise.all([
    readFile(join(root, 'public/fonts/LiberationSans-Regular.ttf')),
    readFile(join(root, 'public/fonts/LiberationSans-Bold.ttf')),
    readFile(join(root, 'app/icon.svg'), 'utf8'),
  ]);

  const fonts = [
    { name: 'Liberation Sans', data: regular, weight: 400, style: 'normal' },
    { name: 'Liberation Sans', data: bold, weight: 700, style: 'normal' },
  ];

  // satori draws an <img>, not arbitrary SVG elements, so the mark goes in as
  // a data URI of the very file the site serves as its favicon.
  const mark = `data:image/svg+xml;base64,${Buffer.from(markSvg).toString('base64')}`;

  await write('app/opengraph-image.png', shareCard(mark), { width: 1200, height: 630, fonts });
  await write('app/apple-icon.png', iconTile(mark, 180), { width: 180, height: 180, fonts });
  await write('public/icons/icon-192.png', iconTile(mark, 192), { width: 192, height: 192, fonts });
  await write('public/icons/icon-512.png', iconTile(mark, 512), { width: 512, height: 512, fonts });
}

/**
 * The 1200x630 card that appears when the URL is pasted anywhere.
 *
 * It has to survive being shown at a third of this size in a chat client, so
 * it says three things and no more.
 */
function shareCard(mark) {
  return h(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: GROUND,
        padding: '72px 80px',
        fontFamily: 'Liberation Sans',
        // A hairline of accent along the top, so the card is recognisable at
        // thumbnail size even where the text is unreadable.
        borderTop: `12px solid ${ACCENT}`,
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 28 } },
      h('img', { src: mark, width: 88, height: 88 }),
      h(
        'div',
        { style: { display: 'flex', fontSize: 60, fontWeight: 700, color: INK, letterSpacing: -1 } },
        SITE_NAME,
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 22 } },
      h(
        'div',
        { style: { display: 'flex', fontSize: 52, fontWeight: 700, color: INK, lineHeight: 1.15, letterSpacing: -1 } },
        HEADLINE,
      ),
      h(
        'div',
        { style: { display: 'flex', fontSize: 30, color: DIM } },
        'Free · No upload · No account · No watermark · No quota',
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', fontSize: 24, color: FAINT } },
      new URL(SITE_URL).host,
    ),
  );
}

/**
 * A square icon tile.
 *
 * The mark sits at 68% of the canvas on an opaque ground. Both numbers are
 * deliberate: iOS composites the Apple touch icon onto white and does not
 * respect transparency, and a maskable manifest icon is cropped to whatever
 * shape the launcher likes, with only the middle 80% guaranteed to survive.
 */
function iconTile(mark, size) {
  return h(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: GROUND,
      },
    },
    h('img', { src: mark, width: Math.round(size * 0.68), height: Math.round(size * 0.68) }),
  );
}

async function write(relative, element, options) {
  const response = new ImageResponse(element, options);
  const bytes = Buffer.from(await response.arrayBuffer());
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  console.log(`${relative} — ${options.width}x${options.height}, ${(bytes.length / 1024).toFixed(1)} kB`);
}

await main();
