'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommitResult, FormFieldInfo, PageInfo } from '@/engine/types';
import {
  canSaveInPlace,
  download,
  editedName,
  openFile,
  readDroppedFile,
  saveAs,
  saveToHandle,
} from '@/io/files';
import { printPdf } from '@/io/print';
import {
  loadPreferences,
  loadSignatures,
  pickImageFile,
  readImageFile,
  savePreferences,
  saveSignatures,
} from '@/io/storage';
import type { OcrLine } from '@/ocr/recognise';
import { useOcr } from '@/ocr/useOcr';
import { Landing } from './Landing';
import { useMediaQuery } from './media';
import { Notices } from './Notices';
import { PageView } from './PageView';
import { ShortcutsDialog } from './ShortcutsDialog';
import { SignatureModal, type CapturedSignature } from './SignatureModal';
import { StatusBar } from './StatusBar';
import { Thumbnails, type PageActions } from './Thumbnails';
import { Toolbar } from './Toolbar';
import { ToolRail } from './ToolRail';
import { nextOverlayId, toPlacements, useEditor } from './store';
import { useEngine, useEngineHealth } from './useEngine';

/**
 * The editor shell.
 *
 * It owns the flows that span components: opening, committing an edit,
 * applying pending additions, saving and printing. The panels stay
 * presentational so the order of operations — which matters, because saving
 * must flatten overlays first — lives in one place.
 */
export default function Editor() {
  const engine = useEngine();
  const health = useEngineHealth(engine);
  const ocr = useOcr(engine);

  const info = useEditor((s) => s.info);
  const fileName = useEditor((s) => s.fileName);
  const loading = useEditor((s) => s.loading);
  const zoom = useEditor((s) => s.zoom);
  const fitMode = useEditor((s) => s.fitMode);
  const overlay = useEditor((s) => s.overlay);
  const dirty = useEditor((s) => s.dirty);
  const currentPage = useEditor((s) => s.currentPage);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const savedSignatures = useEditor((s) => s.savedSignatures);

  const store = useEditor;
  const setDocument = useEditor((s) => s.setDocument);
  const setInfo = useEditor((s) => s.setInfo);
  const setLoading = useEditor((s) => s.setLoading);
  const setZoom = useEditor((s) => s.setZoom);
  const setFitMode = useEditor((s) => s.setFitMode);
  const setCurrentPage = useEditor((s) => s.setCurrentPage);
  const setSignatures = useEditor((s) => s.setSignatures);
  const notify = useEditor((s) => s.notify);
  const notifyBadges = useEditor((s) => s.notifyBadges);
  const setHistory = useEditor((s) => s.setHistory);
  const addOverlay = useEditor((s) => s.addOverlay);
  const clearOverlay = useEditor((s) => s.clearOverlay);
  const markClean = useEditor((s) => s.markClean);
  const setSelection = useEditor((s) => s.setSelection);
  const setTool = useEditor((s) => s.setTool);
  const saveSignature = useEditor((s) => s.saveSignature);
  const replaceSignatures = useEditor((s) => s.replaceSignatures);

  const [renderTokens, setRenderTokens] = useState<Record<number, number>>({});
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showThumbs, setShowThumbs] = useState(true);
  const [showTools, setShowTools] = useState(true);
  const [visible, setVisible] = useState({ from: 0, to: 4 });

  /**
   * On a narrow screen the rails open over the document rather than beside it.
   *
   * 248px of tools plus 178px of pages is 426px of chrome, which on a phone
   * pushed the page itself clean off the right-hand edge: the document was
   * still there, still rendering, still at whatever zoom fit a column of zero
   * width, and entirely invisible. `drawer` is which rail is open, and it is
   * deliberately separate from `showTools`/`showThumbs`, which stay the
   * preference this browser saved on a big screen — opening a rail on a phone
   * must not rewrite what the same browser does on a desktop.
   */
  const narrow = useNarrow();
  const [drawer, setDrawer] = useState<'tools' | 'pages' | null>(null);

  const toolsOpen = narrow ? drawer === 'tools' : showTools;
  const thumbsOpen = narrow ? drawer === 'pages' : showThumbs;

  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const inPlace = useMemo(() => canSaveInPlace(), []);
  const pageInfo: PageInfo | null = info?.pages[currentPage] ?? null;

  // --- Persisted odds and ends -------------------------------------------

  useEffect(() => {
    void (async () => {
      const [signatures, prefs] = await Promise.all([loadSignatures(), loadPreferences()]);
      if (signatures.length > 0) replaceSignatures(signatures);
      setShowThumbs(prefs.showThumbnails);
      setShowTools(prefs.showTools);
      setFitMode(prefs.fitMode);
    })();
  }, [replaceSignatures, setFitMode]);

  useEffect(() => {
    void saveSignatures(savedSignatures);
  }, [savedSignatures]);

  // Rotating a phone to landscape, or widening a window, puts the rails back
  // in the flow; a drawer left open over them would be a second copy.
  useEffect(() => {
    if (!narrow) setDrawer(null);
  }, [narrow]);

  // Picking a tool on a phone means you now want to see the page, not the
  // list you picked it from. This also covers the tool the OCR button arms
  // for you.
  useEffect(() => {
    setDrawer(null);
  }, [tool]);

  useEffect(() => {
    void savePreferences({
      showThumbnails: showThumbs,
      showTools,
      fitMode: fitMode === 'page' ? 'page' : 'width',
    });
  }, [showThumbs, showTools, fitMode]);

  // --- Opening -----------------------------------------------------------

  const loadBytes = useCallback(
    async (name: string, bytes: Uint8Array, handle?: FileSystemFileHandle) => {
      setLoading(true);
      try {
        const opened = await engine.open(bytes);
        handleRef.current = handle ?? null;
        setDocument(name, opened);
        setRenderTokens({});
        ocr.clearAll();
        setVisible({ from: 0, to: Math.min(4, opened.pageCount - 1) });

        const scan = await engine.signatures();
        setSignatures(scan.candidates);
        setHistory(await engine.historyState());

        const scans = opened.pages.filter((p) => p.isScanned).length;
        if (scans === opened.pageCount && scans > 0) {
          notify(
            'info',
            scans === 1
              ? 'This page is a scanned image, so it has no text to edit. Use the panel on the left to read it first.'
              : `All ${scans} pages are scanned images, so they have no text to edit. Use the panel on the left to read a page first.`,
          );
        } else if (scans > 0) {
          notify(
            'info',
            `${scans} of ${opened.pageCount} pages are scans and have no text to edit.`,
          );
        }

        if (scan.digitalCount > 0) {
          notify(
            'info',
            `This document carries ${scan.digitalCount === 1 ? 'a digital signature' : `${scan.digitalCount} digital signatures`}. Any edit will invalidate ${scan.digitalCount === 1 ? 'it' : 'them'}.`,
          );
        }
      } catch (error) {
        notify('error', describe(error, 'That file could not be opened.'));
      } finally {
        setLoading(false);
      }
    },
    [engine, ocr, setDocument, setLoading, setSignatures, setHistory, notify],
  );

  const handleOpen = useCallback(async () => {
    try {
      const file = await openFile();
      if (!file) return;
      await loadBytes(file.name, file.bytes, file.handle);
    } catch (error) {
      notify('error', describe(error, 'That file could not be opened.'));
    }
  }, [loadBytes, notify]);

  // --- Editing -----------------------------------------------------------

  /** Fold a commit result into the UI: re-render pages, surface badges. */
  const absorb = useCallback(
    async (result: CommitResult | null) => {
      if (!result) return;
      if (result.changedPages.length > 0) {
        setRenderTokens((tokens) => {
          const next = { ...tokens };
          for (const page of result.changedPages) next[page] = (next[page] ?? 0) + 1;
          return next;
        });
      }
      notifyBadges(result.badges);
      setInfo(await engine.info());
      setSignatures((await engine.signatures()).candidates);
      setHistory(await engine.historyState());
      store.getState().markDirty();
    },
    [engine, notifyBadges, setInfo, setSignatures, setHistory, store],
  );

  const commitText = useCallback(
    async (page: number, lineId: string, text: string) => {
      setBusy('Applying text…');
      try {
        await absorb(await engine.replaceText(page, lineId, text));
      } catch (error) {
        notify('error', describe(error, 'That text could not be changed.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify],
  );

  /**
   * Commit a new value for a form field.
   *
   * Not `replaceText`: the value is not a text object on the page, so there
   * is no line to rewrite and nothing about the page's content stream
   * changes. PDFium regenerates the field's appearance instead, which is what
   * makes the page look different afterwards.
   */
  const commitFormField = useCallback(
    async (field: FormFieldInfo, value: string, width?: number) => {
      setBusy('Updating the form…');
      try {
        await absorb(await engine.setFormFieldValue(field.page, field.name, value, width));
      } catch (error) {
        notify('error', describe(error, 'That form field could not be changed.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify],
  );

  /** Tick a box or pick a radio option. */
  const toggleFormField = useCallback(
    async (field: FormFieldInfo) => {
      setBusy('Updating the form…');
      try {
        await absorb(await engine.toggleFormFieldValue(field.page, field.name));
      } catch (error) {
        notify('error', describe(error, 'That box could not be ticked.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify],
  );

  /**
   * Commit an edit to text recovered from a scan.
   *
   * A different operation from editing a text object: the page is a picture,
   * so the region is painted over and the replacement drawn on top. The
   * recognised line is updated too, so the box stays clickable and now holds
   * the user's words rather than the recogniser's guess.
   */
  const commitOcr = useCallback(
    async (line: OcrLine, text: string) => {
      setBusy('Replacing on the scan…');
      try {
        await absorb(
          await engine.patchRegion({
            page: line.page,
            rect: line.bounds,
            text,
            fontSize: line.estimatedFontSize,
            fontKey: 'sans',
            colour: { r: 0, g: 0, b: 0, a: 255 },
          }),
        );
        // The region now holds a genuine text object, so the recognised line
        // has served its purpose. Keeping it would draw a second outline over
        // real text and offer to paint over it again.
        ocr.removeLine(line.page, line.id);
      } catch (error) {
        notify('error', describe(error, 'That text could not be replaced.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify, ocr],
  );

  const removeSignature = useCallback(
    async (id: string) => {
      setBusy('Removing signature…');
      try {
        await absorb(await engine.removeSignatureById(id));
      } catch (error) {
        notify('error', describe(error, 'That signature could not be removed.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify],
  );

  /** Delete named objects, whether or not they are the current selection. */
  const deleteObjects = useCallback(
    async (page: number, paths: number[][]) => {
      setBusy('Deleting…');
      try {
        await absorb(await engine.removeObjects(page, paths));
        setSelection(null);
      } catch (error) {
        notify('error', describe(error, 'That item could not be deleted.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify, setSelection],
  );

  const deleteSelection = useCallback(async () => {
    if (!selection) return;
    await deleteObjects(selection.page, selection.paths);
  }, [selection, deleteObjects]);

  /** Widen a field so its current value is not clipped by its own box. */
  const widenField = useCallback(
    async (field: FormFieldInfo) => {
      setBusy('Widening the field…');
      try {
        await absorb(await engine.fitFormFieldWidth(field.page, field.name));
      } catch (error) {
        notify('error', describe(error, 'That field could not be widened.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify],
  );

  /**
   * Remove a form field's widget from the page.
   *
   * The widget is an annotation, not a page object, so this goes through the
   * annotation list rather than `removeObjects`. It is matched by rectangle
   * rather than by name: a field's name frequently lives on a parent in the
   * field tree rather than on the widget itself, so the widget's own `/T` is
   * often absent, while its rectangle is exactly what the hit test used to
   * decide the user had clicked this field.
   */
  const deleteField = useCallback(
    async (field: FormFieldInfo) => {
      setBusy('Removing the field…');
      try {
        const annotations = await engine.annotations(field.page);
        const near = (a: number, b: number) => Math.abs(a - b) < 0.75;
        const match = annotations.find(
          (a) =>
            near(a.bounds.left, field.rect.left) &&
            near(a.bounds.bottom, field.rect.bottom) &&
            near(a.bounds.right, field.rect.right) &&
            near(a.bounds.top, field.rect.top),
        );
        if (!match) throw new Error('That field could not be found on the page any more.');
        await absorb(await engine.removeAnnotationsAt(field.page, [match.index]));
      } catch (error) {
        notify('error', describe(error, 'That field could not be removed.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify],
  );

  // --- Pages ---------------------------------------------------------------

  /**
   * What the pages rail's right-click menu does.
   *
   * Structural edits, all of them undoable, and all of them going through
   * `absorb` so the thumbnails, the page list and the history state catch up
   * together. Extracting a page is the exception: it produces a separate file
   * and leaves this document alone.
   */
  const pageActions: PageActions = useMemo(
    () => ({
      rotate: (page) => {
        setBusy('Rotating…');
        void engine
          .rotate(page, 1)
          .then(absorb)
          .catch((error: unknown) =>
            notify('error', describe(error, 'That page could not be rotated.')),
          )
          .finally(() => setBusy(null));
      },
      move: (page, to) => {
        setBusy('Reordering…');
        void engine
          .movePages([page], to)
          .then(async (result) => {
            await absorb(result);
            setCurrentPage(Math.max(0, to));
          })
          .catch((error: unknown) =>
            notify('error', describe(error, 'That page could not be moved.')),
          )
          .finally(() => setBusy(null));
      },
      insertAfter: (page) => {
        setBusy('Inserting a page…');
        void engine
          .insertBlankPage(page + 1)
          .then(absorb)
          .catch((error: unknown) =>
            notify('error', describe(error, 'A page could not be inserted.')),
          )
          .finally(() => setBusy(null));
      },
      extract: (page) => {
        setBusy('Preparing the page…');
        void engine
          .extract([page])
          .then((bytes) => {
            const base = (fileName ?? 'document.pdf').replace(/\.pdf$/i, '');
            download(bytes, `${base} — page ${page + 1}.pdf`);
          })
          .catch((error: unknown) =>
            notify('error', describe(error, 'That page could not be saved on its own.')),
          )
          .finally(() => setBusy(null));
      },
      remove: (page) => {
        setBusy('Deleting the page…');
        void engine
          .deletePages([page])
          .then(async (result) => {
            await absorb(result);
            setCurrentPage(Math.max(0, page - 1));
          })
          .catch((error: unknown) =>
            notify('error', describe(error, 'That page could not be deleted.')),
          )
          .finally(() => setBusy(null));
      },
    }),
    [engine, absorb, notify, setCurrentPage, fileName],
  );

  /**
   * Commit a drag.
   *
   * The selection is cleared afterwards because the objects it named may not
   * exist any more: moving text out of a form XObject removes it and draws a
   * replacement, so the old paths point at nothing.
   */
  const moveSelection = useCallback(
    async (page: number, paths: number[][], dx: number, dy: number) => {
      setBusy('Moving…');
      try {
        await absorb(await engine.moveObjects(page, paths, dx, dy));
        setSelection(null);
      } catch (error) {
        notify('error', describe(error, 'That item could not be moved.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify, setSelection],
  );

  /**
   * Write pending overlay items into the document.
   *
   * Called before anything that produces bytes, because an overlay item that
   * has not been applied exists only in the UI and would be missing from a
   * saved or printed file.
   */
  const applyOverlay = useCallback(async (): Promise<boolean> => {
    const placements = toPlacements(store.getState().overlay).filter(
      (p) => p.type !== 'text' || p.text.trim() !== '',
    );
    if (placements.length === 0) {
      clearOverlay();
      return true;
    }

    try {
      await absorb(await engine.apply(placements));
      clearOverlay();
      return true;
    } catch (error) {
      notify('error', describe(error, 'Those additions could not be applied.'));
      return false;
    }
  }, [engine, absorb, clearOverlay, notify, store]);

  const undo = useCallback(async () => {
    setBusy('Undoing…');
    try {
      const result = await engine.undo();
      if (result) await absorb(result);
    } catch (error) {
      notify('error', describe(error, 'That could not be undone.'));
    } finally {
      setBusy(null);
    }
  }, [engine, absorb, notify]);

  const redo = useCallback(async () => {
    setBusy('Redoing…');
    try {
      const result = await engine.redo();
      if (result) await absorb(result);
    } catch (error) {
      notify('error', describe(error, 'That could not be redone.'));
    } finally {
      setBusy(null);
    }
  }, [engine, absorb, notify]);

  // --- Output ------------------------------------------------------------

  const save = useCallback(
    async (forceDialog: boolean) => {
      setBusy('Saving…');
      try {
        if (!(await applyOverlay())) return;
        const bytes = await engine.save();

        if (!forceDialog && handleRef.current) {
          await saveToHandle(handleRef.current, bytes);
          markClean();
          notify('info', `Saved to ${fileName ?? 'the original file'}.`);
          return;
        }

        const handle = await saveAs(
          bytes,
          forceDialog ? editedName(fileName) : (fileName ?? 'document.pdf'),
        );
        if (handle) handleRef.current = handle;
        markClean();
      } catch (error) {
        notify('error', describe(error, 'The document could not be saved.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, applyOverlay, fileName, markClean, notify],
  );

  const doDownload = useCallback(async () => {
    setBusy('Preparing download…');
    try {
      if (!(await applyOverlay())) return;
      download(await engine.save(), editedName(fileName));
      markClean();
    } catch (error) {
      notify('error', describe(error, 'The document could not be downloaded.'));
    } finally {
      setBusy(null);
    }
  }, [engine, applyOverlay, fileName, markClean, notify]);

  const doPrint = useCallback(async () => {
    setBusy('Preparing to print…');
    try {
      if (!(await applyOverlay())) return;
      const result = await printPdf(await engine.save());
      if (result.hint) notify('info', result.hint);
    } catch (error) {
      notify('error', describe(error, 'The document could not be printed.'));
    } finally {
      setBusy(null);
    }
  }, [engine, applyOverlay, notify]);

  // --- Placement ---------------------------------------------------------

  /** Drop something onto the current page and scroll it into view. */
  const placeOnPage = useCallback(
    (
      widthFraction: number,
      aspect: number,
      kind: 'signature' | 'image',
      bitmap: { data: Uint8ClampedArray; width: number; height: number },
    ) => {
      const page = info?.pages[currentPage];
      if (!page) return;

      const width = Math.min(page.width * widthFraction, page.width * 0.7);
      const height = width / Math.max(aspect, 0.05);
      const left = page.width * 0.14;
      const bottom = kind === 'signature' ? page.height * 0.16 : page.height * 0.4;

      addOverlay({
        id: nextOverlayId(),
        page: currentPage,
        rect: { left, bottom, right: left + width, top: bottom + height },
        kind,
        bitmap,
        lockAspect: true,
      });

      // A signature lands in the lower part of the page, which at a fit-width
      // zoom is usually below the fold. Without this the user is told to drag
      // something they cannot see.
      requestAnimationFrame(() => {
        const scroller = scrollRef.current;
        const node = scroller?.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
        if (!scroller || !node) return;
        const fractionFromTop = (page.height - (bottom + height)) / page.height;
        scroller.scrollTo({
          top: Math.max(
            0,
            node.offsetTop + fractionFromTop * node.offsetHeight - scroller.clientHeight * 0.35,
          ),
          behavior: 'smooth',
        });
      });
    },
    [info, currentPage, addOverlay],
  );

  const placeSignature = useCallback(
    (captured: CapturedSignature) => {
      placeOnPage(0.32, captured.width / captured.height, 'signature', {
        data: captured.data,
        width: captured.width,
        height: captured.height,
      });
      saveSignature({
        id: nextOverlayId(),
        label: new Date().toLocaleDateString(),
        dataUrl: captured.dataUrl,
        width: captured.width,
        height: captured.height,
      });
      notify(
        'info',
        'Drag the signature into place, then Save or Print to write it into the file.',
      );
    },
    [placeOnPage, saveSignature, notify],
  );

  const addImage = useCallback(async () => {
    try {
      const file = await pickImageFile();
      if (!file) return;
      const image = await readImageFile(file);
      placeOnPage(0.45, image.width / image.height, 'image', image);
      notify('info', 'Drag the image into place, then Save or Print to write it into the file.');
    } catch (error) {
      notify('error', describe(error, 'That image could not be added.'));
    }
  }, [placeOnPage, notify]);

  // --- Zoom and virtualisation -------------------------------------------

  useEffect(() => {
    if (!info || fitMode === 'custom') return;
    const node = scrollRef.current;
    if (!node) return;

    const fit = () => {
      const page = info.pages[currentPage] ?? info.pages[0];
      if (!page) return;
      const available = node.clientWidth - 48;
      const availableHeight = node.clientHeight - 48;
      const next =
        fitMode === 'width'
          ? available / page.width
          : Math.min(available / page.width, availableHeight / page.height);
      setZoom(Math.max(0.1, Math.min(4, next)), fitMode);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [info, fitMode, currentPage, setZoom]);

  /** Ctrl or Cmd plus wheel zooms, as it does in every other document viewer. */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !info) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // Without this the browser zooms the whole page instead.
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom(store.getState().zoom * factor, 'custom');
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [info, setZoom, store]);

  /**
   * Track which pages to mount.
   *
   * Rendering every page of a long document at once is the difference between
   * opening a 28-page file instantly and grinding through 28 bitmaps first.
   * Only a window around the visible page is mounted; the rest keep their
   * exact height so the scrollbar and every page offset stay honest.
   */
  useEffect(() => {
    if (!info) return;
    const node = scrollRef.current;
    if (!node) return;

    const update = () => {
      const gap = 24;
      const top = node.scrollTop;
      const bottom = top + node.clientHeight;

      let offset = gap;
      let first = info.pageCount - 1;
      let last = 0;
      let bestPage = 0;
      let bestVisible = -1;

      for (let i = 0; i < info.pageCount; i++) {
        const height = info.pages[i].height * zoom;
        const start = offset;
        const end = offset + height;

        if (end >= top && start <= bottom) {
          first = Math.min(first, i);
          last = Math.max(last, i);

          // How much of this page is on screen. Whichever shows the most is
          // the page the user would say they are looking at.
          const shown = Math.min(end, bottom) - Math.max(start, top);
          if (shown > bestVisible) {
            bestVisible = shown;
            bestPage = i;
          }
        }
        offset = end + gap;
      }

      // Two pages of slack either side, so scrolling never reveals a blank.
      setVisible({
        from: Math.max(0, first - 2),
        to: Math.min(info.pageCount - 1, last + 2),
      });

      // Derived here rather than from an IntersectionObserver on each page. A
      // page taller than the viewport can never reach a 50% intersection
      // ratio, so an observer-based approach silently stopped updating the
      // page number on exactly the long documents where it matters.
      if (bestVisible > 0) setCurrentPage(bestPage);
    };

    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [info, zoom, setCurrentPage]);

  // --- Keyboard ----------------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal keys from a field the user is typing in.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const meta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (meta) {
        if (key === 'z') {
          event.preventDefault();
          void (event.shiftKey ? redo() : undo());
        } else if (key === 'y') {
          event.preventDefault();
          void redo();
        } else if (key === 's') {
          event.preventDefault();
          void save(event.shiftKey || !(inPlace && handleRef.current));
        } else if (key === 'p') {
          event.preventDefault();
          void doPrint();
        } else if (key === 'o') {
          event.preventDefault();
          void handleOpen();
        } else if (key === '0') {
          event.preventDefault();
          setFitMode('width');
        } else if (key === '9') {
          event.preventDefault();
          setFitMode('page');
        }
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection) {
          event.preventDefault();
          void deleteSelection();
        }
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // Single-letter tool shortcuts, as in every graphics editor.
      if (!info) return;
      const tools: Record<string, () => void> = {
        v: () => setTool('select'),
        t: () => setTool('edit-text'),
        a: () => setTool('add-text'),
        m: () => setTool('mark'),
        c: () => setTool('cover'),
        s: () => setSignatureModalOpen(true),
        i: () => void addImage(),
      };
      const action = tools[key];
      if (action) {
        event.preventDefault();
        action();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    undo,
    redo,
    save,
    doPrint,
    handleOpen,
    selection,
    deleteSelection,
    info,
    setTool,
    setFitMode,
    addImage,
    inPlace,
  ]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // --- Render ------------------------------------------------------------

  if (health.error) {
    return (
      <div
        className="grid h-screen place-items-center p-8 text-center"
        style={{ background: 'var(--app-bg)' }}
      >
        <div>
          <h1 className="mb-2 text-base font-semibold">The PDF engine could not start</h1>
          <p className="max-w-md text-sm" style={{ color: 'var(--app-text-dim)' }}>
            {health.error}
          </p>
          <p className="mt-3 max-w-md text-xs" style={{ color: 'var(--app-text-faint)' }}>
            This app needs WebAssembly and Web Workers. Both are available in current versions of
            Chrome, Edge, Firefox and Safari.
          </p>
        </div>
      </div>
    );
  }

  // Written once, because it is placed in two different ways: beside the
  // document on a wide screen, and inside the drawer on a narrow one.
  const thumbRail = info && (
    <Thumbnails
      engine={engine}
      info={info}
      currentPage={currentPage}
      renderTokens={renderTokens}
      actions={pageActions}
      onSelect={(page) => {
        setCurrentPage(page);
        scrollRef.current
          ?.querySelector(`[data-page="${page}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (narrow) setDrawer(null);
      }}
    />
  );

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--app-bg)' }}>
      <Toolbar
        hasDocument={Boolean(info)}
        fileName={fileName}
        dirty={dirty}
        busy={busy}
        canSaveInPlace={inPlace && Boolean(handleRef.current)}
        pendingCount={overlay.length}
        showTools={toolsOpen}
        showThumbs={thumbsOpen}
        onToggleTools={() =>
          narrow ? setDrawer((d) => (d === 'tools' ? null : 'tools')) : setShowTools((v) => !v)
        }
        onToggleThumbs={() =>
          narrow ? setDrawer((d) => (d === 'pages' ? null : 'pages')) : setShowThumbs((v) => !v)
        }
        onOpen={handleOpen}
        onSave={() => void save(false)}
        onSaveAs={() => void save(true)}
        onDownload={() => void doDownload()}
        onPrint={() => void doPrint()}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1">
        {info && !narrow && (
          // Collapsed to an icon column rather than hidden outright. The tools
          // are the reason the app is open; a toggle that took them away
          // entirely would be a toggle nobody could safely press.
          <ToolRail
            collapsed={!showTools}
            page={pageInfo}
            ocrLines={ocr.linesFor(currentPage)}
            ocrBusy={ocr.busyPage === currentPage}
            ocrProgress={ocr.progress}
            ocrError={ocr.error}
            onRunOcr={() => {
              // Arm the text tool, so the recognised boxes appear as soon as
              // they exist rather than after a further click.
              setTool('edit-text');
              void ocr.run(currentPage);
            }}
            onClearOcr={() => ocr.clearPage(currentPage)}
            onRemoveSignature={(id) => void removeSignature(id)}
            onAddSignature={() => setSignatureModalOpen(true)}
            onAddImage={() => void addImage()}
            onRotate={() => pageActions.rotate(currentPage)}
            onDeleteSelection={selection ? () => void deleteSelection() : undefined}
          />
        )}

        <main
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-auto"
          // The canvas is a darker ground so a white page reads as a sheet
          // lying on it. With no document there is no sheet, so that ground
          // has nothing to do and only makes the landing copy dimmer.
          // `EditorLoader` renders the same pair, or the prerendered page
          // would change colour the moment the editor mounted.
          style={{ background: info ? 'var(--app-canvas)' : 'var(--app-bg)' }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (event) => {
            event.preventDefault();
            setDragOver(false);
            try {
              const file = await readDroppedFile(event.dataTransfer);
              if (!file) {
                notify('error', 'That does not look like a PDF file.');
                return;
              }
              await loadBytes(file.name, file.bytes, file.handle);
            } catch (error) {
              notify('error', describe(error, 'That file could not be opened.'));
            }
          }}
        >
          {!info ? (
            // The same component the static HTML was built from, so the
            // landing copy stays in the DOM once the editor takes over.
            <Landing loading={loading} onOpen={handleOpen} />
          ) : (
            <div className="flex flex-col items-center gap-6 px-6 py-6">
              {info.pages.map((page) =>
                page.index >= visible.from && page.index <= visible.to ? (
                  <PageView
                    key={page.index}
                    engine={engine}
                    page={page}
                    zoom={zoom}
                    renderToken={renderTokens[page.index] ?? 0}
                    ocrLines={ocr.linesFor(page.index)}
                    onCommitText={commitText}
                    onCommitOcr={commitOcr}
                    onCommitField={commitFormField}
                    onToggleField={toggleFormField}
                    onMoveSelection={moveSelection}
                    onDeleteObjects={deleteObjects}
                    onWidenField={widenField}
                    onDeleteField={deleteField}
                    onRotatePage={(index) => pageActions.rotate(index)}
                  />
                ) : (
                  // A placeholder of the right height, so the scrollbar and
                  // every page offset stay correct while this page is not
                  // mounted.
                  <div
                    key={page.index}
                    data-page={page.index}
                    className="page-sheet mx-auto grid place-items-center"
                    style={{
                      width: Math.round(page.width * zoom),
                      height: Math.round(page.height * zoom),
                    }}
                  >
                    <span className="text-xs" style={{ color: 'var(--app-text-faint)' }}>
                      Page {page.index + 1}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}

          {/* The drop target is this whole pane, so this is what says so.
              The landing page used to draw a dashed box of its own, which was
              a smaller target than the real one and implied the drop had to
              land inside it. */}
          {dragOver && (
            <div
              // Fixed rather than absolute: this pane scrolls, and an
              // absolutely positioned overlay inside a scroller is placed
              // against the box at scroll origin, so it slides out of sight
              // once the landing copy has been scrolled at all.
              className="pointer-events-none fixed inset-0 z-30 grid place-items-center"
              style={{ background: 'color-mix(in srgb, var(--app-accent) 18%, transparent)' }}
            >
              <span
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{ background: 'var(--app-panel)', boxShadow: 'var(--app-shadow)' }}
              >
                {info ? 'Drop to open this PDF instead' : 'Drop to open'}
              </span>
            </div>
          )}
        </main>

        {info && !narrow && showThumbs && thumbRail}

        {/* The same two rails, opened over the document instead of beside it.
            Nothing here is a reduced version of the desktop rail: it is the
            rail, at its own width, with a scrim behind it. */}
        {info && narrow && drawer && (
          <>
            <button
              type="button"
              aria-label="Close this panel"
              onClick={() => setDrawer(null)}
              className="absolute inset-0 z-20"
              style={{ background: 'rgb(0 0 0 / 0.35)' }}
            />
            <div
              className={`absolute inset-y-0 z-30 flex ${drawer === 'tools' ? 'left-0' : 'right-0'}`}
              style={{ boxShadow: 'var(--app-menu-shadow)' }}
            >
              {drawer === 'tools' ? (
                <ToolRail
                  collapsed={false}
                  page={pageInfo}
                  ocrLines={ocr.linesFor(currentPage)}
                  ocrBusy={ocr.busyPage === currentPage}
                  ocrProgress={ocr.progress}
                  ocrError={ocr.error}
                  onRunOcr={() => {
                    setTool('edit-text');
                    void ocr.run(currentPage);
                  }}
                  onClearOcr={() => ocr.clearPage(currentPage)}
                  onRemoveSignature={(id) => void removeSignature(id)}
                  onAddSignature={() => setSignatureModalOpen(true)}
                  onAddImage={() => void addImage()}
                  onRotate={() => pageActions.rotate(currentPage)}
                  onDeleteSelection={selection ? () => void deleteSelection() : undefined}
                />
              ) : (
                thumbRail
              )}
            </div>
          </>
        )}
      </div>

      <StatusBar
        info={info}
        currentPage={currentPage}
        zoom={zoom}
        tool={tool}
        pending={overlay.length}
        busy={busy}
        onZoom={(next) => setZoom(next, 'custom')}
        onFit={setFitMode}
      />

      <Notices />

      <SignatureModal
        open={signatureModalOpen}
        onClose={() => setSignatureModalOpen(false)}
        onUse={placeSignature}
      />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The width below which the rails become drawers.
 *
 * 900px is where the two rails — 248 of tools, 178 of pages — stop leaving a
 * usable column for the document between them.
 */
const NARROW_QUERY = '(max-width: 899px)';

function useNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY);
}
