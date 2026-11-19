import { afterEach, expect, it, vi } from 'vitest';
import { getDocumentLibraryFromApi } from '../api/client';
import { saveReadingResponse } from './savedReading';
afterEach(()=>vi.unstubAllGlobals());
async function setup() {
 const data=new Map<string,Response>();
 vi.stubGlobal('caches',{open:async()=>({match:async(url:string)=>data.get(url)?.clone(),put:async(url:string,response:Response)=>data.set(url,response)})});
 await saveReadingResponse('/api/documents/',new Response('{"documents":[]}',{headers:{'Content-Type':'application/json'}}));
}
it('reads saved responses when disconnected',async()=>{await setup();vi.stubGlobal('fetch',async()=>{throw new TypeError('offline');});expect(await getDocumentLibraryFromApi()).toEqual({ok:true,data:{documents:[]}});});
it('reads saved responses after 401 without losing them',async()=>{await setup();vi.stubGlobal('fetch',async()=>new Response('{}',{status:401}));expect(await getDocumentLibraryFromApi()).toEqual({ok:true,data:{documents:[]}});});
it('preserves the server fleet refusal instead of using a saved copy',async()=>{await setup();vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'This manual is not for your fleet.'}}),{status:403,headers:{'Content-Type':'application/json'}}));expect(await getDocumentLibraryFromApi()).toMatchObject({ok:false,error:{status:403,message:'This manual is not for your fleet.'}});});
