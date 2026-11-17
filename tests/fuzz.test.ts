// @vitest-environment happy-dom
/**
 * Property-based fuzzing (fast-check): the parsers that read RSI's pages and saved data must take anything without
 * throwing and keep their invariants. RSI changes its markup without notice, and saves from old versions come back
 * in odd shapes, so "never crash, never invent" matters more here than any one example.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  nameableShips,
  nameablesOf,
  namingOf,
  parseInsurance,
  parseHangarPage,
  upgradeFromName,
} from "@/lib/hangar";
import { parseMoney } from "@/lib/money";
import { paintKey, shipKey } from "@/lib/store";
import {
  cleanLog,
  diffEntries,
  mergeChanges,
  type StoreEntry,
} from "@/lib/storelog";
import { redact } from "@/lib/debug-export";

const RUNS = { numRuns: 300 };

describe("fuzz: text parsers", () => {
  it("parseMoney always gives a finite number", () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), (s) => {
        expect(Number.isFinite(parseMoney(s))).toBe(true);
      }),
      RUNS,
    );
  });
  it("parseInsurance / upgradeFromName never throw", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(typeof parseInsurance(s)).toBe("string");
        const u = upgradeFromName(s);
        if (u) expect(typeof u.fromName).toBe("string");
      }),
      RUNS,
    );
  });
  it("shipKey / paintKey are stable: keying a key changes nothing", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const k = shipKey(s);
        expect(shipKey(k)).toBe(k);
        expect(typeof paintKey(s)).toBe("string");
      }),
      RUNS,
    );
  });
});

describe("fuzz: hangar markup", () => {
  const box = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
  };
  it("nameableShips takes any JSON (or junk) in RSI rename scripts", () => {
    const json = fc.oneof(fc.json(), fc.string());
    fc.assert(
      fc.property(json, json, (a, b) => {
        const list = nameableShips(
          box(
            `<script class="js-pledge-nameable-ships" type="application/json">${a}</script><script class="js-pledge-name-reservations" type="application/json">${b}</script>`,
          ),
        );
        for (const n of list) expect(n.ship).not.toBe("");
      }),
      RUNS,
    );
  });
  it("nameablesOf / namingOf take any saved shape", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (nameable, items) => {
        const p = { nameable, items, nickname: "" } as never;
        expect(Array.isArray(nameablesOf(p))).toBe(true);
        expect(["named", "open", "none"]).toContain(namingOf(p));
      }),
      RUNS,
    );
  });
  it("parseHangarPage never throws on random list items", () => {
    const li = fc.record({
      id: fc.string(),
      name: fc.string(),
      value: fc.string(),
      body: fc.string(),
    });
    fc.assert(
      fc.property(fc.array(li, { maxLength: 5 }), (rows) => {
        const html = `<ul class="list-items">${rows.map((r) => `<li><input class="js-pledge-id" value="${r.id}"><input class="js-pledge-name" value="${r.name}"><input class="js-pledge-value" value="${r.value}">${r.body}</li>`).join("")}</ul>`;
        expect(Array.isArray(parseHangarPage(box(html)))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe("fuzz: store log", () => {
  const entry = fc
    .record({
      key: fc.constantFrom("item:1", "item:2", "item:3", "ccu:4", "ship:5"),
      name: fc.string(),
      price: fc.nat(),
      kind: fc.constantFrom("packs", "gear", "ccu", "ship"),
      vip: fc.option(fc.constant(true as const), { nil: undefined }),
    })
    .map((e) =>
      e.vip ? e : { key: e.key, name: e.name, price: e.price, kind: e.kind },
    ) as fc.Arbitrary<StoreEntry>;
  it("diffEntries: nothing both added and removed; added are new, removed are gone", () => {
    fc.assert(
      fc.property(fc.array(entry), fc.array(entry), (prev, next) => {
        const d = diffEntries(prev, next);
        const has = new Set(next.map((e) => e.key));
        const had = new Set(prev.map((e) => e.key));
        for (const e of d.added) expect(had.has(e.key)).toBe(false);
        for (const e of d.removed) expect(has.has(e.key)).toBe(false);
      }),
      RUNS,
    );
  });
  it("cleanLog / mergeChanges take any saved log", () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const log = cleanLog(v);
        expect(mergeChanges(log).reduce((n, c) => n + c.parts.length, 0)).toBe(
          log.length,
        );
      }),
      RUNS,
    );
  });
});

describe("fuzz: debug export", () => {
  it("a token under any key never comes out in the file", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.anything()),
        fc.string({ minLength: 8 }),
        (rest, secret) => {
          const out = JSON.stringify(
            redact(
              { ...rest, settings: { starorgToken: `tok-${secret}` } },
              true,
              true,
            ),
          );
          expect(out).not.toContain(`tok-${secret}`);
        },
      ),
      RUNS,
    );
  });
});
