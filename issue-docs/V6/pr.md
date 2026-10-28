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

Existing tests: the only failures also fail on untouched `main`: 5 tests in `packages/vite/typescript-optional.spec.ts` (`The "paths[1]" argument must be of type string`) and 16 `webpack5` configuration snapshot tests (the snapshots hard-code another machine's paths).

## What is the current behavior?
<!-- Please describe the current behavior that you are modifying, or link to a relevant issue. -->

In an HMR dev session, the boot recorder (`packages/vite/hmr/server/boot-recording.ts`) is meant to save the URLs a device requests during a cold boot to `node_modules/.ns-vite/boot-closure-<platform>-<flavor>.json`. The next dev-server start then builds the recorded deep `/ns/m/node_modules/...` files into `/ns/deps-bundle.mjs`. This does not work:

1. **No recording is ever saved.** The trace middleware in `hmr/server/websocket.ts` is added with `server.middlewares.use()`. `getHMRPlugins()` registers `ns-hmr-client` before the websocket plugin, and its middleware answers `/__ns_dev__/session` without calling `next()`. That request is the boot signal that opens a recording window, so the recorder never sees it and ignores every request after it. The comment above the middleware says it runs in front of every other middleware, but it runs after the middlewares of the plugins registered before it.
2. **A short boot replaces the full recording.** A closed window with at least `minEntries` (5) URLs replaces the previous recording. A boot that fails early, for example on an error in a page, records only a few URLs. The next deps bundle then loses the deep `node_modules` files, and the following boot fetches them one module at a time again.
3. **One bad recorded file costs the whole bundle.** When a deps-bundle build fails, `createDepsBundleService` gives up on the bundle for the session. Because of (1), recorded entries have never reached that build. Once they do, a recorded file esbuild cannot build (for example an exports-map subpath that resolves on disk to a types-only `index.ts` stub) also drops the bundle the vendor collection alone would give.

## What is the new behavior?
<!-- Describe the changes. -->

- **`websocket.ts`:** the trace middleware is inserted at the front of the connect stack with `server.middlewares.stack.unshift({ route: '', handle: bootTraceMiddleware })`, the same item `use(fn)` pushes. Its body is unchanged: it only observes and always calls `next()`. It now sees `/__ns_dev__/session` and every request after it.
- **`boot-recording.ts`:** a closed window is merged into the previous recording instead of replacing it: the window's URLs first, then the older URLs it did not request, de-duplicated and capped at `maxEntries` (5000). Windows below `minEntries` are still discarded. A fresh dev-server start loads the saved file and merges new boots into it.
- **`deps-bundle.ts`:** when a build that includes recorded entries fails, the service logs a warning and builds once more without the recording, from the vendor collection alone (the entry set `main` builds today, since no recording exists there):
  ```
  [ns-deps-bundle] bundle build with the boot recording FAILED — retrying without it. Delete node_modules/.ns-vite/boot-closure-*.json if this repeats on every start. Error: ...
  ```
  There is no retry when the recording adds no bundle entries. If the second build fails too, the existing fallback to per-module serving applies.
- The file-header comments of `boot-recording.ts` and `deps-bundle.ts` and the `getRecordedPaths()` JSDoc now describe the merge and the retry.

Closes #{{ISSUE}}.

<!-- If this PR contains a breaking change, please describe the impact and migration path for existing applications below. -->

<!-- 
BREAKING CHANGES:


[Describe the impact of the changes here.]

Migration steps:
[Provide a migration path for existing applications.]
-->

### How it was tested

New and changed specs in `packages/vite/hmr/server/`:

- `websocket-boot-recording.spec.ts` (new): starts a real Vite dev server with `getHMRPlugins({ platform: 'ios', flavor: 'typescript' })`, so `ns-hmr-client` comes first as in an app, and serves it over loopback HTTP. It requests `/__ns_dev__/session`, 5 app modules through `/ns/m`, then `/__ns_dev__/session` again, and asserts that `boot-closure-ios-typescript.json` holds exactly those 5 URLs. On `main` no file is written.
- `boot-recording.spec.ts`:
  - New: a 6-URL boot after a 40-URL recording gives the new URLs first, then the earlier ones, de-duplicated.
  - New: the merge is capped at `maxEntries`, dropping the oldest URLs.
  - New: a window below `minEntries` leaves the recording unchanged.
  - New: a new window merges into the recording a previous run saved, and the merged list is written back.
  - Changed: "a new boot signal closes and persists the previous window first" now expects the merged list.
- `deps-bundle-recording-fallback.spec.ts` (new):
  - The build with a recorded entry fails: the service returns the vendor-only bundle, `hasFailed()` is false, and one warning names the boot-closure file.
  - Every build fails: one retry (2 `esbuild.build` calls), then the existing per-module fallback warning.
  - The recording has no bundle entries (an app path and `@nativescript/core`): no retry.
  - These make `esbuild.build` reject through a `vi.mock` passthrough. With esbuild 0.27.4, which this repo's lockfile pins, a failed `metafile: true` build throws an uncaught error instead of rejecting (evanw/esbuild#4420, fixed in 0.27.5), which would crash the test worker.

With the source changes reverted, 7 of these 9 new or changed tests fail. The `minEntries` test and the no-retry test pass either way; they guard behaviour that must not change.

The retry was also checked by hand with esbuild 0.27.7 and a real failing build: a recording holding `/ns/m/node_modules/<pkg>/plugins/foo`, where `exports` maps `./plugins/foo` to `dist/esm/foo/index.js` and the package also ships a types-only `plugins/foo/index.ts`. The first build fails with `Could not resolve "../../dist/types/foo/index"`, and the service returns the vendor-only bundle. On `main` the same recording sends the session to per-module serving.

Commands, each with `--skip-nx-cache`:

| Command | This branch | `main` |
| --- | --- | --- |
| `npx nx run vite:test` | 1932 passed, 5 failed | 1924 passed, 5 failed |
| `npx nx run core:test` | 565 passed, 1 skipped | same |
| `npx nx run webpack5:test` | 65 passed, 16 failed | same |
| `npx nx run workspace-plugin:test` | passed | passed |
| `npx nx run vite:lint` | 3 errors, none in touched files | same 3 errors (`configuration/base.ts`, `hmr/server/css-device-module.ts`) |
| `npx nx run core:build`, `vite:build`, `webpack5:build` | passed | passed |

`npx nx format:check --base=main` is clean.

On a device: a build that combines this PR with the other PRs in this series ran the probe app ({{PROBE_APP_URL}}) on a Samsung SM-X356B tablet (Android 16, API 36), with Vite and with webpack, each under hot reload and as a bundle build. Every probe check that was run passed. The probe checks CSS behaviour and does not inspect the boot recording, and this branch was not run on a device on its own, so the recorder and the retry are covered only by the specs and the manual check above.

### Compatibility and risk

- Only the Vite HMR dev server changes. No public API, option, environment variable or file format changes. `BOOT_RECORDING_VERSION` is unchanged, so existing recordings still load. `@nativescript/webpack` has no boot recorder or deps bundle.
- In practice this turns boot recording on. From the second dev-server start, recorded deep `/ns/m/node_modules/...` files are deps-bundle entries and evaluate when the bundle evaluates at boot. If a build with them fails, the retry gives the app the same vendor-only bundle it gets on `main`.
- Two cases the retry does not cover:
  - **esbuild 0.27.4 exactly.** A failed `metafile: true` build throws instead of rejecting, so the dev server exits and neither the retry nor the per-module fallback runs. This already happens on `main` for any failed deps-bundle build; a recording makes one more likely. Raising the `esbuild` floor to `^0.27.5` would be a separate change.
  - **A recorded file with a bare Node builtin import** (`import { inspect } from 'util'`, with no `util` package installed). The build succeeds, but the bundle keeps `util` as a bare external, which the device runtime cannot resolve (it falls through to a file lookup under the app folder), so the bundle does not link. The same gap exists today for vendor-seeded package roots; the Vite docs ask for such Node-only packages to be kept out of `dependencies`.
- Recordings no longer shrink. A URL stays until the 5000-entry cap pushes it out (URLs that recent boots did not request go first) or the file is deleted. Recorded files that no longer resolve are skipped. A file that still resolves but is no longer imported keeps evaluating at boot, as vendor-seeded package roots already do. A recorded file that breaks the build triggers the retry and its warning on every start until the file is deleted.
- To recover: delete `node_modules/.ns-vite/boot-closure-<platform>-<flavor>.json`, or set `NS_DEPS_PER_MODULE=1` to turn the deps bundle off. `NS_VITE_HMR_DISABLE_BOOT_RECORDING=1` stops new recordings, but the deps bundle still reads an existing file.
- The trace now also sees requests that earlier plugins answer, such as `/__ns_dev__/client` and `/@nativescript/vendor.mjs`. Both were already in the prefetchable list, and the deps bundle only reads `/ns/m/node_modules/` entries.
- `stack.unshift` uses connect's `stack` array. It is typed in Vite's `Connect.Server`, but Vite itself only adds middlewares with `use()`. It also puts the trace ahead of Vite's own early middlewares (invalid-request, CORS and host checks). The trace only observes and records only 2xx responses, so requests Vite rejects are never recorded (a rejected session request still opens a window). If you prefer, the same effect is possible with a small plugin registered before `ns-hmr-client`, or by having the session route signal the recorder.

### Related

- Recommended after #{{PR:V5a}}: recorded boots reach more deps-bundle code paths, and #{{PR:V5a}} resolves exports-map subpaths (the types-only stub case above). This branch merges cleanly with it.
