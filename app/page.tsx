import EditorLoader from '@/editor/EditorLoader';
import { structuredDataJson } from '@/structured-data';

/**
 * The only route.
 *
 * A server component, so the structured data below is rendered into the static
 * HTML and never shipped to the browser as JavaScript. It lives here rather
 * than in the layout because it describes this page: the layout also wraps the
 * 404, which Next marks `noindex`, and a `FAQPage` on a page nobody may index
 * is a contradiction a validator will report.
 *
 * The editor itself is client-only and arrives through `EditorLoader`, whose
 * fallback is the landing page — see `src/editor/Landing.tsx` for why that
 * matters more than it looks.
 */
export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        // The JSON is escaped so it cannot close this element early; see
        // `structuredDataJson`. React would escape a text child, which would
        // corrupt the JSON, so it has to be set this way.
        dangerouslySetInnerHTML={{ __html: structuredDataJson() }}
      />
      <EditorLoader />
    </>
  );
}
