## PR Checklist

- [x] The PR title follows our guidelines: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#commit-messages.
- [x] There is an issue for the bug/feature this PR is for. To avoid wasting your time, it's best to open a suggestion issue first and wait for approval before working on it.
- [x] You have signed the [CLA](http://www.nativescript.org/cla).
- [x] All existing tests are passing: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/DevelopmentWorkflow.md#running-unit-tests-application. The only failures also fail on untouched `main`: 16 configuration snapshot tests in `packages/webpack5` and 5 tests in `packages/vite/typescript-optional.spec.ts`.
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

`@nativescript/core` breaks ties between selectors of equal specificity by registration order. `removeTaggedAdditionalCSS(tag)` followed by `addTaggedAdditionalCSS(css, tag)` puts the tag at the end of the application selector list.

With HMR, `apply-css-loader` generates exactly that pair for every stylesheet it handles (`app.css`, `.css`/`.scss` imported from code, Vue SFC `<style>` blocks). It registers the css with `addTaggedAdditionalCSS(css, resourcePath)`, removes the tag in `module.hot.dispose`, and adds the css again when the module re-executes. So in an HMR session:

- After an `app.css` hot edit, `app.css` wins every equal-specificity tie against component stylesheets. At boot and in builds without HMR, `app.css` is registered first (`app-css-loader` imports it at the top of the entry) and loses those ties.
- A hot-edited component stylesheet moves behind every stylesheet registered after it.
- All `<style>` blocks of a `.vue` file share the file's path as their tag. Editing one block also removes the other blocks' rules, until a restart.
- In production-mode builds with HMR (`ns run --env.production`), the css is added without a tag, so the dispose removes nothing and the old rules stay next to the new ones.

Example: a Vue SFC `<style scoped>` block has `:global(.probe-global) { color: orange; }`. Adding `.probe-global { color: red; }` to `app.css` while the app runs turns the label red. A cold restart with the same files shows it orange.

## What is the new behavior?

For stylesheets that go through `apply-css-loader`, a hot-replaced stylesheet keeps its cold-start position in the cascade (exceptions under Known limitations).

- In HMR builds, the generated code collects the module's css (a local `addTaggedAdditionalCSS` pushes into an array) and passes it to a new runtime module, `apply-css-loader/hmr.runtime`. The loader requires it by an absolute path resolved with `require.resolve` at build time, so every stylesheet shares one instance.
- The runtime applies the css and records it in a `Map` on `globalThis.__NS_WEBPACK_CSS_TAG_ORDER__`, in first-registration order: tag -> webpack module id -> css. `Map.set` keeps a re-set key at its original position.
- When a hot update executes a stylesheet whose tag is already recorded, the runtime re-registers that tag and every tag recorded after it (`removeTaggedAdditionalCSS` + `addTaggedAdditionalCSS`). This includes a new module under a known tag, such as an added Vue `<style>` block or one whose `scoped` or `lang` attribute changed (both get a new module id).
- Modules that share a tag are tracked separately and re-added together, so editing one `<style>` block keeps the others.
- `module.hot.dispose` still removes the tag, and now also marks the module's entry `null`. A stylesheet removed from the graph (a deleted `<style>` block or import) is therefore not re-added by a later re-registration. It comes back only if its module executes again.
- Other tags are re-registered only while webpack applies an update (`module.hot.status() === 'apply'`). A stylesheet executed at any other time is appended, as before. Core may be scoping css to a page that is loading at that moment, and re-adding other tags then would scope them to that page.
- A module that executes again with unchanged css and no dispose in between is not added twice.
- An error thrown while tags are re-registered, or by the removal in the dispose, is caught, so the hot update still completes.

Builds without HMR generate the same code as before.

Closes #{{ISSUE}}.

## How it was tested

New spec `packages/webpack5/__tests__/loaders/apply-css-loader.spec.ts`, 21 tests:

- pins the generated code without HMR, for development and production and for both css2json-loader and css-loader output;
- pins the HMR code for the same four cases;
- runs the HMR code against a fake `module.hot` and a fake style-scope that keeps the registration order, disposing before re-executing as webpack does. It covers an `app.css` replace, a component replace, blocks that share a tag, a new block under a known tag, a block whose module id changes, unchanged css without a dispose, a disposed stylesheet that is not executed again, one that is re-executed inside and outside a hot update, the tag in production builds with HMR, and failing re-registration and dispose removal.

`cd packages/webpack5 && npx jest __tests__/loaders/apply-css-loader.spec.ts`: 21 passed. With `src/loaders/apply-css-loader/index.ts` taken from `main` (the spec still needs the new runtime file): 15 failed, 6 passed. The 6 are the 4 pins without HMR, the initial registration, and the append outside a hot update.

| Command | This branch | `main` (6bb01eab6) |
| --- | --- | --- |
| `npx nx run webpack5:test --skip-nx-cache` | 86 passed, 16 failed | 65 passed, 16 failed |
| `npx nx run core:test --skip-nx-cache` | 565 passed, 1 skipped | 565 passed, 1 skipped |
| `npx nx run vite:test --skip-nx-cache` | 1924 passed, 5 failed | 1924 passed, 5 failed |

- The 16 webpack5 failures are the snapshot tests in `__tests__/configuration/*.spec.ts`. Their snapshots contain machine-specific paths and a stale `FixSourceMapUrlPlugin` entry; none of the differences involve the css loaders. The 5 vite failures are in `typescript-optional.spec.ts`.
- `core:build`, `vite:build`, `webpack5:build` and `workspace-plugin:test` pass.
- `webpack5:lint` reports "Nothing to lint", as on `main`. `npx eslint --no-ignore` on the 3 changed files reports no problems. `npx nx format:check --base=main` is clean.

On a device: this branch was not run on a device by itself. The probe app at {{PROBE_APP_URL}} ran on a Samsung SM-X356B tablet (Android 16) against packages built from this PR merged with my other PRs, with no other changes: #{{PR:W1}} and #{{PR:W3}} for `@nativescript/webpack`, nativescript-vue/nativescript-vue#{{PR:N1}} (the probe uses `v-bind()` in CSS), and the ones for `@nativescript/vite`, `@nativescript/core` and `@nativescript/tailwind`. It ran with both Vite and webpack, each in an HMR session and as a bundle build. Each check was made by sampling pixel colours from screenshots. With webpack, every probe line is styled correctly at start-up, with HMR and in a bundle build. In a webpack HMR session:

- Adding an `app.css` rule with the same specificity as a component rule (red against the component's orange): the component rule still wins, and the rest of the `app.css` edit (an ActionBar colour change) applies. Before these changes, the label turned red and was orange again after a cold restart.
- Recolouring a scoped rule, then deleting it: the rule is replaced, not stacked.
- Editing a partial that a `<style>` block `@import`s, and editing a `<style module>` class: the new values apply.
- Deleting a child component's style blocks: its colours go, and the parent's `:deep` rule stays.

The same checks passed with Vite.

## Compatibility and risk

- **Builds without HMR:** the generated code is unchanged, and the spec pins it.
- **No new core API:** the runtime only calls `addTaggedAdditionalCSS` and `removeTaggedAdditionalCSS`, which the loader already used.
- **Runtime module:** a plain CommonJS module with no dependencies, built to `dist/loaders/apply-css-loader/hmr.runtime.js`. HMR builds always output CommonJS (`base.ts` sets `env.commonjs` when `env.hmr` is set). The path is embedded with `JSON.stringify`, so Windows backslashes are escaped.
- **Production builds with HMR** now register their css under its tag, so the dispose removes the old rules instead of leaving them in place.
- **Webpack runtime:** reordering relies on `module.hot.status()` returning `'apply'` while webpack 5 re-executes self-accepted modules. If it returns anything else, the stylesheet is appended, as on `main`.
- **Cost:** during an `app.css` hot update, every later stylesheet is now removed and re-added, and core rebuilds its rule sets. This is more work per `app.css` edit in apps with many component stylesheets.
- **Memory:** the map keeps an entry for every stylesheet module id seen in the HMR session (`null` once disposed).

Known limitations:

- **Css added at runtime is not tracked.** Only css that goes through `apply-css-loader` is recorded. Css added outside it (Angular component styles added by the renderer, Svelte's injected component css, `Application.addCss`, a theme added under its own tag) is not. After an `app.css` hot edit, `app.css` still lands after that css, as on `main`, and the tracked stylesheets re-registered after it now land after it too, where on `main` they kept their place. For example, in Angular (where only `app.css` and `node_modules` css go through the loader) a `node_modules` stylesheet imported from `main.ts` moves after the component styles. Restoring that order would need a positional insert in `@nativescript/core`.
- **Order inside one tag:** a `<style>` block whose module id changes (a `scoped` or `lang` attribute added) is re-added after its sibling blocks, so the blocks of that SFC can swap their tie order until a restart. On `main` the sibling blocks were dropped.
- **Deleted blocks:** deleting one of several `<style>` blocks of an SFC still removes the other blocks' rules until that tag is registered again, as on `main`.

## Related

- #{{PR:V3}}: the same bug in `@nativescript/vite` HMR, fixed with the same design (a first-registration-order map on `globalThis`, re-registering the tags after the replaced one).
