/**
 * Undo, by snapshot.
 *
 * PDFium's mutations are not reliably invertible. Removing a text object and
 * putting an equivalent one back is not the same as never having removed it,
 * because content regeneration rewrites the whole page stream from the object
 * model. An inverse-operation undo would drift from the truth over a session,
 * and the drift would be invisible until someone compared the saved file to
 * what they thought they had.
 *
 * So the whole document is serialised before each mutation. It costs memory
 * and a serialise per edit, and it is always exactly right.
 */

export interface Snapshot {
  id: string;
  /** What the user did, for the undo tooltip. */
  label: string;
  bytes: Uint8Array;
  /** Pages that the operation this snapshot precedes went on to change. */
  affectedPages: number[];
  createdAt: number;
}

export interface HistoryLimits {
  /** Most snapshots to keep. */
  maxEntries: number;
  /** Total bytes across all snapshots before the oldest are dropped. */
  maxBytes: number;
}

const DEFAULT_LIMITS: HistoryLimits = {
  maxEntries: 30,
  maxBytes: 300 * 1024 * 1024,
};

/**
 * A bounded undo and redo stack.
 *
 * Memory is capped two ways, because either alone fails: a page count limit
 * lets thirty copies of a 40 MB scan exhaust the tab, and a byte limit alone
 * lets thousands of tiny snapshots pile up.
 */
export class History {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private counter = 0;
  private droppedOldest = false;

  constructor(private readonly limits: HistoryLimits = DEFAULT_LIMITS) {}

  /**
   * Record the state before a mutation.
   *
   * Called with bytes already serialised, so the caller controls when the cost
   * is paid and can skip it for operations that change nothing.
   */
  push(label: string, bytes: Uint8Array, affectedPages: number[] = []): Snapshot {
    const snapshot: Snapshot = {
      id: `s${++this.counter}`,
      label,
      bytes,
      affectedPages,
      createdAt: Date.now(),
    };
    this.undoStack.push(snapshot);

    // A new action makes any redo branch unreachable.
    this.redoStack = [];
    this.trim();
    return snapshot;
  }

  /**
   * Take the state to restore, given the current state to keep for redo.
   *
   * The caller passes in the current bytes rather than having them read back
   * out, so that redo is available without an extra serialise on every undo.
   */
  undo(currentLabel: string, currentBytes: Uint8Array): Snapshot | null {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return null;

    this.redoStack.push({
      id: `r${++this.counter}`,
      label: currentLabel,
      bytes: currentBytes,
      affectedPages: snapshot.affectedPages,
      createdAt: Date.now(),
    });
    return snapshot;
  }

  redo(currentLabel: string, currentBytes: Uint8Array): Snapshot | null {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return null;

    this.undoStack.push({
      id: `u${++this.counter}`,
      label: currentLabel,
      bytes: currentBytes,
      affectedPages: snapshot.affectedPages,
      createdAt: Date.now(),
    });
    return snapshot;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Label of the action undo would reverse, for the tooltip. */
  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  get depth(): number {
    return this.undoStack.length;
  }

  /** The most recent snapshot, which autosave mirrors to disk. */
  get latest(): Snapshot | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  /**
   * True when the limits forced older history out.
   *
   * Surfaced so the UI can say undo will not reach all the way back, rather
   * than letting the button just stop working.
   */
  get truncated(): boolean {
    return this.droppedOldest;
  }

  byteSize(): number {
    const sum = (list: Snapshot[]) => list.reduce((n, s) => n + s.bytes.byteLength, 0);
    return sum(this.undoStack) + sum(this.redoStack);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.droppedOldest = false;
  }

  private trim(): void {
    while (this.undoStack.length > this.limits.maxEntries) {
      this.undoStack.shift();
      this.droppedOldest = true;
    }
    // Redo is discarded before undo, since losing the ability to go back is
    // worse than losing the ability to go forward again.
    while (this.byteSize() > this.limits.maxBytes && this.redoStack.length > 0) {
      this.redoStack.shift();
    }
    while (this.byteSize() > this.limits.maxBytes && this.undoStack.length > 1) {
      this.undoStack.shift();
      this.droppedOldest = true;
    }
  }
}
