import { describe,it,expect,vi,afterEach } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/engine/cityData',async()=>({ ...(await vi.importActual('@/lib/city-contract')), fetchCityDataForStream:vi.fn() }));
vi.mock('@/lib/engine/street/assemble-city',()=>({assembleCityFromBuild:vi.fn(async()=>{})}));
vi.mock('@/lib/engine/prebuilt-cell-runtime',()=>({fetchPrebuiltCell:vi.fn(async()=>null)}));
import {fetchCityDataForStream} from '@/lib/engine/cityData';
import {CELL_STEP,cityCacheKey} from '@/lib/city-contract';
import {assembleCityFromBuild} from '@/lib/engine/street/assemble-city';
import {fetchPrebuiltCell} from '@/lib/engine/prebuilt-cell-runtime';
import {createCellStreamer} from '@/lib/engine/street/cell-stream';
import {disposeSceneGroup} from '@/lib/engine/street/resources';
import {createCityBuilderPool} from '@/lib/engine/city-builder';
afterEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchCityDataForStream.mockReset();
  fetchPrebuiltCell.mockReset().mockResolvedValue(null);
  assembleCityFromBuild.mockReset().mockImplementation(async()=>{});
});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
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
    now+=29999;streamer.tick(1,2);
    expect(build).toHaveBeenCalledTimes(1); // the failed cell remains held during backoff
    now+=1;streamer.tick(1,2); // no player movement: retry as soon as the cooldown expires
    await vi.waitFor(()=>expect(streamer.loadingCount()).toBe(0));
    expect(build).toHaveBeenCalledTimes(2);expect(build.mock.calls[1][0].elements[0].id).toBe(42);
    streamer.dispose();
  });
  it('keeps two geometry builds in flight but serializes neighbor assembly',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{}); vi.spyOn(console,'info').mockImplementation(()=>{});
    fetchCityDataForStream.mockImplementation(async(la,lo)=>({
      lat:la,
      lon:lo,
      cacheKey:'test',
      data:{elements:[{type:'way',id:Math.round(la*1e6)+Math.round(lo*1e3),tags:{building:'yes'},geometry:[{lat:la,lon:lo},{lat:la+0.0001,lon:lo},{lat:la,lon:lo+0.0001}]}]},
    }));
    let buildsInFlight=0, maxBuildsInFlight=0;
    const buildCity=vi.fn(async()=>{
      buildsInFlight++;
      maxBuildsInFlight=Math.max(maxBuildsInFlight,buildsInFlight);
      await new Promise(resolve=>setTimeout(resolve,5));
      buildsInFlight--;
      return {};
    });
    let assembliesInFlight=0, maxAssembliesInFlight=0;
    assembleCityFromBuild.mockImplementation(async()=>{
      assembliesInFlight++;
      maxAssembliesInFlight=Math.max(maxAssembliesInFlight,assembliesInFlight);
      await new Promise(resolve=>setTimeout(resolve,2));
      assembliesInFlight--;
    });
    const streamer=createCellStreamer({scene:new THREE.Scene(),lat0:1,lon0:2,terrainTiles:new Map(),engineRef:{current:{}},buildCity});
    streamer.markLoaded('wtw_city6_1.000_2.000',1,2);
    streamer.tick(1,2);
    await vi.waitFor(()=>expect(streamer.loadingCount()).toBe(0));
    expect(maxBuildsInFlight).toBe(2);
    expect(assembleCityFromBuild).toHaveBeenCalledTimes(8);
    expect(maxAssembliesInFlight).toBe(1);
    streamer.dispose();
  });
  it('bounds queued cells and cancels requests outside the latest neighborhood',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{});
    const requests=[];
    fetchCityDataForStream.mockImplementation((la,lo,{signal})=>new Promise((resolve,reject)=>{
      const request={lat:la,lon:lo,aborted:false};
      requests.push(request);
      signal.addEventListener('abort',()=>{request.aborted=true;reject(signal.reason);},{once:true});
    }));
    const buildCity=vi.fn(async()=>({}));
    const streamer=createCellStreamer({scene:new THREE.Scene(),lat0:1,lon0:2,terrainTiles:new Map(),engineRef:{current:{}},buildCity});
    streamer.markLoaded('wtw_city6_1.000_2.000',1,2);
    streamer.tick(1,2);
    await vi.waitFor(()=>expect(requests).toHaveLength(2));
    expect(requests).toHaveLength(2);
    expect(streamer.debugState().queueLimit).toBe(9);
    expect(streamer.loadingCount()).toBeLessThanOrEqual(9);

    const obsoleteRequests=requests.slice();
    streamer.tick(1,2+CELL_STEP*6);
    expect(obsoleteRequests.every((request)=>request.aborted)).toBe(true);
    expect(streamer.debugState().queuedKeys.length).toBeLessThanOrEqual(9);
    expect(streamer.loadingCount()).toBeLessThanOrEqual(11);
    await vi.waitFor(()=>expect(requests.length).toBeGreaterThan(2));
    expect(buildCity).not.toHaveBeenCalled();

    streamer.dispose();
    expect(streamer.debugState().pendingCount).toBe(0);
    expect(streamer.debugState().activeJobKeys).toEqual([]);
  });
  it('rejects an obsolete assembly and rolls back scene, footprints, metadata, and IDs',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{}); vi.spyOn(console,'info').mockImplementation(()=>{});
    const targetLat=1+CELL_STEP,targetLon=2,targetKey=cityCacheKey(targetLat,targetLon);
    const assemblyGate=deferred();
    const requests=[];
    fetchCityDataForStream.mockImplementation(async(la,lo)=>{
      requests.push({lat:la,lon:lo});
      const isTarget=cityCacheKey(la,lo)===targetKey;
      return{
        lat:la,lon:lo,cacheKey:cityCacheKey(la,lo),
        data:{elements:isTarget?[{type:'way',id:42,tags:{building:'yes'},geometry:[
          {lat:la,lon:lo},{lat:la+0.0001,lon:lo},{lat:la,lon:lo+0.0001},
        ]}]:[]},
      };
    });
    const buildCity=vi.fn(async({elements})=>({elements}));
    const scene=new THREE.Scene();
    const engineRef={current:{roadPaths:[],propMarkers:[],pois:[],bridgeDecks:[],spinners:[],lampGlows:[],buildingMats:[],lampPoolMaterials:[]}};
    const footprints=new Map();
    const removeFootprintsByCell=vi.fn((key)=>footprints.delete(key));
    const loaded=[];
    let firstSignal=null,assemblyCount=0;
    assembleCityFromBuild.mockImplementation(async(_built,assemblyCtx)=>{
      assemblyCount++;
      assemblyCtx.root.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));
      assemblyCtx.addFootprint([], {id:42,cellKey:assemblyCtx.cellKey});
      engineRef.current.roadPaths.push({cellKey:assemblyCtx.cellKey});
      if(assemblyCount===1){firstSignal=assemblyCtx.signal;await assemblyGate.promise;}
    });
    const streamer=createCellStreamer({
      scene,lat0:1,lon0:2,terrainTiles:new Map(),engineRef,buildCity,
      addFootprint:(_ring,meta)=>footprints.set(meta.cellKey,true),
      removeFootprintsByCell,
      onCellLoaded:(key)=>loaded.push(key),
    });
    streamer.markLoaded('wtw_city6_1.000_2.000',1,2);
    streamer.tick(1,2);
    await vi.waitFor(()=>expect(assemblyCount).toBe(1));
    expect(firstSignal.aborted).toBe(false);
    expect(streamer.debugState().reservationCount).toBe(1);

    streamer.tick(1,2+CELL_STEP*6);
    expect(firstSignal.aborted).toBe(true);
    assemblyGate.resolve();
    await vi.waitFor(()=>expect(streamer.debugState().activeJobKeys).not.toContain(targetKey));
    expect(streamer.debugState().reservationCount).toBe(0);
    expect(streamer.debugState().loadedKeys).not.toContain(targetKey);
    expect(scene.children.some((child)=>child.name===targetKey)).toBe(false);
    expect(footprints.has(targetKey)).toBe(false);
    expect(removeFootprintsByCell).toHaveBeenCalledWith(targetKey);
    expect(engineRef.current.roadPaths.some((item)=>item.cellKey===targetKey)).toBe(false);
    expect(loaded).not.toContain(targetKey);

    streamer.tick(targetLat,targetLon);
    await vi.waitFor(()=>expect(streamer.debugState().loadedKeys).toContain(targetKey));
    expect(buildCity.mock.calls.filter((call)=>call[0].elements.some((element)=>element.id===42))).toHaveLength(2);
    expect(loaded).toContain(targetKey);
    expect(scene.children.some((child)=>child.name===targetKey)).toBe(true);
    streamer.dispose();
  });

  it('assembles a compatible prebuilt neighbor without fetching or building raw geometry',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{}); vi.spyOn(console,'info').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({})})));
    const targetLat=1+CELL_STEP,targetLon=2,targetKey=cityCacheKey(targetLat,targetLon);
    const result={walls:[],roofCaps:[],pitchedRoofs:[],roadDecals:[],flats:[],meta:{}};
    fetchPrebuiltCell.mockImplementation(async(key)=>key===targetKey?({
      kind:'prebuilt',
      metadata:{origin:{lat:targetLat,lon:targetLon},clippedElementCount:1,featureIds:['way/42']},
      result,
    }):null);
    fetchCityDataForStream.mockResolvedValue({lat:targetLat,lon:targetLon,cacheKey:targetKey,data:{elements:[]}});
    const buildCity=vi.fn(async()=>({}));
    const streamer=createCellStreamer({
      scene:new THREE.Scene(),lat0:1,lon0:2,terrainTiles:new Map(),engineRef:{current:{}},buildCity,
      validatePrebuiltCell:vi.fn(async()=>true),
    });
    streamer.markLoaded(cityCacheKey(1,2),1,2);
    streamer.tick(1,2);
    await vi.waitFor(()=>expect(assembleCityFromBuild).toHaveBeenCalledTimes(1));
    expect(buildCity).not.toHaveBeenCalled();
    expect(fetchCityDataForStream.mock.calls.map(([la,lo])=>[la,lo,cityCacheKey(la,lo)])).not.toContainEqual([targetLat,targetLon,targetKey]);
    expect(streamer.debugState().loadedKeys).toContain(targetKey);
    streamer.dispose();
  });
  it('falls back to raw building when a prebuilt neighbor overlaps already-owned feature IDs',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{}); vi.spyOn(console,'info').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({})})));
    const targetLat=1+CELL_STEP,targetLon=2,targetKey=cityCacheKey(targetLat,targetLon);
    const geometry=[
      {lat:targetLat+0.0001,lon:targetLon+0.0001},
      {lat:targetLat+0.0002,lon:targetLon+0.0001},
      {lat:targetLat+0.0001,lon:targetLon+0.0002},
    ];
    fetchPrebuiltCell.mockImplementation(async(key)=>key===targetKey?({
      kind:'prebuilt',
      metadata:{origin:{lat:targetLat,lon:targetLon},clippedElementCount:2,featureIds:['way/42','way/43']},
      result:{walls:[],roofCaps:[],pitchedRoofs:[],roadDecals:[],flats:[],meta:{}},
    }):null);
    fetchCityDataForStream.mockImplementation(async(la,lo)=>({
      lat:la,lon:lo,cacheKey:cityCacheKey(la,lo),
      data:{elements:cityCacheKey(la,lo)===targetKey?[
        {type:'way',id:42,tags:{building:'yes'},geometry},
        {type:'way',id:43,tags:{building:'yes'},geometry},
      ]:[]},
    }));
    const buildCity=vi.fn(async({elements})=>({elements}));
    const validatePrebuiltCell=vi.fn(async()=>true);
    const streamer=createCellStreamer({
      scene:new THREE.Scene(),lat0:1,lon0:2,terrainTiles:new Map(),engineRef:{current:{}},buildCity,
      validatePrebuiltCell,
    });
    streamer.markLoaded(cityCacheKey(1,2),1,2);
    streamer.noteSpawnIds(['way/42']);
    streamer.tick(1,2);
    await vi.waitFor(()=>expect(streamer.debugState().loadedKeys).toContain(targetKey));
    expect(fetchCityDataForStream).toHaveBeenCalledWith(targetLat,targetLon,expect.objectContaining({signal:expect.any(AbortSignal)}));
    expect(validatePrebuiltCell).not.toHaveBeenCalled();
    expect(buildCity).toHaveBeenCalledOnce();
    expect(buildCity.mock.calls[0][0].elements.map((element)=>element.id)).toEqual([43]);
    expect(streamer.debugState().deferredKeys).not.toContain(targetKey);
    streamer.dispose();
  });
  it('uses an index ownership hint to skip the prebuilt download before raw fallback',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{}); vi.spyOn(console,'info').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({})})));
    const targetLat=1+CELL_STEP,targetLon=2,targetKey=cityCacheKey(targetLat,targetLon);
    const geometry=[
      {lat:targetLat+0.0001,lon:targetLon+0.0001},
      {lat:targetLat+0.0002,lon:targetLon+0.0001},
      {lat:targetLat+0.0001,lon:targetLon+0.0002},
    ];
    fetchPrebuiltCell.mockImplementation(async(key,{getOwnedCellKeys}={})=>{
      if(key!==targetKey) return null;
      expect(getOwnedCellKeys()).toContain(cityCacheKey(1,2));
      return {kind:'raw-fallback',reason:'feature-id-overlap'};
    });
    fetchCityDataForStream.mockImplementation(async(la,lo)=>(
      {lat:la,lon:lo,cacheKey:cityCacheKey(la,lo),data:{elements:cityCacheKey(la,lo)===targetKey?[
        {type:'way',id:42,tags:{building:'yes'},geometry},
        {type:'way',id:43,tags:{building:'yes'},geometry},
      ]:[]}}
    ));
    const buildCity=vi.fn(async({elements})=>({elements}));
    const validatePrebuiltCell=vi.fn(async()=>true);
    const streamer=createCellStreamer({
      scene:new THREE.Scene(),lat0:1,lon0:2,terrainTiles:new Map(),engineRef:{current:{}},buildCity,
      validatePrebuiltCell,
    });
    streamer.markLoaded(cityCacheKey(1,2),1,2);
    streamer.noteSpawnIds(['way/42']);
    streamer.tick(1,2);
    await vi.waitFor(()=>expect(streamer.debugState().loadedKeys).toContain(targetKey));
    expect(validatePrebuiltCell).not.toHaveBeenCalled();
    expect(buildCity.mock.calls[0][0].elements.map((element)=>element.id)).toEqual([43]);
    expect(streamer.debugState().deferredKeys).not.toContain(targetKey);
    streamer.dispose();
  });
  it('keeps a shared texture alive until its last scene owner is removed',()=>{
    const scene=new THREE.Scene(), texture=new THREE.Texture();const dispose=vi.spyOn(texture,'dispose');
    const a=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({map:texture}));
    const b=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({map:texture}));scene.add(a,b);
    disposeSceneGroup(a,scene);expect(dispose).not.toHaveBeenCalled();disposeSceneGroup(b,scene);expect(dispose).toHaveBeenCalledOnce();
  });
  it('preserves cached shared materials and their textures when a cell is evicted',()=>{
    const scene=new THREE.Scene(),texture=new THREE.Texture();
    const material=new THREE.MeshBasicMaterial({map:texture});material.userData.shared=true;
    const geometry=new THREE.BoxGeometry();
    const disposeMaterial=vi.spyOn(material,'dispose');
    const disposeTexture=vi.spyOn(texture,'dispose');
    const disposeGeometry=vi.spyOn(geometry,'dispose');
    const group=new THREE.Group();group.add(new THREE.Mesh(geometry,material));scene.add(group);
    disposeSceneGroup(group,scene);
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(disposeTexture).not.toHaveBeenCalled();
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });
  it('reuses a worker and rejects pending work on disposal',async()=>{
    const worker={postMessage:vi.fn(),terminate:vi.fn()};const factory=vi.fn(()=>worker);
    const pool=createCityBuilderPool({size:1,workerFactory:factory});
    const args={elements:[],terrainTiles:new Map(),lat0:0,lon0:0};
    const first=pool.build(args);worker.onmessage({data:{id:1,type:'done',result:{ok:true}}});await first;
    const second=pool.build(args);expect(factory).toHaveBeenCalledOnce();
    const rejection=expect(second).rejects.toBeDefined();pool.dispose();await rejection;expect(worker.terminate).toHaveBeenCalled();
  });
  it('bounds the geometry queue and removes an aborted queued job',async()=>{
    const worker={postMessage:vi.fn(),terminate:vi.fn()};
    const pool=createCityBuilderPool({size:1,maxQueueSize:1,workerFactory:()=>worker});
    const first=pool.build({elements:[],terrainTiles:new Map(),lat0:0,lon0:0});
    const queuedAbort=new AbortController();
    const second=pool.build({elements:[],terrainTiles:new Map(),lat0:0,lon0:0,signal:queuedAbort.signal});
    await expect(pool.build({elements:[],terrainTiles:new Map(),lat0:0,lon0:0})).rejects.toMatchObject({
      code:'CITY_BUILDER_QUEUE_FULL',
    });
    expect(pool.debugState()).toMatchObject({activeCount:1,queuedCount:1,queueLimit:1,pendingCount:2});
    queuedAbort.abort(new Error('no longer needed'));
    await expect(second).rejects.toThrow('no longer needed');
    expect(pool.debugState()).toMatchObject({activeCount:1,queuedCount:0,pendingCount:1});
    worker.onmessage({data:{id:1,type:'done',result:{ok:true}}});
    await expect(first).resolves.toEqual({ok:true});
    pool.dispose();
  });
  it('ignores a late result from a worker terminated for an obsolete job',async()=>{
    const workers=[];
    const pool=createCityBuilderPool({size:1,workerFactory:()=>{
      const worker={postMessage:vi.fn(),terminate:vi.fn()};workers.push(worker);return worker;
    }});
    const obsoleteAbort=new AbortController();
    const obsolete=pool.build({elements:[],terrainTiles:new Map(),lat0:0,lon0:0,signal:obsoleteAbort.signal});
    const obsoleteRejected=expect(obsolete).rejects.toThrow('obsolete');
    obsoleteAbort.abort(new Error('obsolete'));
    await obsoleteRejected;
    const current=pool.build({elements:[],terrainTiles:new Map(),lat0:0,lon0:0});
    expect(workers).toHaveLength(2);
    workers[0].onmessage({data:{id:1,type:'done',result:{stale:true}}});
    expect(pool.debugState()).toMatchObject({activeCount:1,queuedCount:0});
    workers[1].onmessage({data:{id:2,type:'done',result:{fresh:true}}});
    await expect(current).resolves.toEqual({fresh:true});
    pool.dispose();
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
  it('rebuilds an evicted road cell when the player revisits it',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{}); vi.spyOn(console,'info').mockImplementation(()=>{});
    const targetLat=1+CELL_STEP,targetKey=cityCacheKey(targetLat,2);
    fetchCityDataForStream.mockImplementation(async(la,lo)=>({
      lat:la,lon:lo,cacheKey:cityCacheKey(la,lo),
      data:{elements:cityCacheKey(la,lo)===targetKey?[{type:'way',id:84,tags:{highway:'residential'},geometry:[
        {lat:la,lon:lo},{lat:la+0.0001,lon:lo},{lat:la+0.0001,lon:lo+0.0001},
      ]}]:[]},
    }));
    const buildCity=vi.fn(async({elements})=>({meta:{roadPaths:elements.map((el)=>({id:el.id,pts:el.geometry}))}}));
    const streamer=createCellStreamer({
      scene:new THREE.Scene(),lat0:1,lon0:2,terrainTiles:new Map(),engineRef:{current:{}},
      buildCity,maxCells:1,
    });
    streamer.markLoaded('wtw_city6_1.000_2.000',1,2);
    streamer.tick(1,2);
    await vi.waitFor(()=>expect(assembleCityFromBuild).toHaveBeenCalledTimes(1));
    expect(streamer.debugState().loadedKeys).toContain(targetKey);

    streamer.tick(1+CELL_STEP*6,2);
    await vi.waitFor(()=>expect(streamer.loadingCount()).toBe(0));
    expect(streamer.debugState().loadedKeys).not.toContain(targetKey);

    streamer.tick(targetLat,2);
    await vi.waitFor(()=>expect(assembleCityFromBuild).toHaveBeenCalledTimes(2));
    expect(assembleCityFromBuild.mock.calls[1][0].meta.roadPaths).toEqual([
      expect.objectContaining({id:84}),
    ]);
    expect(streamer.debugState().loadedKeys).toContain(targetKey);
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
