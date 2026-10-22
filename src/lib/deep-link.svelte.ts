/**
 * `#tab?id=<n>&q=<text>` deep links (Notifications → Ship catalog / Browse): on load and on every hashchange, read the
 * params, let the page apply them (clear filters, set the search), flash the row for a few seconds and scroll it into
 * view once the list has rendered. Call from a component's script (it owns `$effect`s).
 */
export const hashParam = (k: string) => new URLSearchParams(location.hash.split('?')[1] ?? '').get(k);

export function useDeepLink(opts: {
  /** Bare hash to leave in the bar afterwards, e.g. `#store`. */
  hash: string;
  /** Param holding the row id, e.g. `ship` / `item`. */
  idParam: string;
  /** DOM id of a row. */
  elId: (id: number) => string;
  /** Apply the link: `q` is the `q` param (null when absent). */
  apply: (q: string | null, id: number | null) => void;
  /** Read the rendered list inside the scroll effect so it re-runs once rows exist. */
  rendered?: () => unknown;
  ms?: number;
}) {
  let flash = $state<number | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function fromHash() {
    const id = Number(hashParam(opts.idParam)) || null;
    const q = hashParam('q');
    if (!id && q == null) return;
    opts.apply(q, id);
    flash = id;
    clearTimeout(timer);
    timer = setTimeout(() => (flash = null), opts.ms ?? 3000);
    history.replaceState(null, '', opts.hash);
  }
  $effect(() => {
    if (flash == null) return;
    opts.rendered?.();
    document.getElementById(opts.elId(flash))?.scrollIntoView({ block: 'center' });
  });
  $effect(() => {
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  });
  return {
    get flash() {
      return flash;
    },
  };
}
