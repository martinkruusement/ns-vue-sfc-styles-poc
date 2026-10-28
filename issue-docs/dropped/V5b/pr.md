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
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

Existing tests: the only failures also fail on untouched `main`. They are 5 cases in `packages/vite/typescript-optional.spec.ts` (`The "paths[1]" argument must be of type string`) and 16 snapshot cases in `packages/webpack5/__tests__/configuration/*.spec.ts`, whose snapshots contain machine-specific paths.

## What is the current behavior?

In an HMR dev session, `@nativescript/vite` by default serves the session's node_modules code from one ESM bundle, `/ns/deps-bundle.mjs`, and every `/ns/m/node_modules/...` shim imports it. The bundle keeps Node builtins external, and `createDepsImportRoutingPlugin` (`packages/vite/hmr/server/deps-bundle.ts`) leaves each specifier as the dependency wrote it. Take a dependency like this, with no npm package of that name installed:

```js
import 'util';
import { join } from 'path';
```

The bundle then contains `import "util";` and `import { join } from "path";`.

The device import map has builtin entries only for the `node:` form (`node:util` → `/ns/node/util`, from `getNodeBuiltinImportMapEntries`), and the native resolver only intercepts `node:` specifiers. So the bare specifier cannot resolve. The bundle fails to link, and every dependency it serves fails with it.

## What is the new behavior?

For static `import` and `export … from` statements (`args.kind === 'import-statement'`), the routing plugin now returns a bare name from `NODE_BUILTIN_SET` as an external `node:<name>`. The bundle contains `import "node:util";`, `import { join } from "node:path";`, `from "node:fs/promises"` and so on. The existing import-map entries route these to `/ns/node/<name>`.

Unchanged:

- Specifiers already written as `node:<name>` (no `node:node:` prefix).
- `require('tty')` (still `__require("tty")`) and dynamic `import('os')` (still `import("os")`).
- Installed npm packages named like a builtin (`events`, `buffer`, …). `createNodeBuiltinPolyfillEsbuildPlugin` runs before the routing plugin and still bundles them.

Closes #{{ISSUE}}.

## How it was tested

Two new cases in `packages/vite/hmr/server/deps-bundle.spec.ts` call `generateDepsBundle` for a fixture package that imports builtins in several forms. The forms are a bare side-effect import, a named import, the `fs/promises` subpath, a `zlib` re-export, `node:url`, dynamic `import('os')` and `require('tty')`. The fixture also has an installed `events` package.

- `routes bare Node builtin import statements through the node: form the device import map serves` fails without the change to `deps-bundle.ts` and passes with it.
- `keeps require() and import() of Node builtins, and installed builtin polyfills, as they were` passes before and after the change. It covers the cases that must stay as they are.

Suites, run with `--skip-nx-cache` and compared with untouched `main` (6bb01eab6):

| Command | This branch | `main` |
| --- | --- | --- |
| `npx nx run vite:test` | 1926 passed, 5 failed | 1924 passed, 5 failed |
| `npx nx run core:test` | 565 passed, 1 skipped | 565 passed, 1 skipped |
| `npx nx run webpack5:test` | 65 passed, 16 failed | 65 passed, 16 failed |

- `deps-bundle.spec.ts`: 55 passed.
- `workspace-plugin:test`, `core:build`, `vite:build` and `webpack5:build` pass.
- `vite:lint` reports the same 3 errors as `main`, all in files this PR does not touch (`configuration/base.ts`, `hmr/server/css-device-module.ts`).

On a device: this branch was not run on a device by itself. It was part of a combined build of all the fixes in this series, across NativeScript, nativescript-vue and tailwind. With that build, the probe app ({{PROBE_APP_URL}}) ran on a Samsung SM-X356B tablet (Android 16) with Vite and with webpack, in hot-reload and bundle modes, and every probe check that was run passed. Only the Vite hot-reload session uses the deps bundle, and the probe app does not specifically import a bare builtin, so the device run is only a regression check. The spec above is what tests the fix.

## Compatibility and risk

- Only the dev-session deps bundle changes. Production builds, the core bundle, the standalone vendor bundle and `NS_DEPS_PER_MODULE=1` per-module serving are not touched.
- The change covers static imports and re-exports of the bare names in `NODE_BUILTINS`, except `module`, which the vendor plugin still replaces with its shim before the routing plugin runs. These were external before and stay external; only the spelling changes. All 48 names in `NODE_BUILTINS` are in Node's `builtinModules`, so each one has a `node:<name>` import-map entry.
- `/ns/node/<name>` serves a stub with a default export that logs a warning, for every builtin except `url`. Side-effect and default imports now link. A named import, such as the `join` import above, still fails to link, as it already does when written as `node:path`.
- Installed builtin-named packages are still found by the polyfill plugin through `<name>/package.json`, so they stay bundled. The second test covers this.
- The deps-bundle disk cache key includes the `@nativescript/vite` version, so a bundle cached by an earlier release is rebuilt after an upgrade.
- `@nativescript/webpack` has no deps bundle and no runtime import map, so it needs no matching change.

## Related

- #{{PR:V5a}}: deps bundle, `exports`-map subpaths (independent)
- #{{PR:V5c}}: deps bundle, minified `export*from` re-exports (independent)
