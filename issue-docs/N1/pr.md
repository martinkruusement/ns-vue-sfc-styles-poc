## Problem

`@vue/compiler-sfc` compiles `color: v-bind(color)` in a `<style>` block to `color: var(--<id>-color)`. It also adds `useCssVars((_ctx) => ({ '<id>-color': _ctx.color }))` to the component's setup, imported from `vue`. Script code reads a `<style module>` class map with `useCssModule()`. Both helpers are exported by `@vue/runtime-dom` only.

nativescript-vue re-exports `@vue/runtime-core`, and both bundlers resolve `vue` to `nativescript-vue` (through `nativescript.webpack.js` for `@nativescript/webpack`, and in `@nativescript/vite`'s Vue config). So the import finds nothing, and a component with `v-bind()` in its `<style>` cannot run:

- `@nativescript/webpack`: setup throws `TypeError: (0 , vue__WEBPACK_IMPORTED_MODULE_0__.useCssVars) is not a function`. When the component is on the first page, the app crashes at start-up.
- `@nativescript/vite` without HMR (`--no-hmr` and release builds): the build fails, because Rolldown (Vite 8's bundler) rejects the import: `[MISSING_EXPORT] "useCssVars" is not exported by "node_modules/nativescript-vue/dist/index.js".`

## Change

New `src/cssVars.ts` ports both helpers from `@vue/runtime-dom`. `src/index.ts` exports them.

**`useCssVars(getter)`**

Same as runtime-dom:

- It finds the component's root view(s) through nested component roots and Fragment roots.
- It re-applies after each update of the component (`onBeforeUpdate` → `queuePostFlushCb`), and when the getter's reactive dependencies change (`watch(setVars, NOOP, { flush: 'post' })`, installed on mount). The write happens after the views are patched.
- `null` and `undefined` become `initial`.

The DOM write `style.setProperty('--x', value)` becomes core's css-variable API:

- Each variable is set with `view.style.setUnscopedCssVariable()` on the root view(s). `var()` on that view and, through core's parent-chain lookup, on every view inside it resolves the variable.
- `view._onCssStateChange()` then re-applies the CSS of the view and its descendants. A per-view record of the last written values skips the variables that did not change, and skips the restyle when none did. Several changes in one tick cost one restyle, and a re-render that changes no bound value costs none.
- The renderer's style module sets style properties one at a time, so the variables survive `:style` updates.

Differences from runtime-dom:

- **A child component that swaps the shared root** (a `v-if` root, a root `<component :is>`). runtime-dom uses a `MutationObserver`. Here an `updated` hook is registered on each child component the root lookup passes through.
- **Expression keys.** `v-bind('theme.size')` appears in the stylesheet as `var(--<id>-theme\.size)`, and core looks variable names up literally. So the escaped name (`getEscapedCssVarName`) is set next to the plain one.
- **Blank values become `unset`.** In the DOM, a blank custom property unsets the declaration that uses it. Core would apply the blank value literally.
- **No Teleport or Suspense handling.** Neither works in nativescript-vue: `<Teleport>` is listed as not supported, and `<Suspense>` cannot mount, because its hidden container is `createElement('div')`.

**`useCssModule(name = '$style')`**

Same as runtime-dom: it returns `instance.type.__cssModules[name]`, with the same dev warnings when there is no current instance, no modules, or no module of that name. Templates already read `$style` through runtime-core.

**Docs**

A new "`v-bind()` in `<style>`" section in Essentials → Gotchas. It covers:

- the scope: the variables are set on the component's root view, like an inline style, and the views inside it inherit them;
- the cost: each change re-applies the CSS of the root view and its descendants, so a value that changes every frame should use `:style`;
- which builds rewrite `v-bind()`: `@nativescript/webpack` and `@nativescript/vite` without HMR do, and the `@nativescript/vite` HMR dev server does not yet (NativeScript/NativeScript#11185);
- `useCssModule()`, and that `@nativescript/webpack` and the Vite HMR dev server do not generate a `<style module>` class map yet.

Closes #{{ISSUE}}

## Tests

New `test/css-vars.test.ts` with 16 tests. In the stubbed core (`test/stubs/nativescript-core.ts`), `ViewBase.style` is now a small `Style` class that keeps unscoped variables in a map. Other style properties stay plain fields, and every existing test passes unchanged.

`useCssVars`:

- sets the variables on the root view at mount and updates them (not on its descendants)
- passes the public instance as `_ctx`, the shape the compiler emits for the Options API
- sets the escaped name, checked against the name `compileStyle` writes into the stylesheet
- maps `''` and whitespace to `unset`, and `null`/`undefined` to `initial`
- restyles once per change, once when several bound values change in the same tick, and not on a re-render that changes no value
- writes a changed value to the new root, not the replaced one, when the root is swapped in the same tick
- keeps the variables across `:style` updates
- sets the variables on every root of a Fragment, and on a root that appears after mount
- keeps parent and child variables on a shared root
- re-applies when a child component replaces the shared root
- skips views without the css-variable API
- warns outside a component

`useCssModule`:

- returns the default and named modules, the same object as `$style`
- warns and returns `{}` when the modules are missing, or outside setup

Without `src/cssVars.ts` and the export, all 16 fail. Each of these changes also makes at least one of them fail: removing the child `updated` hook, removing the `onBeforeUpdate` re-apply, or changing the watcher to `flush: 'sync'` or `flush: 'pre'`.

The CI steps, run locally (Node 25.9.0):

| Command | This branch | `main` |
| --- | --- | --- |
| `npm run typecheck` | pass | pass |
| `npm run format:check` | pass | pass |
| `npm test` | 14 files, 87 passed | 13 files, 71 passed |
| `npm run build` | pass | pass |
| `npm pack --dry-run` | pass, adds `dist/cssVars.{js,d.ts,js.map}` | pass |
| `npm pack --dry-run ./packages/template-blank` | pass | pass |

On a device: this branch was not run on a device by itself. It was merged with the other changes of this series (in NativeScript/NativeScript and NativeScript/tailwind) into one combined build, whose nativescript-vue part is this branch unchanged. The probe app at {{PROBE_APP_URL}} was built against packages built from it, with no other patches. It ran on a Samsung SM-X356B tablet (Android 16, API 36) with Vite and with webpack, each in hot-reload and bundle mode. Each probe line was checked on screenshots.

- The `v-bind(color)` line and the `v-bind('theme.size')` line render with their bound values at start-up in all four modes.
- Tapping the `v-bind(color)` line switches its colour: pass with Vite hot reload and with webpack hot reload. This was not run in the two bundle modes.
- The Vite hot-reload results also depend on NativeScript/NativeScript#{{PR:V1}}, which is part of the combined build.
- `useCssModule()` was not exercised on the device: the probe reads `$style` in its template. The unit tests cover it.
- For comparison, the same app built with webpack and the published nativescript-vue 3.1.2 crashes at start-up on this device with the `useCssVars` error quoted above.

## Compatibility

- Additive: two new named exports. `@vue/runtime-core` exports neither name, so they do not clash with its `export *`. Only components with `v-bind()` in `<style>`, or that call `useCssModule()`, reach the new code. The renderer, the style module and nodeOps are unchanged.
- `@nativescript/core`: `Style.setUnscopedCssVariable` and `ViewBase._onCssStateChange` already exist in 8.9.0, the lowest version of the `>=8.9.0` peer range. A view whose `style` has no `setUnscopedCssVariable` is skipped.
- `@vue/shared`: `getEscapedCssVarName` and `normalizeCssVarValue` need 3.5.18 or later. The existing `^3.5.42` dependency covers that.
- Works with both bundlers, with no build-tool change. vue-loader 17 (`@nativescript/webpack`) and `@vitejs/plugin-vue` (`@nativescript/vite` without HMR) compile the script and the styles with the same id, so the names `useCssVars` sets match the `var()` names in the stylesheet. On the `@nativescript/vite` HMR dev server the import resolves, but `v-bind()` is not rewritten there until NativeScript/NativeScript#11185 is fixed, so the bound values have no effect yet.
- Known limits:
  - As in runtime-dom, variables are never removed. A hand-written getter that stops returning a key leaves its last value on the view.
  - The record of written values goes stale if code assigns a style string to a root view (`view.style = '...'`), because core's `applyInlineStyle` resets the unscoped variables. The renderer never does that.
- `useCssModule()` returns whatever the bundler injects as `__cssModules`:
  - `@nativescript/vite` without HMR injects a class map.
  - `@nativescript/webpack` injects the css2json stylesheet AST, so `useCssModule().title` and `$style.title` are `undefined` there.
  - The `@nativescript/vite` HMR dev server injects nothing.

## Related

- NativeScript/NativeScript#11185 and NativeScript/NativeScript#{{PR:V1}}: Vite compiles SFC `<style>` blocks, including `v-bind()` and `<style module>`, on the HMR dev server.
- NativeScript/NativeScript#{{PR:W1}}: `<style module>` class maps with `@nativescript/webpack`.
- This PR does not depend on either one, and neither depends on it. Once they ship, the two "not yet" sentences in the new docs section can be updated.
