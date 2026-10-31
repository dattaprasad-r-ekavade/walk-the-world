# SEC1 read-only Overture manifest check — 31 Oct 2026

## Result

The current Overture Buildings guide documents release `2026-10-21.0` at
`s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/*`
([official Buildings guide](https://docs.overturemaps.org/guides/buildings/)).
The repository's former `2026-06-17.0` default returned no Parquet files from
its S3 listing. The October release returned 512 files.

The new `--manifest-out <local-path>` mode completed the full DuckDB footer
scan in 1,968 seconds and wrote the exact manifest array payload locally. It
contains 512 unique rows; all filenames use the documented release path, every
row has four finite, ordered bounds, and no row failed validation. The manifest
is 130,066 bytes with SHA-256
`26e3da2ece0c0675f8f34d24ff806bd3b67bbe779b5c00adf4eb5a5696469325`.

The reviewed payload is available as the
[manifest JSON](sec1-overture-index-2026-10-31.json). The default release in
the index builder, manifest builder, and Overture API runtime now matches the
verified `2026-10-21.0` data.

## Scope and remaining gate

This run read public Overture S3 metadata and wrote the result to local
storage. It made no R2 request; `.env.local` has no R2 credentials. The normal
upload path remains unchanged. SEC1 stays open until the exact manifest is
separately authorized and uploaded to R2, the deployed `OVERTURE_RELEASE`
matches, and the live Overture API check passes.

The one-time `POST /api/overture-index` route is disabled in production (404).
In local development it requires the dedicated `OVERTURE_INDEX_SECRET` bearer
token and returns 503 when that secret is unset. The production route's
300-second cap is shorter than this scan, so release indexing uses the CLI.
Local production-route smokes confirmed 503 for the disabled state and 401 for
an invalid token before the production-disabled guard was added; the final
local production-route smoke returned 404. The auth tests cover the local
disabled and invalid-token responses. No valid token was sent, so indexing was
not triggered. The full suite passes (237 tests), the production build passes,
and focused lint is clean. The pre-existing post-FX test was corrected to wait
for the shader warmup before asserting that bloom is active.
