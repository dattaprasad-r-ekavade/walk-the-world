"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { EngineErrorBoundary } from "@/components/EngineErrorBoundary";
import { validCoordinates } from "@/lib/city-contract";
import { demoPresetNear } from "@/lib/geo";
import { prefetchSpawnTerrain } from "@/lib/engine/street/terrain-prefetch";
import { useGameStore } from "@/stores/game-store";
import { useMounted } from "@/hooks/use-mounted";

const StreetEngine = dynamic(() => import("@/components/StreetEngine"), {
  ssr: false,
});

// priority: explicit URL coords → where you last were → Rome
function spawnCoordinates(params, lastPosition) {
  const hasUrlCoords = !!params.get("lat");
  let lat = hasUrlCoords ? parseFloat(params.get("lat")) : lastPosition?.lat ?? 41.8902;
  let lon = params.get("lon") ? parseFloat(params.get("lon")) : lastPosition?.lon ?? 12.4922;
  if (!validCoordinates(lat, lon)) { lat = 41.8902; lon = 12.4922; }
  return { lat, lon, hasUrlCoords };
}

function StreetContent() {
  const params = useSearchParams();
  const lastPosition = useGameStore((s) => s.lastPosition);
  // wait for client mount so the persisted store (localStorage) is hydrated —
  // otherwise SSR/client mismatch double-boots the engine at the wrong place
  const mounted = useMounted();
  // The spawn tile's elevation gates the first walkable frame. Request it now,
  // while the engine chunk is still downloading; the engine reuses the request.
  useEffect(() => {
    if (!mounted) return;
    const { lat, lon } = spawnCoordinates(params, useGameStore.getState().lastPosition);
    prefetchSpawnTerrain(lat, lon);
  }, [mounted, params]);
  const bench = params.get("bench") === "1";
  if (!mounted) return null;
  const { lat, lon, hasUrlCoords } = spawnCoordinates(params, lastPosition);
  // Resuming where you left off, rather than arriving somewhere new. Spawn
  // framing must not relocate the player in this case or the saved position
  // creeps a little further every session (lib/engine/street/spawn.js).
  const resumedPosition = !hasUrlCoords && !!lastPosition;

  return (
    <StreetEngine
      lat0={lat}
      lon0={lon}
      resumedPosition={resumedPosition}
      demoPreset={params.get("demo") === "1" ? demoPresetNear(lat, lon) : null}
      bench={bench}
    />
  );
}

export default function StreetPage() {
  return (
    <EngineErrorBoundary label="Street engine crashed">
      <StreetContent />
    </EngineErrorBoundary>
  );
}
