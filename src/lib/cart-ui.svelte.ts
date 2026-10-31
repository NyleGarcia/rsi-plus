/**
 * One cart ledger for every page that adds lines to the RSI cart (Browse, Notifications, Ships, Paint rebuy, Buyback,
 * CCU planner): per-key state (adding / added / error), the count of lines added, and sequential `addAll` with RSI's
 * polite 400 ms gap. The call itself (`addStandalone`, `addStep`) stays with the page; this only tracks it.
 * Nothing here retries or pays (lib/cart.ts).
 */
import {
  CartError,
  readCart,
  type CartErrorCode,
  type CartSnapshot,
} from "./cart";

export type CartState =
  | { st: "adding" }
  | { st: "added"; price?: number | null }
  | { st: "error"; code: CartErrorCode; msg: string };

/** Short label for a failed add (the long message goes in a tooltip). */
export const cartErrorLabel = (code: CartErrorCode): string =>
  code === "signed-out"
    ? "Sign in to RSI"
    : code === "conflict"
      ? "Cart busy"
      : code === "network"
        ? "No answer — check your cart"
        : "RSI refused";

/**
 * `readBack` (default on): read the RSI cart once on creation and again ~0.6 s after every add that landed, so the
 * page can show what is in the cart already (`qtyOf`) and a line isn't added twice by accident. Quiet when signed
 * out or unanswered — then nothing is known and the buttons stay plain.
 */
export function createCartLedger(opts: { readBack?: boolean } = {}) {
  let state = $state<Record<string, CartState>>({});
  let busy = $state(false);
  const added = $derived(
    Object.values(state).filter((c) => c.st === "added").length,
  );
  let snapshot = $state<CartSnapshot | null>(null);
  let syncing = $state(false);
  /** SKU → copies in the RSI cart, from the last read. */
  const qtys = $derived.by(() => {
    const m = new Map<number, number>();
    for (const l of snapshot?.lines ?? [])
      m.set(l.skuId, (m.get(l.skuId) ?? 0) + l.qty);
    return m;
  });
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  async function sync(): Promise<void> {
    if (syncing) return;
    syncing = true;
    try {
      snapshot = await readCart();
    } catch {
      /* signed out / no answer: the cart stays unknown */
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
  ): Promise<boolean> {
    const k = String(key);
    if (state[k]?.st === "adding") return false;
    state = { ...state, [k]: { st: "adding" } };
    try {
      const r = await task();
      state = { ...state, [k]: { st: "added", price: r?.price ?? null } };
      if (opts.readBack !== false) syncSoon();
      return true;
    } catch (e) {
      const ce =
        e instanceof CartError
          ? e
          : new CartError("refused", (e as Error).message);
      state = {
        ...state,
        [k]: { st: "error", code: ce.code, msg: ce.message },
      };
      return false;
    }
  }
  /** Adds in order, skipping lines already in, stopping at the first failure; `busy` is true meanwhile. */
  async function addAll(
    lines: {
      key: string | number;
      task: () => Promise<{ price?: number | null } | void>;
    }[],
    gapMs = 400,
  ) {
    busy = true;
    try {
      for (const l of lines) {
        if (state[String(l.key)]?.st === "added") continue;
        if (!(await add(l.key, l.task))) break;
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
    of: (key: string | number): CartState | undefined => state[String(key)],
    /** Copies of a SKU in the RSI cart as last read; 0 when unknown. */
    qtyOf: (sku: number | null | undefined): number =>
      sku == null ? 0 : (qtys.get(sku) ?? 0),
    /** Read the RSI cart back now. */
    sync,
    add,
    addAll,
    reset: () => (state = {}),
  };
}
