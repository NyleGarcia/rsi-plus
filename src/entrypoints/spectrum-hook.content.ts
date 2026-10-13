/**
 * Runs in the page's MAIN world at document_start, before Spectrum's app boots.
 * - Forwards the JSON of thread lists / thread pages / identify to the isolated content script, which uses it
 *   for read tracking, badges and mutes (DOM rows carry only a link — the data comes from here).
 * - With muteMode 'hide', drops muted threads from `/forum/channel/threads` payloads before Spectrum renders them.
 * No extension APIs exist here; it talks to the content script via window.postMessage.
 */
import { filterThreads } from '@/lib/filters';
import { CAPTURE, HOOK_CONFIG_KEY, HOOK_TAG, LIST_PATH, type HookConfig } from '@/lib/hook-config';
import { NO_MUTES } from '@/lib/filters';

export default defineContentScript({
  matches: ['https://robertsspaceindustries.com/spectrum/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const TAG = HOOK_TAG;
    let config: HookConfig = { dropMuted: false, mutes: NO_MUTES };
    try {
      config = { ...config, ...JSON.parse(localStorage.getItem(HOOK_CONFIG_KEY) ?? '{}') };
    } catch {}
    window.addEventListener('message', (e) => {
      if (e.source === window && e.data?.[TAG] === 'config') config = e.data.config;
    });
    const post = (url: string, json: unknown) => window.postMessage({ [TAG]: 'api', payload: { path: new URL(url, location.href).pathname, json } }, location.origin);
    const seenPaths = new Set<string>();
    (window as any).__spectrumplus = { paths: () => [...seenPaths].sort().join('\n') };

    /** Inspect a JSON body: forward it, return the rewritten text (or null = unchanged). */
    const process = (url: string, text: string): string | null => {
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        return null;
      }
      if (!json?.success) return null;
      const out = config.dropMuted && LIST_PATH.test(url) ? filterThreads(json, config.mutes) : null;
      post(url, out ?? json);
      return out ? JSON.stringify(out) : null;
    };
    const interesting = (url: string) => {
      if (/\/api\/spectrum\//.test(url) && seenPaths.size < 300) seenPaths.add(new URL(url, location.href).pathname);
      return CAPTURE.test(url);
    };

    // ---- fetch ----
    const origFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const url = input instanceof Request ? input.url : String(input);
      const res = await origFetch.call(this, input, init);
      if (!res.ok || !interesting(url) || !res.headers.get('content-type')?.includes('json')) return res;
      try {
        const out = process(url, await res.clone().text());
        if (out == null) return res;
        const replaced = new Response(out, { status: res.status, statusText: res.statusText, headers: res.headers });
        Object.defineProperty(replaced, 'url', { value: res.url });
        return replaced;
      } catch {
        return res;
      }
    };

    // ---- XMLHttpRequest ----
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    XHR.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
      const href = new URL(String(url), location.href).href;
      if (interesting(href)) {
        // Registered before the app's own handlers (attached after open), so we patch first.
        this.addEventListener('readystatechange', () => {
          if (this.readyState !== 4 || this.status !== 200) return;
          if (this.responseType && this.responseType !== 'text' && this.responseType !== 'json') return;
          try {
            const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
            const out = process(href, text);
            if (out == null) return;
            const value = this.responseType === 'json' ? JSON.parse(out) : out;
            Object.defineProperty(this, 'responseText', { configurable: true, get: () => out });
            Object.defineProperty(this, 'response', { configurable: true, get: () => value });
          } catch {}
        });
      }
      return (origOpen as any).call(this, method, url, ...rest);
    };
  },
});
