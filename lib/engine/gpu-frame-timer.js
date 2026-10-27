/**
 * Non-blocking WebGL2 GPU frame timer. Results are polled on later frames;
 * callers must treat them as diagnostics and never wait for a query result.
 */
export function createGpuFrameTimer(gl, { onSample = () => {}, maxPendingQueries = 8 } = {}) {
  let extension = null;
  let unavailableReason = null;
  let disposed = false;
  let activeQuery = null;
  let pending = [];
  let disjointSamples = 0;
  let skippedForCapacity = 0;

  try {
    if (!gl || typeof gl.createQuery !== "function" || typeof gl.getQueryParameter !== "function") {
      unavailableReason = "WebGL2 query methods are unavailable.";
    } else {
      extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      if (!extension) unavailableReason = "EXT_disjoint_timer_query_webgl2 is unavailable.";
    }
  } catch (error) {
    unavailableReason = `GPU timer query setup failed: ${error?.message || error}`;
  }

  const supported = !!extension && !unavailableReason;

  const deleteQuery = (query) => {
    if (!query) return;
    try { gl.deleteQuery(query); } catch { /* context may already be lost */ }
  };

  const disable = (reason) => {
    unavailableReason ||= reason;
    if (activeQuery) {
      try { gl.endQuery(extension.TIME_ELAPSED_EXT); } catch { /* best effort */ }
      deleteQuery(activeQuery);
      activeQuery = null;
    }
    for (const entry of pending) deleteQuery(entry.query);
    pending = [];
    extension = null;
  };

  const poll = () => {
    if (!supported || disposed || pending.length === 0) return;
    try {
      if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
        disjointSamples += pending.length;
        for (const entry of pending) deleteQuery(entry.query);
        pending = [];
        return;
      }

      const remaining = [];
      for (const entry of pending) {
        if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) {
          remaining.push(entry);
          continue;
        }
        const nanoseconds = Number(gl.getQueryParameter(entry.query, gl.QUERY_RESULT));
        if (Number.isFinite(nanoseconds) && nanoseconds >= 0) onSample(nanoseconds / 1_000_000);
        deleteQuery(entry.query);
      }
      pending = remaining;
    } catch (error) {
      disable(`GPU timer query polling failed: ${error?.message || error}`);
    }
  };

  return {
    get supported() { return supported && !unavailableReason; },
    beginFrame() {
      if (!this.supported || disposed) return false;
      poll();
      if (pending.length >= Math.max(1, maxPendingQueries)) {
        skippedForCapacity += 1;
        return false;
      }
      try {
        activeQuery = gl.createQuery();
        if (!activeQuery) throw new Error("createQuery returned no query object");
        gl.beginQuery(extension.TIME_ELAPSED_EXT, activeQuery);
        return true;
      } catch (error) {
        if (activeQuery) deleteQuery(activeQuery);
        activeQuery = null;
        disable(`GPU timer query start failed: ${error?.message || error}`);
        return false;
      }
    },
    endFrame() {
      if (!activeQuery || disposed || !extension) return false;
      try {
        gl.endQuery(extension.TIME_ELAPSED_EXT);
        pending.push({ query: activeQuery });
        activeQuery = null;
        return true;
      } catch (error) {
        disable(`GPU timer query end failed: ${error?.message || error}`);
        return false;
      }
    },
    poll,
    snapshot() {
      return {
        supported: this.supported,
        reason: unavailableReason,
        pendingQueries: pending.length,
        disjointSamples,
        skippedForCapacity,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (activeQuery) {
        if (extension) {
          try { gl.endQuery(extension.TIME_ELAPSED_EXT); } catch { /* best effort */ }
        }
        deleteQuery(activeQuery);
        activeQuery = null;
      }
      for (const entry of pending) deleteQuery(entry.query);
      pending = [];
    },
  };
}
