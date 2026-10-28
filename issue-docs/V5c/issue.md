### Issue Description

Runtime error in HMR development with `@nativescript/vite`, when the app depends on a package that ships a minified ESM dist: the app does not boot (`does not provide an export named '…'`).

Two HMR dev-server scanners only recognise a star re-export that is the first statement on its line and has whitespace around `*` (`export * from './x'`):

- `collectDepsModuleExportInfo` (`packages/vite/hmr/server/deps-bundle.ts`), which builds the export list of a deps-bundle shim served at `/ns/m/node_modules/...`
- `scanModuleExportSurface` (`packages/vite/hmr/server/websocket-served-module-helpers.ts`), which collects the star sources that `expandStarExports` follows

Minifiers write the statement without spaces, usually mid-line (`export*from"./a.js";function f(){}export*from"./b.js";`). Neither scanner sees these stars, so the re-exported names are missing from the deps shim and from the expanded `export { … } from` list. An app import of one of those names then fails to link with `does not provide an export named '…'`.

The line-start anchor also misses a second star on the same line: `export * from "a"; export * from "b";` loses `b`.

Expected behavior: `export*from"./x"` and `export * from './x'` are both followed, wherever a statement can start on the line. Look-alikes such as `reexport*from"…"`, strings that begin with `export`, and comments are ignored.

Related: #11543 and #11427 changed the same function, `collectDepsModuleExportInfo`: #11543 for minified ESM detection and CommonJS names, #11427 for `export * from '<package>'` targets. Neither covers a star re-export that is not at the start of a line.

A PR with the fix follows.

### Reproduction

A package with a minified ESM entry:

```json
// min-pkg/package.json
{"name":"min-pkg","version":"1.0.0","type":"module","main":"./index.mjs","exports":{".":"./index.mjs"}}
```

```js
// min-pkg/index.mjs
export*from"./a.mjs";export const own=1;
```

```js
// min-pkg/a.mjs
export const fromA = 1;
```

**1. The scanner.** In `packages/vite` on `main`, save this as `hmr/server/min-star-repro.spec.ts` and run `npx vitest run hmr/server/min-star-repro.spec.ts`:

```ts
import { it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDepsModuleExportInfo } from './deps-bundle.js';

it('min-pkg export info', () => {
	const dir = join(mkdtempSync(join(tmpdir(), 'min-star-')), 'node_modules', 'min-pkg');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.mjs'), 'export*from"./a.mjs";export const own=1;\n');
	writeFileSync(join(dir, 'a.mjs'), 'export const fromA = 1;\n');
	console.log(JSON.stringify(collectDepsModuleExportInfo(join(dir, 'index.mjs'), 'ios')));
});
```

- Actual: `{"names":["own"],"hasDefault":false}`
- Expected: `{"names":["fromA","own"],"hasDefault":false}`

The published 8.0.21 returns the same result: in the project folder of the app from step 2, run a Node ESM script that imports `collectDepsModuleExportInfo` from `./node_modules/@nativescript/vite/hmr/server/deps-bundle.js` and logs `JSON.stringify(collectDepsModuleExportInfo(<path to min-pkg/index.mjs>, 'ios'))`.

To see the second-star case, change the spec to write `export * from "./a.mjs"; export * from "./b.mjs";` as `index.mjs` and add `writeFileSync(join(dir, "b.mjs"), "export const fromB = 1;\n");`. It then logs `{"names":["fromA"],"hasDefault":false}` (expected: `{"names":["fromA","fromB"],"hasDefault":false}`).

**2. In an app.** An app from `ns create <name> --vue` (NativeScript CLI 9.1.1), switched to `@nativescript/vite` 8.0.21 in the project folder:

```bash
npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
npm uninstall @nativescript/webpack && rm webpack.config.js
npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
```

then add `bundler: 'vite',` and `bundlerConfigPath: 'vite.config.mts',` to `nativescript.config.ts`. (`nativescript-vite init` does neither the last install nor the config change.)

Pack `min-pkg` (`npm pack` in its folder) and install the tarball, so it is copied into `node_modules`. Use it in `app/app.ts`:

```ts
import { fromA, own } from 'min-pkg';
console.log(fromA, own);
```

Run `ns run android`. The shim served at `http://localhost:5173/ns/m/node_modules/min-pkg` has `export const own = __ns_dep_ns__.own;` and `export default __ns_dep_ns__;`, but no `fromA`, although the deps bundle `/ns/deps-bundle.mjs` has `fromA` in the `min-pkg` namespace. The app never starts: the boot screen stays on "Retrying after a boot failure" and the log shows the error under Relevant log output. With the fix the shim also exports `fromA` and the app starts.

**3. The per-module path.** In the same app, create a folder `wrap-pkg` directly in `node_modules` (it is not added to `package.json`) with these files:

- `package.json`: `{"name":"wrap-pkg","version":"1.0.0","type":"module","main":"./index.mjs"}`
- `index.mjs`: `export * from './lib/min.mjs';`
- `lib/min.mjs`: the minified `min-pkg/index.mjs` above
- `lib/a.mjs`: the `min-pkg/a.mjs` above

Then start the app with `NS_DEPS_PER_MODULE=1 ns run android` and open `http://localhost:5173/ns/m/node_modules/wrap-pkg/index.mjs`. It returns

```js
export { own } from "http://127.0.0.1:5173/ns/m/node_modules/wrap-pkg/lib/min.mjs";
```

without `fromA`. With the fix it is `export { own, fromA } from …`. An app module with `export * from 'min-pkg'` does not show this, because Vite resolves the bare import to its pre-bundled `/node_modules/.vite/deps/min-pkg.js`.

### Relevant log output (if applicable)

```shell
# step 1, main
{"names":["own"],"hasDefault":false}
# step 1, with the fix
{"names":["fromA","own"],"hasDefault":false}
# step 2, app on device, @nativescript/vite 8.0.21
[ns-entry] deterministic dev session bootstrap failed Error: Instantiation failed (http-loader): http://127.0.0.1:5173/ns/m/app/app.ts — Uncaught SyntaxError: The requested module 'min-pkg' does not provide an export named 'fromA'
```

### Environment

- `@nativescript/vite` 8.0.21 with `vite` 8.3.5, and `main` at 6bb01eab6
- `@nativescript/core` 9.1.3, `nativescript-vue` 3.1.2, NativeScript CLI 9.1.1, `@nativescript/android` 9.1.1, on an Android tablet
- Node 25.9.0, macOS 26.5
- The code is platform-independent dev-server code, so Android and iOS are both affected. Production builds do not use it.

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
  "min-pkg": "file:../pkg/min-pkg-1.0.0.tgz",
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
