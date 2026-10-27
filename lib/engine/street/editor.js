import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { disposeSceneGroup } from "./resources";

/** Editor picking, placement, persistence and fly-camera state for one scene. */
export function createStreetEditor({ scene, renderer, camera, player, engineRef, ambience, editsKey,
  toLocal, toGeo, groundHeight, patchTerrain, footprintAt, signal,
  setUiMode, setDebugSel, setEditorMsg, setMutedUi }) {
    // ---- editor / debug ----
    engineRef.current.edits = engineRef.current.edits || {};
    const editor = { mode: null, tool: null, placed: [], selected: null, undo: [] };
    // free-fly camera rig for editor/debug — Blender-style:
    // scroll zoom, MMB orbit, Shift+MMB pan, RMB (or MMB) freelook fallback
    const fly = {
      x: 0, y: 0, z: 0, heading: 0, pitch: 0,
      rmb: false, orbit: null, pan: false, grab: null, photo: false,
    };
    const flyForward = () => {
      const cp = Math.cos(fly.pitch);
      return new THREE.Vector3(Math.sin(fly.heading) * cp, Math.sin(fly.pitch), -Math.cos(fly.heading) * cp);
    };
    const lookAtPivot = () => {
      const o = fly.orbit;
      const d = flyForward();
      fly.x = o.px - d.x * o.dist;
      fly.y = o.py - d.y * o.dist;
      fly.z = o.pz - d.z * o.dist;
    };
    const raycaster = new THREE.Raycaster();

    // hover visuals: brush ring for terrain tools, outline for pickable features,
    // box helper for placed-asset select/hover
    const brushRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide })
    );
    brushRing.renderOrder = 999;
    brushRing.visible = false;
    scene.add(brushRing);
    const outlineLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x4ae3ff, depthTest: false, linewidth: 2 })
    );
    outlineLine.renderOrder = 999;
    outlineLine.visible = false;
    scene.add(outlineLine);
    let selBox = null;
    const clearSelBox = () => { if (selBox) { disposeSceneGroup(selBox, scene); selBox = null; } };
    const showSelBox = (obj, color = 0x4ae3ff) => {
      clearSelBox();
      selBox = new THREE.BoxHelper(obj, color);
      selBox.material.depthTest = false;
      selBox.renderOrder = 999;
      scene.add(selBox);
    };
    const showOutline = (pts, closed) => {
      if (!pts || pts.length < 2) { outlineLine.visible = false; return; }
      const arr = closed ? [...pts, pts[0]] : pts;
      const v = [];
      for (const q of arr) {
        const qx = q[0], qz = q[1];
        v.push(qx, groundHeight(qx, qz) + 0.5, qz);
      }
      outlineLine.geometry.dispose();
      outlineLine.geometry = new THREE.BufferGeometry();
      outlineLine.geometry.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      outlineLine.visible = true;
    };
    const hideHover = () => { brushRing.visible = false; outlineLine.visible = false; };
    let hoverT = 0;
    const updateHover = (e) => {
      if (!editor.mode) { hideHover(); return; }
      const now = performance.now();
      if (now - hoverT < 60) return;
      hoverT = now;
      const hit = pickPoint(e);
      if (!hit) { hideHover(); return; }
      const t = editor.tool;
      const terrainTool = t && ["flatten", "raise", "lower"].includes(t.type);
      if (editor.mode === "editor" && terrainTool) {
        outlineLine.visible = false;
        brushRing.visible = true;
        brushRing.position.set(hit.point.x, groundHeight(hit.point.x, hit.point.z) + 0.4, hit.point.z);
        brushRing.scale.setScalar(t.radius || 12);
      } else if (editor.mode === "editor" && t?.type === "asset") {
        outlineLine.visible = false;
        brushRing.visible = true;
        brushRing.position.set(hit.point.x, groundHeight(hit.point.x, hit.point.z) + 0.4, hit.point.z);
        brushRing.scale.setScalar(1.5);
      } else {
        brushRing.visible = false;
        const sel = resolveOsmAt(hit);
        if (sel?.outline) showOutline(sel.outline, sel.closed);
        else outlineLine.visible = false;
      }
    };
    // GLBs with external resources (e.g. Kenney's Textures/colormap.png)
    // resolve relative to the model URL — flatten every relative request to
    // the asset library so textures load from /api/assets/<basename>
    const gltfManager = new THREE.LoadingManager();
    gltfManager.setURLModifier((url) => {
      if (/^(https?:|data:|blob:)/.test(url)) return url;
      if (url.startsWith("/") && !url.startsWith("/api/assets/")) return url;
      const base = url.split(/[/?#]/).filter(Boolean).pop();
      return `/api/assets/${base}`;
    });
    const gltfLoader = new GLTFLoader(gltfManager);
    const loadGLB = (url) =>
      new Promise((res, rej) => {
        if (signal.aborted) { rej(signal.reason); return; }
        gltfLoader.load(url, (g) => {
          if (signal.aborted) { disposeSceneGroup(g.scene, scene); rej(signal.reason); }
          else res(g.scene);
        }, undefined, rej);
      });
    const placeAsset = async (entry, record) => {
      try {
        const obj = await loadGLB(entry.url);
        signal.throwIfAborted();
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const p = toLocal(entry.lat, entry.lon);
        obj.position.set(p.x, groundHeight(p.x, p.z) + (entry.yOffset || 0), p.z);
        obj.rotation.y = entry.rotY || 0;
        obj.scale.setScalar(entry.scale || 1);
        scene.add(obj);
        editor.placed.push({ group: obj, entry });
        if (record) ((engineRef.current.edits.assets ||= [])).push(entry);
      } catch (err) {
        console.warn("[editor] asset load failed:", err?.message);
        if (!signal.aborted) setEditorMsg(`failed to load ${entry.name}`);
      }
    };
    const saveEdits = async () => {
      try {
        const res = await fetch(`/api/edits/${editsKey}`, {
          method: "PUT",
          signal,
          headers: {
            "content-type": "application/json",
            "x-editor-key": localStorage.getItem("wtw_editor_key") || "",
          },
          body: JSON.stringify(engineRef.current.edits || {}),
        });
        return res.ok;
      } catch { return false; }
    };
    const pickPoint = (e) => {
      const el = renderer.domElement;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      return hits.find((h) => h.object.isMesh) || null;
    };
    const distToSeg = (x, z, a, b) => {
      const dx = b.x - a.x, dz = b.z - a.z;
      const L2 = dx * dx + dz * dz;
      const t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
      return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
    };
    // Resolve the OSM feature at a raycast hit: building footprint first
    // (nudged along the ray — wall hits land exactly ON the edge), then the
    // nearest road centerline. Shared by debug mode and the hide tool.
    const resolveOsmAt = (hit) => {
      const { x, z } = hit.point;
      // per-mesh identity (anything that sets userData.osm)
      for (let o = hit.object; o; o = o.parent) {
        if (o.userData?.osm) {
          const u = o.userData.osm;
          return { kind: u.kind || "feature", id: u.id, tags: { ...u.tags }, outline: u.outline };
        }
      }
      // props (gates, trees, lamps… baked into merged meshes — match by position)
      let bp = null;
      for (const pr of engineRef.current.propMarkers || []) {
        if (!pr.id) continue;
        const d = Math.hypot(x - pr.x, z - pr.z);
        if (d <= 3 && (!bp || d < bp.d)) bp = { d, pr };
      }
      if (bp) {
        const { pr } = bp;
        const R = 1.6, ring = [];
        for (let i = 0; i < 12; i++)
          ring.push([pr.x + Math.cos((i / 12) * Math.PI * 2) * R, pr.z + Math.sin((i / 12) * Math.PI * 2) * R]);
        return { kind: `prop (${pr.kind})`, id: pr.id, tags: { ...pr.tags }, outline: ring, closed: true };
      }
      const dir = raycaster.ray.direction;
      const fp = footprintAt(x, z) || footprintAt(x + dir.x * 0.4, z + dir.z * 0.4);
      if (fp?.meta?.id)
        return { kind: "building", id: fp.meta.id, tags: { ...fp.meta.tags }, outline: fp.poly, closed: true };
      let best = null;
      for (const rp of engineRef.current.roadPaths || []) {
        if (!rp.id) continue;
        for (let i = 0; i < rp.pts.length - 1; i++) {
          // road pts are THREE.Vector2 in the XZ plane: .y holds z
          const a = rp.pts[i], b2 = rp.pts[i + 1];
          const d = distToSeg(x, z, { x: a.x, z: a.y }, { x: b2.x, z: b2.y });
          if (d <= Math.max((rp.width || 6) * 0.75, 5) && (!best || d < best.d)) best = { d, rp };
        }
      }
      return best
        ? { kind: "road", id: best.rp.id, tags: { ...best.rp.tags }, outline: best.rp.pts.map((v) => [v.x, v.y]) }
        : null;
    };
    const debugPick = (e) => {
      const hit = pickPoint(e);
      if (!hit) { setDebugSel(null); return; }
      let sel = resolveOsmAt(hit);
      if (sel) {
        const ov = engineRef.current.edits?.tagOverrides?.[sel.id];
        if (ov) sel.tags = { ...sel.tags, ...ov };
      }
      setDebugSel(sel || { kind: "none" });
    };
    const editorClick = async (e) => {
      const hit = pickPoint(e);
      if (!hit) return;
      const { x, z } = hit.point;
      const t = editor.tool;
      if (!t) {
        let idx = null;
        outer: for (let i = 0; i < editor.placed.length; i++) {
          for (let o = hit.object; o; o = o.parent)
            if (o === editor.placed[i].group) { idx = i; break outer; }
        }
        if (idx === null) {
          // small assets are easy to miss — select the nearest within 3m
          let bd = 3;
          for (let i = 0; i < editor.placed.length; i++) {
            const gp = editor.placed[i].group.position;
            const d = Math.hypot(x - gp.x, z - gp.z);
            if (d < bd) { bd = d; idx = i; }
          }
        }
        editor.selected = idx;
        if (idx !== null) showSelBox(editor.placed[idx].group);
        else clearSelBox();
        setEditorMsg(
          idx !== null
            ? `selected ${editor.placed[idx].entry.name} — G move · R rotate · [ ] scale · X delete`
            : "nothing selected — click a placed asset, or pick a tool"
        );
        return;
      }
      if (t.type === "asset") {
        const g = toGeo(x, z);
        await placeAsset({ name: t.name, url: t.url, lat: g.lat, lon: g.lon, rotY: 0, scale: 1 }, true);
        editor.undo.push({ type: "asset" });
        setEditorMsg(`placed ${t.name} — 💾 Save to persist`);
      } else if (t.type === "flatten" || t.type === "raise" || t.type === "lower") {
        const r = t.radius || 12;
        // flatten targets the clicked height; raise/lower shift it (repeat
        // clicks stack) — enough to close terrain gaps or bury seams by hand
        const h =
          groundHeight(x, z) + (t.type === "raise" ? 1.5 : t.type === "lower" ? -1.5 : 0);
        const prevH = groundHeight(x, z);
        patchTerrain(x, z, r, h);
        const g = toGeo(x, z);
        ((engineRef.current.edits.terrain ||= [])).push({ lat: g.lat, lon: g.lon, radius: r, height: h });
        editor.undo.push({ type: "terrain", prevH, x, z, r });
        setEditorMsg(`terrain ${t.type} applied (${r}m) — 💾 Save to persist`);
      } else if (t.type === "hide") {
        const sel = resolveOsmAt(hit);
        if (!sel) { setEditorMsg("nothing with OSM data there"); return; }
        const hidden = (engineRef.current.edits.hidden ||= []);
        if (!hidden.includes(sel.id)) { hidden.push(sel.id); editor.undo.push({ type: "hide", id: sel.id }); }
        setEditorMsg(`${sel.id} hidden on next load — 💾 Save to persist (${hidden.length} hidden)`);
      }
    };
    const setMode = (m) => {
      const was = editor.mode;
      editor.mode = editor.mode === m ? null : m;
      if (editor.mode && document.pointerLockElement) document.exitPointerLock();
      if (editor.mode && !was) {
        // enter fly where the player camera is, looking the same way
        fly.x = camera.position.x;
        fly.y = camera.position.y + 4;
        fly.z = camera.position.z;
        fly.heading = player.heading;
        fly.pitch = Math.max(-1.2, player.pitch - 0.3);
      }
      if (!editor.mode) { hideHover(); clearSelBox(); }
      setUiMode(editor.mode);
      if (editor.mode !== "debug") setDebugSel(null);
      if (editor.mode !== "editor") { editor.tool = null; editor.selected = null; setEditorMsg(null); }
    };
    engineRef.current.setMode = setMode;
    engineRef.current.toggleMute = () => setMutedUi(ambience.toggleMute());
    setMutedUi(ambience.muted);
    engineRef.current.setPhotoFly = (on) => {
      if (on) {
        if (document.pointerLockElement) document.exitPointerLock();
        fly.x = camera.position.x;
        fly.y = camera.position.y + 2;
        fly.z = camera.position.z;
        fly.heading = player.heading;
        fly.pitch = Math.max(-1.2, player.pitch - 0.15);
        fly.photo = true;
      } else {
        fly.photo = false;
      }
    };
    engineRef.current.editorApi = {
      setTool: (t) => {
        editor.tool = t;
        editor.selected = null;
        setEditorMsg(
          !t ? "select mode — click a placed asset"
          : t.type === "hide" ? "hide armed — click a building/road to remove it"
          : ["flatten", "raise", "lower"].includes(t.type) ? `${t.type} armed (${t.radius}m) — click ground`
          : `${t.name} armed — click ground to place`
        );
      },
      save: async () => {
        const ok = await saveEdits();
        setEditorMsg(ok ? "saved to R2 ✓" : "save failed — check editor key");
        return ok;
      },
      setTagOverride: async (id, tags) => {
        ((engineRef.current.edits.tagOverrides ||= {}))[id] = tags;
        return saveEdits();
      },
      setEditorKey: (k) => localStorage.setItem("wtw_editor_key", k),
      clearHidden: () => {
        engineRef.current.edits.hidden = [];
        setEditorMsg("hidden list cleared — 💾 Save, then reload to restore");
      },
      clearTerrain: () => {
        engineRef.current.edits.terrain = [];
        setEditorMsg("terrain edits cleared — 💾 Save, then reload to restore");
      },
    };

  return { get selectionBox() { return selBox; }, editor, fly, flyForward, lookAtPivot, pickPoint, resolveOsmAt,
    debugPick, editorClick, setMode, showSelBox, clearSelBox, hideHover,
    updateHover, loadGLB, placeAsset, dispose: clearSelBox };
}
