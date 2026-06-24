"use client";

import { useEffect, useRef } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";

// CesiumJS 3D globe. Renders the whole Earth, lets the user click anywhere (or
// use the city shortcuts) to fly down to street level, and walk around with
// WASD. When a Google Maps / Cesium ion token is configured it streams Google
// Photorealistic 3D Tiles (real textured 3D cities); otherwise it falls back to
// the bundled Natural Earth imagery so the app still runs with zero config.
export default function Globe({ controllerRef, onReady }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let viewer;
    let handler;
    let destroyed = false;
    const keys = {};
    let onKeyDown, onKeyUp, preRender;

    (async () => {
      if (typeof window !== "undefined") window.CESIUM_BASE_URL = "/cesium";
      const Cesium = await import("cesium");
      if (destroyed || !containerRef.current) return;

      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      const googleKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

      // Always-available base layer: bundled Natural Earth II (no token needed).
      const baseLayer = Cesium.ImageryLayer.fromProviderAsync(
        Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
        ),
        {}
      );

      viewer = new Cesium.Viewer(containerRef.current, {
        baseLayer,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
      });
      viewer.scene.globe.enableLighting = true;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
      viewer.cesiumWidget.creditContainer.style.display = "none";

      // If an ion token exists, upgrade to high-res world imagery + terrain.
      if (ionToken) {
        try {
          const world = Cesium.ImageryLayer.fromWorldImagery({});
          viewer.imageryLayers.add(world);
          viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
        } catch (e) {
          console.warn("[cesium] world imagery/terrain unavailable:", e?.message);
        }
      }

      // Real 3D cities via Google Photorealistic 3D Tiles (needs a token/key).
      let hasTiles = false;
      if (ionToken || googleKey) {
        try {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset(
            googleKey ? { key: googleKey } : undefined
          );
          viewer.scene.primitives.add(tileset);
          hasTiles = true;
        } catch (e) {
          console.warn("[cesium] Photorealistic 3D Tiles unavailable:", e?.message);
        }
      }

      // ---- Camera helpers ----
      const flyToStreet = (lat, lon) => {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 350),
          orientation: {
            heading: Cesium.Math.toRadians(20),
            pitch: Cesium.Math.toRadians(-30),
            roll: 0,
          },
          duration: 3,
        });
      };

      const homeView = () => {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(10, 25, 20000000),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-90),
            roll: 0,
          },
          duration: 2,
        });
      };
      homeView();

      // ---- Click anywhere to fly there ----
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click) => {
        const cartesian =
          viewer.scene.pickPosition(click.position) ||
          viewer.camera.pickEllipsoid(
            click.position,
            viewer.scene.globe.ellipsoid
          );
        if (!cartesian) return;
        const c = Cesium.Cartographic.fromCartesian(cartesian);
        flyToStreet(
          Cesium.Math.toDegrees(c.latitude),
          Cesium.Math.toDegrees(c.longitude)
        );
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // ---- WASD / QE keyboard "walk" ----
      onKeyDown = (e) => {
        keys[e.code] = true;
      };
      onKeyUp = (e) => {
        keys[e.code] = false;
      };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      preRender = () => {
        const cam = viewer.camera;
        const carto = Cesium.Cartographic.fromCartesian(cam.position);
        const height = carto ? carto.height : 1000;
        const speed = Math.max(1.5, Math.min(height * 0.04, 50000));
        if (keys.KeyW || keys.ArrowUp) cam.moveForward(speed);
        if (keys.KeyS || keys.ArrowDown) cam.moveBackward(speed);
        if (keys.KeyA || keys.ArrowLeft) cam.moveLeft(speed);
        if (keys.KeyD || keys.ArrowRight) cam.moveRight(speed);
        if (keys.Space || keys.KeyQ) cam.moveUp(speed);
        if (keys.ShiftLeft || keys.KeyE) cam.moveDown(speed);
      };
      viewer.scene.preRender.addEventListener(preRender);

      if (controllerRef) {
        controllerRef.current = { flyToStreet, homeView };
      }
      if (onReady) onReady({ hasTiles });
    })();

    return () => {
      destroyed = true;
      if (onKeyDown) window.removeEventListener("keydown", onKeyDown);
      if (onKeyUp) window.removeEventListener("keyup", onKeyUp);
      if (handler) handler.destroy();
      if (viewer && preRender) viewer.scene.preRender.removeEventListener(preRender);
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="cesium-container" />;
}
