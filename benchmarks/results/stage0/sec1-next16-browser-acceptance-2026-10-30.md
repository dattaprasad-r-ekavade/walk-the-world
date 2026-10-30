# SEC1 Next.js 16 browser acceptance check

Date: 30 October 2026

Tested source revision: `021f55b`

## Static checks

- `npm run build`: passed with Next.js 16.4.3.
- `npm test`: 38 files and 234 tests passed.
- `npm run lint`: 0 errors and 15 React Compiler warnings. The run was on
  `a575d24`; application source is unchanged at `021f55b`.
- `npm audit --json`: 0 findings.
- `npm audit --omit=dev --json`: 0 findings.

## Browser smoke

The local development app ran in Brave on port 3458. `reactStrictMode` is
explicitly enabled in `next.config.mjs`. In a private window, the visible
sequence was:

1. Load the home page and open the globe.
2. Select Pune from Fast Travel; the browser navigated client-side to
   `/street?lat=18.540913&lon=73.895553&demo=1`.
3. Use Globe view to return to `/`.

The app returned to the globe without a Next.js issue badge. The city scene did
not finish: the local UI remained at “Streaming city” / “Streaming nearby
streets”. The server logged a Pune city request returning 502 after 85 s and a
200 retry after 16.9 s; earlier centre and neighbour requests took 86 s. The
R2 server configuration and `NEXT_PUBLIC_R2_PUBLIC_BASE` were both absent, so
the city route could not write to R2 and no local public cache was available.
The normal Brave profile did show a hydration mismatch: an extension had added
`data-extension-*` attributes to `<html>` and `contenteditable="false"` to
`<body>`. That mismatch did not appear in the private-window run.

## Result and limits

This confirms the local production build, audit, tests and a React 19
globe/street route transition. It does not complete the full four-city street
run or validate live Overture/DuckDB behavior. The Overpass feed did not provide
a usable street scene during this pass, and the Overture query was not run
because it writes results to R2. SEC1 remains open.
