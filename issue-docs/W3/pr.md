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
  The only failures also fail on an untouched `main`: 16 webpack5 snapshot tests in `__tests__/configuration/*.spec.ts` that contain another machine's absolute paths and a stale `FixSourceMapUrlPlugin` entry, and 5 tests in `packages/vite/typescript-optional.spec.ts`.
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

`packages/webpack5/src/configuration/vue.ts` still configures vue-loader 15 (Vue 2), while `@nativescript/webpack` itself depends on `vue-loader` `^17.4.2` (vue-loader 17 since #10759 and #10772):

- **HMR patch.** With HMR on (`ns run`, `ns debug`), `patchVueLoaderForHMR()` rewrites `vue-loader/lib/index.js` to force `isServer = false`. vue-loader 16+ has no `lib/` folder, so every Vue 3 HMR build logs:

  ```
  [@nativescript/webpack] Error: 
   Failed to patch VueLoader - HMR may not work properly!
  ```

  The file is resolved from `@nativescript/webpack`'s own location, so if some vue-loader 15 is resolvable from there, that copy is rewritten even though the project uses 17.
- **stylePostLoader path.** The `vue-css-loader` use in the `css` and `scss` rules loads `vue-loader/lib/loaders/stylePostLoader.js`, which only vue-loader 15 has. vue-loader 17 ships `vue-loader/dist/stylePostLoader.js`.
- **vue-loader options.** The `vue-loader` options always get `compiler: require('nativescript-vue-template-compiler')` (the Vue 2 template compiler, or `undefined` when it is not installed) and never `isServerBuild`. vue-loader 17 computes `isServerBuild ?? target === 'node'`, so with only this config it emits `ssrRender` and turns hot reload off.

Vue 3 apps build only because nativescript-vue 3's `nativescript.webpack.js` replaces both stylePostLoader paths and sets `isServerBuild: false`. The HMR patch runs in `@nativescript/webpack`'s own Vue config, before nativescript-vue's plugin, so that plugin cannot prevent the error.

## What is the new behavior?

`vue.ts` chooses the configuration by the vue-loader major version. It reads the version with `getDependencyVersion('vue-loader')`, which resolves `vue-loader/package.json` from the project root. When the project cannot resolve vue-loader (for example pnpm without hoisting), it falls back to the vue-loader that `@nativescript/webpack` depends on.

- **vue-loader 16+:**
  - `vue-css-loader` in the `css` and `scss` rules uses `vue-loader/dist/stylePostLoader.js`.
  - The `vue-loader` options get `isServerBuild: false` and no `compiler`.
  - `patchVueLoaderForHMR()` is not called: no error, and nothing in `node_modules` is rewritten.
- **vue-loader 15:** unchanged (`lib/loaders/stylePostLoader.js`, `compiler: nativescript-vue-template-compiler`, source patch with HMR).
- **nativescript-vue 2 with only vue-loader 16+ resolvable:** vue-loader 16+ cannot compile Vue 2, so these projects keep the vue-loader 15 configuration above, as today. They now also log:

  ```
  [@nativescript/webpack] Error: 
   nativescript-vue 2.9.3 needs vue-loader 15, but vue-loader 17.4.2 was found.
  Install vue-loader 15 and configure it in webpack.config.js as described in
  https://github.com/NativeScript/NativeScript/issues/11009
  ```

  The message links #11009 because installing vue-loader 15 is not enough on its own: with npm, vue-loader 17 can stay nested under `@nativescript/webpack/node_modules`, which `resolveLoader` searches before the project's `node_modules`, so `webpack.config.js` must also point the loader and `VueLoaderPlugin` at vue-loader 15, as shown there.
- Rule names (`vue`, `css`, `scss`), use names (`vue-loader`, `vue-css-loader`) and the `VueLoaderPlugin` plugin name are unchanged, so nativescript-vue's plugin still finds and overrides them.
- The comment above the HMR patch now says it is only for vue-loader 15, and prettier added a trailing comma to one line in `patchVueLoaderForHMR()`.

Closes #{{ISSUE}}.

## How was this tested?

New tests in `packages/webpack5/__tests__/configuration/vue.spec.ts` (11; the file now has 13). The spec now mocks the vue-loader and nativescript-vue versions instead of depending on what the monorepo root installs (vue-loader 15.9.8):

- vue-loader 15 in the project: lib stylePostLoader, Vue 2 compiler, HMR patch.
- vue-loader 17 in the project: dist stylePostLoader, options exactly `{ isServerBuild: false }`, no HMR patch and no "Failed to patch VueLoader" log.
- nativescript-vue 2 with only vue-loader 17: the vue-loader 15 configuration is kept and the message above is logged once.
- No error logged for nativescript-vue 2 + vue-loader 15, or for nativescript-vue 3 + vue-loader 17.
- Fallback to `@nativescript/webpack`'s own vue-loader when the project has none.

Logged messages go through the shared `console.warn` spy in `packages/webpack5/scripts/jest.mockWarn.ts`, so any unexpected warning fails a test. With `vue.ts` from `main`, 6 of the 11 fail: the three vue-loader 17 tests, the fallback and both nativescript-vue 2 tests. The other 5 check behaviour that does not change.

Because the versions are mocked, the two existing snapshot tests (`for ios`, `for android`) now show the vue-loader 17 configuration: per platform, the two stylePostLoader paths and `compiler: undefined` becoming `isServerBuild: false` (3 lines each). Only those lines were edited; both tests still fail with the same machine-path diff as on `main`.

Suites, each run with `--skip-nx-cache`, against untouched `main` (6bb01eab6):

| Command | This branch | `main` |
| --- | --- | --- |
| `npx nx run webpack5:test --skip-nx-cache` | 92 tests: 76 passed, 16 failed | 81 tests: 65 passed, 16 failed |
| `npx nx run core:test --skip-nx-cache` | 565 passed, 1 skipped | 565 passed, 1 skipped |
| `npx nx run vite:test --skip-nx-cache` | 1924 passed, 5 failed | 1924 passed, 5 failed |

The 16 webpack5 failures are the same snapshot tests on both, and the 5 vite failures the same `typescript-optional.spec.ts` tests. `webpack5:build`, `core:build`, `vite:build` and `workspace-plugin:test` pass, and `npx nx format:check --base=main` is clean. `webpack5:lint` reports "Nothing to lint" on `main`, so the changed files were checked with `npx eslint --no-ignore`: the only finding is the existing `prefer-const` on the untouched `for (let platform of platforms)` loop in the spec, which `main` also has.

Config generated with the built package and `hmr: true`:

- In a NativeScript-Vue 3 app (nativescript-vue 3.1.2, vue-loader 17.4.2), through `resolveChainableConfig()`, which also applies nativescript-vue's plugin: `main` logs "Failed to patch VueLoader"; this branch does not. Both end with the same css/scss loaders and the same effective `vue-loader` options (`isServerBuild: false, compilerOptions: {}`).
- With nativescript-vue 2.9.3 and vue-loader 15.9.8, this branch gives the same configuration as `main` (lib path, `compiler`, patch attempted). With nativescript-vue 2.9.3 and only vue-loader 17.4.2, it gives that same configuration plus the new message.

On a device: this branch was not run on a device by itself. It was part of one combined build of all the changes I am proposing to NativeScript, nativescript-vue and NativeScript/tailwind, which ran the probe app at {{PROBE_APP_URL}} on a Samsung SM-X356B tablet (Android 16) with Vite and with webpack, each with hot reload and as a bundle. Every probe check that was run passed, including scoped styles, `:deep`, `:slotted` and hot edits of scoped rules with webpack, and the webpack HMR log had no "Failed to patch VueLoader" line. Since nativescript-vue's plugin sets the same loaders on top, that run shows the Vue 3 webpack app still builds, styles and hot-reloads. The Vue 2 paths were not run on a device.

## Compatibility and risk

- **Vue 3 (nativescript-vue 3):** after nativescript-vue's plugin, the final config is the same, except that `compiler` is no longer set. It was `undefined`, or the Vue 2 compiler when `nativescript-vue-template-compiler` was still installed, which is the wrong compiler for vue-loader 17. The patch attempt and its error are gone.
- **Vue 2 with vue-loader 15 in the project**, including the setup in #11009: identical configuration and output.
- **Vue 2 without its own vue-loader 15:** already broken (#11009). The configuration and the existing log lines are unchanged; the only addition is the message pointing to #11009.
- **Detection reads the project's vue-loader, not the `resolveLoader` order.** With npm, when the project has vue-loader 15, the vue-loader 17 of `@nativescript/webpack` is nested under `@nativescript/webpack/node_modules`, which `resolveLoader` searches first. Following that order would detect 17 for those Vue 2 apps and switch them away from the #11009 setup.
- **Not changed here:** in that npm layout, the bare `vue-loader` loader and `VueLoaderPlugin` still resolve to the nested vue-loader 17 unless `webpack.config.js` overrides them, as in #11009. The ForkTsChecker `vue` extension still gets `compiler: 'nativescript-vue-template-compiler'`; nativescript-vue 3 disables that extension.
- **Other flavors:** unaffected; the new code only runs in the Vue config.
- **Tests:** "patches vue-loader for HMR" and "keeps the vue-loader 15 configuration" resolve the real `vue-loader/lib/index.js` (with `fs.writeFileSync` stubbed), so they rely on the root `vue-loader` 15 devDependency. If the root moves to vue-loader 17, they fail and need adjusting.

## Related

- #11009: the Vue 2 setup that the new message links to.
- #10759, #10772: moved `@nativescript/webpack` to vue-loader 17.
- This PR does not depend on any other change.
