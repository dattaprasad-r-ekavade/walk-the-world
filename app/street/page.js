"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { EngineErrorBoundary } from "@/components/EngineErrorBoundary";

const StreetEngine = dynamic(() => import("@/components/StreetEngine"), {
  ssr: false,
});

function StreetContent() {
  const params = useSearchParams();
  const lat = parseFloat(params.get("lat") ?? "41.8902");
  const lon = parseFloat(params.get("lon") ?? "12.4922");
  const bench = params.get("bench") === "1";

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
