/**
 * One cart ledger for every page that adds lines to the RSI cart (Browse, Notifications, Ships, Paint rebuy, Buyback,
 * CCU planner): per-key state (adding / added / error), the count of lines added, and sequential `addAll` with RSI's
 * polite 400 ms gap. The call itself (`addStandalone`, `addStep`) stays with the page; this only tracks it.
 * Nothing here retries or pays (lib/cart.ts).
 */
import {
  asLimit,
  CartError,
  readCart,
  type CartErrorCode,
  type CartSnapshot,
} from "./cart";

export type CartState =
  | { st: "adding" }
  /** `held`: the cart had it already (read back), nothing was added now. */
  | { st: "added"; price?: number | null; held?: boolean }
  | { st: "error"; code: CartErrorCode; msg: string };

/** Short label for a failed add (the long message goes in a tooltip). */
export const cartErrorLabel = (code: CartErrorCode): string =>
  code === "signed-out"
    ? "Sign in to RSI"
    : code === "conflict"
      ? "Cart busy"
      : code === "network"
        ? "No answer — check your cart"
        : code === "limit"
          ? "One per cart"
          : "RSI refused";

export interface LedgerLine {
  key: string | number;
  task: () => Promise<{ price?: number | null } | void>;
  /** The SKU the line puts in the cart: a refusal while the cart holds it reads as RSI's one-per-cart limit. */
  sku?: number | null;
}

/**
 * `readBack` (default on): read the RSI cart once on creation and again ~0.6 s after every add that landed, so the
 * page can show what is in the cart already (`qtyOf`) and a line isn't added twice by accident. Quiet when signed
 * out or unanswered — then nothing is known and the buttons stay plain.
 */
export function createCartLedger(opts: { readBack?: boolean } = {}) {
  let state = $state<Record<string, CartState>>({});
  let busy = $state(false);
  const added = $derived(
    Object.values(state).filter((c) => c.st === "added" && !c.held).length,
  );
  let snapshot = $state<CartSnapshot | null>(null);
  let syncing = $state(false);
  /** Why the last read failed ("" = it worked, or nothing was read yet). */
  let syncError = $state("");
  /** SKU → copies in the RSI cart, from the last read. */
  const qtys = $derived.by(() => {
    const m = new Map<number, number>();
    for (const l of snapshot?.lines ?? [])
      m.set(l.skuId, (m.get(l.skuId) ?? 0) + l.qty);
    return m;
  });
  /** SKU → lines this ledger added (the read-back lags an add by a moment). */
  const mine = new Map<number, number>();
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  async function sync(): Promise<void> {
    if (syncing) return;
    syncing = true;
    try {
      snapshot = await readCart();
      syncError = "";
    } catch (e) {
      /* signed out / no answer: the cart stays unknown */
      syncError = (e as Error).message;
    } finally {
      syncing = false;
    }
  }
  const syncSoon = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => ((syncTimer = null), void sync()), 600);
  };
  if (opts.readBack !== false) void sync();

  /** Run one add under `key`; resolves true when it landed. A key already adding is left alone. */
  async function add(
    key: string | number,
    task: () => Promise<{ price?: number | null } | void>,
    sku: number | null = null,
  ): Promise<boolean> {
    const k = String(key);
    if (state[k]?.st === "adding") return false;
    state = { ...state, [k]: { st: "adding" } };
    try {
      const r = await task();
      state = { ...state, [k]: { st: "added", price: r?.price ?? null } };
      if (sku != null) mine.set(sku, (mine.get(sku) ?? 0) + 1);
      if (opts.readBack !== false) syncSoon();
      return true;
    } catch (e) {
      const raw =
        e instanceof CartError
          ? e
          : new CartError("refused", (e as Error).message);
      const ce = asLimit(
        raw,
        sku != null && ((qtys.get(sku) ?? 0) > 0 || (mine.get(sku) ?? 0) > 0),
      );
      state = {
        ...state,
        [k]: { st: "error", code: ce.code, msg: ce.message },
      };
      return false;
    }
  }
  /**
   * Adds in order, skipping lines already in, stopping at the first failure; `busy` is true meanwhile. `past`: error
   * codes that concern one line only (RSI refused it, one per cart) — the rest of the batch still goes in.
   */
  async function addAll(
    lines: LedgerLine[],
    gapMs = 400,
    past: readonly CartErrorCode[] = [],
  ) {
    busy = true;
    try {
      for (const l of lines) {
        const k = String(l.key);
        if (state[k]?.st === "added") continue;
        if (!(await add(l.key, l.task, l.sku ?? null))) {
          const s = state[k];
          if (!(s?.st === "error" && past.includes(s.code))) break;
        }
        await new Promise((ok) => setTimeout(ok, gapMs));
      }
    } finally {
      busy = false;
    }
  }
  return {
    get state() {
      return state;
    },
    get busy() {
      return busy;
    },
    get added() {
      return added;
    },
    /** The RSI cart as last read (null = not read / signed out). */
    get snapshot() {
      return snapshot;
    },
    get syncing() {
      return syncing;
    },
    get syncError() {
      return syncError;
    },
    of: (key: string | number): CartState | undefined => state[String(key)],
    /** Copies of a SKU in the RSI cart as last read; 0 when unknown. */
    qtyOf: (sku: number | null | undefined): number =>
      sku == null ? 0 : (qtys.get(sku) ?? 0),
    /** Read the RSI cart back now. */
    sync,
    add,
    addAll,
    /** The cart holds this line already (read back): shown as in the cart, not counted as added here. */
    hold: (key: string | number) => {
      const k = String(key);
      if (state[k]?.st !== "added")
        state = { ...state, [k]: { st: "added", held: true } };
    },
    reset: () => (state = {}),
  };
}

export type CartLedger = ReturnType<typeof createCartLedger>;
