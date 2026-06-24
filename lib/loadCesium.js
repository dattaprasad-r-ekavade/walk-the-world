import { getCesiumBaseUrl } from "./cesium";

let loadPromise = null;

function loadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.Cesium) resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () =>
          reject(new Error(`Failed to load ${src}`))
        );
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

// Load Cesium from CDN via <script> to avoid webpack bundling it, which breaks
// in production builds (octal escape errors in minified Cesium chunks).
export function loadCesium() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Cesium can only load in the browser"));
  }
  if (window.Cesium) return Promise.resolve(window.Cesium);

  if (!loadPromise) {
    const base = getCesiumBaseUrl();
    window.CESIUM_BASE_URL = base;

    loadPromise = (async () => {
      loadStylesheet(`${base}/Widgets/widgets.css`);
      await loadScript(`${base}/Cesium.js`);
      if (!window.Cesium) {
        throw new Error("Cesium.js loaded but window.Cesium is missing");
      }
      return window.Cesium;
    })();
  }

  return loadPromise;
}
