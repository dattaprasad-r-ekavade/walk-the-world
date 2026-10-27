import { describe,it,expect,vi,afterEach } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/engine/cityData',async()=>({ ...(await vi.importActual('@/lib/city-contract')), fetchCityDataForStream:vi.fn() }));
vi.mock('@/lib/engine/street/assemble-city',()=>({assembleCityFromBuild:vi.fn(async()=>{})}));
import {fetchCityDataForStream} from '@/lib/engine/cityData';
import {createCellStreamer} from '@/lib/engine/street/cell-stream';
import {disposeSceneGroup} from '@/lib/engine/street/resources';
import {createCityBuilderPool} from '@/lib/engine/city-builder';
afterEach(()=>vi.restoreAllMocks());
describe('stream lifecycle',()=>{
  it('releases reserved feature IDs after a failed build so retry can render them',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{}); vi.spyOn(console,'info').mockImplementation(()=>{});
    let now=100000; vi.spyOn(Date,'now').mockImplementation(()=>now);
    const lat=1.0055,lon=2;
    fetchCityDataForStream.mockImplementation(async(la,lo)=>({lat:la,lon:lo,cacheKey:'test',data:{elements:la===lat&&lo===lon?[{type:'way',id:42,tags:{building:'yes'},geometry:[{lat,lon},{lat:lat+0.0001,lon},{lat,lon:lon+0.0001}]}]:[]}}));
    const build=vi.fn().mockRejectedValueOnce(new Error('worker failed')).mockResolvedValue({});
    const streamer=createCellStreamer({scene:new THREE.Scene(),lat0:1,lon0:2,terrainTiles:new Map(),engineRef:{current:{}},buildCity:build});
    streamer.markLoaded('wtw_city6_1.000_2.000',1,2); streamer.tick(1,2);
    await vi.waitFor(()=>expect(streamer.loadingCount()).toBe(0));
    expect(build).toHaveBeenCalledTimes(1);
    now+=60000;streamer.tick(1,2);
    await vi.waitFor(()=>expect(streamer.loadingCount()).toBe(0));
    expect(build).toHaveBeenCalledTimes(2);expect(build.mock.calls[1][0].elements[0].id).toBe(42);
    streamer.dispose();
  });
  it('keeps a shared texture alive until its last scene owner is removed',()=>{
    const scene=new THREE.Scene(), texture=new THREE.Texture();const dispose=vi.spyOn(texture,'dispose');
    const a=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({map:texture}));
    const b=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({map:texture}));scene.add(a,b);
    disposeSceneGroup(a,scene);expect(dispose).not.toHaveBeenCalled();disposeSceneGroup(b,scene);expect(dispose).toHaveBeenCalledOnce();
  });
  it('reuses a worker and rejects pending work on disposal',async()=>{
    const worker={postMessage:vi.fn(),terminate:vi.fn()};const factory=vi.fn(()=>worker);
    const pool=createCityBuilderPool({size:1,workerFactory:factory});
    const args={elements:[],terrainTiles:new Map(),lat0:0,lon0:0};
    const first=pool.build(args);worker.onmessage({data:{id:1,type:'done',result:{ok:true}}});await first;
    const second=pool.build(args);expect(factory).toHaveBeenCalledOnce();
    const rejection=expect(second).rejects.toBeDefined();pool.dispose();await rejection;expect(worker.terminate).toHaveBeenCalled();
  });
});
describe('stream eviction',()=>{
  it('keeps the full ring plus the pinned spawn cell without re-request churn',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{}); vi.spyOn(console,'info').mockImplementation(()=>{});
    fetchCityDataForStream.mockImplementation(async(la,lo)=>({lat:la,lon:lo,cacheKey:'test',data:{elements:[{type:'way',id:Math.round(la*1e6)+Math.round(lo*1e3),tags:{building:'yes'},geometry:[{lat:la,lon:lo},{lat:la+0.0001,lon:lo},{lat:la,lon:lo+0.0001}]}]}}));
    const streamer=createCellStreamer({scene:new THREE.Scene(),lat0:1,lon0:2,terrainTiles:new Map(),engineRef:{current:{}},buildCity:vi.fn(async()=>({}))});
    streamer.markLoaded('wtw_city6_1.000_2.000',1,2);
    streamer.tick(1.0055,2); // ring centered one cell north of spawn
    await vi.waitFor(()=>expect(streamer.loadingCount()).toBe(0));
    const state=streamer.debugState();
    expect(state.center.key).toBe('wtw_city6_1.006_2.000');
    expect(state.pendingCount).toBe(0);
    expect(state.residentCellCount).toBeLessThanOrEqual(state.maxCells);
    const calls=fetchCityDataForStream.mock.calls.length;
    streamer.tick(1.0055,2.0001);
    expect(fetchCityDataForStream.mock.calls.length).toBe(calls);
    expect(calls).toBeGreaterThanOrEqual(8); // all ring cells requested (spawn is pinned, one is skipped)
    streamer.dispose();
  });
  it('evicts empty cells as the loaded ring advances and preserves its capacity bound',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{}); vi.spyOn(console,'info').mockImplementation(()=>{});
    fetchCityDataForStream.mockImplementation(async(la,lo)=>({lat:la,lon:lo,cacheKey:'empty',data:{elements:[]}}));
    const streamer=createCellStreamer({scene:new THREE.Scene(),lat0:1,lon0:2,terrainTiles:new Map(),engineRef:{current:{}},maxCells:10});
    streamer.markLoaded('wtw_city6_1.000_2.000',1,2);
    for(const lon of [2,2.0055,2.011]){
      streamer.tick(1,lon);
      await vi.waitFor(()=>expect(streamer.loadingCount()).toBe(0));
    }
    const state=streamer.debugState();
    expect(state.center.key).toBe('wtw_city6_1.000_2.011');
    expect(state.loadedKeys).toContain('wtw_city6_1.000_2.000');
    expect(state.residentCellCount).toBeLessThanOrEqual(10);
    streamer.dispose();
  });
});
