### Issue Description

A runtime problem in `@nativescript/vite` HMR dev sessions (`ns run` / `ns debug` with HMR). Bundle builds (`--no-hmr`) are not affected.

After a dependency patch is added or edited, the next dev session still runs the dependency's old code. The HMR dev server caches the deps bundle as `node_modules/.ns-vite/deps-bundle-<platform>-<key>.mjs`, and its key (`computeDepsBundleCacheKey` in `packages/vite/hmr/server/deps-bundle.ts`) covers the installed dependencies only through the app root's lockfile, by mtime and size. A patch changes installed files without changing that stamp:

- **patch-package**: the lockfile has no record of `patches/*.patch`. Editing a package in node_modules and saving the change with `npx patch-package <pkg>`, or applying patches with `npx patch-package`, changes the installed files and leaves the lockfile as it was. (With npm, `npm install` rewrites `package-lock.json` each time, so a patch applied by the `postinstall` script happens to change the key.)
- **bun `patchedDependencies`**: `bun.lock` records a patch by its path, not by a content hash, so an edited patch leaves it unchanged, even after the reinstall that applies the edit.
- **Monorepos**: the lockfile and the patches (`patches/` or a `patchedDependencies` declaration) are in the workspace root, which the key never looks at.

There is no warning or error. The device runs the unpatched code: in the steps below, a line the patch adds never runs. Deleting `node_modules/.ns-vite` works around it. Setting `NS_DEPS_BUNDLE_NO_DISK_CACHE=1` also does, but only while it stays set: it skips the disk cache without replacing the stale file, so the next run without it loads the old bundle again.

Expected behavior: adding, editing or removing a dependency patch invalidates the deps-bundle disk cache, so the next dev session runs the patched code.

Related: #11408 fixed the same kind of stale cache for the core bundle (`core-bundle-*.mjs`) by adding `patches/@nativescript+core*.patch` to its key; the deps-bundle key has no such stamp.

I will open a PR with a fix right after this issue: the cache key also stamps the patch files.

### Reproduction

Setup: an app from `ns create repro --vue` (NativeScript CLI 9.1.1), switched to `@nativescript/vite` 8.0.21 in the project folder (`cd repro`):

```bash
npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
npm uninstall @nativescript/webpack && rm webpack.config.js
npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
```

then add `bundler: 'vite',` and `bundlerConfigPath: 'vite.config.mts',` to `nativescript.config.ts`. (`nativescript-vite init` does neither the last install nor the config change.)

Then add patch-package with `npm install -D patch-package` and `npm pkg set scripts.postinstall=patch-package`.

1. Run `NS_VITE_VERBOSE=1 ns run android`, let the app start, then stop it. The dev server prints `[ns-deps-bundle] built ...`, and `node_modules/.ns-vite/deps-bundle-android-<key>.mjs` now exists. Use the same command in every step: `NS_VITE_VERBOSE` is part of the cache key.
2. Add this line at the top of `node_modules/nativescript-vue/dist/index.js`, then run `npx patch-package nativescript-vue`:
   ```js
   console.log('nativescript-vue patched');
   ```
   Do not run `npm install` before step 3: npm rewrites `package-lock.json` on every install, which changes the cache key.
3. Run `NS_VITE_VERBOSE=1 ns run android` again. The dev server prints `[ns-deps-bundle] loaded from disk cache` with the same hash and key as step 1 (`ls node_modules/.ns-vite` shows the same `deps-bundle-android-<key>.mjs`). Neither the `ns run` output (`nativescript-vue patched`) nor `adb logcat` (`CONSOLE LOG: nativescript-vue patched`) shows the line.
4. Run `rm -rf node_modules/.ns-vite`, then `NS_VITE_VERBOSE=1 ns run android`. The dev server prints `[ns-deps-bundle] built ...` with a new hash (under the same file name, since the key has not changed), and the line is logged.

### Relevant log output (if applicable)

```shell
# NS_VITE_VERBOSE=1 in every step (it sets a define that is part of the key)
# step 1:
[ns-deps-bundle] built 37 modules (0 recorded + 3 vendor-seeded), 531kb in 76ms (hash d67d5f34)
# step 3, after the patch (package-lock.json unchanged):
[ns-deps-bundle] loaded from disk cache: 37 modules, 531kb in 4ms (hash d67d5f34, key 85cbb30912c0)
# step 4, after rm -rf node_modules/.ns-vite:
[ns-deps-bundle] built 37 modules (0 recorded + 3 vendor-seeded), 531kb in 73ms (hash 60761586)
# (numbers from a stock `ns create --vue` app. In step 3, Vite's own dependency optimizer also
# prints "Re-optimizing dependencies because lockfile has changed": its lockfile hash includes
# the mtime of the patches/ folder. That is about node_modules/.vite, not the deps bundle.)
```

### Environment

The relevant versions:

- NativeScript CLI 9.1.1
- `@nativescript/core` 9.1.3, `@nativescript/android` 9.1.1
- `@nativescript/vite` 8.0.21, vite 8.3.5 (the same cache key code is on `main` at 6bb01eab6)
- `nativescript-vue` 3.1.2, `@nativescript/tailwind` 4.1.0
- patch-package 8.0.1, npm 11.12.1, bun 1.3.12 (for the bun case), Node 25.9.0, macOS 26.5
- Samsung SM-X356B tablet, Android 16 (API 36)

The cache key code does not depend on the platform, so iOS should behave the same (not tested).

Output of `echo 'y' | npx nativescript-envinfo` in the reproduction app. It does not detect the NativeScript CLI 9.1.1, which is installed with bun, or the Android SDK, which has no `cmdline-tools`; the SDK has platforms android-35 and android-36 and build-tools 35.0.0 to 36.1.0.

<!-- COPY START -->
```yaml
OS: macOS 26.5
CPU: (10) arm64 Apple M4
Shell: /bin/zsh
node: 25.9.0
npm: 11.12.1
nativescript: Not Found

# android
java: 17.0.18
ndk: Not Found
apis: Not Found
build_tools: Not Found
system_images: Not Found

# ios
xcode: /undefined
cocoapods: Not Found
python: Not Found
python3: 3.9.6
ruby: 2.6.10
platforms: Not Found
```

### Dependencies

```json
"dependencies": {
  "@nativescript/core": "~9.1.0",
  "@valor/nativescript-websockets": "^2.0.2",
  "nativescript-vue": "^3.1.2"
},
"devDependencies": {
  "@nativescript/android": "9.1.1",
  "@nativescript/tailwind": "^4.0.0",
  "@nativescript/types": "~9.0.0",
  "@nativescript/vite": "^8.0.21",
  "@types/node": "^20.0.0",
  "@vitejs/plugin-vue": "^6.0.10",
  "@vitejs/plugin-vue-jsx": "^5.1.6",
  "@vue/compiler-sfc": "^3.5.44",
  "patch-package": "^8.0.1",
  "tailwindcss": "^4.0.0",
  "typescript": "~6.0.0",
  "vite": "^8.3.5",
  "vue": "^3.5.44",
  "vue-tsc": "^3.3.13"
}
```
<!-- COPY END -->

### Please accept these terms

- [x] I have searched the [existing issues](https://github.com/NativeScript/NativeScript/issues) as well as [StackOverflow](https://stackoverflow.com/questions/tagged/nativescript) and this has not been posted before
- [x] This is a bug report
- [x] I agree to follow this project's [Code of Conduct](https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#coc)
