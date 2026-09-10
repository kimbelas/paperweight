import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAQ, SITE_URL } from '@/site';

/**
 * The README against the site's own copy.
 *
 * The README is read where the app is not: on github.com, in a package
 * listing, and inside the crawl of every answer engine and language model
 * that will one day be asked what Paperweight is. So it answers the same
 * questions the site answers — and the failure mode of two copies of an
 * answer is that one of them quietly stops being true. `seo.spec.ts` already
 * pins the rendered FAQ to the structured data for that reason; this is the
 * same argument reaching one file further out.
 *
 * Only the questions are compared, not the answers. The README's are shorter
 * on purpose: what has to hold is that no question is answered in one place
 * and not the other, and that neither invents a question the other has never
 * heard of.
 */

const README = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

/** Every `### ` heading, which is what the FAQ is written as. */
const headings = README.split('\n')
  .filter((line) => line.startsWith('### '))
  .map((line) => line.slice(4).trim());

describe('README', () => {
  it('answers every question the site answers', () => {
    for (const { question } of FAQ) {
      expect(headings, `README is missing the FAQ question: ${question}`).toContain(question);
    }
  });

  it('invents no question the site does not answer', () => {
    const asked = FAQ.map((entry) => entry.question);
    expect(headings.filter((heading) => !asked.includes(heading))).toEqual([]);
  });

  it('links to the live site at its canonical URL', () => {
    expect(README).toContain(SITE_URL);
  });

  /**
   * Every screenshot the README points at has to exist, and be an image with
   * alt text. A broken image on GitHub renders as the alt text alone, which
   * looks deliberate and so goes unnoticed for a long time — and alt text is
   * the only description of the picture a crawler gets at all.
   */
  it('shows screenshots that exist, each with alt text', () => {
    const images = [...README.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    expect(images.length).toBeGreaterThan(0);

    for (const [, alt, path] of images) {
      expect(alt.length, `no alt text on ${path}`).toBeGreaterThan(20);
      expect(() => readFileSync(join(process.cwd(), path))).not.toThrow();
    }
  });
});
