"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EngineErrorBoundary } from "@/components/EngineErrorBoundary";
import { validCoordinates } from "@/lib/city-contract";
import { useGameStore } from "@/stores/game-store";

const StreetEngine = dynamic(() => import("@/components/StreetEngine"), {
  ssr: false,
});

function StreetContent() {
  const params = useSearchParams();
  const lastPosition = useGameStore((s) => s.lastPosition);
  // wait for client mount so the persisted store (localStorage) is hydrated —
  // otherwise SSR/client mismatch double-boots the engine at the wrong place
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const bench = params.get("bench") === "1";
  if (!mounted) return null;
  // priority: explicit URL coords → where you last were → Rome
  const hasUrlCoords = !!params.get("lat");
  let lat = hasUrlCoords ? parseFloat(params.get("lat")) : lastPosition?.lat ?? 41.8902;
  let lon = params.get("lon") ? parseFloat(params.get("lon")) : lastPosition?.lon ?? 12.4922;
  if (!validCoordinates(lat, lon)) { lat = 41.8902; lon = 12.4922; }
  // Resuming where you left off, rather than arriving somewhere new. Spawn
  // framing must not relocate the player in this case or the saved position
  // creeps a little further every session (lib/engine/street/spawn.js).
  const resumedPosition = !hasUrlCoords && !!lastPosition;

  if (bench && typeof window !== "undefined") {
    window.__BENCH_MODE = true;
  }

  return <StreetEngine lat0={lat} lon0={lon} resumedPosition={resumedPosition} />;
}

export default function StreetPage() {
  return (
    <EngineErrorBoundary label="Street engine crashed">
      <StreetContent />
    </EngineErrorBoundary>
  );
}
