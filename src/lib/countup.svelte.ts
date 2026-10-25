/**
 * Count-up for KPI numbers (after 21st.dev's Stats Band): the digits inside a formatted string ("$1,234.50", "95 of
 * 245", "12%") run from the previous value to the new one; prefix / suffix text stays. Nothing to count (masked
 * "$•••", "—") renders as is. Honours prefers-reduced-motion.
 */
const NUM = /^(.*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/s;
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function countUp(initial: string, ms = 900) {
  let text = $state(initial);
  let shown = 0;
  let raf = 0;
  let armed = false;
  const parse = (s: string) => {
    const m = s.match(NUM);
    if (!m) return null;
    const n = Number(m[2]!.replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const dec = (m[2]!.split('.')[1] ?? '').length;
    return { pre: m[1]!, n, dec, post: m[3]! };
  };
  const fmt = (p: { pre: string; dec: number; post: string }, n: number) => `${p.pre}${n.toLocaleString('en-US', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec })}${p.post}`;
  function set(next: string) {
    cancelAnimationFrame(raf);
    const p = parse(next);
    if (!p || reduced() || !armed) {
      text = next;
      shown = p?.n ?? 0;
      return;
    }
    const from = shown;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      shown = from + (p.n - from) * ease(t);
      text = t < 1 ? fmt(p, shown) : next;
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  return {
    get text() {
      return text;
    },
    /** Call once the tile is in view; the next `set` counts up from 0. */
    arm(value: string) {
      if (armed) return;
      armed = true;
      shown = 0;
      set(value);
    },
    set,
    stop: () => cancelAnimationFrame(raf),
  };
}
