### Issue Description

`<style module>` in a Vue single-file component has no effect when the app is built with `@nativescript/webpack`. The cause is at build time, but it only shows at runtime: the styles are missing, and nothing about the style block is logged. (An HMR build also prints `Failed to patch VueLoader - HMR may not work properly!`; that line is unrelated, see #{{PR:W3}}.)

vue-loader sets `$style` to the default export of the block's style request and expects that to be a class map, which css-loader produces when `modules` is enabled. `@nativescript/webpack` uses `css2json-loader` instead of css-loader, and css2json-loader has no CSS modules step. So:

- `$style` is css2json-loader's stylesheet AST, and `$style.title` is `undefined`.
- The block's rules are registered with their original, unscoped selectors (`.title`).
- `:global(.x)` stays in the selector as written and never matches, and `composes:` stays as a declaration (both show up unchanged in the AST below if you add them to the block).

Expected behavior: `$style` maps each class to a scoped name (`{ title: '<scoped name>' }`), the rules are registered under those names, and the label below is `#654321`, as with Vue on the web.

A PR with the fix follows.

### Reproduction

```vue
<template>
  <Page>
    <Label :class="$style.title" text="Hello" />
  </Page>
</template>

<style module>
.title { color: #654321; }
</style>
```

1. Create the stock Vue app with `ns create w1 --vue` (it installs `@nativescript/webpack` 5.0.39 and `nativescript-vue` 3.1.2), and replace `app/components/Home.vue` with this component. `app/app.ts` already renders it with `createApp(Home).start()`.
2. Run `ns run android` (the result is the same with `ns run android --no-hmr --clean`).
3. "Hello" is drawn in the theme's default grey text colour (`#757575` on the template's white page, also with the device in dark mode), not in `#654321` (brown). If you give the label the static class `class="title"` instead, it turns brown, because the rule is registered with the unscoped `.title`.

### Relevant log output (if applicable)

```shell
# Nothing about the style block is logged on its own. Adding a <script> block with
# `mounted() { console.log(JSON.stringify(this.$style)) }` shows that $style is
# css2json-loader's default export for the block, the stylesheet AST:
{"type":"stylesheet","stylesheet":{"rules":[{"type":"rule","selectors":[".title"],"declarations":[{"type":"declaration","property":"color","value":"#654321"}]}],"parsingErrors":[]}}
```

### Environment

```shell
NativeScript CLI: 9.1.1
@nativescript/webpack: 5.0.39 (same loader on main, 6bb01eab6)
@nativescript/core: 9.1.3
@nativescript/android: 9.1.1
nativescript-vue: 3.1.2
vue-loader: 17.4.2
webpack: 5.112.2
@nativescript/tailwind: 4.1.0 (from the `ns create --vue` template)
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
