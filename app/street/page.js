"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EngineErrorBoundary } from "@/components/EngineErrorBoundary";
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
  const lat = params.get("lat") ? parseFloat(params.get("lat")) : lastPosition?.lat ?? 41.8902;
  const lon = params.get("lon") ? parseFloat(params.get("lon")) : lastPosition?.lon ?? 12.4922;

  if (bench && typeof window !== "undefined") {
    window.__BENCH_MODE = true;
  }

  return <StreetEngine lat0={lat} lon0={lon} />;
}

export default function StreetPage() {
  return (
    <EngineErrorBoundary label="Street engine crashed">
      <StreetContent />
    </EngineErrorBoundary>
  );
}
