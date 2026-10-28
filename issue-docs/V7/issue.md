### Issue Description

Runtime bug in `@nativescript/vite` HMR sessions.

When the app replaces the global `XMLHttpRequest`, stylesheet hot updates stop applying on the device. The concrete case is `@nativescript/canvas-polyfill`, which defines its own global `XMLHttpRequest`. This affects `app.css` edits, component stylesheet edits, and Tailwind content-file edits that change `app.css`. The device receives `ns:css-updates`, nothing is logged, the HMR overlay stays on "Applying CSS update", and the change only appears after `ns run android` is restarted. Vue component edits still hot-update.

Cause: an `ns:css-updates` item carries only the stylesheet's path, and the HMR client (`packages/vite/hmr/client/css-handler.ts`) downloads `<origin><path>?direct=1&t=<ts>` with the global `fetch()`.

- On the device, `fetch()` is `@nativescript/core`'s `whatwg-fetch` polyfill, which sends each request through `new XMLHttpRequest()`, using whichever global `XMLHttpRequest` exists at that moment.
- Core installs its own `XMLHttpRequest` only when none exists yet (`globals/polyfills/polyfill-xhr`).
- With the canvas polyfill's `XMLHttpRequest`, that `fetch()` never settles: no error, no timeout. `handleCssUpdates` awaits it forever, so later updates in the same batch are not applied either.
- For Angular, the deferred Tailwind stylesheet is awaited right before `reboot(true)` in the serialized HMR cycle, so that reboot waits as well.

Core's `Http.getString` to the same URL returns the stylesheet within about 70 ms.

Expected behavior: a stylesheet edit applies on the device whichever `XMLHttpRequest` the app installs.

Related: NativeScript/canvas#87 reports that the canvas polyfill's `XMLHttpRequest` replaces core's and breaks code that relies on it (for example axios).

A PR with the fix follows: the server includes the compiled stylesheet in `ns:css-updates`, and when it is missing the client fetches with core `Http` first and gives up after a timeout.

### Reproduction

1. Create a `nativescript-vue` app on `@nativescript/vite` and install the canvas polyfill. This needs the 3.0.0-beta.5 packages: `@nativescript/android` 9.1 moved to V8 14.9, and the native library of the latest stable `@nativescript/canvas`, 2.1.18, is built for the V8 10.3 of 9.0, so the app does not boot with it.

   ```bash
   ns create repro --vue && cd repro
   npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
   npm uninstall @nativescript/webpack && rm webpack.config.js
   npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
   npm install @nativescript/canvas-polyfill@3.0.0-beta.5 @nativescript/canvas@3.0.0-beta.5 @nativescript/canvas-svg@3.0.0-beta.5 @nativescript/canvas-media@3.0.0-beta.5
   ```

   Add `bundler: 'vite',` and `bundlerConfigPath: 'vite.config.mts',` to `nativescript.config.ts` (`nativescript-vite init` does neither the last install nor the config change). Then replace these files:

   `app/app.ts`
   ```ts
   import '@nativescript/canvas-polyfill';
   import { createApp } from 'nativescript-vue';
   import Home from './components/Home.vue';

   createApp(Home).start();
   ```

   `app/components/Home.vue`
   ```vue
   <template>
     <Frame>
       <Page>
         <Label class="title" text="Hello" />
       </Page>
     </Frame>
   </template>
   ```

   `app/app.css` (the whole file)
   ```css
   .title { padding: 8; }
   ```
2. Run `ns run android`.
3. In `app/app.css`, change `padding: 8` to `padding: 40` and save.
4. The label keeps its old padding, and the HMR overlay stays on "HMR update applying..." with "Re-importing entry (60%)" and "Applying CSS update". Vue component edits still hot-update. After restarting `ns run android` the label has the new padding. Expected: the new padding applies without a restart.

### Relevant log output (if applicable)

No error or warning is logged. With verbose HMR logging (`NS_VITE_VERBOSE=1 ns run android`), these are the client's last lines for the update:

```shell
[hmr-client] received message ns:css-updates
[ns-hmr-overlay] update stage=reimporting detail=Applying CSS update
[ns-hmr] handleCssUpdates called, updates: 1 origin: http://<host>:<port>
[ns-hmr] Fetching CSS: http://<host>:<port>/app/app.css?direct=1&t=<timestamp>
[hmr-client] received message custom
```

### Environment

- NativeScript CLI 9.1.1
- `@nativescript/core` 9.1.3, `@nativescript/android` 9.1.1
- `@nativescript/vite` 8.0.21 (the same code is on `main` at 6bb01eab6), `vite` 8.3.5, `nativescript-vue` 3.1.2
- `@nativescript/canvas-polyfill` 3.0.0-beta.5 (with `@nativescript/canvas`, `canvas-svg` and `canvas-media` 3.0.0-beta.5)
- Node 25.9.0, macOS 26.5
- Samsung SM-X356B tablet, Android 16 (API 36)

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
  "@nativescript/canvas": "^3.0.0-beta.5",
  "@nativescript/canvas-media": "^3.0.0-beta.5",
  "@nativescript/canvas-polyfill": "^3.0.0-beta.5",
  "@nativescript/canvas-svg": "^3.0.0-beta.5",
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
