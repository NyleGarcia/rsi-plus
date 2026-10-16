<script lang="ts">
  /** Catalog ship picker: searchable by name / maker, your hangar's ships first (like SC-ORG-BOT's HybridShipSelect). */
  import { usd, type CatalogShip } from '@/lib/store';
  import Combobox, { type Option } from './Combobox.svelte';

  let {
    ships,
    mine = [],
    value = $bindable(null),
    placeholder = 'Pick a ship…',
    ariaLabel,
    onlyMine = false,
    price = true,
    saleTag = false,
    onpick,
  }: {
    ships: CatalogShip[];
    /** Ships you own — listed first under "In your hangar". */
    mine?: CatalogShip[];
    value?: number | null;
    placeholder?: string;
    ariaLabel: string;
    /** Offer only `mine` (the "ship in my hangar" source mode). */
    onlyMine?: boolean;
    price?: boolean;
    /** Tag hulls nothing sells today (no CCU, no standalone) — "not on sale", "concept". */
    saleTag?: boolean;
    onpick?: (id: number | null) => void;
  } = $props();

  const opt = (s: CatalogShip, group?: string): Option<number> => ({
    value: s.id,
    label: s.name,
    sublabel: [s.manufacturer, price && s.msrp ? usd(s.msrp) : '', saleTag && !s.ccu.some((k) => k.available) && !s.standalone.some((k) => k.available) ? (s.msrpSource ? 'not in RSI CCU list · MSRP via wiki' : s.flyable === 'Concept' ? 'concept · not on sale' : 'not on sale') : ''].filter(Boolean).join(' · '),
    group,
  });
  const options = $derived.by(() => {
    const own = new Set(mine.map((s) => s.id));
    const first = mine.map((s) => opt(s, 'In your hangar'));
    if (onlyMine) return first;
    const rest = ships.filter((s) => !own.has(s.id)).map((s) => opt(s, mine.length ? 'All ships' : undefined));
    return [...first, ...rest];
  });
</script>

<Combobox {options} bind:value {placeholder} {ariaLabel} emptyText={onlyMine && !mine.length ? 'Load your hangar first' : 'No ship matches'} onpick={(v) => onpick?.(v)} />
