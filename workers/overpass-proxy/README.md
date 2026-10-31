# Overpass proxy Worker

This Worker exposes one form-encoded `POST /api/interpreter` route for the
server-side city fetcher. It requires a bearer token, forwards only the query,
content type, user agent, and JSON accept header, disables caching, and can add
a separate upstream authorization header. It does not accept arbitrary URLs or
paths.

## Configure

1. Set `UPSTREAM_URL` in `wrangler.toml` to the HTTPS interpreter URL on the
   self-hosted Overpass origin. Protect that origin with its own authentication
   or network restrictions; the Worker token protects the public Worker route,
   not direct access to the origin.
2. From this directory, set the Worker token with `npx wrangler secret put
   OVERPASS_ENDPOINT_TOKEN`. Set the same value as the server-only
   `OVERPASS_ENDPOINT_TOKEN` in the app's deployment environment.
3. If the origin requires HTTP authorization, set
   `npx wrangler secret put UPSTREAM_AUTHORIZATION` to its `Authorization`
   header value. Keep the origin credential different from the Worker token.
4. Deploy with `npx wrangler deploy`. Set the app's server-only
   `OVERPASS_ENDPOINT` to the Worker URL ending in `/api/interpreter`.

The app sends the bearer token only to a configured custom endpoint; the
public fallback mirrors never receive it. Do not prefix the Worker with a
`NEXT_PUBLIC_` variable. Requests and responses are marked `no-store` because
POST query caching is not part of this proxy.

This directory prepares the proxy only. A VPS, Overpass database, protected
origin, Cloudflare account configuration, and live acceptance still need to be
provided separately.

References: [Cloudflare Worker fetch API](https://developers.cloudflare.com/workers/runtime-apis/fetch/),
[Worker environment variables and secrets](https://developers.cloudflare.com/workers/configuration/environment-variables/),
[Overpass installation guide](https://overpass-api.de/full_installation.html).
