import {it,expect,vi,afterEach} from 'vitest';
import {fetchOverpassCell} from '@/lib/overpassServer';
afterEach(()=>vi.unstubAllGlobals());
it('stops the mirror chain when its shared request deadline expires',async()=>{
  const fetcher=vi.fn((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
  vi.stubGlobal('fetch',fetcher);
  await expect(fetchOverpassCell(1,2,{timeoutMs:20})).rejects.toBeDefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
const bld=Array.from({length:3},(_,i)=>({type:'way',id:i,tags:{building:'yes'},geometry:[]}));
const roads=Array.from({length:30},(_,i)=>({type:'way',id:100+i,tags:{highway:'residential'}}));
const complete={elements:[...bld,...roads]};
it('races a second mirror when the first is slow and aborts the loser',async()=>{
  let loser;
  const fetcher=vi.fn((url,{signal})=>{
    if(fetcher.mock.calls.length===1) return new Promise((_,reject)=>{loser=signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
    return Promise.resolve(Response.json(complete));
  });
  vi.stubGlobal('fetch',fetcher);
  const data=await fetchOverpassCell(1,2,{staggerMs:10});
  expect(data.elements.length).toBe(complete.elements.length);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(loser.aborted).toBe(true);
});
it('starts the next mirror immediately when one fails and falls back to partial results',async()=>{
  const partial={elements:roads};
  const fetcher=vi.fn(async()=>{ const n=fetcher.mock.calls.length; if(n===1) return new Response('',{status:503}); return Response.json(partial); });
  vi.stubGlobal('fetch',fetcher);
  const data=await fetchOverpassCell(1,2,{staggerMs:60000});
  expect(data.partial).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('sweeps the mirrors again after a backoff when every mirror fails fast',async()=>{
  const fetcher=vi.fn(async()=>fetcher.mock.calls.length<=3?new Response('',{status:502}):Response.json(complete));
  vi.stubGlobal('fetch',fetcher);
  const data=await fetchOverpassCell(1,2,{staggerMs:60000,backoffMs:5});
  expect(data.elements.length).toBe(complete.elements.length);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('gives up after the last round',async()=>{
  const fetcher=vi.fn(async()=>new Response('',{status:502}));
  vi.stubGlobal('fetch',fetcher);
  await expect(fetchOverpassCell(1,2,{staggerMs:60000,backoffMs:5,rounds:2})).rejects.toThrow('Overpass HTTP 502');
  expect(fetcher).toHaveBeenCalledTimes(6);
});
