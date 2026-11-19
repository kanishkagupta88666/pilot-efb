// Visited reading responses are device copies, not authorization decisions.
const CACHE = 'efb-saved-reading-v1';
export async function savedResponse(url: string): Promise<Response | undefined> {
  try { return await (await caches.open(CACHE)).match(url) ?? undefined; } catch { return undefined; }
}
export async function saveReadingResponse(url: string, response: Response): Promise<void> {
  if (!response.ok || !/\/api\/(documents\/|documents\/?$)/.test(url)) return;
  try { await (await caches.open(CACHE)).put(url, response.clone()); } catch { /* Reading still works when device storage is full. */ }
}
export async function hasSavedReading(path: string): Promise<boolean> {
  try {
    const match = path.match(/^\/reader\/([^/]+)\/([^/?#]+)/);
    if (!match) return false;
    const keys = await (await caches.open(CACHE)).keys();
    const prefix = `/api/documents/${match[1]}/revisions/${match[2]}/topics/`;
    return keys.some(key => new URL(key.url).pathname.startsWith(prefix));
  } catch { return false; }
}
