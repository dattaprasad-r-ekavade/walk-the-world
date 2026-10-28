# A4 visual and performance acceptance

Compared the existing D1 rehearsal with the A4 production build on the same
host, using visible Chrome at 1280×720, each demo place's saved coordinate,
heading, hour, and clear weather. Each after capture waited for all nine cells
to settle, then sampled 300 animation frames.

| City | Before p95 | After p95 | Change | Before capture | After capture |
|---|---:|---:|---:|---|---|
| Pune | 14.0 ms | 14.0 ms | 0.0% | `rehearsal-2026-10-28-d1-d3-local-production/pune.jpg` | `pune.jpg` |
| Edinburgh | 20.8 ms | 20.8 ms | 0.0% | `rehearsal-2026-10-28-d1-d3-local-production/edinburgh.jpg` | `edinburgh.jpg` |
| Tokyo | 27.9 ms | 20.8 ms | −25.4% | `rehearsal-2026-10-28-d1-d3-local-production/tokyo.jpg` | `tokyo.jpg` |
| New York | 20.8 ms | 20.9 ms | +0.5% | `rehearsal-2026-10-28-d1-d3-local-production/new-york.jpg` | `new-york.jpg` |

All four places became ready and settled with nine nearby cells. Spawn framing,
heading and moved-distance matched the D1 report for each place. The after-run
browser logged one local `/api/assets` 501 per city because this machine has no
R2 server credentials; the street-cell payloads were fetched from the public
R2 endpoint by the Node-side Playwright route, which added the CORS header only
for this local rehearsal. No asset response or street geometry was changed.

`npm test` passed 170 tests and `npm run build` succeeded on this code. The
build used `NEXT_PUBLIC_R2_PUBLIC_BASE=https://myjyotishai.in` for local data
loading; the value was not written to `.env.local`.
