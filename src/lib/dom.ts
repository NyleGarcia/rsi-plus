/** Text helpers for RSI's server-rendered pages (parsed with DOMParser). */
/** Collapsed whitespace, trimmed. */
export const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
/** An element's text, collapsed. */
export const text = (el: Element | null | undefined): string => clean(el?.textContent);
/**
 * Every text node joined with spaces — `textContent` glues neighbours ("USDUEC", "AB12345March 3") and breaks word
 * boundaries. Walks the body when given a Document.
 */
export function textNodes(root: ParentNode): string {
  const parts: string[] = [];
  const walk = (n: Node) => (n.nodeType === 3 ? parts.push(n.textContent ?? '') : n.childNodes.forEach(walk));
  walk((root as Document).body ?? root);
  return parts.join(' ').replace(/\s+/g, ' ');
}
