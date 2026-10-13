<script lang="ts">
  import { addable, addStep, CART_URL, CartError } from '@/lib/cart';
  import { DEFAULT_PLAN_OPTIONS, ownedCcus, ownedShips, plan, reservedRefs, STORE_START, type Objective, type PlanOptions, type SavedChain, type Step } from '@/lib/ccu';
  import { hangarUrl } from '@/lib/hangar';
  import { bg } from '@/lib/messages';
  import { buybackItem, catalogItem, ccuChainsItem, hangarItem } from '@/lib/settings';
  import { usd, type Catalog } from '@/lib/store';
  import ShipSelect from './ShipSelect.svelte';

  let { initialTo = null }: { initialTo?: number | null } = $props();

  let cat = $state<Catalog | null>(null);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let buyback = $state<Awaited<ReturnType<typeof buybackItem.getValue>>>(null);
  let chains = $state<SavedChain[]>([]);
  let error = $state('');

  type Mode = 'store' | 'hangar' | 'any';
  let mode = $state<Mode>('hangar');
  let fromId = $state<number | null>(null);
  let toId = $state<number | null>(null); // set from initialTo by the effect below
  let opt = $state<PlanOptions>({ ...DEFAULT_PLAN_OPTIONS, include: [], exclude: [] });
  let excludeSaved = $state(true);
  let chainName = $state('');
  let saved = $state('');

  $effect(() => {
    hangarItem.getValue().then((h) => (hangar = h));
    buybackItem.getValue().then((b) => (buyback = b));
    catalogItem.getValue().then((c) => (cat = c));
    ccuChainsItem.getValue().then((c) => (chains = c));
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch((e) => (error = (e as Error).message));
  });
  $effect(() => {
    if (initialTo != null) toId = initialTo;
  });

  const ships = $derived((cat?.ships ?? []).filter((s) => s.msrp > 0).sort((a, b) => a.msrp - b.msrp));
  const byId = $derived(new Map(ships.map((s) => [s.id, s])));
  const mine = $derived(ownedShips(hangar?.pledges ?? [], ships));
  const ccus = $derived(ownedCcus(hangar?.pledges ?? [], buyback?.items ?? [], ships));
  const buybackUrl = $derived(new Map((buyback?.items ?? []).map((b) => [b.id, b.url])));

  /** Which saved chain holds each CCU ref. */
  const reservedBy = $derived(new Map(chains.flatMap((c) => reservedRefs([c]).map((r) => [r, c] as const))));
  const effective = $derived<PlanOptions>({
    ...opt,
    exclude: excludeSaved ? [...new Set([...opt.exclude, ...reservedBy.keys()])] : opt.exclude,
  });
  const startId = $derived(mode === 'store' ? STORE_START : fromId);
  const result = $derived(startId != null && toId != null ? plan(ships, ccus.owned, startId, toId, effective) : null);
  /** Running spend after each step. */
  const running = $derived(result ? result.steps.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? 0) + s.cost], []) : []);
  const creditCents = $derived(hangar?.credits ? Math.round(hangar.credits.usd * 100) : null);
  const cashNeeded = $derived(result && creditCents != null ? result.cash + Math.max(0, result.total - result.cash - creditCents) : null);

  // ---- RSI cart ----
  type CartState = { st: 'adding' } | { st: 'added'; price: number | null } | { st: 'error'; code: string; msg: string };
  let cart = $state<Record<string, CartState>>({});
  let cartBusy = $state(false);
  const cartKey = (s: Step) => `${s.kind}:${s.fromId}>${s.toId}:${s.skuId ?? s.ref ?? ''}`;
  // A new plan = a new cart ledger (state is per step identity, so a re-plan with the same steps keeps it).
  const addableSteps = $derived(result ? result.steps.filter((s) => addable(s, byId).kind !== 'none') : []);
  const hasBuyback = $derived(addableSteps.some((s) => s.kind === 'buyback'));
  async function addOne(s: Step) {
    const k = cartKey(s);
    cart = { ...cart, [k]: { st: 'adding' } };
    try {
      const { price } = await addStep(s, byId);
      cart = { ...cart, [k]: { st: 'added', price } };
      return true;
    } catch (e) {
      const ce = e instanceof CartError ? e : new CartError('refused', (e as Error).message);
      cart = { ...cart, [k]: { st: 'error', code: ce.code, msg: ce.message } };
      return false;
    }
  }
  /** Store steps one after another (RSI is polite about it; a buy-back goes alone, so it is skipped here). */
  async function addAll() {
    cartBusy = true;
    try {
      for (const s of addableSteps) {
        if (s.kind === 'buyback') continue;
        if (cart[cartKey(s)]?.st === 'added') continue;
        if (!(await addOne(s))) break;
        await new Promise((ok) => setTimeout(ok, 400));
      }
    } finally {
      cartBusy = false;
    }
  }

  const name = (id: number) => (id === STORE_START ? 'Store' : (byId.get(id)?.name ?? `#${id}`));
  const KIND: Record<string, string> = { warbond: 'Warbond CCU', standard: 'Standard CCU', limited: 'Limited CCU', owned: 'You own it', buyback: 'Buyback', standalone: 'Buy ship' };
  const OBJECTIVES: { id: Objective; label: string; hint: string }[] = [
    { id: 'spend', label: 'Current highest savings', hint: 'least to pay now — CCUs you own are free' },
    { id: 'cash', label: 'Lowest new money', hint: 'least that store credit cannot cover, then least to pay' },
    { id: 'longterm', label: 'Long-term highest savings', hint: 'owned CCUs count at what you paid for them' },
  ];
  const UPGRADES = 'https://robertsspaceindustries.com/pledge/ship-upgrades';
  function link(s: Step): string | null {
    if (s.kind === 'owned' && hangar && s.ref != null) return hangarUrl(hangar.pledges, s.ref);
    if (s.kind === 'buyback' && s.ref != null) return buybackUrl.get(s.ref) ?? null;
    if (s.kind === 'standalone') return byId.get(s.toId)?.link ?? null;
    return UPGRADES;
  }
  const forceOf = (ref: number): 'include' | 'exclude' | '' => (opt.include.includes(ref) ? 'include' : opt.exclude.includes(ref) ? 'exclude' : '');
  /** neutral → force include → force exclude → neutral */
  function cycleForce(ref: number) {
    const f = forceOf(ref);
    opt.include = opt.include.filter((r) => r !== ref);
    opt.exclude = opt.exclude.filter((r) => r !== ref);
    if (f === '') opt.include = [...opt.include, ref];
    else if (f === 'include') opt.exclude = [...opt.exclude, ref];
  }

  async function persist(next: SavedChain[]) {
    chains = next;
    await ccuChainsItem.setValue(JSON.parse(JSON.stringify(next)));
  }
  async function saveChain() {
    if (!result || startId == null || toId == null) return;
    const c: SavedChain = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: chainName.trim() || `${name(startId)} → ${name(toId)}`,
      at: Date.now(),
      startId,
      targetId: toId,
      steps: $state.snapshot(result.steps),
      total: result.total,
      cash: result.cash,
      opt: $state.snapshot(effective),
    };
    await persist([...chains, c]);
    chainName = '';
    saved = c.name;
    setTimeout(() => (saved = ''), 2500);
  }
  function loadChain(c: SavedChain) {
    mode = c.startId === STORE_START ? 'store' : mine.some((s) => s.id === c.startId) ? 'hangar' : 'any';
    fromId = c.startId === STORE_START ? null : c.startId;
    toId = c.targetId;
    opt = { ...DEFAULT_PLAN_OPTIONS, ...c.opt, include: [...c.opt.include], exclude: [...c.opt.exclude] };
    excludeSaved = false;
  }
  /** What the same chain settings cost today (other saved chains' CCUs excluded, this one's own allowed). */
  function now(c: SavedChain) {
    const others = reservedRefs(chains.filter((x) => x.id !== c.id));
    return plan(ships, ccus.owned, c.startId, c.targetId, { ...c.opt, exclude: [...new Set([...c.opt.exclude, ...others])] });
  }
  const changed = (c: SavedChain, p: ReturnType<typeof plan>) =>
    !p || p.total !== c.total || p.steps.length !== c.steps.length || p.steps.some((s, i) => s.toId !== c.steps[i]?.toId || s.kind !== c.steps[i]?.kind);
</script>

<div class="stack">
  <section class="card stack">
    <div>
      <h2>CCU chain planner</h2>
      <span class="muted">Cheapest path using CCUs on sale now, the CCUs in your hangar (free) and, optionally, buyback. Warbond steps need new money.</span>
    </div>
    {#if error}<span class="err">{error}</span>{/if}

    <fieldset class="group">
      <legend>1 · Optimise for</legend>
      <div class="row">
        {#each OBJECTIVES as ob (ob.id)}
          <label class="radio" title={ob.hint}><input type="radio" name="objective" value={ob.id} bind:group={opt.objective} /> {ob.label}</label>
        {/each}
      </div>
      <span class="muted small">{OBJECTIVES.find((o) => o.id === opt.objective)?.hint}</span>
    </fieldset>

    <fieldset class="group">
      <legend>2 · Options</legend>
      <div class="row">
        <label class="row"><input type="checkbox" bind:checked={opt.warbond} /> Warbond CCUs</label>
        <label class="row"><input type="checkbox" bind:checked={opt.buyback} /> Buyback CCUs</label>
        <label class="row"><input type="checkbox" bind:checked={opt.inStockOnly} /> Skip sold-out limited</label>
        <label class="row"><input type="checkbox" bind:checked={opt.storeCredit} /> Pay with store credit</label>
        <label class="row"><input type="checkbox" bind:checked={opt.excludeGifted} /> Exclude gifted CCUs</label>
        <label class="row"><input type="checkbox" bind:checked={excludeSaved} disabled={!chains.length} /> Exclude saved chains{chains.length ? ` (${reservedBy.size} CCUs)` : ''}</label>
      </div>
      <span class="muted small">
        {hangar ? `${ccus.owned.filter((o) => o.source === 'hangar').length} owned CCUs` : 'Load your hangar to use owned CCUs'}
        {buyback ? ` · ${ccus.owned.filter((o) => o.source === 'buyback').length} buyback CCUs` : ''}
        {creditCents != null ? ` · store credit ${usd(creditCents)}` : ''}
      </span>
    </fieldset>

    <div class="row">
      <fieldset class="group grow">
        <legend>3 · Source</legend>
        <div class="row">
          <label class="radio"><input type="radio" name="mode" value="hangar" bind:group={mode} /> Ship in my hangar</label>
          <label class="radio"><input type="radio" name="mode" value="store" bind:group={mode} /> Buy a ship from the store</label>
          <label class="radio"><input type="radio" name="mode" value="any" bind:group={mode} /> Any ship</label>
        </div>
        {#if mode === 'store'}
          <span class="muted small">Picks the cheapest standalone ship on sale to start from.</span>
        {:else}
          <ShipSelect {ships} {mine} bind:value={fromId} onlyMine={mode === 'hangar'} ariaLabel="From ship" placeholder={mode === 'hangar' ? 'Pick a ship you own…' : 'Pick a ship…'} />
        {/if}
      </fieldset>
      <fieldset class="group grow">
        <legend>4 · Target</legend>
        <ShipSelect {ships} {mine} bind:value={toId} ariaLabel="Target ship" placeholder="Pick a target…" />
      </fieldset>
    </div>

    {#if startId != null && toId != null}
      {#if !result}
        <p class="err">
          No chain found — {mode === 'store' ? 'no standalone ship on sale leads there, ' : ''}the target isn't sold as a CCU right now and you own no CCU leading to it, a forced CCU can't be reached, or
          it's not pricier than the start.
        </p>
      {:else}
        <div class="stats">
          <div><strong>{usd(result.total)}</strong><span>to pay now</span></div>
          <div><strong>{usd(result.cash)}</strong><span>new money</span></div>
          {#if cashNeeded != null}<div><strong class:ok={cashNeeded === 0}>{usd(cashNeeded)}</strong><span>cash after store credit</span></div>{/if}
          {#if result.paid}<div><strong>{usd(result.paid)}</strong><span>already paid (owned CCUs)</span></div>{/if}
          <div><strong>{usd(result.msrpDiff)}</strong><span>{mode === 'store' ? 'target MSRP' : 'MSRP difference'}</span></div>
          <div><strong class:ok={result.savings > 0} class:err={result.savings < 0}>{usd(result.savings)}</strong><span>saved vs MSRP</span></div>
        </div>
        <table>
          <thead>
            <tr><th>#</th><th>Step</th><th>Ship</th><th>Cost</th><th>New money</th><th>Running</th><th>Hull value</th><th>RSI cart</th><th></th></tr>
          </thead>
          <tbody>
            {#each result.steps as s, i (i)}
              {@const a = addable(s, byId)}
              {@const c = cart[cartKey(s)]}
              <tr>
                <td class="muted">{i + 1}</td>
                <td><span class="chip k-{s.kind}">{KIND[s.kind]}</span>{s.label && s.kind !== 'owned' && s.kind !== 'buyback' ? ` ${s.label}` : ''}</td>
                <td>{#if s.fromId !== STORE_START}<span class="muted">{name(s.fromId)} →</span> {/if}<strong>{name(s.toId)}</strong></td>
                <td>{s.cost ? usd(s.cost) : 'free'}{s.paid ? ` (paid ${usd(s.paid)})` : ''}</td>
                <td class:warn={s.cash > 0}>{s.cash ? usd(s.cash) : '—'}</td>
                <td>{usd(running[i] ?? 0)}</td>
                <td class="muted">{usd(byId.get(s.toId)?.msrp ?? 0)}</td>
                <td class="cartcell">
                  {#if a.kind === 'none'}
                    <span class="muted small">{s.kind === 'owned' ? '—' : a.why}</span>
                  {:else if c?.st === 'adding'}
                    <span class="muted small">Adding…</span>
                  {:else if c?.st === 'added'}
                    <span class="ok small">In cart{c.price != null && c.price !== s.cost ? ` · RSI says ${usd(c.price)}` : ''}</span>
                  {:else}
                    <button class="btn small" disabled={cartBusy} onclick={() => addOne(s)} title={s.kind === 'buyback' ? 'Buy-backs check out alone: one per cart, nothing else in it.' : 'Adds this CCU to your RSI cart (nothing is paid)'}>
                      {s.kind === 'buyback' ? 'Add buy-back' : 'Add to cart'}
                    </button>
                    {#if c?.st === 'error'}<span class="err small" title={c.msg}>{c.code === 'signed-out' ? 'Sign in to RSI' : c.code === 'conflict' ? 'Cart busy' : c.code === 'network' ? 'No answer — check cart' : 'Refused'}</span>{/if}
                  {/if}
                </td>
                <td>
                  {#if link(s)}
                    <a class="btn small" href={link(s)} target="_blank" rel="noopener">{s.kind === 'owned' ? 'Hangar' : s.kind === 'buyback' ? 'Buy back' : s.kind === 'standalone' ? 'Store' : 'Upgrades'}</a>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="row spread">
          <div class="row">
            {#if addableSteps.some((s) => s.kind !== 'buyback')}
              <button class="btn primary small" disabled={cartBusy} onclick={addAll}>{cartBusy ? 'Adding…' : `Add ${addableSteps.filter((s) => s.kind !== 'buyback').length} store step${addableSteps.filter((s) => s.kind !== 'buyback').length === 1 ? '' : 's'} to RSI cart`}</button>
            {/if}
            <a class="btn small" href={CART_URL} target="_blank" rel="noopener">Open RSI cart ↗</a>
            <span class="muted small">
              Lines are added to your RSI cart in your signed-in session; nothing is paid here. Check the cart before checkout.
              {#if hasBuyback} A buy-back must be the only line in the cart — add it separately and check it out alone.{/if}
            </span>
          </div>
          <form class="row" onsubmit={(e) => (e.preventDefault(), saveChain())}>
            <input placeholder="Chain name (optional)" bind:value={chainName} aria-label="Chain name" />
            <button class="btn small" type="submit">Save chain</button>
            {#if saved}<span class="ok small">Saved “{saved}”</span>{/if}
          </form>
        </div>
        <span class="muted small">Or buy by hand on the RSI <a href={UPGRADES} target="_blank" rel="noopener">ship upgrades page</a>. Prices change during sales — refresh in Store.</span>
      {/if}
    {/if}
  </section>

  {#if chains.length}
    <section class="card stack">
      <h2>Saved chains <span class="muted">({chains.length})</span></h2>
      <span class="muted">Their CCUs stay out of new plans while <em>Exclude saved chains</em> is on. “Now” re-prices each chain on today's store + hangar.</span>
      <table>
        <thead><tr><th>Name</th><th>Chain</th><th>Saved</th><th>Now</th><th></th></tr></thead>
        <tbody>
          {#each chains as c (c.id)}
            {@const p = now(c)}
            <tr>
              <td><strong>{c.name}</strong><br /><span class="muted small">{new Date(c.at).toLocaleDateString()} · {c.steps.length} steps · {OBJECTIVES.find((o) => o.id === c.opt.objective)?.label}</span></td>
              <td class="small">{[name(c.startId), ...c.steps.map((s) => name(s.toId))].join(' → ')}</td>
              <td>{usd(c.total)}<br /><span class="muted small">{usd(c.cash)} new money</span></td>
              <td>
                {#if !p}<span class="err">no longer possible</span>
                {:else}<span class:ok={p.total < c.total} class:warn={p.total > c.total}>{usd(p.total)}</span>{#if changed(c, p)}<br /><span class="muted small">chain changed</span>{/if}{/if}
              </td>
              <td class="row">
                <button class="btn small" onclick={() => loadChain(c)}>Load</button>
                <button class="btn small" onclick={() => persist(chains.filter((x) => x.id !== c.id))}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  {#if ccus.owned.length}
    <section class="card stack">
      <h2>Your CCUs <span class="muted">({ccus.owned.length})</span></h2>
      <span class="muted">Click <em>Force</em> to require a CCU in the chain (include), click again to keep it out (exclude), again to reset.</span>
      <table>
        <thead><tr><th>CCU</th><th>Source</th><th>Paid</th><th>Upgrade value</th><th>Reserved by</th><th>Force</th></tr></thead>
        <tbody>
          {#each ccus.owned.sort((a, b) => (byId.get(a.fromId)?.msrp ?? 0) - (byId.get(b.fromId)?.msrp ?? 0)) as o (o.source + o.ref)}
            {@const gain = (byId.get(o.toId)?.msrp ?? 0) - (byId.get(o.fromId)?.msrp ?? 0)}
            <tr>
              <td><span class="muted">{name(o.fromId)} →</span> <strong>{name(o.toId)}</strong></td>
              <td>{o.source}{o.gifted ? ' · gift' : ''}</td>
              <td>{o.value ? usd(o.value) : o.source === 'hangar' ? '—' : '?'}</td>
              <td class:ok={o.value && gain > o.value}>{usd(gain)}</td>
              <td class="small">{reservedBy.get(o.ref)?.name ?? ''}</td>
              <td>
                <button class="btn small f-{forceOf(o.ref)}" onclick={() => cycleForce(o.ref)}>{forceOf(o.ref) || 'auto'}</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  {#if ccus.unmapped.length}
    <section class="card stack">
      <h2>CCUs not matched to a ship <span class="muted">({ccus.unmapped.length})</span></h2>
      <span class="muted">Ignored by the planner (name didn't match a store ship).</span>
      <div class="row">{#each ccus.unmapped as u, i (i)}<span class="chip">{u.name} · {u.source}</span>{/each}</div>
    </section>
  {/if}
</div>

<style>
  .group {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
    display: grid;
    gap: 8px;
    margin: 0;
    min-width: 0;
  }
  .group legend {
    color: var(--muted);
    font-size: 12px;
    padding: 0 4px;
  }
  .grow {
    flex: 1 1 300px;
  }
  .radio {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 8px;
  }
  .stats div {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
    display: grid;
  }
  .stats strong {
    font-size: 18px;
  }
  .stats span {
    color: var(--muted);
    font-size: 12px;
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: #ffd166;
  }
  .k-warbond {
    color: #ffd166;
  }
  .k-owned {
    color: var(--ok);
  }
  .k-standalone {
    color: var(--accent);
  }
  .f-include {
    color: var(--ok);
  }
  .f-exclude {
    color: var(--err);
  }
  .small {
    font-size: 11px;
  }
  .cartcell {
    white-space: nowrap;
  }
  .cartcell .err {
    margin-left: 6px;
  }
</style>
