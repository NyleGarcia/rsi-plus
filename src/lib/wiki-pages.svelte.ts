/**
 * Which names have a Star Citizen Wiki page. The list (`data/wiki-titles.json`: every article and redirect in the
 * wiki's main namespace, refreshed by `scripts/wiki-titles.mjs`) ships with the extension and is loaded on first use
 * as its own chunk, so no request goes to the wiki. Until it has loaded `wikiTitle` answers null — no link rather than
 * one that may 404 — and anything that called it re-renders once it arrives.
 */
const key = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const pages = $state<{ byKey: Map<string, string> | null }>({ byKey: null });
let loading: Promise<void> | null = null;

/** Replace the title list (tests; the extension loads it with `loadWikiTitles`). */
export function setWikiTitles(titles: readonly string[]) {
  pages.byKey = new Map(titles.map((t) => [key(t), t]));
}

export function loadWikiTitles(): Promise<void> {
  return (loading ??= import('./data/wiki-titles.json')
    .then((m) => setWikiTitles(m.default as string[]))
    .catch(() => {
      loading = null; // try again on the next lookup
    }));
}

/**
 * The wiki's title for `name`, ignoring case and spacing (MediaWiki titles differ from RSI's mostly in case), or null
 * when the wiki has no page by that name or the list hasn't loaded yet.
 */
export function wikiTitle(name: string): string | null {
  if (!pages.byKey) {
    void loadWikiTitles();
    return null;
  }
  return pages.byKey.get(key(name)) ?? null;
}
