<!--
We, the rest of the NativeScript community, thank you for your
contribution! 
To help the rest of the community review your change, please follow the instructions in the template.
-->

<!-- PULL REQUEST TEMPLATE -->
<!-- (Update "[ ]" to "[x]" to check a box) -->

## PR Checklist

- [x] The PR title follows our guidelines: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#commit-messages.
- [x] There is an issue for the bug/feature this PR is for. To avoid wasting your time, it's best to open a suggestion issue first and wait for approval before working on it.
- [x] You have signed the [CLA](http://www.nativescript.org/cla).
- [x] All existing tests are passing: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/DevelopmentWorkflow.md#running-unit-tests-application.
  - The only failures also fail on untouched `main`: 5 in `packages/vite/typescript-optional.spec.ts` (`The "paths[1]" argument must be of type string`) and 16 stale snapshots in `packages/webpack5/__tests__/configuration/*.spec.ts`.
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

Two HMR dev-server scanners find `export * from` with a pattern that must start a line and needs whitespace around `*` and `from`:

- `collectDepsModuleExportInfo` (`packages/vite/hmr/server/deps-bundle.ts`) builds the export list of a deps-bundle shim served at `/ns/m/node_modules/...`.
- `scanModuleExportSurface` (`packages/vite/hmr/server/websocket-served-module-helpers.ts`) collects the star sources that `expandStarExports` follows.

Minified dists write the statement without spaces, usually mid-line:

```js
export*from"./a.js";function f(){}export*from"./b.js";export const own=f;
```

Neither scanner sees these stars:

- The deps shim for this module exports only `own`.
- When `expandStarExports` walks this module as a star target, it collects only `own`. If the target has no direct exports, the importer's star becomes a bare `import "<url>"`.

An app import of a name that comes from `./a.js` or `./b.js` then fails to link (`does not provide an export named '…'`).

Because of the line-start anchor, a second star on the same line is also missed: `export * from "a"; export * from "b";` loses `b`.

## What is the new behavior?

Both scanners use:

```js
/(?:^|[;}])[ \t]*export\s*\*\s*from\s*["']([^"']+)["']/gm
```

- Whitespace around `*` and `from` is optional, so `export*from"./x"` and `export * from './x'` both match.
- The statement must start a line or follow `;` or `}`, which is where a top-level statement can start once comments are blanked. An identifier ending in `export` (`reexport*from"…"`), a member access (`foo.export * from …`) or a string that begins with `export` does not match.
- Every star on a line is found. Trailing comments are still tolerated.
- `collectDepsModuleExportInfo` now runs the star scan on `maskJsComments(code)`, as `scanModuleExportSurface` already does. Without it, the new anchor would follow stars mentioned in comments, such as `// see a; export * from './x'`. The other scans in that function are unchanged.

`export * as ns from` does not match this pattern and is still handled by the existing `export * as` scans.

Closes #{{ISSUE}}.

## How it was tested

New spec cases:

- `deps-bundle.spec.ts` › `collectDepsModuleExportInfo`: "follows minified export*from stars at line starts and after ; or }" and "ignores export*from look-alikes in identifiers, strings and comments".
- `websocket-star-export-expansion.spec.ts` › `expandStarExports — transitive star re-export chains`: "follows minified export*from stars in walked targets at line starts and after ; or }" and "ignores export*from look-alikes in identifiers, strings and comments of walked targets".
- The "follows" fixtures mix `export*from"…"`, `export*from'…'`, a spaced star after `;` on the same line, and an indented minified star on the next line.
- With the two source files at `main`, 3 of the 4 cases fail. The expansion look-alike case also passes on `main`; it guards behaviour that must not change.

Suites, each run with `--skip-nx-cache`:

| Command | This branch | `main` (6bb01eab6) |
| --- | --- | --- |
| `npx nx run vite:test` | 1928 passed, 5 failed | 1924 passed, 5 failed |
| `npx nx run core:test` | 565 passed, 1 skipped | 565 passed, 1 skipped |
| `npx nx run webpack5:test` | 65 passed, 16 failed | 65 passed, 16 failed |
| `npx nx run workspace-plugin:test` | passed | passed |
| `npx nx run core:lint` | 0 errors, 22 warnings | 0 errors, 22 warnings |
| `npx nx run vite:lint` | 3 errors, none in files this PR touches | the same 3 errors |
| `npx nx run core:build`, `vite:build`, `webpack5:build` | pass | pass |

`npx prettier --check` on the four changed files passes.

On a device: this branch was not run on a device by itself. It was part of one combined build of this PR and the other PRs in this series, which ran the probe app ({{PROBE_APP_URL}}) on a Samsung SM-X356B tablet (Android 16, API 36) with Vite and with webpack, each in hot-reload and bundle mode; every probe check that was run passed. Only the Vite hot-reload run executes this code, and the probe app does not specifically exercise minified star re-exports, so that run is a regression check. The spec cases above cover the fix.

## Compatibility and risk

- Spaced stars at the start of a line match as before. The new pattern only adds matches, with one exception: in the deps-bundle scan, stars inside comments are no longer followed. That includes an `export * from` line inside a multi-line `/* */` block, which the old pattern followed by mistake.
- Minified packages whose stars were dropped now get their full export list. In the deps bundle, if such a star's target does not resolve, the module keeps per-module serving, as a spaced star already does, instead of getting a shim with names missing.
- Known gap: a string or template literal that contains `;export*from'x'` or `}export*from'x'` still matches (for example `"a;export*from'x'"`), as does a template-literal line that starts with `export * from`, which the old pattern also matched. Ruling these out needs a string-aware lexer.
- Cost: one extra `maskJsComments` pass per file in `collectDepsModuleExportInfo`. It returns early when the file has no `//` or `/*`, and shims are cached per spec.
- HMR dev server only; production builds do not run these scanners. No API or config changes.

Not changed here (same class of bug, possible follow-ups):

- `export*as ns from"./x"`: the `export * as` scans in both files still require whitespace.
- In the importing module itself, `expandStarExports` still rewrites a star only when it is spaced and alone on its line.
- `collectDepsModuleExportInfo` treats a minified `.js` file as CommonJS when no line starts with `import` or `export` (for example `var a=1;export*from"./b"`).

## Related

- #{{PR:V5a}}: another deps-bundle fix, independent of this one.
- #11543 made `.mjs` files count as ESM in `collectDepsModuleExportInfo`; it did not change the star scan.
