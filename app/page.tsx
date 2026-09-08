'use client';

import dynamic from 'next/dynamic';

/**
 * The editor touches `window`, `Worker` and `canvas` on the way up, and the
 * PDF engine is a WebAssembly module, so there is nothing meaningful to
 * render on a server. It is loaded client-side only.
 */
const Editor = dynamic(() => import('@/editor/Editor'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--app-text-faint)',
      }}
    >
      Starting the editor…
    </div>
  ),
});

export default function Page() {
  return <Editor />;
}
