# SEC1 dependency audit follow-up — 31 October 2026

The audit was refreshed against the current `main` lockfile after the 30 Oct
zero-finding report.

| Command | Result |
| --- | --- |
| `npm audit --json` | 19 moderate, 0 high, 0 critical |
| `npm audit --omit=dev --json` | 0 findings |
| `npm audit fix --dry-run --json` | 0 packages changed; all 19 findings remain |

All reported vulnerabilities are in development tools. The two advisory chains
are:

- `eslint@9.39.5` and its ESLint plugins resolve `minimatch@3.1.5`; the current
  `eslint-plugin-import`, `eslint-plugin-jsx-a11y`, and `eslint-plugin-react`
  releases still declare `minimatch@^3.1.2`.
- `@gltf-transform/cli@4.5.1` uses `@donmccurdy/caporal@0.0.10`, which resolves
  the root-overridden `glob@10.5.0` and `minimatch@9.0.9`.

The audit database reports `minimatch <11.0.1` and `glob <=14.0.1` as
affected. `typescript-eslint@8.72.1` already resolves `minimatch@10.2.6`; it is
not one of the vulnerable copies. The [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
and [glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) are both
moderate.

The dry-run's available fixes require major-version changes or downgrades; it
does not offer a semver-safe lockfile update. The current `@gltf-transform/cli`
release is still 4.5.1. The latest ESLint is 10.14.0, but the locked
`eslint-plugin-react@7.37.5` peer range only accepts ESLint through 9.x, so a
direct ESLint 10 bump would create an unsupported toolchain pairing. No
override, downgrade, or package change was made. Production dependencies remain
clear; the full-audit SEC1 gate remains open until upstream tool dependencies
have compatible fixes.
