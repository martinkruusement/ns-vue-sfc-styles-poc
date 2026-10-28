### Issue Description

This is a runtime error in `@nativescript/core`. The `animation:` shorthand parser (`keyframeAnimationsFromCSSProperty` in `packages/core/ui/styling/css-animation-parser.ts`) classifies each token with a regular expression that is not anchored to the whole token (`/\dm?s$/`, `/infinite|[\d.]+$/`, `/ease|linear|...|cubic-bezier/`, `/none|forwards|backwards|both/`, ...) and takes the first token left over as the name. A keyframe name that ends in a digit, or contains a keyword, can be taken for another field:

- `spin-7ba5bd90 1s linear infinite`: name `infinite`, iteration count `NaN`. The animation does not play.
- `pulse2 1s`: no name, iteration count `NaN`.
- `fade-in-2s 1s`: no name, duration `NaN`.
- `reverse-fade 1s`, `nonexistent 1s`, `both-ways 1s`: no name.
- `release-banner 1s`, or any name that contains `ease`, `linear`, `spring` or `cubic-bezier` and comes before any timing function: the name is passed to `animationTimingFunctionConverter`, which throws `Invalid value for animation: release-banner`. `CSSSource.parse()` catches the error and drops every rule of the stylesheet. The error goes only to `Trace`, and `app.css` is parsed when the bundle loads, before app code can enable tracing, so nothing is logged at launch.

Vue `<style scoped>` keyframes hit this often. Vue renames `spin` to `spin-<8 hex digits>`, so a scoped animation written with the shorthand fails in every component whose scope id ends in 0-9 (10 of the 16 values), unless an iteration count comes before the name. The scope id is a hash (with vue-loader in development, of the component's file path), so the same component stays affected across rebuilds. For example, with webpack, `app/components/ScopedB.vue` gets `spin-46404456` and does not animate, while `app/components/Scoped.vue` gets `spin-61eeab3d` and works. This happens with webpack, and with Vite in builds without HMR (`ns build`, `ns run --no-hmr`); the Vite HMR dev server does not scope `<style scoped>` blocks yet (#11185). The longhand `animation-name` works.

In projects that use `@nativescript/tailwind` 4.1.0 (the default in `ns create --vue`), its PostCSS step removes `animation:` shorthands at build time, so core never sees them and this bug does not show (NativeScript/tailwind#{{PR:T1}}).

Expected behavior: as in CSS, a token counts as a time, a number, a keyword or `cubic-bezier()` only when the whole token is one. `spin-7ba5bd90 1s linear infinite` gives the name `spin-7ba5bd90`, 1000 ms, linear, infinite iterations. `release-banner 1s` gives the name `release-banner`, and the rest of the stylesheet keeps applying.

Related: #10245 introduced these token classifiers when it rewrote the shorthand parser for 8.5.0.

A PR with the fix follows.

### Reproduction

In core's unit tests, on `main`: save this as `packages/core/ui/styling/animation-shorthand-repro.spec.ts` and run `npx vitest run ui/styling/animation-shorthand-repro.spec.ts` from `packages/core`. It passes on `main`, which shows the bug, and fails once the parser is fixed:

```ts
import { keyframeAnimationsFromCSSProperty } from './css-animation-parser';

it('animation shorthand misreads keyframe names', () => {
	const animations = [];
	keyframeAnimationsFromCSSProperty('spin-7ba5bd90 1s linear infinite', animations);
	expect(animations[0].name).toBe('infinite'); // expected: 'spin-7ba5bd90'
	expect(animations[0].iterations).toBeNaN(); // expected: Infinity

	expect(() => keyframeAnimationsFromCSSProperty('release-banner 1s', [])).toThrow('Invalid value for animation: release-banner'); // expected: no error
});
```

In an app, `CSSSource.parse()` runs this parser when a stylesheet is loaded. Create a Vue app without Tailwind: `ns create c1repro --vue`, then `npm uninstall @nativescript/tailwind tailwindcss` and delete `@import "tailwindcss";` from `app/app.css` (with Tailwind the shorthands are removed at build time, see above).

To use `@nativescript/vite` (needed for step 3), switch the app to `@nativescript/vite` 8.0.21 in the project folder:

```bash
npm install -D @nativescript/vite@8.0.21 && npx nativescript-vite init
npm uninstall @nativescript/webpack && rm webpack.config.js
npm install -D @vitejs/plugin-vue @vitejs/plugin-vue-jsx vite @vue/compiler-sfc vue vue-tsc
```

then add `bundler: 'vite',` and `bundlerConfigPath: 'vite.config.mts',` to `nativescript.config.ts`. (`nativescript-vite init` does neither the last install nor the config change.) Steps 1 and 2 behave the same with the template's `@nativescript/webpack` and with the Vite setup above; step 3 needs Vite.

Add this to the end of `app/app.css`:

```css
@keyframes spin-7ba5bd90 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes release-banner { from { opacity: 0; } to { opacity: 1; } }
.spin { animation: spin-7ba5bd90 1s linear infinite; }
.banner { animation: release-banner 1s; }
.red { background-color: red; }
```

and in the template of `app/components/Home.vue`, replace the `<GridLayout>` and its label with:

```xml
<StackLayout>
	<Label class="spin" text="spin" />
	<Label class="banner" text="banner" />
	<Label class="red" text="red" />
</StackLayout>
```

To see the log lines below, put `Trace.enable(); Trace.addCategories(Trace.categories.Animation);` (with `import { Trace } from '@nativescript/core'`) at the top of `app/app.ts`.

1. Run `ns run android`. No rule of `app.css` applies: the `red` label has no red background, and the ActionBar loses its `app.css` colour, because parsing `release-banner 1s` throws and the stylesheet is dropped. No `Style:` error is logged.
2. Remove the `.banner` rule and run the app again (with `@nativescript/vite`, the hot update while `ns run android` runs is enough). The red background and the ActionBar colour are back, but `spin` does not rotate: its parsed name is `infinite`, and its iteration count is `NaN`.
3. Optional, with `@nativescript/vite` and `ns run android` still running: put the `.banner` rule back. The hot update parses `app.css` again after app code has enabled tracing, the stylesheet is dropped again, and the `Style:` error below is printed.

### Relevant log output (if applicable)

```shell
# Step 1: no error is logged at launch. The error goes only to Trace (category Style),
# and app.css is parsed when the bundle loads, before app code can call Trace.enable().
# Step 2, with the Animation category enabled
Animation: No keyframes found for animation 'infinite'.
# Step 3 (hot update that parses app.css again)
Style: Css styling failed: Error: Invalid value for animation: release-banner
```

### Environment

```shell
NativeScript CLI: 9.1.1
@nativescript/core: 9.1.3 (the classifiers are the same from 8.5.0 to main at 6bb01eab6)
@nativescript/android: 9.1.1
@nativescript/webpack: 5.0.39, with vue-loader 17.4.2
@nativescript/vite: 8.0.21, with @vitejs/plugin-vue 6.0.10 and vite 8.3.5
nativescript-vue: 3.1.2
Node: 25.9.0
macOS: 26.5
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
