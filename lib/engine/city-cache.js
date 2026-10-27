// IndexedDB keeps multi-MB JSON serialization off the render-critical storage path.
const TTL = 7 * 864e5;
let opening;
function openCache() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!opening) opening = new Promise(resolve => {
    const request = indexedDB.open("wtw-city-cache", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("cells", { keyPath: "key" }).createIndex("time", "time");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
  return opening;
}
export async function readCityCache(key) {
  try {
    const db = await openCache();
    if (!db) return null;
    return await new Promise(resolve => {
      const req = db.transaction("cells").objectStore("cells").get(key);
      req.onsuccess = () => resolve(req.result && Date.now() - req.result.time < TTL ? req.result.data : null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}
export async function writeCityCache(key, data) {
  try {
    const db = await openCache();
    if (!db) return;
    await new Promise(resolve => {
      const tx = db.transaction("cells", "readwrite");
      const store = tx.objectStore("cells");
      store.put({ key, time: Date.now(), data });
      let count = 0;
      const req = store.index("time").openKeyCursor(null, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (++count > 12) store.delete(cursor.primaryKey);
        cursor.continue();
      };
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  } catch { /* private mode or quota: memory cache still works */ }
}
