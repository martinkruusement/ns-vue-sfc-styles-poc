## Problem

Vue's [`v-bind()` in `<style>`](https://vuejs.org/api/sfc-css-features.html#v-bind-in-css) does not work in nativescript-vue, and neither does `useCssModule()`.

For the component below, `@vue/compiler-sfc` rewrites `color: v-bind(color)` to `color: var(--<id>-color)` (production-mode builds emit a hashed name such as `--v0992e790` instead: release builds with either bundler, and every `@nativescript/vite` build except the HMR dev server, including `ns run android --no-hmr`) and adds this to its setup:

```js
import { useCssVars as _useCssVars, unref as _unref } from 'vue'
_useCssVars(_ctx => ({ "<id>-color": (_unref(color)) }))
```

`useCssVars` and `useCssModule` are exported by `@vue/runtime-dom` only. nativescript-vue re-exports `@vue/runtime-core`, and both `@nativescript/webpack` and `@nativescript/vite` resolve `vue` to `nativescript-vue`. So the import finds nothing.

## Reproduction

1. Create a project with `ns create repro --vue` (it uses `@nativescript/webpack`).
2. Save this component as `app/components/TapLabel.vue`:

   ```vue
   <script setup>
   import { ref } from 'nativescript-vue';

   const color = ref('red');
   </script>

   <template>
     <Label text="Tap me" class="title" @tap="color = 'blue'" />
   </template>

   <style scoped>
   .title {
     color: v-bind(color);
   }
   </style>
   ```

3. In `app/components/Home.vue`, replace the `<Label ... />` inside `<GridLayout>` with `<TapLabel />`, and add `import TapLabel from './TapLabel.vue'` to its `<script setup>`.
4. Run `ns run android`.

The webpack build already warns about the import:

```
WARNING in ./app/components/TapLabel.vue?vue&type=script&setup=true&lang=js
export 'useCssVars' (imported as '_useCssVars') was not found in 'vue' (possible exports: ...)
```

On the device, the app crashes at start-up on the splash screen: nativescript-vue's `errorHandler` rethrows in development builds, and the error reaches `Application.onCreate`. `ns run` prints:

```
Error during execution of setup function: TypeError: (0 , vue__WEBPACK_IMPORTED_MODULE_0__.useCssVars) is not a function
[Vue warn]: Unhandled error during execution of app errorHandler
  at <TapLabel>
  at <Home>
System.err: An uncaught Exception occurred on "main" thread.
System.err: Unable to create application com.tns.NativeScriptApplication
...
System.err: TypeError: (0 , vue__WEBPACK_IMPORTED_MODULE_0__.useCssVars) is not a function
```

To try `@nativescript/vite`, switch the same project to `@nativescript/vite` 8.0.21 in the project folder:

```bash
npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
npm uninstall @nativescript/webpack && rm webpack.config.js
npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
```

then add `bundler: 'vite',` and `bundlerConfigPath: 'vite.config.mts',` to `nativescript.config.ts`. (`nativescript-vite init` does neither the last install nor the config change.)

With `@nativescript/vite`, `ns run android --no-hmr` and release builds fail at build time, because Rolldown (Vite 8's bundler) rejects the same import:

```
[MISSING_EXPORT] "useCssVars" is not exported by "node_modules/nativescript-vue/dist/index.js".
```

With plain `ns run android` (the `@nativescript/vite` HMR dev server), the build and install succeed, but `useCssVars` is `undefined` at runtime. The app stays on "NativeScript Vite preparing dev session... Retrying after a boot failure" and logs:

```
Error during execution of setup function: TypeError: _useCssVars is not a function
[Vue warn]: Unhandled error during execution of app errorHandler
  at <TapLabel>
  at <Home>
[ns-entry] deterministic dev session bootstrap failed TypeError: _useCssVars is not a function
```

Importing `useCssModule` from `nativescript-vue` has the same problem. Vite reports `[MISSING_EXPORT] "useCssModule" is not exported by "node_modules/nativescript-vue/dist/index.js".` and webpack warns `export 'useCssModule' (imported as 'useCssModule') was not found in 'nativescript-vue'`.

## Expected behaviour

As in web Vue:

- The label is red and turns blue on tap. The bound value follows its reactive source.
- `useCssModule()` returns the `<style module>` class map, the same object templates read as `$style`. (Only `@nativescript/vite` without HMR currently injects a class map; with `@nativescript/webpack`, `$style` itself is the css2json stylesheet AST, see NativeScript/NativeScript#{{PR:W1}}.)

Note: the `@nativescript/vite` HMR dev server does not compile SFC `<style>` blocks yet. It registers them unscoped, with `v-bind()` left as written, so even once `useCssVars` is exported, core logs `Invalid color: v-bind(color)` and the label keeps its default colour. On that server `v-bind()` also needs NativeScript/NativeScript#11185.

A pull request that adds both helpers follows.

## Environment

- NativeScript CLI 9.1.1
- nativescript-vue 3.1.2
- @nativescript/core 9.1.3, @nativescript/android 9.1.1
- @nativescript/webpack 5.0.39, vue-loader 17.4.2, webpack 5.112.2
- @nativescript/vite 8.0.21, @vitejs/plugin-vue 6.0.10, @vue/compiler-sfc 3.5.44, vite 8.3.5
- Node 25.9.0, macOS 26.5
- Samsung SM-X356B tablet, Android 16 (API 36)
