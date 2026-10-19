import {it,expect,vi,afterEach} from 'vitest';
import {fetchOverpassCell} from '@/lib/overpassServer';
afterEach(()=>vi.unstubAllGlobals());
it('stops the mirror chain when its shared request deadline expires',async()=>{
  const fetcher=vi.fn((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
  vi.stubGlobal('fetch',fetcher);
  await expect(fetchOverpassCell(1,2,{timeoutMs:20})).rejects.toBeDefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
