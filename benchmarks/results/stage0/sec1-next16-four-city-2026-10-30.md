# SEC1: current-main four-city browser acceptance

30 October 2026; live deployment
[`walk-the-world-delta.vercel.app`](https://walk-the-world-delta.vercel.app),
visible Chrome 156.0.8078.79 at 1280×720. The rehearsal used the app's public
R2 cell base and did not write to R2.

## Result

All four demo cities completed the browser run. Each city's nine-cell
neighborhood was warm in R2; all nine browser city responses were HTTP 200. Each
street reached engine-ready, settled with nine resident cells and zero failed
cells, matched its preset heading, and reported no remaining console or page
errors after the rehearsal script's known-noise filter.

| City | Cells warm | Ready | Settled | Ready time | Heading | Frame p95 |
|---|---:|---|---|---:|---:|---:|
| Pune | 9/9 | yes | yes | 6,302 ms | 270° | 14.0 ms |
| Edinburgh | 9/9 | yes | yes | 4,847 ms | 349° | 14.0 ms |
| Tokyo | 9/9 | yes | yes | 4,845 ms | 317° | 14.1 ms |
| New York | 9/9 | yes | yes | 9,389 ms | 292° | 20.9 ms |

Screenshots: [Pune](../../../screenshots/demo-track/rehearsal-2026-10-30-sec1-next16/pune.jpg),
[Edinburgh](../../../screenshots/demo-track/rehearsal-2026-10-30-sec1-next16/edinburgh.jpg),
[Tokyo](../../../screenshots/demo-track/rehearsal-2026-10-30-sec1-next16/tokyo.jpg),
[New York](../../../screenshots/demo-track/rehearsal-2026-10-30-sec1-next16/new-york.jpg).

The live `/sw.js` revision was `21922f187c27ded6`, equal to the revision
computed from the current `main` commit `293eee6763c5` and the checked-in runtime
texture manifest. This ties the browser run to the current source build. The raw
JSON report is ignored at
`screenshots/demo-track/rehearsal-2026-10-30-sec1-next16/report.json`.

## Limits and remaining SEC1 work

The frame p95 values are a single host's 300-frame samples, not target-laptop or
cross-device performance acceptance. This run verifies the four-city data and
route path; it does not exercise the live DuckDB Overture query against S3. That
query writes results to R2 and remains a separate release-data check. SEC1 stays
open until that check is authorized and completed.

## Reproduce

```powershell
node scripts/rehearse-demo.mjs https://walk-the-world-delta.vercel.app --headed --frames=300 --ready-timeout-ms=90000 --settle-timeout-ms=30000 --out=screenshots/demo-track/rehearsal-2026-10-30-sec1-next16
```
