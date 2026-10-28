### Issue Description

This is a runtime issue in `@nativescript/webpack` dev sessions with HMR (`ns run`, where HMR is on by default). Hot-replacing a stylesheet changes which of two equal-specificity rules wins. Builds without HMR are not affected.

`@nativescript/core` breaks ties between selectors of equal specificity by registration order. `removeTaggedAdditionalCSS(tag)` followed by `addTaggedAdditionalCSS(css, tag)` puts the tag at the end. With HMR, `apply-css-loader` (`packages/webpack5/src/loaders/apply-css-loader`) generates exactly that pair: it removes the stylesheet's tag in `module.hot.dispose` and adds the css again when the module re-executes. As a result:

- After an `app.css` hot edit, `app.css` wins every tie against component stylesheets (Vue SFC `<style>` blocks, `.css`/`.scss` imported from code). At boot and without HMR, `app.css` is registered first and loses those ties. With Tailwind, this also happens when a template edit adds a utility class: Tailwind regenerates `app.css`, and the hot update re-executes it.
- A hot-edited component stylesheet moves behind every stylesheet registered after it.
- All `<style>` blocks of a `.vue` file are registered under the file's path, so editing one block also removes the other blocks' rules.

Nothing is logged, and the styles differ from a cold start until the app restarts (for example by stopping and re-running `ns run`).

Expected behavior: a hot update keeps each stylesheet at its cold-start position in the cascade, so a hot update and a cold restart show the same styles.

A PR with the fix follows.

### Reproduction

Create the stock Vue app with `ns create w2-repro --vue`. It builds with `@nativescript/webpack` and its `app/app.css` uses Tailwind v4. Replace `app/components/Home.vue`, the root component passed to `createApp` in `app/app.ts`, with:

```vue
<template>
  <Frame>
    <Page>
      <Label class="probe" text="Hello" />
    </Page>
  </Frame>
</template>

<style scoped>
:global(.probe) { color: orange; }
</style>
```

`:global(.probe)` compiles to a plain `.probe` selector, with the same specificity as `.probe` in `app.css`.

1. Run `ns run android` (HMR). The label is orange.
2. While the app runs, add `.probe { color: red; }` at the end of `app/app.css` and save.
3. The hot update applies (`Successfully applied update.`), and the label turns red.
4. Stop `ns run` (Ctrl+C) and run `ns run android` again without changing any files. The label is orange.

### Relevant log output (if applicable)

```shell
None. Nothing is logged when the order changes.
(The "Failed to patch VueLoader - HMR may not work properly!" error that `ns run` prints once at startup with vue-loader 17 is unrelated; HMR still applies the update.)
```

### Environment

```shell
NativeScript CLI: 9.1.1
@nativescript/webpack: 5.0.39 (same apply-css-loader code on main, 6bb01eab6)
@nativescript/core: 9.1.3
@nativescript/android: 9.1.1
nativescript-vue: 3.1.2
@nativescript/tailwind: 4.1.0 (tailwindcss 4.3.3)
vue-loader: 17.4.2
webpack: 5.112.2
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
