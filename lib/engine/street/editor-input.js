import * as THREE from "three";
import { disposeSceneGroup } from "./resources";

const clampPitch = (pitch) => Math.max(-1.45, Math.min(1.45, pitch));

/**
 * Mouse and keyboard handling while the editor or tag inspector is open.
 * Controls follow Blender: scroll dolly, MMB orbit, Shift+MMB pan, RMB look,
 * G grab / click confirm / Esc cancel, R rotate, [ ] scale, X delete,
 * 1-5 tools, Ctrl+Z undo.
 *
 * Each handler returns true when it consumed the event.
 */
export function createEditorInput({ editorTools, scene, engineRef, toGeo, toLocal, groundHeight, patchTerrain, setEditorMsg }) {
  const { editor, fly, flyForward, lookAtPivot, pickPoint, updateHover, clearSelBox } = editorTools;
  const refreshSelection = () => editorTools.selectionBox?.update();
  const placeAt = (rec, x, z) => rec.group.position.set(x, groundHeight(x, z) + (rec.entry.yOffset || 0), z);
  const removeAssetEntry = (entry) => {
    const assets = engineRef.current.edits.assets || [];
    const index = assets.indexOf(entry);
    if (index >= 0) assets.splice(index, 1);
  };

  /** A click while an asset is grabbed confirms the move. */
  const onClick = () => {
    if (editor.mode !== "editor" || !fly.grab) return false;
    const { rec, orig } = fly.grab;
    const g = toGeo(rec.group.position.x, rec.group.position.z);
    rec.entry.lat = g.lat;
    rec.entry.lon = g.lon;
    editor.undo.push({ type: "move", rec, orig });
    fly.grab = null;
    setEditorMsg(`moved ${rec.entry.name} — 💾 Save to persist`);
    return true;
  };

  const undo = () => {
    const u = editor.undo.pop();
    if (!u) return setEditorMsg("nothing to undo");
    if (u.type === "asset") {
      const rec = editor.placed.pop();
      if (rec) {
        disposeSceneGroup(rec.group, scene);
        removeAssetEntry(rec.entry);
      }
      editor.selected = null;
      clearSelBox();
      setEditorMsg("undid asset placement");
    } else if (u.type === "hide") {
      const hidden = engineRef.current.edits.hidden || [];
      const index = hidden.indexOf(u.id);
      if (index >= 0) hidden.splice(index, 1);
      setEditorMsg(`undid hide of ${u.id}`);
    } else if (u.type === "move") {
      const p = toLocal(u.orig.lat, u.orig.lon);
      u.rec.entry.lat = u.orig.lat;
      u.rec.entry.lon = u.orig.lon;
      placeAt(u.rec, p.x, p.z);
      refreshSelection();
      setEditorMsg("undid move");
    } else if (u.type === "terrain") {
      (engineRef.current.edits.terrain || []).pop();
      patchTerrain(u.x, u.z, u.r, u.prevH);
      setEditorMsg("undid terrain edit");
    }
  };

  /** Editor-mode key presses (non-repeat keydown only). */
  const onKeyDown = (e) => {
    if (editor.mode !== "editor") return;
    const api = engineRef.current.editorApi;
    const radius = editor.tool?.radius || 12;
    if (e.code === "Digit1") api.setTool(null);
    if (e.code === "Digit2") api.setTool({ type: "flatten", radius });
    if (e.code === "Digit3") api.setTool({ type: "raise", radius });
    if (e.code === "Digit4") api.setTool({ type: "lower", radius });
    if (e.code === "Digit5") api.setTool({ type: "hide" });
    if (e.code === "KeyG" && editor.selected !== null && !fly.grab) {
      const rec = editor.placed[editor.selected];
      if (rec) {
        fly.grab = { rec, orig: { lat: rec.entry.lat, lon: rec.entry.lon } };
        setEditorMsg(`moving ${rec.entry.name} — move mouse, click to confirm, Esc to cancel`);
      }
    } else if (e.code === "Escape" && fly.grab) {
      const { rec, orig } = fly.grab;
      const p = toLocal(orig.lat, orig.lon);
      placeAt(rec, p.x, p.z);
      refreshSelection();
      fly.grab = null;
      setEditorMsg("move cancelled");
    } else if (e.code === "Escape") {
      api.setTool(null);
      clearSelBox();
      editor.selected = null;
    }
    if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      undo();
    }

    const rec = editor.selected !== null ? editor.placed[editor.selected] : null;
    if (!rec) return;
    if (e.code === "KeyR") { rec.entry.rotY = rec.group.rotation.y += Math.PI / 12; refreshSelection(); }
    if (e.code === "BracketLeft") { rec.group.scale.setScalar((rec.entry.scale = Math.max(0.1, (rec.entry.scale || 1) * 0.9))); refreshSelection(); }
    if (e.code === "BracketRight") { rec.group.scale.setScalar((rec.entry.scale = Math.min(50, (rec.entry.scale || 1) * 1.1))); refreshSelection(); }
    if (e.code === "KeyX") {
      disposeSceneGroup(rec.group, scene);
      editor.placed.splice(editor.selected, 1);
      removeAssetEntry(rec.entry);
      editor.selected = null;
      clearSelBox();
      setEditorMsg("asset deleted — 💾 Save to persist");
    }
  };

  const onMouseMove = (e) => {
    if (!editor.mode) return false;
    if (fly.orbit) {
      fly.heading += e.movementX * 0.006;
      fly.pitch = clampPitch(fly.pitch - e.movementY * 0.006);
      lookAtPivot();
    } else if (fly.pan) {
      const d = flyForward();
      const right = new THREE.Vector3(Math.cos(fly.heading), 0, Math.sin(fly.heading));
      const up = new THREE.Vector3().crossVectors(right, d).negate().normalize();
      const speed = Math.max(4, fly.y - groundHeight(fly.x, fly.z) + 6) * 0.0022;
      fly.x += (-e.movementX * right.x + e.movementY * up.x) * speed;
      fly.y += e.movementY * up.y * speed;
      fly.z += (-e.movementX * right.z + e.movementY * up.z) * speed;
    } else if (fly.rmb) {
      fly.heading += e.movementX * 0.0028;
      fly.pitch = clampPitch(fly.pitch - e.movementY * 0.0028);
    } else if (fly.grab) {
      // The grabbed asset follows the cursor across the ground.
      const hit = pickPoint(e);
      if (hit) {
        placeAt(fly.grab.rec, hit.point.x, hit.point.z);
        refreshSelection();
      }
    } else {
      updateHover(e);
    }
    return true;
  };

  const onMouseDown = (e) => {
    if (!editor.mode) return;
    if (e.button === 2) { fly.rmb = true; e.preventDefault(); }
    if (e.button !== 1) return;
    e.preventDefault();
    if (e.shiftKey) { fly.pan = true; return; }
    // Orbit pivot: whatever is under the cursor, else 30 m ahead.
    const hit = pickPoint(e);
    const d = flyForward();
    const pivot = hit ? hit.point : { x: fly.x + d.x * 30, y: fly.y + d.y * 30, z: fly.z + d.z * 30 };
    fly.orbit = {
      px: pivot.x, py: pivot.y, pz: pivot.z,
      dist: Math.max(2, Math.hypot(fly.x - pivot.x, fly.y - pivot.y, fly.z - pivot.z)),
    };
  };

  const onMouseUp = (e) => {
    if (e.button === 2) fly.rmb = false;
    if (e.button === 1) { fly.orbit = null; fly.pan = false; }
  };

  /** Dolly along the view; speed scales with height above ground. */
  const onWheel = (e) => {
    if (!editor.mode) return;
    e.preventDefault();
    const d = flyForward();
    const step = -Math.sign(e.deltaY) * Math.max(4, fly.y - groundHeight(fly.x, fly.z) + 6) * 0.22;
    fly.x += d.x * step;
    fly.y += d.y * step;
    fly.z += d.z * step;
    const minY = groundHeight(fly.x, fly.z) + 1.2;
    if (fly.y < minY) fly.y = minY;
  };

  const onContextMenu = (e) => {
    if (editor.mode) e.preventDefault();
  };

  return { onClick, onKeyDown, onMouseMove, onMouseDown, onMouseUp, onWheel, onContextMenu };
}
