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

`resolveSpecToFile` in `packages/vite/hmr/server/deps-bundle.ts` maps a `/node_modules/...` spec to a file for the HMR deps bundle. It is used for boot-recording entries, vendor-seeded entries, the shim lookup for `/ns/m/node_modules/...` requests, and the bundle's fallback for bare imports esbuild cannot resolve.

Package roots already honor `exports` / `module` / `main`. An extensionless subpath (`/node_modules/<pkg>/<subpath>`) only goes through the on-disk lookup (`<subpath>.<platform>.js`, ..., `<subpath>/index.*`) and never reads the package's `exports` map:

- **Types-only stub at the subpath.** In the issue's `demo-plugin`, `exports` maps `./plugins/foo` to `./dist/esm/plugins/foo/index.js`, but the package also ships `plugins/foo/index.ts` with `export * from '../../dist/types/plugins/foo/index'`. The stub becomes the bundle entry and the whole deps-bundle build fails:
  ```
  [ns-deps-bundle] bundle build FAILED — falling back to per-module node_modules serving for this session. Set NS_DEPS_PER_MODULE=1 to silence. Error: Build failed with 1 error:
  node_modules/demo-plugin/plugins/foo/index.ts:1:14: ERROR: Could not resolve "../../dist/types/plugins/foo/index"
  ```
- **Shipped sources at the subpath.** `seroval-plugins@1.5.1` (a solid-js dependency) ships `web/index.ts` next to `"./web": { "import": "./dist/esm/production/web.mjs", ... }`. `/node_modules/seroval-plugins/web` resolves to the TypeScript source, not the file esbuild bundles for the bare `seroval-plugins/web` import, so the module can exist twice.
- **No file at the subpath.** `rxjs/operators`, `solid-js/web` and `css-tree/tokenizer` have no `<subpath>.*` or `<subpath>/index.*` file, so they do not resolve. A recorded entry is dropped, and the spec is served per-module even when the bundle already contains the declared file.

## What is the new behavior?

- For a spec without a script extension, `resolveSpecToFile` first tries the targets the package's `exports` map declares for `./<subpath>`: the exact key first, then `*` patterns, with the condition order already used for bare `export *` subpaths.
- Targets go through the existing `resolvePackageFileCandidates`, so platform suffixes (`.ios.js` / `.android.js`), index lookup and the package-directory containment check still apply. The first declared target that exists on disk wins.
- Only the nearest installed copy is read: `node_modules/<pkg>` under the project root if it exists, otherwise under the workspace root. A hoisted copy that declares the subpath does not shadow an app-local copy that does not, as in Node and esbuild.
- When that copy declares no usable target, the existing lookup runs unchanged: undeclared subpaths, `null` entries, fallback arrays, and declared targets missing on disk. Specs with a script extension (already-resolved file URLs), package roots and nested `node_modules` specs are not affected.
- The exports-target collection moves unchanged out of `resolvePackageSubpathEntry` into `collectPackageSubpathExportsTargets`. `resolvePackageSubpathEntry` behaves exactly as before.

Closes #{{ISSUE}}.

## How it was tested

- `npx nx run vite:test --testFiles=hmr/server/deps-bundle.spec.ts --skip-nx-cache`: 61 passed (53 existing, 8 new).
  - New behavior: exact and `*` pattern keys win over types-only stubs, platform-suffixed targets on iOS and Android, an `exports` map read from a package hoisted to the workspace root, and the shim served for the extensionless spec of a bundled `exports` target.
  - Unchanged behavior: undeclared subpaths and missing targets, `null` and fallback arrays, a spec with an extension resolved as written, and an app-local copy without a usable entry next to a hoisted copy that declares the subpath.
  - With the change to `deps-bundle.ts` reverted, the 4 new-behavior tests fail and the 4 unchanged-behavior tests pass.
- `npx nx run vite:test --skip-nx-cache`: 1932 passed, 5 failed (`main`: 1924 passed, the same 5 failed).
- `npx nx run core:test --skip-nx-cache`: 565 passed, 1 skipped. `npx nx run webpack5:test --skip-nx-cache`: 65 passed, 16 failed. Both are the same as on `main`.
- `npx nx run vite:lint --skip-nx-cache`: no new problems; the 3 errors in `configuration/base.ts` and `hmr/server/css-device-module.ts` are on `main` too.
- `core:build`, `vite:build`, `webpack5:build`, `workspace-plugin:test` and `npx nx format:check --base=main` pass.
- Resolution comparison on real dependency trees, iOS and Android: every non-pattern subpath key in the installed packages' `exports` maps that has no script, style or JSON extension was resolved with `main` and with this branch, and compared with esbuild's resolution of the bare specifier under the deps bundle's `conditions` / `mainFields` / `resolveExtensions`.
  - This repository's `node_modules`: 2122 resolutions, 1304 changed (1284 of them unresolved on `main`), 1298 of the changed ones equal esbuild's.
  - A NativeScript-Vue app as the project root, with this repository's packages hoisted to the workspace root: 2216 resolutions, 1342 changed, 1336 equal esbuild's. No subpath of a package the app has installed resolves to the hoisted copy, except `yargs/yargs`, which already does so on `main` through the on-disk lookup.
  - No resolution went from a file to nothing. The changed results that differ from esbuild's come from three specs that were unresolved on `main`: two `require`-only exports that esbuild does not resolve under the bundle's conditions (`@swc-node/register/register`, `baseline-browser-mapping/legacy`) and one `browser` vs `import` order difference (`jimp/fonts`).
- On a device, this branch was not run on its own. A combined build of this PR with the other fixes from the same set (Vite, webpack, core, nativescript-vue, tailwind) ran the probe app ({{PROBE_APP_URL}}) on a Samsung SM-X356B tablet (Android 16), with Vite and webpack, in hot reload and bundle mode. Every probe check that ran passed. Only the Vite hot-reload run uses the deps bundle, and the probe app checks styling, so on a device this change is covered for regressions only.

## Compatibility and risk

- Only the deps bundle of the Vite HMR dev server is affected. No API or configuration change.
- Recorded subpaths that resolved to nothing before (e.g. `rxjs/operators`) now become bundle entries and are served as shims from the bundle instead of per-module. If esbuild cannot bundle such an entry, the build fails and the session falls back to per-module serving, as for any failing entry today.
- Some subpaths switch from a CommonJS or root-compat file to the declared ESM target, e.g. `vue/jsx-runtime` from `jsx-runtime/index.js` to `jsx-runtime/index.mjs`. This matches what esbuild bundles for the bare import.
- Apps whose entries change rebuild their cached deps bundle once, because the cache key includes the entry keys.
- One extra `package.json` read per extensionless subpath resolution; shim results are already cached per spec.
- Unchanged and out of scope: the fixed condition priority (`module`, `import`, `browser`, `default`, `require`) and the lack of fallback-array support in `collectExportsMapTargets`, which the package-root and re-export paths share.

## Related

Sibling deps-bundle fixes, independent of this one:

- #{{PR:V5c}}: deps bundle, minified `export*from` re-exports
