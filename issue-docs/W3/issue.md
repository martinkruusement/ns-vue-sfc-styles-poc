### Issue Description

A build-time problem in `@nativescript/webpack` (`packages/webpack5`). In a NativeScript-Vue 3 app, webpack builds with HMR (`ns run`, `ns debug`) log this once, when webpack starts:

```
[@nativescript/webpack] Error: 
 Failed to patch VueLoader - HMR may not work properly!
```

HMR itself still works (updates are applied), because nativescript-vue's own webpack plugin repairs the config afterwards. So the message is false and alarming, and Vue 3 builds rely on that plugin to work at all.

`packages/webpack5/src/configuration/vue.ts` still configures vue-loader 15 (Vue 2), although `@nativescript/webpack` itself depends on `vue-loader` `^17.4.2`:

- With HMR, `patchVueLoaderForHMR()` rewrites `vue-loader/lib/index.js` to force `isServer = false`. vue-loader 16+ has no `lib/` folder (vue-loader 17 takes an `isServerBuild` option instead), so the patch fails on Vue 3 HMR builds (unless some vue-loader 15 is resolvable from `@nativescript/webpack`, in which case that copy is rewritten instead).
- The `vue-css-loader` use in the `css` and `scss` rules points at `vue-loader/lib/loaders/stylePostLoader.js`, which only vue-loader 15 has. vue-loader 17 ships `vue-loader/dist/stylePostLoader.js`.
- The `vue-loader` options get `compiler: require('nativescript-vue-template-compiler')` (the Vue 2 template compiler, or `undefined` when it is not installed) and never `isServerBuild: false`. With the `node` target, vue-loader 17 then compiles templates as SSR render functions with hot reload off. Without nativescript-vue's override (below), the build fails with `Can't resolve 'vue/server-renderer'`.

Vue 3 apps build only because nativescript-vue 3's `nativescript.webpack.js` replaces both stylePostLoader paths and sets `isServerBuild: false`. The HMR patch runs in `@nativescript/webpack`'s own Vue config, before that plugin, so that plugin cannot prevent the error.

Expected behavior: `@nativescript/webpack` configures the Vue rules for the vue-loader version the project uses. For vue-loader 16+: `dist/stylePostLoader.js`, `isServerBuild: false`, no source patch and no Vue 2 compiler. vue-loader 15 (Vue 2) projects keep the current setup.

Related: #11009 (Vue 2 apps after the move to vue-loader 17), #10759 and #10772 (the vue-loader 17 dependency that `vue.ts` was not updated for), and nativescript-vue/nativescript-vue#1114 (a Vue 3 build that failed on the same hard-coded vue-loader 15 path).

I will open a PR with a fix right after this issue.

### Reproduction

Create a NativeScript-Vue 3 app with the stock template and keep the generated `webpack.config.js`:

```bash
ns create repro --vue
cd repro
```

With CLI 9.1.1 this installs `nativescript-vue` 3.1.2 and `@nativescript/webpack` 5.0.39. Both depend on `vue-loader` `^17.4.2`, so vue-loader 17.4.2 is installed.

1. Run `ns run android` (HMR is on by default).
2. Right after "Preparing project...", before the first "webpack ... compiled successfully", the CLI prints the error above. It is printed once per webpack start, not on rebuilds. The app then installs and hot-reloads normally.

Expected: no such error.

Without a device: save this as `repro.js` in the project folder (`repro/`, next to `package.json`, not inside `app/`) and run `node repro.js` from there. It prints a `Cannot find NativeScript CLI path` warning (only because the CLI is not involved), then the error above. With `hmr: false` the error is not printed.

```js
const webpack = require('@nativescript/webpack');
webpack.init({ android: true, hmr: true });
webpack.useConfig('vue');
webpack.resolveChainableConfig(); // logs "Failed to patch VueLoader"
```

### Relevant log output (if applicable)

```shell
[@nativescript/webpack] Error: 
 Failed to patch VueLoader - HMR may not work properly!
```

### Environment

Relevant versions:

- NativeScript CLI 9.1.1
- `@nativescript/webpack` 5.0.39 (`vue.ts` is the same on `main` at 6bb01eab6)
- nativescript-vue 3.1.2, vue-loader 17.4.2, webpack 5.112.2
- `@nativescript/core` 9.1.3, `@nativescript/android` 9.1.1
- Node 25.9.0, macOS 26.5

The Vue config does not depend on the platform.

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
  "nativescript-vue": "^3.1.2"
},
"devDependencies": {
  "@nativescript/android": "9.1.1",
  "@nativescript/tailwind": "^4.0.0",
  "@nativescript/types": "~9.0.0",
  "@nativescript/webpack": "~5.0.31",
  "@types/node": "^20.0.0",
  "tailwindcss": "^4.0.0",
  "typescript": "~6.0.0"
}
```
<!-- COPY END -->

### Please accept these terms

- [x] I have searched the [existing issues](https://github.com/NativeScript/NativeScript/issues) as well as [StackOverflow](https://stackoverflow.com/questions/tagged/nativescript) and this has not been posted before
- [x] This is a bug report
- [x] I agree to follow this project's [Code of Conduct](https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#coc)
