/**
 * fetch() wrapper that always bypasses the browser's HTTP cache.
 *
 * The site's /data/*.json files are static, rebuilt daily by the scrape
 * pipeline and redeployed to GitHub Pages. Browsers were caching old
 * responses (visible as "stale stats until you open an incognito window"),
 * so every /data/ fetch should skip the disk cache and always hit the
 * network for a fresh copy.
 *
 * Usage is identical to fetch() — this only changes caching behavior.
 */
export function fetchJson(url, init = {}) {
  return fetch(url, { ...init, cache: 'no-store' });
}
