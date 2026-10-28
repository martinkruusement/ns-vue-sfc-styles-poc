### Issue Description

This is a dev-server (HMR) problem in `@nativescript/vite`, not a build-time or app runtime error.

During a cold boot under HMR, the device fetches `/ns/m/node_modules/...` modules that the vendor collection does not cover (in larger apps, deep files of dependencies; in a stock app, only `@nativescript/vite`'s own HMR client files). The boot recorder (`packages/vite/hmr/server/boot-recording.ts`) is meant to save those URLs to `node_modules/.ns-vite/boot-closure-<platform>-<flavor>.json`, so the next dev-server start builds them into `/ns/deps-bundle.mjs`. This does not work:

1. **No recording is ever saved.** The recorder's trace middleware in `hmr/server/websocket.ts` is added with `server.middlewares.use()`. `getHMRPlugins()` registers `ns-hmr-client` first, and its middleware answers `/__ns_dev__/session` without calling `next()`. That request is the boot signal, so the recorder never opens a recording window and ignores every module request after it.
2. **A short boot replaces the full recording.** Once recordings are saved, each closed window with at least 5 URLs replaces the previous one. A boot that fails early (for example on an error in a page) shrinks the recording to a few URLs, and the next deps bundle loses the deep `node_modules` files.
3. **One bad recorded file costs the whole bundle.** If a recorded file breaks the deps-bundle build, `createDepsBundleService` drops the bundle for the session, although the vendor collection alone would build. (1) hides this today.

Expected behavior:

- The module URLs served after `/__ns_dev__/session` are saved when the recording window closes: after the first HMR boot, `node_modules/.ns-vite/boot-closure-android-vue.json` exists and the verbose log shows `[hmr-ws][boot-record] captured N boot urls`.
- A short or failed boot adds to the recording instead of replacing it.
- A recorded file that breaks the build does not cost the app the bundle it gets without a recording.

Related: #11584 (open) makes a dynamic `import()` target whose closure fails to build fall back to per-module serving instead of failing the bundle. It does not change the boot recorder, and a recorded entry that breaks the build still drops the whole bundle.

A PR with the fix follows.

### Reproduction

Setup: an app from `ns create <name> --vue` (NativeScript CLI 9.1.1, `@nativescript/android` 9.1.1), switched to `@nativescript/vite` 8.0.21 in the project folder:

```bash
npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
npm uninstall @nativescript/webpack && rm webpack.config.js
npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
```

then add `bundler: 'vite',` and `bundlerConfigPath: 'vite.config.mts',` to `nativescript.config.ts`. (`nativescript-vite init` does neither the last install nor the config change.)

**1. No recording.** Run `NS_VITE_VERBOSE=1 ns run android` on an Android device, let the app boot to the Home screen, wait about 10 s (the recorder's idle window is 5 s), then force-stop and relaunch the app a few times. No `boot-closure-*.json` appears in `node_modules/.ns-vite/`, however many boots you run, and the `ns run` output never contains a `[hmr-ws][boot-record] captured N boot urls` line.

**2. A short boot replaces the recording.** Save this as `repro.mjs` in the app root and run `node repro.mjs`:

```js
import { createBootRecorder } from './node_modules/@nativescript/vite/hmr/server/boot-recording.js';

const rec = createBootRecorder({ platform: 'android', flavor: 'vue', projectRoot: process.cwd(), persist: false });
const boot = (urls) => {
	rec.noteRequest('/__ns_dev__/session');
	for (const url of urls) rec.noteRequest(url)?.(200);
	rec.closeActiveSession();
};
boot(Array.from({ length: 40 }, (_, i) => `/ns/m/node_modules/ajv/dist/file-${i}.js`)); // full boot
boot(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `/ns/m/src/${name}.ts`)); // boot that fails early
console.log(rec.getRecordedPaths().length); // 6: the 40 node_modules URLs are gone
```

It prints `6`. Expected: `46`.

**3. One bad file drops the bundle** (needs esbuild 0.27.5 or later; with 0.27.4 a failed deps-bundle build crashes the dev server with `SyntaxError: Unexpected end of JSON input`, evanw/esbuild#4420). Create a stand-in package in the app whose `exports` maps `./plugins/foo` to `./dist/esm/foo/index.js` and that also ships a types-only `plugins/foo/index.ts`:

```bash
P=node_modules/repro-pkg; mkdir -p $P/plugins/foo $P/dist/esm/foo $P/dist/types/foo
echo '{ "name": "repro-pkg", "version": "1.0.0", "type": "module", "exports": { "./plugins/foo": "./dist/esm/foo/index.js" } }' > $P/package.json
echo "export * from '../../dist/types/foo/index';" > $P/plugins/foo/index.ts
echo "export const foo = 'foo';" > $P/dist/esm/foo/index.js
echo 'export declare const foo: string;' > $P/dist/types/foo/index.d.ts
```

Since (1) prevents a real recording, write one by hand to `node_modules/.ns-vite/boot-closure-android-vue.json`:

```json
{ "version": 1, "platform": "android", "flavor": "vue", "paths": ["/ns/m/node_modules/repro-pkg/plugins/foo"] }
```

Then start the dev server with `ns run android`. The deps-bundle build fails at dev-server start, before the device connects (log below), and the whole session falls back to per-module serving: while the dev server runs, `http://localhost:<port>/ns/deps-bundle.mjs` (`<port>` is the one in the `ns run` output, "Vite dev server ready on port …") answers 503. Delete the JSON file and restart: the bundle builds from the vendor collection and answers 200.

In a stock `ns create --vue` app the per-module fallback then also fails to boot: the device stays on "NativeScript Vite preparing dev session..." with "Retrying after a boot failure", and the log shows `Uncaught SyntaxError: Identifier '__TEST__' has already been declared` for `__ns_dev__/client`. The same happens with `NS_DEPS_PER_MODULE=1` and no recording, so that is a separate problem, but here it means one bad recorded file costs the app its boot, not just its bundle.

### Relevant log output (if applicable)

```shell
# 1: after any number of HMR boots
$ ls node_modules/.ns-vite/ | grep -c boot-closure
0

# 3: dev-server start with the hand-written recording
[ns-deps-bundle] bundle build FAILED — falling back to per-module node_modules serving for this session. Set NS_DEPS_PER_MODULE=1 to silence. Error: Build failed with 1 error:
node_modules/repro-pkg/plugins/foo/index.ts:1:14: ERROR: Could not resolve "../../dist/types/foo/index"

# 3: on the device afterwards (stock Vue app)
[ns-entry] deterministic dev session bootstrap failed Error: Instantiation failed (http-loader): http://127.0.0.1:5173/__ns_dev__/client — Uncaught SyntaxError: Identifier '__TEST__' has already been declared
```

### Environment

- @nativescript/vite 8.0.21 (same code on `main` at 6bb01eab6), vite 8.3.5, esbuild 0.27.7
- NativeScript CLI 9.1.1, @nativescript/core 9.1.3, @nativescript/android 9.1.1
- Node 25.9.0, macOS 26.5
- Samsung SM-X356B tablet, Android 16 (API 36). The affected code runs in the dev server and does not depend on the platform.

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
