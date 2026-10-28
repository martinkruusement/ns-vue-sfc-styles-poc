### Issue Description

This is a runtime bug in an HMR session with `@nativescript/vite` and Vue, once SFC `<style>` blocks are compiled by the dev server (#{{PR:V1}}, which fixes #11185).

Saving a `.vue` file updates its scoped css on the device. Saving a file that one of its `<style>` blocks depends on does not:

- a partial `@import`ed from a `<style>` or `<style scoped>` block;
- a sass partial pulled in with `@use`/`@import` from `<style lang="scss">`;
- the file of a `<style src="…">` block.

`/ns/asm` caches each assembled SFC under the hash of the `.vue` source. An edit to one of its stylesheets does not change that hash, and no `ns:vue-sfc-registry-update` is sent, so the device never re-fetches the SFC. The component keeps its old scoped css until the `.vue` file changes or `ns run` (the dev server) is restarted. Restarting the app is not enough, because `/ns/asm` serves the same cached assembly again. Depending on the file, the device gets this instead:

- A `.css` file that is not an `app.css` dependency is sent as a component stylesheet (`ns:css-updates` under the file's own tag). The device installs its unscoped css app-wide, so its rules also match views outside the component.
- A `.css` file that is an `app.css` dependency re-sends `app.css`. With Tailwind v4 every file Tailwind scans is one, `.css` files included.
- A `.scss`/`.sass` partial sends no style update.

Expected behavior: every SFC whose styles depend on the edited file re-renders with the new scoped css, and a stylesheet that only SFC style blocks use is not installed app-wide.

A PR with the fix follows; it is stacked on #{{PR:V1}}.

### Reproduction

1. Create the app, switch it to `@nativescript/vite` and remove Tailwind:
   ```bash
   ns create repro --vue && cd repro
   npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
   npm uninstall @nativescript/webpack @nativescript/tailwind tailwindcss && rm webpack.config.js
   npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
   ```
   Add `bundler: 'vite'` and `bundlerConfigPath: 'vite.config.mts'` to `nativescript.config.ts`, and remove `@import "tailwindcss";` from `app/app.css`. Then install #{{PR:V1}}'s `@nativescript/vite`: in a NativeScript checkout of that branch run `npx nx run vite:build`, then `npm pack` in `dist/packages/vite`, and `npm install -D` the tarball in the app.

   `app/app.ts` stays as generated (`createApp(Home).start()`). Replace `app/components/Home.vue` (a bare `<Page>` root is fine) and add the other two files:

   `app/styles/card.css`
   ```css
   .card { color: red; }
   ```

   `app/components/Home.vue`
   ```vue
   <template>
     <Page>
       <StackLayout>
         <Label class="card" text="Inside" />
         <Other />
       </StackLayout>
     </Page>
   </template>

   <script setup>
   import Other from './Other.vue';
   </script>

   <style scoped>
   @import '../styles/card.css';
   </style>
   ```

   `app/components/Other.vue`
   ```vue
   <template>
     <StackLayout>
       <Label class="card" text="Outside" />
     </StackLayout>
   </template>
   ```
2. Run `ns run android`. "Inside" is red, "Outside" has the default colour.
3. In `card.css`, change `red` to `blue` and save.
4. "Inside" stays red and "Outside" turns blue. Expected: "Inside" turns blue and "Outside" is unchanged.

   The dev server sends `ns:css-updates` for `/app/styles/card.css` (under the tag `/app/styles/card.css`) and no `ns:vue-sfc-registry-update`, and `/ns/asm?path=/app/components/Home.vue` keeps serving `.card[data-v-…] { color: red; }`. Force-stopping and relaunching the app while `ns run` keeps running shows "Inside" red and "Outside" in the default colour again.

Variants:

- `<style scoped src="../styles/card.css"></style>` instead of the `@import` behaves the same.
- If Tailwind is kept (the template's default: `@nativescript/tailwind` installed and `@import "tailwindcss"` in `app.css`), step 3 re-sends `app.css` instead: "Inside" still stays red and "Outside" keeps the default colour.
- With `<style scoped lang="scss">@use '../styles/colors' as c; .card { color: c.$card; }</style>` and `app/styles/_colors.scss` containing `$card: red;`, changing the partial to `blue` changes nothing: the dev server sends no style update and `/ns/asm` keeps serving `color: red`.

### Relevant log output (if applicable)

No error or warning. On save the dev server logs only:

```
[hmr-ws][update] kind=css file=/app/styles/card.css await=1ms framework=0ms broadcast=0ms total=1ms invalidated=0 recipients=1
```

In the Tailwind variant it also prints Tailwind/PostCSS's "A PostCSS plugin did not pass the `from` option to `postcss.parse`" warning, which is unrelated (it appears with the fix too).

### Environment

- NativeScript CLI 9.1.1
- `@nativescript/core` 9.1.3, `@nativescript/android` 9.1.1
- `@nativescript/vite` 8.0.21 (also `main` at 6bb01eab6), with #{{PR:V1}}
- `nativescript-vue` 3.1.2, `@vitejs/plugin-vue` 6.0.10, `vite` 8.3.5, `tailwindcss` 4.3.3 (for the Tailwind case)
- Node 25.9.0, macOS 26.5
- Android 16 Samsung tablet

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
  "@nativescript/types": "~9.0.0",
  "@nativescript/vite": "^8.0.21",
  "@types/node": "^20.0.0",
  "@vitejs/plugin-vue": "^6.0.10",
  "@vitejs/plugin-vue-jsx": "^5.1.6",
  "@vue/compiler-sfc": "^3.5.44",
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
