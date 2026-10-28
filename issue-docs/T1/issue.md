## Problem

With `@nativescript/tailwind` 4.1.0 installed from npm, the plugin removes every `animation:` shorthand declaration that the parser accepts (in practice every valid one) from the CSS it outputs, so nothing declared with the shorthand animates. This affects every stylesheet the plugin processes (`app.css`, Vue SFC `<style>` blocks), with Vite and with webpack.

`package.json` depends on `@hookun/parse-animation-shorthand@^0.1.4`, which has resolved to 0.1.5 on every fresh install since 0.1.5 was published (2023-01-06). In 0.1.5, `parseSingle()` returns `{ start, end, value }` instead of the parsed value. `src/expandAnimations.js` uses the wrapper as the parsed value, so it replaces the shorthand with `animation-start`, `animation-end` and `animation-value`, and `removeUnsupported` then drops those. This repo's `yarn.lock` still pins 0.1.4, where the shorthand is expanded.

Comma-separated lists (`animation: a 1s, b 2s`) and `var()` values (`animation: var(--animate-spin)`, from Tailwind v4's `animate-*` utilities) are removed as well. 0.1.5 stops reading at a `,`, or at the `(` of any function other than `cubic-bezier()` and `steps()`, and returns what it has read so far instead of throwing, so the plugin no longer keeps the value as written (and a fix that only unwraps the result would expand just the part before that point). 0.1.4 throws on both, and the plugin keeps them.

A second bug is already visible with 0.1.4, and would remain with 0.1.5 once the result is unwrapped. The parser returns times in milliseconds, but only durations that are a whole number of milliseconds are converted back (to seconds). Delays, and durations such as `333.3ms`, are written with no unit, and core's `timeConverter` reads a unit-less time as seconds. `animation: spin 1s 2s` gets `animation-delay: 2000`, a 2000-second delay.

Related: #67 added `expandAnimations.js`, and #152 was an earlier parser error in the same function, fixed by catching the parser's exceptions.

A PR with the fix follows.

## Reproduction

In an empty directory, run `npm init -y && npm install @nativescript/tailwind postcss` (`npm ls @hookun/parse-animation-shorthand` then shows 0.1.5), and add:

```js
// repro.mjs
import nsTailwind from '@nativescript/tailwind';

const { css } = await nsTailwind.process(
  '.a { color: red; animation: spin 1s 2s ease-in-out infinite; }',
  { from: undefined },
);
console.log(css);
```

`node repro.mjs` prints:

```css
.a { color: red; }
```

To see the second bug, force the parser version this repo's `yarn.lock` pins: add `"overrides": { "@hookun/parse-animation-shorthand": "0.1.4" }` to `package.json`, run `npm install` again, then `node repro.mjs`. It prints:

```css
.a { color: red; animation-name: spin; animation-iteration-count: infinite; animation-timing-function: ease-in-out; animation-delay: 2000; animation-duration: 1s; }
```

`animation-delay: 2000` has no unit, which core reads as 2000 seconds.

In an app created with `ns create <name> --vue` (NativeScript CLI 9.1.1, which installs this plugin), add `@keyframes blink { from { background-color: #ff0000; } to { background-color: #0000ff; } }` and `.probe-app { animation: blink 1s 2s ease-in-out infinite; }` to `app/app.css`, and in `app/components/Home.vue` change the `<GridLayout>` (and its closing tag) to `<StackLayout>` and add `<Label class="probe-app" text="app.css animation" height="120" />` inside it. For the SFC case, add a `<style>` block (not scoped) to `app/components/Home.vue` containing `.probe-sfc { animation: blink 1s ease-in-out infinite alternate; }`, plus `<Label class="probe-sfc" text="SFC style animation" height="120" />` in the same `<StackLayout>`. `@keyframes blink` stays in `app/app.css`.

The app as created (no bundler changes) is the webpack case. For the Vite case, make a copy of the app folder and switch the copy to `@nativescript/vite` 8.0.21 in its project folder:

```bash
npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
npm uninstall @nativescript/webpack && rm webpack.config.js
npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
```

then add `bundler: 'vite',` and `bundlerConfigPath: 'vite.config.mts',` to `nativescript.config.ts`. (`nativescript-vite init` does neither the last install nor the config change.)

Run each of the two apps as a bundle, without HMR, with `ns run android --no-hmr` (or `ns build android`). Neither Label animates, with webpack or with Vite, and the rules are missing from the compiled bundle.

## Expected behaviour

The shorthand is expanded into longhands that core reads, with explicit time units:

```css
.a { color: red; animation-name: spin; animation-iteration-count: infinite; animation-timing-function: ease-in-out; animation-delay: 2000ms; animation-duration: 1000ms; }
```

A value the plugin cannot expand in full is kept as written instead of being removed or cut short: a comma-separated list (`animation: a 1s, b 2s`), which core's own shorthand parser handles, or a `var()` value (`animation: var(--animate-spin)`).

## Environment

- `@nativescript/tailwind` 4.1.0. `src/expandAnimations.js` and the `^0.1.4` range have not changed since 2.0.1.
- `@hookun/parse-animation-shorthand` 0.1.5
- `postcss` 8.5.31, `tailwindcss` 4.3.3
- `@nativescript/core` 9.1.3, `@nativescript/vite` 8.0.21, `@nativescript/webpack` 5.0.39
- Node 25.9.0, macOS 26.5
