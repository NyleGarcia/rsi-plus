/**
 * Lazy rows: `use:nearView={(v) => (near = v)}` on a list's "… N more loading" line reports whether it is within
 * `margin` px below the viewport. Panels grow their row budget only while it is, so a 1000-pledge hangar builds the
 * rows you can scroll to soon (a few screens) instead of all 17k DOM nodes on every visit; scrolling down loads more.
 * When the element is gone (everything loaded) nothing is observed.
 */
export const NEAR_MARGIN = 1500;

export function nearView(node: Element, onchange: (near: boolean) => void) {
  const io = new IntersectionObserver((entries) => onchange(entries.some((e) => e.isIntersecting)), { rootMargin: `0px 0px ${NEAR_MARGIN}px 0px` });
  io.observe(node);
  return {
    destroy() {
      io.disconnect();
    },
  };
}
