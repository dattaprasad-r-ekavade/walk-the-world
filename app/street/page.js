"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const StreetEngine = dynamic(() => import("@/components/StreetEngine"), {
  ssr: false,
});

// /street?lat=..&lon=..  — the custom Three.js street-level engine.
export default function StreetPage() {
  const [coords, setCoords] = useState(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setCoords({
      lat: parseFloat(p.get("lat")) || 41.8902,
      lon: parseFloat(p.get("lon")) || 12.4922,
    });
  }, []);

  if (!coords) return null;
  return <StreetEngine lat0={coords.lat} lon0={coords.lon} />;
}
