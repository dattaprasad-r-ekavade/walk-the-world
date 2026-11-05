# Performance Contract

Performance claims must compare production builds with the same browser, fixture,
viewport, GPU mode, quality preset, cache state, and commit metadata.

## Required scenarios

| Scenario | Cache | Required measurements |
|---|---|---|
| Menu first load | cold | LCP, usable time, JS transfer, long tasks |
| Showcase street | warm | terrain, interactive, p50/p95 FPS, 1% low, draw calls |
| Unseen street | cold | first terrain, first building, streaming complete |
| Continuous walk | warm neighbors | frame spikes, memory growth, cell swaps |
| Mobile controls | warm | input delay, FPS, adaptive downgrade |

## Budgets

| Metric | Desktop mid-tier | Mobile low-tier |
|---|---:|---:|
| Menu usable | < 2 s | < 2.5 s |
| Warm street interactive | < 4 s | < 6 s |
| Sustained frame rate | 60 FPS target | 30 FPS minimum |
| p95 frame time | < 16.7 ms | < 33.3 ms |
| Cell-streaming main-thread stall | < 100 ms | < 150 ms |
| 15-minute memory trend | bounded | bounded |

`BENCHMARK-PERF.md` remains historical evidence; its development-versus-production
load figures must not be presented as a fair load-time improvement.

