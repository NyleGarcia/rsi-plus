/**
 * One cart ledger for every page that adds lines to the RSI cart (Browse, Notifications, Ships, Paint rebuy, Buyback,
 * CCU planner): per-key state (adding / added / error), the count of lines added, and sequential `addAll` with RSI's
 * polite 400 ms gap. The call itself (`addStandalone`, `addStep`) stays with the page; this only tracks it.
 * Nothing here retries or pays (lib/cart.ts).
 */
import { CartError, type CartErrorCode } from './cart';

export type CartState = { st: 'adding' } | { st: 'added'; price?: number | null } | { st: 'error'; code: CartErrorCode; msg: string };

/** Short label for a failed add (the long message goes in a tooltip). */
export const cartErrorLabel = (code: CartErrorCode): string =>
  code === 'signed-out' ? 'Sign in to RSI' : code === 'conflict' ? 'Cart busy' : code === 'network' ? 'No answer — check your cart' : 'RSI refused';

export function createCartLedger() {
  let state = $state<Record<string, CartState>>({});
  let busy = $state(false);
  const added = $derived(Object.values(state).filter((c) => c.st === 'added').length);

  /** Run one add under `key`; resolves true when it landed. A key already adding is left alone. */
  async function add(key: string | number, task: () => Promise<{ price?: number | null } | void>): Promise<boolean> {
    const k = String(key);
    if (state[k]?.st === 'adding') return false;
    state = { ...state, [k]: { st: 'adding' } };
    try {
      const r = await task();
      state = { ...state, [k]: { st: 'added', price: r?.price ?? null } };
      return true;
    } catch (e) {
      const ce = e instanceof CartError ? e : new CartError('refused', (e as Error).message);
      state = { ...state, [k]: { st: 'error', code: ce.code, msg: ce.message } };
      return false;
    }
  }
  /** Adds in order, skipping lines already in, stopping at the first failure; `busy` is true meanwhile. */
  async function addAll(lines: { key: string | number; task: () => Promise<{ price?: number | null } | void> }[], gapMs = 400) {
    busy = true;
    try {
      for (const l of lines) {
        if (state[String(l.key)]?.st === 'added') continue;
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
    of: (key: string | number): CartState | undefined => state[String(key)],
    add,
    addAll,
    reset: () => (state = {}),
  };
}
