import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cellNeighborhood, cityCacheKey, parseCityKey } from '@/lib/city-contract';
const city = { elements:[{type:'way', id:1, tags:{building:'yes'}}] };
beforeEach(() => { vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_R2_PUBLIC_BASE', 'https://cache.test'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('city loading', () => {
  it('holds neighborhood stable during movement inside the arrival tile', () => {
    const initial = cellNeighborhood(35.6595,139.7005);
    expect(cellNeighborhood(35.6605,139.7015,35.6595,139.7005)).toEqual(initial);
    expect(new Set(initial.map(([la,lo])=>cityCacheKey(la,lo))).size).toBe(9);
    expect(parseCityKey('wtw_city6_999.000_0.000')).toBeNull();
  });
  it('deduplicates requests but isolates mutable data between consumers', async () => {
    const fetcher=vi.fn(async()=>Response.json(city)); vi.stubGlobal('fetch',fetcher);
    const {fetchCityData}=await import('@/lib/engine/cityData');
    const [a,b]=await Promise.all([fetchCityData(1,2),fetchCityData(1,2)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    a.elements[0].tags.building='changed'; expect(b.elements[0].tags.building).toBe('yes');
  });
  it('does not remember partial API results or repeatedly probe missing CDN entries', async () => {
    const fetcher=vi.fn(async url=>String(url).startsWith('https:') ? new Response('',{status:404}) : Response.json({...city,partial:true}));
    vi.stubGlobal('fetch',fetcher);
    const {fetchCityData}=await import('@/lib/engine/cityData');
    expect((await fetchCityData(1,2)).partial).toBe(true);
    await fetchCityData(1,2);
    expect(fetcher.mock.calls.filter(([u])=>String(u).startsWith('https:'))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([u])=>String(u).startsWith('/api/'))).toHaveLength(2);
  });
  it('cancels only after the last subscriber leaves', async () => {
    let netSignal, complete;
    vi.stubGlobal('fetch',vi.fn((url,{signal})=> { netSignal=signal; return new Promise(resolve=>{complete=()=>resolve(Response.json(city));}); }));
    const {fetchCityData}=await import('@/lib/engine/cityData');
    const a=new AbortController(), b=new AbortController();
    const first=fetchCityData(1,2,{signal:a.signal}); const second=fetchCityData(1,2,{signal:b.signal});
    await vi.waitFor(()=>expect(netSignal).toBeDefined());
    const rejection=expect(first).rejects.toBeDefined(); a.abort(); await rejection;
    expect(netSignal.aborted).toBe(false); complete(); expect((await second).partial).toBe(false);
  });
});
