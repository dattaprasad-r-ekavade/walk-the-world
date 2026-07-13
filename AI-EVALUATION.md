# AI World Repair Evaluation

## Contract

World Repair audits structured map summaries. It may recommend reversible visual
review actions, but it may not invent businesses, landmarks, history, exact materials,
or unsafe geometry. Every output includes evidence, confidence, risk, and provenance.

The production path is a local deterministic inference system. It uses no paid
model or external AI API, and every recommendation is reproducible from the same
structured map summary.

## Evaluation set

Build a fixed 30-cell catalog containing:

- dense and sparse urban cells;
- Western and non-Western mapping patterns;
- relation-heavy water/building geometry;
- bridges with and without water context;
- high and low height/material tag coverage;
- rural, historic, commercial, residential, and coastal areas.

## Metrics

| Measure | Target |
|---|---:|
| Schema-valid outputs | 100% |
| Unsupported named facts | 0 |
| High-risk changes marked review-only | 100% |
| Reviewer acceptance | > 70% |
| Cached audit p95 | < 250 ms |
| Local audit p95 | < 250 ms |

Record rule-set version, summary hash, latency, confidence, review decision, and
rejection reason. The runtime scene must never depend on an external model call.
