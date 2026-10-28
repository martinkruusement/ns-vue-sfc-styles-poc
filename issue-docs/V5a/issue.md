### Issue Description

Dev-server (HMR) issue in `@nativescript/vite` 8.0.21 and current `main`: it affects the deps bundle of the HMR dev server (`ns run` / `ns debug`). `ns build` is not affected. When the deps-bundle build fails, the dev session falls back to per-module `node_modules` serving. (In an app from `ns create <name> --vue` (NativeScript CLI 9.1.1) switched to `@nativescript/vite` 8.0.21, that fallback then fails to boot on the device because of a separate problem: `Identifier '__TEST__' has already been declared` for `__ns_dev__/client`.)

The HMR deps bundle maps an extensionless package subpath such as `/ns/m/node_modules/<pkg>/<subpath>` to a file with an on-disk lookup only: `<subpath>` with each resolve extension (platform-suffixed first, `.tsx`/`.jsx`/`.ts` before `.js`), then `<subpath>/index.*`. Unlike package roots, it never reads the package's `exports` map. When the file at the subpath location is not the one `exports` declares, the deps bundle uses the wrong file:

- A types-only stub at the subpath (for example `plugins/foo/index.ts` re-exporting from `dist/types`) becomes a bundle entry. The whole deps-bundle build fails and the session falls back to per-module `node_modules` serving.
- Shipped sources become a second copy of the module. `/ns/m/node_modules/seroval-plugins/web` (seroval-plugins 1.5.1, a solid-js dependency) resolves to `web/index.ts`, while esbuild bundles `dist/esm/production/web.mjs` for the bare import.
- Subpaths with no file at their location (`rxjs/operators` in rxjs 7.8.1, `solid-js/web` in solid-js 1.9.11, `css-tree/tokenizer` in css-tree 3.1.0) do not resolve, so they are always served per-module, even when the bundle contains the declared file.

Expected behavior: an extensionless subpath resolves to the target that the nearest installed copy of the package declares in `exports`, which is the file esbuild picks for the bare import inside the bundle. The on-disk lookup applies only when `exports` declares nothing usable.

A PR with the fix follows.

### Reproduction

1. In an app that uses `@nativescript/vite`, create `node_modules/demo-plugin` with this `package.json`:
   ```json
   { "name": "demo-plugin", "version": "1.0.0", "exports": { "./plugins/foo": { "types": "./dist/types/plugins/foo/index.d.ts", "import": "./dist/esm/plugins/foo/index.js" } } }
   ```
   and these files inside `node_modules/demo-plugin/`:
   - `plugins/foo/index.ts`: `export * from '../../dist/types/plugins/foo/index';`
   - `dist/types/plugins/foo/index.d.ts`: `export declare const foo: string;`
   - `dist/esm/plugins/foo/index.js`: `export const foo = 'foo';`
2. Save this as `check.mjs` in the app root and run `node check.mjs` from the app root:
   ```js
   const { resolveDepsEntriesFromRecording } = await import('./node_modules/@nativescript/vite/hmr/server/deps-bundle.js');
   for (const platform of ['android', 'ios']) {
     console.log(platform, resolveDepsEntriesFromRecording(['/ns/m/node_modules/demo-plugin/plugins/foo'], process.cwd(), null, platform).map((e) => e.key));
   }
   ```
3. It prints:
   ```
   android [ 'node_modules/demo-plugin/plugins/foo/index.ts' ]
   ios [ 'node_modules/demo-plugin/plugins/foo/index.ts' ]
   ```
   Expected, for both platforms: `[ 'node_modules/demo-plugin/dist/esm/plugins/foo/index.js' ]`.
4. `/ns/m/node_modules/demo-plugin/plugins/foo` is the URL a bare `demo-plugin/plugins/foo` import is served at. To see the effect on the dev server, put that URL in the boot recording by hand (the published version never saves one, which is a separate bug): save
   ```json
   { "version": 1, "platform": "android", "flavor": "vue", "paths": ["/ns/m/node_modules/demo-plugin/plugins/foo"] }
   ```
   as `node_modules/.ns-vite/boot-closure-android-vue.json`. The platform and flavor must match your app both in the file name and in the JSON's `"platform"` and `"flavor"` fields; otherwise the dev server ignores the file. Then run `ns run android`. The dev server's deps-bundle service (`createDepsBundleService` in the same module) fails to build the bundle and logs the output below, `/ns/deps-bundle.mjs` answers 503, and every `node_modules` module is served per-module.

### Relevant log output (if applicable)

```shell
[ns-deps-bundle] bundle build FAILED — falling back to per-module node_modules serving for this session. Set NS_DEPS_PER_MODULE=1 to silence. Error: Build failed with 1 error:
node_modules/demo-plugin/plugins/foo/index.ts:1:14: ERROR: Could not resolve "../../dist/types/plugins/foo/index"
```

### Environment

- NativeScript CLI 9.1.1
- @nativescript/core 9.1.3
- @nativescript/android 9.1.1
- @nativescript/vite 8.0.21 (also current `main`)
- esbuild 0.27.7
- Node 25.9.0, macOS 26.5

The resolution does not depend on the platform; it happens the same for iOS and Android.

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
