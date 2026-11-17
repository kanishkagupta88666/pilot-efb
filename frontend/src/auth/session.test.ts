import { beforeEach, expect, it, vi } from 'vitest';
import { clearSession, isExpired, readSession, readingAccess, safeReturnPath, saveSession } from './session';
import { authenticatedFetch, login } from './client';
import { mockTransport } from './mock';
beforeEach(() => { const data = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) }); });
it('persists sign-in across reads and clears only its own state', async () => {
 const s = await login('P-100', 'demo-only', mockTransport); localStorage.setItem('notes', 'keep');
 expect(saveSession(s)).toBe(true); expect(readSession()).toEqual(s); expect(clearSession()).toBe(true); expect(readSession()).toBeNull(); expect(localStorage.getItem('notes')).toBe('keep');
});
it('rejects incorrect credentials', async () => { await expect(login('P-100', 'wrong', mockTransport)).rejects.toMatchObject({status:401}); });
it('keeps cached reading available after expiry and without identity', async () => {
 const s = await login('P-100', 'demo-only', mockTransport); s.expiresAt = '2000-01-01T00:00:00Z';
 expect(isExpired(s)).toBe(true); expect(readingAccess(s,true)).toBe('read'); expect(readingAccess(null,true)).toBe('read'); expect(readingAccess(s,false)).toBe('sign-in');
});
it('attaches a bearer token and handles forbidden responses', async () => {
 const s = await login('P-200','demo-only',mockTransport); const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}',{status:403}));
 await expect(authenticatedFetch('/api/documents/',s,{},transport)).rejects.toMatchObject({status:403});
 expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(`Bearer ${s.token}`);
});
it('rejects external return paths', () => { expect(safeReturnPath('//evil.test')).toBe('/'); expect(safeReturnPath('/\\evil.test')).toBe('/'); expect(safeReturnPath('/open?doc=FM-S100')).toBe('/open?doc=FM-S100'); });
