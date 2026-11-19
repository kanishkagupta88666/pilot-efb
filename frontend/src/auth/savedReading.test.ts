import { beforeEach, expect, it, vi } from 'vitest';
import { hasSavedReading, savedResponse, saveReadingResponse } from './savedReading';
beforeEach(() => { const data = new Map<string, Response>(); vi.stubGlobal('caches', {open: async () => ({match: async (url: string) => data.get(url)?.clone(), put: async (url: string, response: Response) => data.set(url,response), keys: async () => [...data.keys()].map(url => ({url: new URL(url,'http://localhost').href}))})}); });
it('keeps a visited topic available independently of sign-in', async () => {
 const path='/api/documents/FM-S100/revisions/2/topics/topic-1/';
 await saveReadingResponse(path, new Response('{"topic":"saved"}'));
 expect(await hasSavedReading('/reader/FM-S100/2')).toBe(true);
 expect(await hasSavedReading('/reader/FM-S100/3')).toBe(false);
 expect(await (await savedResponse(path))?.json()).toEqual({topic:'saved'});
});
it('does not save denied responses or authentication credentials', async () => {
 await saveReadingResponse('/api/auth/login/',new Response('secret'));
 await saveReadingResponse('/api/documents/FM-S200/revisions/4/topics/t/',new Response('denied',{status:403}));
 expect(await savedResponse('/api/auth/login/')).toBeUndefined();
 expect(await hasSavedReading('/reader/FM-S200/4')).toBe(false);
});
it('handles unavailable device storage', async () => {
 vi.stubGlobal('caches',{open:async()=>{throw new Error('unavailable');}});
 await saveReadingResponse('/api/documents/',new Response('{}'));
 expect(await hasSavedReading('/reader/FM-S100/2')).toBe(false);
 expect(await savedResponse('/api/documents/')).toBeUndefined();
});
