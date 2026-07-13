# Walk the World — Engineering Case Study

## The problem

“Walk anywhere on Earth” sounds like a camera problem. It is actually a data,
geometry, streaming, rendering, provenance, and interaction problem. The source data
is global but inconsistent, and browsers have strict CPU, GPU, memory, and network
limits.

## The first approach

The project began with CesiumJS for the globe and street-level movement. Cesium is
excellent at planetary travel, but the street experience needed tighter control over
geometry, collision, art direction, population, and frame cost.

## The engine rewrite

A purpose-built Three.js engine divides the world into cells, streams terrain and
open map data, constructs merged geometry in a worker, and writes successful city
responses through an R2 cache. The globe remains the travel layer; the custom engine
owns the street-level experience.

## What profiling changed

The largest wins came from reducing repeated work: minimap throttling, ref-driven HUD
updates, indexed ground-height lookup, instancing, worker geometry construction, and
progressive terrain-first rendering. The historical benchmark showed a large FPS gain,
but its load-time comparison mixed development and production modes; the new contract
requires identical production environments.

## AI without pretending

Incomplete maps should not be “fixed” through unconstrained generation. World Repair
first summarizes observable tags, then requests a strict evidence-bound audit. Results
carry confidence, risk, and provenance. The deterministic fallback uses the same UI
contract and is visibly labelled, so the demo never implies a model ran when it did not.

## Product lesson

Breadth was not the final bottleneck. Presentation was. The portfolio pass focuses on
one guided minute, three product pillars, a calm HUD, explicit loading states, and
verifiable claims so the underlying engineering becomes legible to a first-time visitor.

