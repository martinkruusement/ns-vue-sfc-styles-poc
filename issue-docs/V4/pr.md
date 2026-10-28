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
  The only failures also fail on an untouched `main`: 5 tests in `packages/vite/typescript-optional.spec.ts` (`The "paths[1]" argument must be of type string`) and 16 webpack5 snapshot tests that contain another machine's absolute paths.
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

In an HMR dev session, `@nativescript/vite` saves the built deps bundle as `node_modules/.ns-vite/deps-bundle-<platform>-<key>.mjs` and reuses it on the next dev-server start when the key matches. The key (`computeDepsBundleCacheKey` in `packages/vite/hmr/server/deps-bundle.ts`) covers the installed dependencies only through the app root's lockfile, by mtime and size.

A dependency patch changes a package's installed files without changing its version. In these setups it also leaves the lockfile stamp unchanged:

- **patch-package**: `patches/*.patch` are applied in `postinstall`. The lockfile has no record of them.
- **bun `patchedDependencies`**: `bun.lock` records a patch by its path, not by a content hash, so an edited patch leaves it unchanged, even after the reinstall that applies the edit.
- **Monorepos** (pnpm, bun, npm or yarn workspaces): the lockfile and the patches (`patches/` or a `patchedDependencies` declaration) are in the workspace root. The lockfile lookup only checks the app root, so the stamp is `none` there.

The next start then loads the bundle built from the unpatched (or previously patched) sources. The device runs the old dependency code with no warning; an export the patch adds is `undefined`. The workarounds are deleting `node_modules/.ns-vite` or setting `NS_DEPS_BUNDLE_NO_DISK_CACHE=1`.

A single-project pnpm app is not affected: the reinstall that applies a changed patch rewrites `pnpm-lock.yaml`, which records the patch hash.

## What is the new behavior?

The cache key gets a `patches` field, computed by the new exported `patchedDependenciesFingerprint(projectRoot, workspaceRoot)`. It stamps each patch file by path, mtime and size, and never reads patch contents. It covers:

- every file named in `package.json#patchedDependencies` and `pnpm.patchedDependencies`, merged, with `patchedDependencies` winning for the same package;
- every `*.patch` file directly in `patches/`, the default directory of patch-package, pnpm and bun. This also covers pnpm 10 patches declared in `pnpm-workspace.yaml` when they are in `patches/`. `readCorePatchesSignature` already scans `patches/` this way for the `@nativescript/core` patches in the core bundle cache key;
- the app root and, in a monorepo, the workspace root (counted once when both are the same directory).

Adding, editing or removing a patch now changes the key, so the next start rebuilds the deps bundle. A declared patch whose file is missing is stamped as `missing`. Read, parse and stat errors give a stable value instead of throwing, and an unreadable `package.json` does not skip the `patches/` scan. Without patches the value is `none`, which is also what an omitted `patches` input keys as.

Closes #{{ISSUE}}.

## How was this tested?

New tests in `packages/vite/hmr/server/deps-bundle.spec.ts` (12):

- `computeDepsBundleCacheKey`: the key changes when `patches` changes; an omitted `patches` keys the same as `none`.
- `patchedDependenciesFingerprint`:
  - `none` without patches, and with a missing or invalid `package.json`;
  - a declared patch is stamped, and the value changes on an edit that changes the size and on one that only changes the mtime;
  - `missing` for a declared patch whose file does not exist;
  - `pnpm.patchedDependencies` is merged;
  - patch-package patches are stamped and other files in `patches/` are ignored, also when `package.json` is missing or invalid;
  - the workspace root is covered, and not counted twice when it is the app root;
  - no throw on malformed manifests or on a `patches` file in place of the directory.
- `generateDepsBundle`, end to end: one case with a patch-package patch in the app root, one with a declared patch in the workspace root. Each rewrites the installed file and the patch, then checks that the next build contains the new code.

Without the `deps-bundle.ts` change, 11 of the 12 fail, and both end-to-end cases get the stale cached bundle. The one that passes checks that an omitted `patches` keys like `none`.

Suites, each run with `--skip-nx-cache`, compared with untouched `main` (6bb01eab6):

| Command | This branch | `main` |
| --- | --- | --- |
| `npx nx run vite:test --skip-nx-cache` | 1936 passed, 5 failed | 1924 passed, 5 failed |
| `npx nx run core:test --skip-nx-cache` | 565 passed, 1 skipped | 565 passed, 1 skipped |
| `npx nx run webpack5:test --skip-nx-cache` | 65 passed, 16 failed | 65 passed, 16 failed |
| `npx nx run vite:lint --skip-nx-cache` | 3 errors | the same 3 errors |

The 3 lint errors are in files this PR does not touch (`configuration/base.ts` `no-fallthrough` ×2, `hmr/server/css-device-module.ts` `no-irregular-whitespace`). `core:build`, `vite:build`, `webpack5:build` and `workspace-plugin:test` pass, and `npx prettier --check` on the two changed files is clean.

On a device: this branch was not run on a device by itself. It was part of one combined build of all the changes I am proposing to NativeScript, nativescript-vue and NativeScript/tailwind, which ran the probe app at {{PROBE_APP_URL}} on a Samsung SM-X356B tablet (Android 16) with Vite and with webpack, each with hot reload and as a bundle. Every probe check that was run passed. That run did not edit a dependency patch, so it only shows that the new key does not disturb a normal Vite HMR session. The stale-cache case is covered by the two `generateDepsBundle` tests above.

## Compatibility and risk

- Existing disk caches are rebuilt once after upgrading, because the key has a new field. A `@nativescript/vite` version bump already does the same.
- `computeDepsBundleCacheKey` gets an optional `patches` input. Existing callers are unaffected.
- The extra work only happens when a deps bundle is generated with the disk cache enabled: per root, one `package.json` read, one `readdir` of `patches/` and one `stat` per patch file.
- Every `*.patch` in `patches/` counts, including patches of packages the deps bundle does not contain (such as `@nativescript/core`, which has its own cache key). Editing one causes an extra deps-bundle rebuild.
- Like the lockfile stamp, it relies on mtime and size: a same-size edit within one mtime tick on a filesystem with coarse timestamps is not detected.
- Not covered: a custom `patch-package --patch-dir`, patches in subdirectories of `patches/`, and pnpm 10 patches declared in `pnpm-workspace.yaml` that live outside `patches/`. `NS_DEPS_BUNDLE_NO_DISK_CACHE=1` still works for those.
- Out of scope: the lockfile lookup still checks only the app root, so in a monorepo neither a reinstall that changes dependency versions nor an edited Yarn `patch:` protocol patch (in `.yarn/patches/`) changes the key. That is a separate change.
- `@nativescript/webpack` needs no counterpart: it does not configure a persistent cache, so every dev start rebuilds from `node_modules`.

## Related

- None. This PR does not depend on any other change.
