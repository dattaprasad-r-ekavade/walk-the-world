const DATABASE = "wtw-terrain-grid-cache";
const STORE = "grids";
const FORMAT = "terrarium-grid-v1";
const MAX_ENTRIES = 192;
const TTL_MS = 30 * 864e5;

let opening;

function openCache() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!opening) {
    opening = new Promise((resolve) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("accessedAt", "accessedAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    });
  }
  return opening;
}

export function terrainGridCacheKey(sourceHash, size) {
  if (!/^[0-9a-f]{64}$/u.test(sourceHash || "") || !Number.isInteger(size) || size < 2 || size > 257) return null;
  return `${FORMAT}:${size}:${sourceHash}`;
}

export async function hashTerrainImage(blob, cryptoApi = globalThis.crypto) {
  if (!blob || typeof blob.arrayBuffer !== "function" || typeof cryptoApi?.subtle?.digest !== "function") return null;
  try {
    const digest = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", await blob.arrayBuffer()));
    return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function validGrid(heights, size) {
  if (!(heights instanceof Float32Array) || heights.length !== size * size) return false;
  for (let index = 0; index < heights.length; index++) {
    if (!Number.isFinite(heights[index])) return false;
  }
  return true;
}

export async function readTerrainGridCache(sourceHash, size) {
  const key = terrainGridCacheKey(sourceHash, size);
  if (!key) return null;
  try {
    const db = await openCache();
    if (!db) return null;
    return await new Promise((resolve) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.get(key);
      let result = null;
      request.onsuccess = () => {
        const record = request.result;
        if (record?.format !== FORMAT || record.sourceHash !== sourceHash || record.size !== size ||
            !Number.isFinite(record.accessedAt) ||
            !validGrid(record.heights, size) || Date.now() - record.accessedAt > TTL_MS) {
          if (record) store.delete(key);
          return;
        }
        record.accessedAt = Date.now();
        store.put(record);
        result = new Float32Array(record.heights);
      };
      request.onerror = () => { result = null; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function writeTerrainGridCache(sourceHash, size, heights) {
  const key = terrainGridCacheKey(sourceHash, size);
  if (!key || !validGrid(heights, size)) return false;
  try {
    const db = await openCache();
    if (!db) return false;
    return await new Promise((resolve) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      store.put({
        key,
        format: FORMAT,
        sourceHash,
        size,
        heights: new Float32Array(heights),
        accessedAt: Date.now(),
      });
      const cursorRequest = store.index("accessedAt").openCursor(null, "prev");
      let count = 0;
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        if (++count > MAX_ENTRIES) store.delete(cursor.primaryKey);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = transaction.onabort = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/** Resolve a terrain grid by the exact PNG bytes, falling back to decode on a cache miss. */
export async function resolveTerrainGrid(blob, size, decode, {
  cryptoApi = globalThis.crypto,
  readGrid = readTerrainGridCache,
  writeGrid = writeTerrainGridCache,
} = {}) {
  if (typeof decode !== "function") throw new TypeError("Terrain grid decoder is required");
  const sourceHash = await hashTerrainImage(blob, cryptoApi);
  const cached = sourceHash ? await readGrid(sourceHash, size) : null;
  if (validGrid(cached, size)) return { heights: new Float32Array(cached), sourceHash, cacheHit: true };

  const heights = await decode(blob);
  if (!validGrid(heights, size)) throw new TypeError("Decoded terrain grid is invalid");
  if (sourceHash) {
    try { Promise.resolve(writeGrid(sourceHash, size, heights)).catch(() => {}); } catch { /* best-effort cache */ }
  }
  return { heights, sourceHash, cacheHit: false };
}
