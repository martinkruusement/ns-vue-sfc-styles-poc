### Issue Description

This is a runtime issue in `@nativescript/vite` dev sessions with HMR. Hot-replacing a stylesheet changes which of two equal-specificity rules wins. Builds without HMR are not affected.

`@nativescript/core` breaks ties between selectors of equal specificity by registration order. `removeTaggedAdditionalCSS(tag)` followed by `addTaggedAdditionalCSS(css, tag)` puts the tag at the end. The HMR css appliers replace a stylesheet with exactly that pair: `__NS_HMR_APPLY_CSS__` and `__NS_REGISTER_CSS__` in `packages/vite/hmr/entry-runtime.ts`, and `applyCssText` in `packages/vite/hmr/client/css-handler.ts`. An `app.css` save arrives as `ns:css-updates` for `/app/app.css` without a tag, and `applyCssText` forwards it to `__NS_HMR_APPLY_CSS__`. Vue SFC `<style>` blocks and `.css` files imported from code are registered through `__NS_REGISTER_CSS__` (tags `sfc:<path>` and the file's root-relative path). As a result:

- After any `app.css` hot edit, `app.css` wins every tie against the component stylesheets already registered (Vue SFC `<style>`, `.css` files imported from code). Without HMR, and normally at boot, `app.css` is registered first and loses those ties. (If component css is queued before the HMR css applier is installed, it is drained before `app.css`, so `app.css` wins at boot too.)
- A hot-replaced component stylesheet moves behind every component stylesheet registered after it.

No warning or error is logged. Restarting `ns run` restores the original order. Restarting only the app is not enough after an `app.css` edit: when the app reconnects, the dev server re-sends the changed `app.css`, and it is applied the same way.

Expected behavior: a hot replace keeps each stylesheet at its original position in the cascade, as at boot and in builds without HMR.

Related: #11522 made `app.css` register before component styles at HMR boot; this issue is about the hot replaces after boot. #11476 is the same kind of dev/release cascade difference in the release-build CSS inlining.

A PR with the fix follows.

### Reproduction

Setup: an app from `ns create repro --vue` (NativeScript CLI 9.1.1, the stock template, with Tailwind v4 through `@nativescript/tailwind`), switched to `@nativescript/vite` 8.0.21 by running these commands in the project root (the `repro` folder that `ns create` made, not its `app/` subfolder):

```bash
npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
npm uninstall @nativescript/webpack && rm webpack.config.js
npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
```

then add `bundler: 'vite',` and `bundlerConfigPath: 'vite.config.mts',` to `nativescript.config.ts`. (`nativescript-vite init` does neither the last install nor the config change.)

Add this rule to the end of `app/app.css`:

```css
.title { color: red; }
```

Replace `app/components/Home.vue` with:

```vue
<template>
  <Page>
    <Label class="title" text="Hello" />
  </Page>
</template>

<style>
.title { color: green; }
</style>
```

The same happens without the `<style>` block: put `.title { color: green; }` in `app/home.css` and add `import './home.css'` at the top of `app/app.ts`.

1. Run `ns run android` (HMR). The label is green, as with `ns run android --no-hmr`.
2. Change anything in `app/app.css`, for example add `.other { margin: 1; }`, and save.
3. The label turns red. Reverting the edit does not bring green back (the revert is another hot replace). Restarting the app while `ns run` keeps running and `app/app.css` still differs from its content when `ns run` started does not bring green back either: on reconnect the dev server re-sends the changed `app.css` (`[hmr-ws] app.css changed since server startup → synced /app/app.css to newly connected client`), which is applied the same way. Restarting the app after the revert, or restarting `ns run`, restores green.

Variant, a component stylesheet moving behind a later one (without Tailwind: remove `@import "tailwindcss"` from `app/app.css`): put `.title { color: blue; }` in `app/a.css` and `.title { color: green; }` in `app/b.css`, add `import './a.css'` and then `import './b.css'` at the top of `app/app.ts`, and remove the `<style>` block from `Home.vue`. Start a new `ns run android`. The label is green (`b.css` is registered last). Add `.other { margin: 1; }` to `a.css` and save: the label turns blue. (With Tailwind v4, an edit to a `.css` file under `app/` is sent as an `app.css` update instead, so `app.css` wins and the label turns red.)

### Relevant log output (if applicable)

No warning or error. The `ns run` output only shows the normal update line:

```shell
[hmr-ws][update] kind=css file=/app/app.css await=0ms framework=0ms broadcast=0ms total=0ms invalidated=0 recipients=1
```

(With Tailwind, Vite's one-time "A PostCSS plugin did not pass the `from` option to `postcss.parse`" warning may also appear on the first css rebuild; it is unrelated.)

### Environment

```shell
NativeScript CLI: 9.1.1
@nativescript/vite: 8.0.21 (same code on main, 6bb01eab6)
@nativescript/core: 9.1.3
@nativescript/android: 9.1.1
nativescript-vue: 3.1.2
@vitejs/plugin-vue: 6.0.10
vite: 8.3.5
@nativescript/tailwind: 4.1.0 (the Variant removes `@import "tailwindcss"` from app.css)
tailwindcss: 4.3.3
Node: 25.9.0
macOS: 26.5
Device: Samsung SM-X356B tablet, Android 16 (API 36)
```

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
