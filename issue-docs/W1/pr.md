## PR Checklist

- [x] The PR title follows our guidelines: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#commit-messages.
- [x] There is an issue for the bug/feature this PR is for. To avoid wasting your time, it's best to open a suggestion issue first and wait for approval before working on it.
- [x] You have signed the [CLA](http://www.nativescript.org/cla).
- [x] All existing tests are passing: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/DevelopmentWorkflow.md#running-unit-tests-application. The only failures also fail on untouched `main`: 16 snapshot tests in `packages/webpack5/__tests__/configuration` (the snapshots hard-code another machine's paths) and 5 tests in `packages/vite/typescript-optional.spec.ts`.
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

vue-loader sets a component's `$style` to the default export of its `<style module>` block request (`Comp.vue?vue&type=style&index=N&id=<id>&module=true&lang=css`). It expects css-loader with `modules` enabled to export the class map there. `@nativescript/webpack` uses `css2json-loader` instead of css-loader, and css2json-loader has no CSS modules step. With this component:

```vue
<template>
  <Label :class="$style.title" text="Hello" />
</template>

<style module>
.title { color: #654321; }
</style>
```

- `$style` is the css2json stylesheet AST (`{"type":"stylesheet",...}`), so `$style.title` is `undefined`.
- The rule is registered with its original selector, `.title`, unscoped.
- `:global(.x)` stays in the selector as written and never matches. `composes:` stays as a declaration.

The label keeps the default colour. Nothing is logged.

## What is the new behavior?

`css2json-loader` compiles CSS modules requests. Only `packages/webpack5/src/loaders/css2json-loader/index.ts` and its spec change.

- **Which requests.** A request is a CSS module when its resource query has a `module` parameter other than `false`. vue-loader emits `module=true` for `<style module>` and `module=<name>` for `<style module="name">`. A plain `import s from './a.css?module'` matches too. Every other request takes the existing synchronous path and produces the same output as before.
- **Compiling.** The CSS goes through `compileStyleAsync({ modules: true })` from `@vue/compiler-sfc`, which bundles postcss-modules. `@vue/compiler-sfc` is already a dependency of `@nativescript/webpack`. It is required only on this path, and the loader goes async only for these requests.
- **Names.** postcss-modules' default `_<class>_<hash>_<line>` (also Vite's default). The hash is computed from the CSS the loader receives, so the same CSS always gets the same names.
- **Exports.** The class map is the module's CommonJS `module.exports`. The scoped stylesheet stays in `___CSS2JSON_LOADER_EXPORT___`, which apply-css-loader registers as before.
  - vue-loader 17 imports the block's default export. For a CommonJS module, webpack maps that to `module.exports`, so `$style` is the plain map.
  - vue-loader 15 wraps the block in an `import mod from req; export default mod; export * from req` proxy. In builds without HMR, and in its hot handler, it uses that proxy's namespace as `$style`. With CommonJS output, `export *` turns the class names into named exports, so they resolve there too. With an ES default export, that namespace would be `{ default: {...} }`.
- **Supported.** `:global()` and `:local()`, `composes` within the file, named modules, `lang="scss"` blocks, and `@keyframes` names together with the `animation` values that use them (see Compatibility for the `animation` shorthand). postcss-import inlines relative `@import`s before this loader runs, so their rules become part of the module. An `@import` it leaves in place is still turned into a `require()`, as before.
- **`composes: x from './other.css'`.** postcss-modules' default `FileSystemLoader` ends the Node process with an unhandled rejection when the file is missing or invalid. The loader passes its own `Loader` instead, which:
  - resolves the file with `this.getResolve()` and the options css-loader uses for `composes`, so `~/`, aliases and platform suffixes work;
  - adds it with `addDependency`, so editing it rebuilds the module;
  - inlines each composed file's scoped rules once, in import order;
  - fails the module with an error for a missing file, a syntax or other error in it, circular composes, a file that is not `.css`, and an `@import` inside it.
- **HMR.** apply-css-loader self-accepts the stylesheet module, so on its own a hot update that renames classes would re-register the CSS but leave the component with the old map.
  - In hot builds the module now keeps its class map in `module.hot.dispose` data. When the new map differs, it calls `module.hot.invalidate()`, as style-loader does.
  - The update then reaches the `module.hot.accept(request, …)` handler vue-loader registers for the block, which reassigns `cssModules` and rerenders the component.
  - When the map is unchanged, only the existing self-accept runs. Builds without HMR contain none of this code.

Closes #{{ISSUE}}.

## How it was tested

`cd packages/webpack5 && npx jest __tests__/loaders/css2json-loader.spec.ts`: 27 passed (3 existing, 24 new). The spec's `run()` helper now supports the async callback, `resourceQuery`, `hot`, an `enhanced-resolve` resolver and `addDependency`, and evaluates the generated module.

- 4 guards pin the exact output for a plain stylesheet, a vue style block, a scoped vue style block and `module=false`, and check that the loader stays synchronous.
- CSS modules (12): the map as `module.exports` with scoped selectors, including inside `@media`; CommonJS output whose exports are exactly the class names, including classes named `default` and `locals`; the same names on every build; keyframes; `:global()`/`:local()`; same-file `composes`; named modules; a Sass-compiled `lang="scss"` block; `@import` requires; syntax errors; HMR invalidation only when the map changes; `@vue/compiler-sfc` loaded only for CSS modules requests.
- `composes` from other files (8): inlined rules and watched files; `~/` resolution and one copy per file; six failure cases.
- With the loader from `main`, the 20 CSS modules and `composes` tests fail and the other 7 pass.

| Command | This branch | `main` (6bb01eab6) |
| --- | --- | --- |
| `npx nx run webpack5:test --skip-nx-cache` | 105 tests: 89 passed, 16 failed | 81 tests: 65 passed, 16 failed |
| `npx nx run core:test --skip-nx-cache` | 565 passed, 1 skipped | 565 passed, 1 skipped |
| `npx nx run vite:test --skip-nx-cache` | 1924 passed, 5 failed | 1924 passed, 5 failed |

- The failures are the same tests on both, listed in the checklist above.
- `core:build`, `vite:build`, `webpack5:build` and `workspace-plugin:test` pass. `npx nx format:check --base=main` is clean.
- `webpack5:lint` reports "Nothing to lint", as on `main`. `npx eslint --no-ignore` on the two changed files reports one error, `prefer-const` on the unchanged `let dependencies = []` line, which `main` reports too.
- Output for non-module requests was compared with `main`'s loader on 767 `.css` files, each with 8 non-module queries (none, vue block, scoped block, `module=false`, `?inline`, `?raw`, `?ngResource`, `?modules`), with and without `useForImports` and `hot`: 24544 runs, no difference in code, errors, or sync/async.

On a device: this branch was not run on a device by itself. The probe app at {{PROBE_APP_URL}} ran on a Samsung SM-X356B tablet (Android 16) against packages built from all the related PRs merged together: this one, #{{PR:W2}}, #{{PR:W3}}, nativescript-vue/nativescript-vue#{{PR:N1}}, and the other CSS fixes for `@nativescript/vite`, `@nativescript/core` and `@nativescript/tailwind`. Its `<style module>` check is one class read through `$style` in the template. Results with `@nativescript/webpack` (Vue 3, vue-loader 17.4.2), checked by sampling pixel colours from screenshots:

- The `<style module>` label has its colour at start-up, in an HMR session and in a `--no-hmr` build. Before these changes it was unstyled with webpack.
- In an HMR session, editing the `<style module>` class updates the label.
- Every other probe line passes in both modes.

Cross-file `composes`, named modules, `lang="scss"` modules, keyframes in a module and `useCssModule()` were not part of the device check. Vue 2 was not run on a device. It was checked only in a standalone webpack 5.112.2 build with vue-loader 15.9.8: every class resolves through `$style` in production (see Compatibility for the extra `default` key), and with HMR a hot update switches `$style` to the new names and rerenders.

## Compatibility and risk

- **Configuration unchanged.** The css/scss rules and their use names are unchanged, so nativescript-vue's `nativescript.webpack.js`, which re-points `vue-css-loader`, keeps working.
- **Only `module` requests change**, including a plain `import styles from './x.css?module'`. Their default export used to be the stylesheet AST, which no class lookup could use.
  - Visible change: `<style module>` rules used to be registered unscoped, so a static `class="title"` matched them by accident. They now apply only through `$style`, as in Vue on the web.
- **Class names.** Any change to a block's CSS renames all of its classes, because the hash covers the whole block. In `lang="scss"` blocks, names differ between development and production builds, because sass-loader compresses its output in production. Within one build, the map and the rules always match.
- **Keyframes in the `animation` shorthand.** Scoped keyframes names always end in a digit (`_<name>_<hash>_<line>`). `@nativescript/core`'s `animation` shorthand parser takes such a name for the iteration count, so a shorthand that uses a `<style module>` keyframes name does not play until #{{PR:C1}} is merged. `animation-name` is not affected.
- **Composed files** are read as is, without the loaders of their rule, so they must be plain `.css` without `@import`. Anything else fails the module with an error that says so.
- **Vue 2 (vue-loader 15).**
  - In builds without HMR, and after a hot update, `$style` is the proxy's namespace. It also holds vue-loader's `default` export (the whole map), so a class named `default` cannot be used through `$style` there.
  - vue-loader 15 reads `$style` as `style.locals || style`, so in a block with a class named `locals`, `$style` is that class's scoped name and none of the block's classes resolve.
  - Fixing either needs vue-loader 15 changes. Vue 3 (vue-loader 17) is not affected.
- **Existing on `main`, not changed here.** With HMR, all style blocks of one `.vue` file share apply-css-loader's tag (the file path). A hot update of one block, including a `<style module>` block, removes the other blocks' rules until a restart. #{{PR:W2}} fixes this.
- **Dependencies.** None added. `module.hot.invalidate()` needs webpack 5, which the `webpack` dependency range already requires.

## Related

- #{{PR:V1}}: the `@nativescript/vite` counterpart. It compiles `<style module>` blocks for the Vite HMR dev server.
- nativescript-vue/nativescript-vue#{{PR:N1}}: exports `useCssModule()`, which script code needs to read the class map. `$style` in templates works without it.
- #{{PR:W2}}: keeps an SFC's other style blocks when one block is hot-replaced.
