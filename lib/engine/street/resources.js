// Dispose only resources no longer used by the remaining scene.
function collect(root) {
  const resources = new Set();
  root?.traverse?.(o => {
    if (o.geometry) resources.add(o.geometry);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      // Cached cross-cell materials are only disposed with the material cache.
      if (m.userData?.shared) continue;
      resources.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) resources.add(value);
    }
    if (o.skeleton) resources.add(o.skeleton);
  });
  return resources;
}
export function disposeSceneGroup(group, scene, sharedTextures = []) {
  if (!group) return;
  const owned = collect(group);
  group.removeFromParent?.();
  const retained = group === scene ? new Set() : collect(scene);
  for (const texture of sharedTextures) retained.add(texture);
  for (const resource of owned) if (!retained.has(resource)) resource.dispose?.();
  group.clear?.();
}
