# A3 interior-mapping acceptance

Compared the settled A4 production captures with the A3 build on the same host,
using visible Chrome at 1280×720 and each demo place's exact saved position,
heading, hour, and clear weather. Each after capture waited for nine nearby
cells to settle, then sampled 300 animation frames. The shared room atlas was
present in every scene; it contains eight rooms with six faces each.

| City | Hour | Before p95 | After p95 | Change | Before capture | After capture |
|---|---:|---:|---:|---:|---|---|
| Pune | 17:00 | 14.0 ms | 14.0 ms | 0.0% | `rehearsal-2026-10-28-a4-after/pune.jpg` | `pune.jpg` |
| Edinburgh | 17:30 | 20.8 ms | 20.8 ms | 0.0% | `rehearsal-2026-10-28-a4-after/edinburgh.jpg` | `edinburgh.jpg` |
| Tokyo | 19:00 | 20.8 ms | 20.8 ms | 0.0% | `rehearsal-2026-10-28-a4-after/tokyo.jpg` | `tokyo.jpg` |
| New York | 18:00 | 20.9 ms | 20.8 ms | −0.5% | `rehearsal-2026-10-28-a4-after/new-york.jpg` | `new-york.jpg` |

All captures used identical player coordinates and headings before and after.
The interiors are visible in the Tokyo and New York dusk/night views; the Pune
and Edinburgh presets keep them unlit. All four scenes loaded the interior room
texture and settled with nine cells. No shader compilation errors occurred.

The browser reports one local `/api/assets` 501 per city because this machine
has no R2 server credentials. As with the A4 rehearsal, public city-cell
responses used a Node-side local-preview route that adds CORS without changing
the response body. `npm test` passed 173 tests and `npm run build` succeeded.
