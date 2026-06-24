"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { PLACES } from "@/lib/geo";

const Globe = dynamic(() => import("@/components/Globe"), { ssr: false });

export default function Home() {
  const controllerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [hasTiles, setHasTiles] = useState(false);

  const fly = (lat, lon) => controllerRef.current?.flyToStreet(lat, lon);
  const home = () => controllerRef.current?.homeView();

  return (
    <main>
      <Globe
        controllerRef={controllerRef}
        onReady={({ hasTiles }) => {
          setReady(true);
          setHasTiles(hasTiles);
        }}
      />

      <div className="hud">
        <h1>🌍 Walk the World</h1>
        <p>
          Click anywhere on Earth to fly down · drag to look · WASD to walk ·
          scroll to zoom
        </p>
      </div>

      <div className="places">
        <button className="ghost" onClick={home}>
          🌐 Globe
        </button>
        {PLACES.map((p) => (
          <button key={p.name} onClick={() => fly(p.lat, p.lon)}>
            {p.name}
          </button>
        ))}
      </div>

      {ready && !hasTiles && (
        <div className="token-warn">
          Running on the basic globe. Add a <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
          or <code>NEXT_PUBLIC_CESIUM_ION_TOKEN</code> (or split{" "}
          <code>_1</code>/<code>_2</code> parts) in <code>.env.local</code> to
          stream Google Photorealistic 3D Tiles (real 3D cities).
        </div>
      )}
    </main>
  );
}
