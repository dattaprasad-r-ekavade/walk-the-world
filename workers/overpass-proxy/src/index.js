const MAX_QUERY_BYTES = 32 * 1024;

function json(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function getUpstreamUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

async function readLimitedBody(request) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_QUERY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/interpreter") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    if (!env.OVERPASS_ENDPOINT_TOKEN) return json("Proxy authentication is not configured", 503);
    if (!env.UPSTREAM_URL) return json("Overpass upstream is not configured", 503);

    const suppliedToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/iu, "") || "";
    if (!constantTimeEqual(suppliedToken, env.OVERPASS_ENDPOINT_TOKEN)) return json("Unauthorized", 401);

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      return json("Expected an Overpass form-encoded query", 415);
    }
    let body;
    try {
      body = await readLimitedBody(request);
    } catch {
      return json("Could not read query body", 400);
    }
    if (!body) return json("Query body exceeds the proxy limit", 413);
    if (body.byteLength === 0) return json("Query body is empty", 400);

    const upstreamUrl = getUpstreamUrl(env.UPSTREAM_URL);
    if (!upstreamUrl) return json("Overpass upstream must be a valid HTTPS URL", 503);

    const headers = new Headers({
      "Content-Type": contentType,
      "User-Agent": request.headers.get("User-Agent") || "WalkTheWorld/0.4",
      Accept: "application/json",
    });
    if (env.UPSTREAM_AUTHORIZATION) headers.set("Authorization", env.UPSTREAM_AUTHORIZATION);

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body,
        cache: "no-store",
        redirect: "manual",
        signal: request.signal,
      });
    } catch {
      return json("Overpass upstream is unavailable", 502);
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      return json("Unexpected redirect from Overpass upstream", 502);
    }

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.delete("Set-Cookie");
    const responseBody = [204, 205, 304].includes(upstream.status) ? null : upstream.body;
    return new Response(responseBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
