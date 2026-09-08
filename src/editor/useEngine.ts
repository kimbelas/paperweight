'use client';

import * as Comlink from 'comlink';
import { useEffect, useRef, useState } from 'react';
import type { EngineApi } from '@/engine/worker';

/**
 * The worker client.
 *
 * One worker per app instance, created lazily on first use and torn down with
 * the component. Comlink turns the worker's API into a promise-returning
 * proxy, so callers just await methods.
 */

export type Engine = Comlink.Remote<EngineApi>;

let sharedWorker: Worker | null = null;
let sharedEngine: Engine | null = null;

function getEngine(): Engine {
  if (!sharedEngine) {
    // The worker is a build artefact produced by scripts/build-worker.mjs,
    // not something the page bundler compiles. Resolving it against
    // `document.baseURI` rather than the site root keeps it working when the
    // app is deployed under a sub-path or opened from a desktop shell.
    // The build stamp is part of the URL. A worker is fetched by plain URL and
    // cached hard, so without it a rebuilt engine is silently ignored: the tab
    // goes on running the previous worker while every test passes against the
    // new one, which looks exactly like a fix that does not work.
    const stamp = process.env.NEXT_PUBLIC_WORKER_STAMP ?? 'dev';
    const url = new URL('engine-worker.js', document.baseURI);
    url.searchParams.set('v', stamp);

    sharedWorker = new Worker(url, { type: 'module' });

    // Printed once, so the running engine can be identified from the console
    // when behaviour and source appear to disagree.
    console.info(`Paperweight engine build ${stamp}`);
    sharedEngine = Comlink.wrap<EngineApi>(sharedWorker);
  }
  return sharedEngine;
}

export function useEngine(): Engine {
  const ref = useRef<Engine | null>(null);
  ref.current ??= getEngine();
  return ref.current;
}

/**
 * Terminate the worker.
 *
 * Only for a hard reset; ordinary navigation keeps it alive so the 4.5 MB
 * WASM module is not re-fetched and re-instantiated.
 */
export function disposeEngine(): void {
  sharedWorker?.terminate();
  sharedWorker = null;
  sharedEngine = null;
}

/**
 * Track whether the engine is reachable.
 *
 * A worker that fails to start is otherwise invisible: every call just hangs.
 * This turns that into a message.
 */
export function useEngineHealth(engine: Engine): { ready: boolean; error: string | null } {
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({
    ready: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    // `isOpen` is the cheapest round trip that proves the worker booted and
    // the WASM module answered.
    engine
      .isOpen()
      .then(() => {
        if (!cancelled) setState({ ready: true, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          ready: false,
          error:
            error instanceof Error
              ? error.message
              : 'The PDF engine could not be started in this browser.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [engine]);

  return state;
}
