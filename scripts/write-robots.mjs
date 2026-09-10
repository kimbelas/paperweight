/**
 * Rewrite `out/robots.txt` with the Content Signals preamble.
 *
 * `app/robots.ts` produces the directives, and Next's metadata route is the
 * right place for them — but `MetadataRoute.Robots` has no way to emit a
 * comment, and a Content Signal without the text that defines it is a term
 * nobody agreed to. Cloudflare's own format is a comment block stating what
 * each signal means, followed by the machine-readable line.
 *
 * The previous arrangement assumed Cloudflare prepended that block itself on
 * a `workers.dev` host. It does not. `curl`ing the deployed file returned
 * exactly what the build emitted, preamble absent, which is how a directive
 * with no definition shipped and stayed shipped: nothing anywhere reports it,
 * because a robots.txt is valid either way and no crawler complains.
 *
 * So this runs as `postbuild`, after Next has written the file, and puts the
 * preamble in front of what is already there rather than restating the
 * directives — the route stays the single source of those, and this script
 * cannot drift from it.
 *
 * The wording is Cloudflare's published text, trimmed to the two signals
 * actually set. See https://contentsignals.org.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(root, 'out', 'robots.txt');

const PREAMBLE = `# As a condition of accessing this website, you agree to abide by the
# following content signals:
#
# (a) If a content signal is "yes", you may engage in the corresponding use.
# (b) If a content signal is "no", you may not engage in the corresponding use.
# (c) If no content signal is stated for a use, no permission is granted or
#     refused by these signals, and any other applicable rights or agreements
#     apply.
#
# The signals used here are defined as follows:
#
#   search: building a search index and providing search results (for example,
#     returning hyperlinks and short excerpts from this website's contents).
#     Search does not include providing AI-generated search summaries.
#   ai-input: inputting the content into one or more AI models (for example,
#     retrieval augmented generation, grounding, or other real-time taking of
#     content for generative AI search answers).
#
# Any use of this site's content that is not covered by a signal above is
# neither granted nor refused here.
`;

const current = await readFile(FILE, 'utf8');

if (current.startsWith('#')) {
  console.log('robots.txt → already carries a preamble, left alone');
} else {
  await writeFile(FILE, `${PREAMBLE}\n${current}`, 'utf8');
  const lines = PREAMBLE.trimEnd().split('\n').length;
  console.log(`robots.txt → out/robots.txt (${lines} lines of Content Signals preamble)`);
}
