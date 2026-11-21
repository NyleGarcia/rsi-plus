<script lang="ts">
  /**
   * Stock-limited hull waves (lib/waves.ts): the schedule in your
   * timezone with a countdown, a ready check (signed in, cart, store credit, the listing your account can see, your
   * clock against RSI's), and a stock watch around each wave that lights up the moment the listing is sellable. The
   * button adds it to your RSI cart and opens the cart; checking out is yours. Nothing here submits an order.
   */
  import { addStandalone, CART_URL, readCart, signedIn, type CartSnapshot } from '@/lib/cart';
  import { bg } from '@/lib/messages';
  import { conciergeItem, hangarItem, wavesItem, wavesViewItem } from '@/lib/settings';
  import { fetchShipListings, usd, type ShipListing } from '@/lib/store';
  import { activeWaveEvent, countdown, EVENT_TAIL_MS, currentWave, IAE_2956, matchListings, stopAfterLook, watchEveryMs, WAVE_OPEN_MS, waveTimes, type WaveSale, type WaveStop } from '@/lib/waves';
  import { fmtWhen } from '@/lib/fmt';
  import { cn } from '@/lib/utils';
  import SwitchRow from './SwitchRow.svelte';
  import * as Card from '@/components/ui/card';
  import * as Alert from '@/components/ui/alert';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';

  // ---- clock ----
  let now = $state(Date.now());
  /** RSI's clock minus this PC's (ms), from the last store answer: the countdown runs on RSI's time. */
  let offset = $state(0);
  $effect(() => {
    const t = setInterval(() => (now = Date.now() + offset), 250);
    return () => clearInterval(t);
  });

  // ---- which sale ----
  const allSales = IAE_2956.map((s) => ({ ...s, times: waveTimes(s.date) }));
  /** A sale day leaves the list a day after its last wave. */
  const sales = $derived(allSales.filter((s) => now < s.times.at(-1)! + EVENT_TAIL_MS));
  const live = $derived(sales.filter((s) => now < s.times.at(-1)! + WAVE_OPEN_MS));
  let pick = $state<string | null>(null);
  const sale = $derived(sales.find((s) => s.id === pick) ?? live[0] ?? sales.at(-1) ?? allSales.at(-1)!);
  /** Per sale: the listing you picked to watch (0 = none). Saved with the ship picked, so a reload or a ship switch keeps both. */
  let picks = $state<Record<string, number>>({});
  $effect(() => {
    wavesViewItem.getValue().then((v) => {
      pick ??= v.pick;
      picks = { ...v.watch, ...picks };
    });
  });
  const saveView = () => void wavesViewItem.setValue({ pick, watch: $state.snapshot(picks) });
  const pickSale = (id: string) => ((pick = id), saveView());
  const wave = $derived(currentWave(sale.times, now));
  const toWave = $derived(wave ? wave.at - now : Infinity);

  // ---- reminders ----
  let armed = $state<string[]>([]);
  $effect(() => {
    wavesItem.getValue().then((v) => (armed = v.armed));
  });
  const arm = (id: string, on: boolean) => {
    armed = on ? [...new Set([...armed, id])] : armed.filter((x) => x !== id);
    void wavesItem.getValue().then((v) => wavesItem.setValue({ ...v, armed: $state.snapshot(armed) }));
  };

  // ---- the listing, the cart, the account ----
  let listings = $state<ShipListing[]>([]);
  let looked = $state(0);
  let looking = $state(false);
  let lookError = $state('');
  let cart = $state<CartSnapshot | null>(null);
  let signed = $state<{ ok: boolean; why: string } | null>(null);
  let credit = $state<number | null>(null);
  let concierge = $state<string | null>(null);
  $effect(() => {
    hangarItem.getValue().then((h) => (credit = h?.credits ? Math.round(h.credits.usd * 100) : null));
    conciergeItem.getValue().then((c) => (concierge = c?.level ?? null));
  });
  const matches = $derived(matchListings(listings, sale));
  /**
   * The one listing being watched. A wave hull is usually listed twice — a warbond one (new money only) and a store
   * credit one — and other editions can carry the same name (a Best in Show). You pick one; during a wave only that
   * one is polled (by SKU). Default: among the "10 Year" ones, store credit when your credit covers it, else warbond.
   */
  const choice = $derived<number | null>(picks[sale.id] ?? null); // null = default, 0 = none
  const wanted = $derived(matches.some((m) => /10 year/i.test(m.name)) ? matches.filter((m) => /10 year/i.test(m.name)) : matches);
  const fallback = $derived(wanted.find((m) => !m.warbond && credit != null && credit >= m.discounted) ?? wanted.find((m) => m.warbond) ?? wanted[0] ?? null);
  const watched = $derived(choice === 0 ? null : (matches.find((m) => m.id === choice) ?? fallback));
  const watchedOf = (m: ShipListing) => watched?.id === m.id;
  const toggleWatch = (m: ShipListing) => ((picks = { ...picks, [sale.id]: watchedOf(m) ? 0 : m.id }), saveView());
  const hits = $derived(watched?.available ? [watched] : []);
  const hit = $derived(hits[0] ?? null);
  /** What store credit does for a listing: nothing for a warbond; else covers it or falls short. */
  const pay = (m: ShipListing): string => (m.warbond ? 'new money only (warbond): store credit cannot pay it' : credit == null ? 'store credit can pay it' : credit >= m.discounted ? `your store credit covers it (${usd(credit)})` : `store credit pays ${usd(credit)}, ${usd(m.discounted - credit)} more in new money`);
  const inCart = $derived((cart?.lines ?? []).filter((l) => matches.some((m) => m.id === l.skuId) || l.title.toLowerCase().includes(sale.listing.toLowerCase())));

  /** `only`: just the watched listing (the wave poll); else every standalone ship (ready check, *Look now*). */
  async function look(only = false) {
    if (looking) return;
    looking = true;
    try {
      const before = Date.now();
      const id = only ? watched?.id : undefined;
      const r = await fetchShipListings(id ? [id] : undefined);
      // A one-SKU answer replaces that listing only; an empty one (delisted between waves) marks it not sellable.
      listings = id ? listings.map((l) => (l.id === id ? (r.items.find((x) => x.id === id) ?? { ...l, available: false }) : l)) : r.items;
      if (r.serverAt != null) offset = r.serverAt + 500 - (before + Date.now()) / 2; // the header has whole seconds
      looked = Date.now();
      lookError = '';
    } catch (e) {
      lookError = (e as Error).message;
    } finally {
      looking = false;
    }
  }
  let checking = $state(false);
  async function readyCheck() {
    checking = true;
    try {
      signed = await signedIn();
      cart = await readCart().catch(() => null);
      await look();
    } finally {
      checking = false;
    }
  }
  $effect(() => {
    void readyCheck();
  });

  // ---- stock watch: only around a wave, a few seconds apart; rests once the wave is in stock or sold out ----
  let watching = $state(true);
  /** `<sale>:<wave index>`: the wave a stop or a sighting belongs to. A new wave has a new key, so the watch resumes. */
  const waveKey = $derived(wave ? `${sale.id}:${wave.i}` : '');
  let stop = $state<{ key: string; why: WaveStop; at: number } | null>(null);
  /** Waves in which some listing was seen sellable (sold-out needs "was there, now gone"). */
  let sawStock = $state(new Set<string>());
  /** *Watch again* on a wave: keep looking through it, no auto stop (stock can come back when carts time out). */
  let keepOn = $state('');
  const stopped = $derived(stop && stop.key === waveKey ? stop : null);
  const every = $derived(watching && wave && !stopped ? watchEveryMs(toWave) : null);
  $effect(() => {
    if (!looked || !waveKey || stopped || keepOn === waveKey) return;
    const anyInStock = !!watched?.available; // only the watched listing is polled during the wave
    const key = waveKey;
    if (anyInStock && !sawStock.has(key)) sawStock = new Set([...sawStock, key]);
    const why = stopAfterLook({ open: !!wave?.open, watchedInStock: hits.length > 0, anyInStock, sawStock: anyInStock || sawStock.has(key) });
    if (why) stop = { key, why, at: looked };
  });
  $effect(() => {
    if (every == null) return;
    const t = setInterval(() => void look(true), every);
    return () => clearInterval(t);
  });
  // the moment it is sellable: sound + a notification, once per wave
  let rang = $state('');
  $effect(() => {
    if (!hit || !wave) return;
    const key = `${sale.id}:${wave.i}:${hits.map((h) => h.id).join(',')}`;
    if (rang === key) return;
    rang = key;
    void bg({ type: 'sound:ding' }).catch(() => undefined);
    try {
      browser.notifications.create(`wave-stock:${key}`, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: `${sale.ship} is in stock`, message: `${hits.map((h) => `${h.warbond ? 'Warbond' : 'Store credit'} ${usd(h.discounted)}`).join(' · ')}. RSI+ → Limited waves: add it to your cart now.`, requireInteraction: true });
    } catch {
      /* no notification permission: the page shows it */
    }
  });

  // ---- add to cart (your click) → RSI's cart ----
  let adding = $state(false);
  let addMsg = $state('');
  async function add(item: ShipListing) {
    if (adding) return;
    adding = true;
    addMsg = '';
    const tab = window.open(CART_URL, '_blank'); // opened in the click, so it is not blocked; shows the cart as soon as the add lands
    try {
      await addStandalone(item.id, 1);
      addMsg = 'In your RSI cart. Finish the order on RSI.';
      try {
        if (tab) tab.location.href = CART_URL; // show the cart with the line in it
      } catch {
        /* the tab navigated away: the cart link below still works */
      }
      cart = await readCart().catch(() => cart);
    } catch (e) {
      addMsg = `RSI refused: ${(e as Error).message}`;
    } finally {
      adding = false;
    }
  }

  const when = (t: number) => fmtWhen(t, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const day = (s: WaveSale) => fmtWhen(waveTimes(s.date)[0]!, { weekday: 'short', month: 'short', day: 'numeric' });
  const drift = $derived(Math.round(offset / 1000));
</script>

{#snippet line(ok: boolean | null, text: string)}
  <li class="flex items-start gap-2">
    {#if ok === true}<Check class="text-success mt-0.5 size-4 shrink-0" />{:else if ok === false}<X class="text-destructive mt-0.5 size-4 shrink-0" />{:else}<TriangleAlert class="text-warning mt-0.5 size-4 shrink-0" />{/if}
    <span>{text}</span>
  </li>
{/snippet}

<div class="grid gap-4">
  <Alert.Root><Alert.Description>RSI+ counts down, checks you are ready and watches the listing; you add to cart and you place the order.</Alert.Description></Alert.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{activeWaveEvent(now)?.name ?? 'IAE 2956 (over)'} · stock-limited hulls</Card.Title>
      <Card.Description>Six waves per hull, four hours apart, from 16:00 UTC on the sale date. Times below are yours.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-2">
      {#each sales as s (s.id)}
        {@const w = currentWave(s.times, now)}
        <div class={cn('flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2', s.id === sale.id && 'border-primary bg-primary/5', !w && 'opacity-50')}>
          <Button variant={s.id === sale.id ? 'default' : 'outline'} size="sm" onclick={() => pickSale(s.id)}>{s.ship}</Button>
          <span class="text-muted-foreground text-xs">{day(s)}</span>
          {#if s.concierge}<Badge variant="outline">Concierge</Badge>{/if}
          {#if s.invite}<Badge variant="warning">Invite only</Badge>{/if}
          <span class="text-xs tabular-nums">
            {#if !w}over{:else if w.open}<strong class="text-success">wave {w.i + 1} is on</strong>{:else}wave {w.i + 1} in <strong>{countdown(w.at - now)}</strong>{/if}
          </span>
          <span class="flex-1"></span>
          <SwitchRow id={`wave-arm-${s.id}`} size="sm" class="text-xs" label="Remind me" hint="Notifications 30, 5 and 1 minute before each wave of this ship" checked={armed.includes(s.id)} disabled={!w} onchange={(v) => arm(s.id, v)} />
        </div>
      {/each}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{sale.ship}</Card.Title>
      <Card.Description>{sale.note}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <div class="flex flex-wrap items-end gap-6">
        <div>
          <div class="text-muted-foreground text-xs">{wave ? (wave.open ? `Wave ${wave.i + 1} opened` : `Wave ${wave.i + 1} of ${sale.times.length}`) : 'Sale over'}</div>
          <div class={cn('text-4xl font-bold tabular-nums', wave?.open && 'text-success', wave && !wave.open && toWave < 60_000 && 'text-warning')}>
            {#if !wave}—{:else if wave.open}{countdown(now - wave.at)} ago{:else}{countdown(toWave)}{/if}
          </div>
          {#if wave}<div class="text-muted-foreground text-xs">{when(wave.at)} your time</div>{/if}
        </div>
        <ol class="m-0 flex list-none flex-wrap gap-1.5 p-0 text-xs">
          {#each sale.times as t, i (t)}
            <li class={cn('rounded-md border px-2 py-1 tabular-nums', wave?.i === i && 'border-primary text-foreground', now > t + WAVE_OPEN_MS && 'text-muted-foreground line-through')}>{i + 1} · {when(t)}</li>
          {/each}
        </ol>
      </div>

      <div class="grid gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <strong class="text-sm">Ready check</strong>
          <Button variant="outline" size="xs" disabled={checking} onclick={readyCheck}>{checking ? 'Checking…' : 'Check again'}</Button>
        </div>
        <ul class="m-0 grid list-none gap-1 p-0 text-sm">
          {@render line(signed ? signed.ok : null, signed ? (signed.ok ? 'Signed in to RSI in this browser.' : `Not signed in: ${signed.why}`) : 'Checking your RSI sign-in…')}
          {@render line(lookError ? false : matches.length ? true : looked ? false : null, lookError ? `Could not read the store (${lookError}).` : matches.length ? `Your account sees ${matches.length === 1 ? 'the listing' : `${matches.length} listings`}: ${matches.map((m) => `${m.name} · ${usd(m.discounted)} ${m.warbond ? '(warbond)' : '(store credit OK)'}`).join(', ')}.` : looked ? `No "${sale.listing}" listing among the standalone ships your account sees${sale.concierge ? ' (Concierge only; it may only be listed during the waves)' : sale.invite ? ' (invite only; it may only be listed during the waves)' : ''}.` : 'Reading the store…')}
          {@render line(inCart.length ? true : cart ? (cart.lines.length ? null : true) : null, !cart ? 'Cart not read (sign in to RSI).' : inCart.length ? `Already in your cart: ${inCart.map((l) => l.title).join(', ')}. You only need to finish the order on RSI.` : cart.lines.length ? `Your cart holds ${cart.qty} other item${cart.qty === 1 ? '' : 's'}. They would be in the same order: empty the cart first if you do not want that.` : 'Your cart is empty.')}
          {@render line(credit == null ? null : true, credit == null ? 'Store credit unknown (open your RSI account page once so RSI+ can read it).' : `Store credit: ${usd(credit)}.${matches.length ? ` ${matches.map((m) => `${m.warbond ? 'Warbond' : 'Store credit'} ${usd(m.discounted)}: ${pay(m)}`).join('. ')}.` : ' A warbond price takes new money only.'}`)}
          {#if sale.concierge}{@render line(concierge ? true : null, concierge ? `Concierge: ${concierge}.` : 'Concierge level not read (open the Wallet page once).')}{/if}
          {@render line(Math.abs(drift) <= 2 ? true : null, looked ? (Math.abs(drift) <= 2 ? "Your clock matches RSI's." : `Your clock is ${Math.abs(drift)} s ${drift > 0 ? 'behind' : 'ahead of'} RSI's. The countdown here uses RSI's time.`) : 'Clock not compared yet.')}
        </ul>
      </div>

      <div class="grid gap-2">
        <div class="flex flex-wrap items-center gap-3">
          <strong class="text-sm">Stock watch</strong>
          <SwitchRow id="wave-watch" size="sm" class="text-xs" label="On" hint="Looks at the store listing every few seconds from 45 s before a wave until 3 min after, slower up to 15 min after. Stops for that wave once a watched listing is in stock or the wave sells out; the next wave starts again." checked={watching} onchange={(v) => (watching = v)} />
          <span class="text-muted-foreground text-xs">
            {#if !wave}nothing to watch{:else if stopped}{stopped.why === 'stock' ? 'in stock' : 'sold out'} at {fmtWhen(stopped.at, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}{wave.i + 1 < sale.times.length ? `: resting until wave ${wave.i + 2}` : ': that was the last wave'}{:else if every == null}{watching ? 'starts 5 min before the wave' : 'off'}{:else}checking every {every / 1000} s{/if}
            {#if looked} · last look {Math.max(0, Math.round((now - offset - looked) / 1000))} s ago{/if}
          </span>
          {#if stopped}<Button variant="outline" size="xs" onclick={() => ((keepOn = waveKey), (stop = null))} title="Keep watching this wave (e.g. stock may come back after a cart timeout)">Watch again</Button>{/if}
          <Button variant="outline" size="xs" disabled={looking} onclick={() => look()}>Look now</Button>
        </div>
        {#if matches.length}
          <div class="grid gap-2">
            {#each matches as m (m.id)}
              {@const on = watchedOf(m)}
              <div class={cn('grid gap-2 rounded-lg border p-3', m.available && on ? 'border-success bg-success/10' : !on && 'opacity-60')}>
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant={m.warbond ? 'warning' : 'info'}>{m.warbond ? 'Warbond' : 'Store credit'}</Badge>
                  <strong class={cn(m.available && on && 'text-success text-lg')}>{m.available ? 'IN STOCK · ' : ''}{m.name} · {usd(m.discounted)}</strong>
                  {#if !m.available}<span class="text-muted-foreground text-xs">not sellable right now</span>{/if}
                  <span class="flex-1"></span>
                  <SwitchRow id={`wave-watch-${m.id}`} size="sm" class="text-xs" label="Watch" hint="Watch this one: during the wave only it is checked, and you are told when it becomes sellable" checked={on} onchange={() => toggleWatch(m)} />
                </div>
                <span class="text-muted-foreground text-xs">{pay(m)}</span>
                <div class="flex flex-wrap items-center gap-2">
                  <Button size={m.available ? 'lg' : 'sm'} disabled={adding || !m.available} onclick={() => add(m)}><ShoppingCart />{adding ? 'Adding…' : m.available ? 'Add to cart and open RSI cart' : 'Add to cart'}</Button>
                  <Button variant="outline" size={m.available ? 'lg' : 'sm'} href={m.url} target="_blank" rel="noopener">Open the store page <ExternalLink /></Button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if inCart.length}
          <Button variant="outline" href={CART_URL} target="_blank" rel="noopener"><ShoppingCart />Open RSI cart: {inCart[0]!.title} is in it <ExternalLink /></Button>
        {/if}
        {#if addMsg}<span class={cn('text-sm', addMsg.startsWith('RSI refused') ? 'text-destructive' : 'text-success')} role="status">{addMsg}</span>{/if}
      </div>
    </Card.Content>
  </Card.Root>
</div>
