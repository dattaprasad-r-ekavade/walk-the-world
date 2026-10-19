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
