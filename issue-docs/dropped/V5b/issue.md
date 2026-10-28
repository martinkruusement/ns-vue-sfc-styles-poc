### Issue Description

This is a runtime problem in an `@nativescript/vite` HMR dev session using the default deps-bundle mode.

The deps bundle (`/ns/deps-bundle.mjs`) keeps Node builtin imports external, exactly as the dependency wrote them. Some dependencies import builtins without the `node:` prefix (`import 'util'`, `import util from 'util'`). When no npm package of that name is installed, the bundle contains `import "util";`.

The device import map has builtin entries only for the `node:` form (`node:util` → `/ns/node/util`, from `getNodeBuiltinImportMapEntries` in `packages/vite/hmr/server/node-builtins-route.ts`); it has no `util` key. On Android (runtime 9.1.1), `node:` specifiers are resolved from the runtime's own built-in modules (`node:util`, `node:url`, `node:module`), and a bare `util` falls through to file resolution, which fails with `Cannot find module 'util'`. The deps bundle is imported by every dependency shim under `/ns/m/node_modules/...` and by `/@nativescript/vendor.mjs`, which the dev-session client `/__ns_dev__/client` imports before the app entry. So the dev session fails to boot before the app entry runs: the boot screen stays on "Retrying after a boot failure" and the app never renders.

The specifier is left as written by `createDepsImportRoutingPlugin` in `packages/vite/hmr/server/deps-bundle.ts`: `if (NODE_BUILTIN_SET.has(spec)) return undefined;`.

Expected behavior:

A static `import` or `export … from` of a bare builtin in a dependency should be emitted in its `node:` form (`import "node:util";`), so it resolves the same way `node:util` does today, and the app boots. Builtins that the runtime does not provide (for example `node:path`, which fails on Android with `No such built-in module: node:path`) still fail, as they do today when written with `node:`; that is a separate limitation.

A PR with a fix follows.

### Reproduction

**In an app**

1. Create an app with `ns create <name> --vue` (NativeScript CLI 9.1.1, `@nativescript/android` 9.1.1) and switch it to `@nativescript/vite` 8.0.21 in the project folder:

   ```bash
   npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
   npm uninstall @nativescript/webpack && rm webpack.config.js
   npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
   ```

   then add `bundler: 'vite',` and `bundlerConfigPath: 'vite.config.mts',` to `nativescript.config.ts`. (`nativescript-vite init` does neither the last install nor the config change.)
2. Create a local package `pkg-bare-util` next to the app.

   `package.json`:

   ```json
   { "name": "pkg-bare-util", "version": "1.0.0", "module": "index.js" }
   ```

   `index.js`:

   ```js
   import 'util';
   import util from 'util';
   export const bareUtil = 'pkg-bare-util loaded, util default is ' + typeof util;
   ```

3. Run `npm pack` in the package folder, then `npm install ../pkg-bare-util/pkg-bare-util-1.0.0.tgz` in the app.
4. In `app/app.ts`, add `import { bareUtil } from 'pkg-bare-util'` and `console.log(bareUtil)`.
5. Run `ns run android` on an Android device.

Actual: the device stays on the "NativeScript Vite preparing dev session..." screen with "Retrying after a boot failure", the `ns run` output shows the `Cannot find module 'util'` error below, and the app's `console.log` line is never printed. While the dev server runs, `http://localhost:<port>/ns/deps-bundle.mjs` (`<port>` is the one in the `ns run` output, "Vite dev server ready on port …") contains `import "util";` and `import util from "util";`, and `http://localhost:<port>/ns/import-map.json` has `importMap.imports["node:util"]` but no `util` key.

**As a unit test**

In a clone of NativeScript/NativeScript at `main` (6bb01eab6), run `npm install` at the repository root. In `packages/vite/hmr/server/deps-bundle.spec.ts`, add these two lines to `createFixtureProject()`, just before `return projectRoot;`. They add a package that imports builtins bare; neither `util` nor `path` is installed as an npm package. (`path` is only here for the transform check; on a device `node:path` is not a runtime builtin.)

```ts
write('node_modules/pkg-bare-builtins/package.json', JSON.stringify({ name: 'pkg-bare-builtins', version: '1.0.0', module: 'index.js' }));
write('node_modules/pkg-bare-builtins/index.js', `import 'util';\nimport { join } from 'path';\nexport const p = join('a', 'b');\n`);
```

Then build the deps bundle with that package as a recorded entry, inside `describe('generateDepsBundle')`:

```ts
it('bare builtin', async () => {
	const state = await generateDepsBundle({ projectRoot, platform: 'ios', mode: 'development', flavor: 'typescript', recordedPaths: ['/ns/m/node_modules/pkg-bare-builtins/index.js'] });
	expect(state!.code).toContain('import "node:util";');
});
```

In `packages/vite`, `npx vitest run hmr/server/deps-bundle.spec.ts` fails with `AssertionError: expected '/* /ns/deps-bundle.mjs — single-eval …' to contain 'import "node:util";'` (1 failed, 53 passed). The received code contains `import "util";` and `import { join } from "path";`.

### Relevant log output (if applicable)

```shell
# ns run android, Android device (@nativescript/vite 8.0.21, runtime 9.1.1)
[ns-entry] deterministic dev session bootstrap failed Error: Instantiation failed (http-loader): http://127.0.0.1:<port>/__ns_dev__/client — Uncaught Error: Cannot find module 'util' (tried /data/data/<app id>/files/app/util)

# Generated /ns/deps-bundle.mjs (@nativescript/vite 8.0.21), app dependency pkg-bare-util
import "util";
import util from "util";

# Generated deps bundle (@nativescript/vite 8.0.21 and main 6bb01eab6), unit-test fixture pkg-bare-builtins
import "util";
import { join } from "path";
```

### Environment

- `@nativescript/vite` 8.0.21, vite 8.3.5, and `main` at 6bb01eab6
- NativeScript CLI 9.1.1, `@nativescript/android` 9.1.1
- esbuild 0.27 (it builds the deps bundle), Node 25.9.0, macOS 26.5
- The deps bundle is built by the dev server, so its content does not depend on the platform. The device failure was observed on Android (runtime 9.1.1, Samsung tablet); iOS was not tested.

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
  "nativescript-vue": "^3.1.2",
  "pkg-bare-util": "file:../pkgs/pkg-bare-util-1.0.0.tgz"
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
