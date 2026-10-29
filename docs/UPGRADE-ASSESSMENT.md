# Major upgrade assessment

Source and upstream migration guides checked on 2026-10-29. Assessment only;
none of these majors are applied on `loop/deps`. Effort: S = hours, M = 1-2 days,
L = several days, including verification. Estimates assume one developer.

## Recommended order

| Order | Upgrade | Effort | Reason |
| --- | --- | --- | --- |
| 1 | dotenv 16 -> 18 | S | Isolated to two maintenance scripts. |
| 2 | Vitest 4 -> 5 | M | Upgrade the Node test environment before framework work. |
| 3a | React/React DOM 18 -> 19 | M | Pair with Next 15 for this App Router app. |
| 3b | Next 14 -> 15 | M | Migrate route APIs and verify caching together. |
| 4 | ESLint 8 -> 9, flat config | M | Establish a working lint command before Next 16. |
| 5 | Next 15 -> 16 | M | Separate bundler and runtime changes from the first hop. |
| 6 | ESLint 9 -> 10 | M | Wait for compatible Next ESLint config/parser/plugins. |
| 7 | Tailwind 3 -> 4 | L | Broad visual regression surface; keep separate from React. |

## Next 14 -> 15

- `params` becomes asynchronous. Await it in `app/api/city/[key]/route.js`
  (GET and PUT), `app/api/edits/[key]/route.js` (GET and PUT),
  `app/api/overture/[key]/route.js`, and `app/api/assets/[name]/route.js`.
  Update plain-object contexts in `tests/city-route.test.js` to Promise contexts.
- No `cookies()`, `headers()`, `draftMode()`, or server page `searchParams` props
  were found. `useSearchParams()` in `app/street/page.js` and
  `new URL(req.url).searchParams` remain synchronous APIs.
- Move `experimental.serverComponentsExternalPackages: ['duckdb']` in
  `next.config.mjs` to top-level `serverExternalPackages`.
- Server `fetch` and GET handlers lose default caching. Overpass already uses
  `cache: 'no-store'` in `lib/overpassServer.js`; R2 read-through caching and
  explicit HTTP Cache-Control headers remain separate mechanisms. This build
  lists all API routes as dynamic; no implicit server-fetch cache dependency
  was found. Verify city/edit/asset freshness after migration; browser fetches
  are outside Next's Data Cache.
- Recheck globe-to-street navigation: page segments are no longer reused by
  default in the client router cache. Install matching React 19 dependencies.
Reference: [Next 15 migration](https://nextjs.org/docs/app/guides/upgrading/version-15).

## React 18 -> 19

- Upgrade `react` and `react-dom` together with compatible Next/query/store peers;
  Next supplies the required modern JSX transform.
- `ref` is a regular prop; `element.ref` is deprecated. `forwardRef` still works
  in React 19 and needs no mandatory rewrite. No `forwardRef`, `element.ref`,
  string refs, function `propTypes`/`defaultProps`, or legacy ReactDOM calls were
  found in app/components/stores. Current DOM refs use `useRef` objects.
- Function `propTypes` checks and function `defaultProps` are removed; there are
  no direct call sites to migrate. Strict Mode and Suspense behavior changes
  still warrant mount/unmount checks for `Globe`, `StreetEngine`, and their
  listeners/render loops. Verify `EngineErrorBoundary` fallback behavior too.
Reference: [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide).

## ESLint 8 -> 9 -> 10

- The loop/build branch adds a legacy `.eslintrc.json` (next/core-web-vitals)
  so `next lint` runs non-interactively. ESLint 9 defaults to `eslint.config.*`;
  convert it to a flat config with explicit JS/JSX/MJS scope, browser/Node/test
  globals, Next rules and ignores for `.next`, generated assets and dependencies,
  and replace the script with an ESLint CLI invocation.
- Upgrade `eslint-config-next` with Next, checking its peer range. ESLint 9
  removes old rule-context APIs, so parser/plugin compatibility matters even
  though this repo defines no custom lint rules.
- ESLint 10 removes legacy config support and changes config lookup to start
  from each linted file. Validate root config coverage. It requires Node
  20.19+, 22.13+, or 24+; this session's Node 22.23.3 meets that requirement.
References: [ESLint 9](https://eslint.org/docs/latest/use/migrate-to-9.0.0),
[ESLint 10](https://eslint.org/docs/latest/use/migrate-to-10.0.0).

## Next 15 -> 16

- Synchronous request-API compatibility is removed; finish all `params` changes.
- Requires Node >=20.9 and uses React 19.2 features. Local Node 22.23.3 qualifies;
  verify deployment versions and DuckDB native loading separately.
- Turbopack becomes the default production bundler for `next build`. Verify
  Three workers, local fonts, `@` aliases, prebuilt revision generation and
  DuckDB externalization. `dev:webpack` must explicitly use `next dev --webpack`;
  its current `next dev` command would otherwise switch bundlers.
- `next lint` is removed and builds stop running lint. Use the standalone CLI
  established above. No middleware, custom webpack config, or next/image usage
  was found requiring those additional migrations.
Reference: [Next 16 migration](https://nextjs.org/docs/app/guides/upgrading/version-16).

## Vitest 4 -> 5

- Requires Node >=22.12 (the Dockerfile and package.json engines now use Node 22) and Vite >=6.4;
  direct Vite 8 already satisfies the latter. Upgrade test/container runtimes.
- `clearMocks` now defaults true; audit shared mock histories in city/stream
  tests. Unawaited async assertions become failures; current rejects/resolves
  assertions are awaited, including saved rejection promises.
- Nested `vi.mock`/`vi.hoisted` now throw; current calls are top-level. `it.each`
  titles change formatting (`city-route`, `roof-geometry`); no snapshots found.
  The node-only `vitest.config.js` has no browser/projects/coverage migration.
Reference: [Vitest 5 migration](https://vitest.dev/guide/migration/).

## dotenv 16 -> 18

- Only `scripts/build-overture-index.mjs` and `scripts/enrich-r2-cells.mjs` call
  `config({ path: '.env.local' })`. Version 18 removes vault/preload support;
  no `.env.vault`, `DOTENV_KEY`, or `dotenv/config` usage was found.
- Injection messages move from stdout to stderr and tips disappear; use
  `quiet: true` if scripts require clean streams. Verify explicit-path loading
  and existing-environment precedence without running upload/index operations.
Reference: [dotenv changelog](https://github.com/motdotla/dotenv/blob/master/CHANGELOG.md).

## Tailwind 3 -> 4

- Replace `tailwindcss` in `postcss.config.js` with `@tailwindcss/postcss`;
  v4 handles prefixing, so remove its redundant autoprefixer entry.
- Replace the three `@tailwind` directives in `app/globals.css` with
  `@import 'tailwindcss'`. Explicitly load `../tailwind.config.js` using `@config`
  or migrate its colors/fonts/shadows/animations to CSS theme definitions;
  JavaScript configuration is no longer automatically discovered.
- Change `backdrop-blur-sm` in `lib/ui.js`/`GameShell.jsx` to `backdrop-blur-[4px]`,
  and review `outline-none`, `space-y-*`, hover behavior, border/preflight and
  transform changes across HUD/editor/mobile controls. Check custom utilities
  and `@apply bg-void`. Browser floor becomes Safari 16.4/Chrome 111/Firefox 128.
Reference: [Tailwind 4 upgrade guide](https://tailwindcss.com/docs/upgrade-guide).
