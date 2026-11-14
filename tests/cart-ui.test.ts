import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CartSnapshot } from "@/lib/cart";

const readCart = vi.fn<() => Promise<CartSnapshot>>();
vi.mock("@/lib/cart", async (orig) => ({
  ...(await orig<typeof import("@/lib/cart")>()),
  readCart: () => readCart(),
}));

const snap = (lines: [number, number][]): CartSnapshot => ({
  at: 1,
  id: "c",
  subTotal: 0,
  total: 0,
  qty: lines.reduce((a, l) => a + l[1], 0),
  lines: lines.map(([skuId, qty], i) => ({
    id: String(i),
    skuId,
    qty,
    title: "",
    unit: 0,
    unitDiscounted: 0,
    discount: "",
    discounts: [],
    upgrade: null,
  })),
});
const flush = () => new Promise((ok) => setTimeout(ok, 0));

describe("cart ledger: what is in the RSI cart already", () => {
  beforeEach(() => {
    readCart.mockReset(); // braces: a returned mock would run as a cleanup hook
  });
  it("reads the cart on creation; qtyOf sums copies per SKU, 0 when unknown", async () => {
    readCart.mockResolvedValue(
      snap([
        [7, 1],
        [7, 2],
        [9, 1],
      ]),
    );
    const { createCartLedger } = await import("@/lib/cart-ui.svelte");
    const cart = createCartLedger();
    await flush();
    expect(readCart).toHaveBeenCalledTimes(1);
    expect(cart.snapshot?.qty).toBe(4);
    expect([
      cart.qtyOf(7),
      cart.qtyOf(9),
      cart.qtyOf(1),
      cart.qtyOf(null),
    ]).toEqual([3, 1, 0, 0]);
  });
  it("signed out / no answer: stays unknown, no throw; readBack: false never reads", async () => {
    readCart.mockImplementation(() => Promise.reject(new Error("signed out")));
    const { createCartLedger } = await import("@/lib/cart-ui.svelte");
    const cart = createCartLedger();
    await flush();
    expect(cart.snapshot).toBeNull();
    expect(cart.qtyOf(7)).toBe(0);
    const quiet = createCartLedger({ readBack: false });
    await flush();
    expect(quiet.snapshot).toBeNull();
    expect(readCart).toHaveBeenCalledTimes(1);
  });
  it("re-reads ~0.6 s after an add that landed (adds in a burst → one read)", async () => {
    vi.useFakeTimers();
    try {
      readCart.mockResolvedValue(snap([]));
      const { createCartLedger } = await import("@/lib/cart-ui.svelte");
      const cart = createCartLedger();
      await vi.advanceTimersByTimeAsync(0);
      expect(readCart).toHaveBeenCalledTimes(1);
      readCart.mockResolvedValue(snap([[7, 2]]));
      await cart.add(7, async () => {});
      await cart.add(8, async () => {});
      await vi.advanceTimersByTimeAsync(100);
      expect(readCart).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(700);
      expect(readCart).toHaveBeenCalledTimes(2);
      expect(cart.qtyOf(7)).toBe(2);
      await cart.add(9, async () => {
        throw new Error("nope");
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(readCart).toHaveBeenCalledTimes(2); // a failed add changes nothing in the cart
    } finally {
      vi.useRealTimers();
    }
  });
  it("a refusal for a SKU already in the cart is the one-per-cart limit; addAll carries on past it when asked", async () => {
    const { CartError } = await import("@/lib/cart");
    readCart.mockResolvedValue(snap([[7, 1]]));
    const { createCartLedger } = await import("@/lib/cart-ui.svelte");
    const cart = createCartLedger();
    await flush();
    const refuse = async () => {
      throw new CartError("refused", "RSI refused: no");
    };
    const ran: string[] = [];
    const ok = (k: string) => async () => void ran.push(k);
    await cart.addAll(
      [
        { key: "a", sku: 7, task: refuse }, // in the cart already → limit, carry on
        { key: "b", sku: 8, task: ok("b") },
        { key: "c", sku: 9, task: refuse }, // not in the cart → plain refusal, stops here
        { key: "d", sku: 10, task: ok("d") },
      ],
      0,
      ["limit"],
    );
    expect(cart.of("a")).toMatchObject({ st: "error", code: "limit" });
    expect(cart.of("b")).toMatchObject({ st: "added" });
    expect(cart.of("c")).toMatchObject({ st: "error", code: "refused" });
    expect(cart.of("d")).toBeUndefined();
    expect(ran).toEqual(["b"]);
    // a second copy of what this ledger just added is the limit too, before the cart is read back
    await cart.add("b2", refuse, 8);
    expect(cart.of("b2")).toMatchObject({ st: "error", code: "limit" });
    // held lines show as in the cart but are not counted as added here
    cart.hold("h");
    expect(cart.of("h")).toMatchObject({ st: "added", held: true });
    expect(cart.added).toBe(1);
  });
});
