## PR Checklist

- [x] The PR title follows our guidelines: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#commit-messages.
- [x] There is an issue for the bug/feature this PR is for. To avoid wasting your time, it's best to open a suggestion issue first and wait for approval before working on it.
- [x] You have signed the [CLA](http://www.nativescript.org/cla).
- [x] All existing tests are passing: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/DevelopmentWorkflow.md#running-unit-tests-application. The only failures also fail on untouched `main`: 5 tests in `packages/vite/typescript-optional.spec.ts` (`The "paths[1]" argument must be of type string`) and 16 snapshot tests in `packages/webpack5/__tests__/configuration` (stale snapshots that hard-code another machine's paths).
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

On the `@nativescript/vite` HMR dev server, `/ns/asm` assembles each Vue SFC and registers its `<style>` css under the tag `sfc:<path>`. This path differs from a bundle build in several ways:

- **Every block compiles unscoped.** `compileSfcStylesToCss` passes plain css through as written, without the app's postcss config (Tailwind) or Vite's `@import` handling, and compiles preprocessor blocks with `scoped: false` and the placeholder id `data-v-nshmr`.
  - `<style scoped>` rules apply to every component.
  - `:deep()`, `:global()`, `:slotted()` and `v-bind()` do not work.
  - `<style src>` blocks are skipped, because they have no inline content.
  - `<style module>` gets no class map, so `$style` is undefined.
- **The assembler uses its own component id.** It compiles script and template with `md5(<absolute path>)` instead of plugin-vue's `descriptor.id`, never passes `scoped`/`slotted` to `compileTemplate`, and never attaches `__scopeId` or `__cssModules`. Scoped css could not match even if it were compiled, and slot content never gets the `data-v-<id>-s` attribute that `:slotted()` targets.
- **`/ns/sfc-meta`** always reports `hasStyle: false`, and answers 500 when a variant transform throws (an SFC without `<script>`).
- **The style variant** (`/ns/sfc/<file>.vue?vue&type=style…`) answers `export {}`, or a 404 module that throws when the variant transform fails (the error in #11185).
- **Style-only edits are always render-only** (Vue `rerender`), including the ones that change the component definition: toggling `scoped`, a `v-bind()`, a `<style module>` class, the first `:slotted()` rule. A rerender keeps the old definition, so live instances do not pick these up.
- **Removed styles stay.** When an SFC loses its last `<style>` block, `/ns/asm` emits no register call, so the old rules remain until restart.
- **`VUE_STYLE_IMPORTS`** (the Vue strategy's `preClean` strip) matches only `.vue?type=style`. @vitejs/plugin-vue emits `.vue?vue&type=style&index=N…`, so its style imports are not stripped.
- **Scoped keyframes can fail to play in Vue bundle builds.** Vue renames scoped keyframes (`spin` -> `spin-7ba5bd90`). Core's `animation:` shorthand parser takes any token matching `/infinite|[\d.]+$/` for the iteration count, so a name whose id ends in a digit is not read as the name and the animation does not play.

## What is the new behavior?

**Style compilation** (`compileSfcStyles` in `sfc-route-shared.ts`, replacing `compileSfcStylesToCss`):

- Each block goes through the Vite css pipeline with the sub-request @vitejs/plugin-vue emits for it, plus `&inline` (`?vue&type=style&index=N[&src=…]&inline[&scoped=<id>]<attrs>&lang.<ext>`). The app's postcss config (Tailwind included), preprocessors, `@import`, scoping and `v-bind()` run as in a bundle build. If the pipeline fails, the block is compiled with `@vue/compiler-sfc`, scoped with the same id.
- `<style module>` blocks always compile with `@vue/compiler-sfc`, using Vite's `css.modules` options, so the css and the class map come from one run.
- `<style src>` resolves through the dev server's resolver, as plugin-vue resolves it, so relative, root-relative and alias paths work. The file is requested under its own path (`/@fs/…` when outside the root).
- The pipeline rebases `url()`s to dev-server paths (`/src/assets/x.png`), which the device would read as absolute file paths. Urls under the app directory are turned back into `~/` urls; all other urls are left as they are.
- A block that cannot be read or compiled is skipped and reported as failed.

**`/ns/asm`:**

- Runs plugin-vue's main transform on the bare path (replacing the unused `?vue` warm-up request) and reads the component id from its `__hmrId`. Without one, it recomputes the id as plugin-vue's `createDescriptor` does: sha256 of the root-relative path, plus the source in production. Script, template and styles all use this id.
- Compiles the template with `scoped` and an explicit `slotted` (compiler-core treats an omitted `slotted` as true), and takes `isProd` from the dev server's `config.isProduction`, as plugin-vue does.
- Attaches `__scopeId` (when a block is scoped) and `__cssModules` the same way it attaches `__hmrId`, in both emit paths.
- `:slotted()` needs no device code: Vue's `renderSlot` stamps `data-v-<id>-s` on slot content, nativescript-vue sets it on the native view, and core's attribute selectors match it.

**Removing rules:**

- When an SFC has no style rules left and no block failed, `/ns/asm` registers `''` under its `sfc:<path>` tag. Both device appliers (`registerCss` in `entry-runtime.ts` and the client's `applyCssText`) take `''` for an `sfc:` tag as "remove this tag's rules", and restyle only if something was removed.
- `''` is still ignored for every other tag (`app.css`, imported `.css` files, Angular `styleUrls`).
- When the css is empty because a block failed to compile (for example a syntax error mid-edit), nothing is registered and the device keeps the previous rules. If another block of the SFC still compiles, its css replaces the tag's rules.

**Change classification** (`sfcScriptSignature`) now also covers what the styles put into the component definition: whether any block is scoped, the `<style module>` blocks (name, lang, src, content), `descriptor.slotted` and `descriptor.cssVars`. These edits are now classified `full`, so the client reloads the component (Vue `reload`) instead of rerendering it:

- the component gaining or losing scoped styles
- a `v-bind()` change
- a `<style module>` change
- adding the first or removing the last `:slotted()` rule of a scoped block

Every other style edit stays render-only, including adding a plain block or changing the `lang` of a block that is not a module.

**Routes:**

- `/ns/sfc-meta` reports `hasStyle`, `styleCount`, `scoped`, `slotted`, `cssModules`, `cssVars` and `scopeId`. Variant transforms are guarded, so an SFC without `<script>` gets `hasScript: false` instead of a 500.
- The style variant serves the block's compiled css as `export default "<css>"`. It is for inspection and registers nothing; `/ns/asm` still registers the SFC's styles.

**Other:**

- `VUE_STYLE_IMPORTS` also matches `.vue?vue&type=style…`.
- Keyframes names of Vue's scoped form (`<name>-<8 hex>`) that end in a digit get an `x` appended, in the `@keyframes` rule and in every reference. This applies to SFC css under HMR and to Vue bundle builds (`helpers/main-entry.ts`); bundle css of other flavors is unchanged. It is a workaround until core's shorthand parser is fixed (#{{PR:C1}}).

Components that use `v-bind()` in `<style>` need a nativescript-vue release that exports `useCssVars` (nativescript-vue/nativescript-vue#{{PR:N1}}). The compiled script already called `useCssVars` before this change, so this PR adds no new requirement.

Known limitations:

- `@vue/compiler-sfc` sets `descriptor.slotted` from inline scoped blocks only. `:slotted()` rules that exist only in a `<style scoped src>` file or an `@import`ed file do not turn on slot stamping. Bundle builds behave the same.
- `<style module>` blocks, and blocks the pipeline cannot compile, are compiled by `@vue/compiler-sfc` alone: no app postcss config, no Vite `@import` or url handling. No block got these before this change either.
- With postcss-modules' default naming, `<style module>` keyframes become `_<name>_<hash>_<line>`, which always ends in a digit, so an `animation:` shorthand that uses one does not play. Renaming them would also mean changing the class map, so they wait for the core parser fix.
- A custom `features.componentIdGenerator` is honoured only when its id appears as a hex `__hmrId`.
- Editing an `@import`ed or `src` stylesheet does not re-assemble the SFC yet. #{{PR:V2}} adds that.

Closes #11185

## How it was tested

New and updated specs sit next to the sources: `sfc-route-shared`, `sfc-route-assemble`, `sfc-route-meta`, `sfc-route-serve`, `sfc-change-kind`, `websocket-sfc`, `css-device-module`, `constants`, `entry-runtime`, `client/css-handler`, `client/index` and `helpers/main-entry` (12 spec files, 6 of them new; the vite suite has 81 more tests than on `main`). Besides the new behaviour, they pin what must not change: unscoped SFC output, non-Vue bundle css, `''` being ignored for `app.css` and other non-SFC tags, an empty fetched component update keeping its tag, and render-only edits.

Each command was run with `--skip-nx-cache`, on this branch and on `main` (`6bb01eab6`):

| Command | `main` | This branch |
| --- | --- | --- |
| `npx nx run vite:test` | 165 files, 1924 passed, 5 failed | 171 files, 2005 passed, 5 failed (the same 5) |
| `npx nx run core:test` | 565 passed, 1 skipped | 565 passed, 1 skipped |
| `npx nx run webpack5:test` | 65 passed, 16 failed | 65 passed, 16 failed (the same 16) |
| `npx nx run workspace-plugin:test` | pass | pass |
| `npx nx run core:lint` | 0 errors, 22 warnings | 0 errors, 22 warnings |
| `npx nx run vite:lint` | 3 errors | the same 3 errors (`configuration/base.ts` no-fallthrough x2; `css-device-module.ts:24` no-irregular-whitespace, a line this PR does not change) |
| `npx nx run core:build`, `vite:build`, `webpack5:build` | pass | pass |

`npx prettier --check` on the changed files: clean.

On a device: this branch was not run on a device on its own. It was run as part of one build that merges this PR with #{{PR:V2}}, #{{PR:V3}}, #{{PR:V4}}, #{{PR:V5a}}, #{{PR:V5c}}, #{{PR:V6}}, #{{PR:V7}}, #{{PR:C1}}, #{{PR:W1}}, #{{PR:W2}}, #{{PR:W3}}, nativescript-vue/nativescript-vue#{{PR:N1}} and NativeScript/tailwind#{{PR:T1}}. Resolving the merge conflict with #{{PR:V3}} added the `__NS_CSS_TAG_ORDER__` deletion described under "Interaction with other PRs"; nothing else was changed. The probe app ({{PROBE_APP_URL}}) was built against those packages and run on a Samsung SM-X356B tablet (Android 16) with both `@nativescript/vite` and `@nativescript/webpack`. Each probe line was checked by sampling its colour from screenshots. The checks this PR is responsible for, on Vite:

- Every probe line at start-up, with hot reload and as a bundle: pass. The lines cover scoped, `:global`, `v-bind()` and expression, scss, a platform ancestor selector, no leak into a child, `:deep`, `<style src>`, scoped keyframes animating, `<style module>`, `@import`, every `:slotted` case, and an unstyled control. The probe's scope id ends in a letter, so the keyframes rename is covered by the unit tests only.
- Hot reload: recolouring a scoped rule and then deleting it (replaced, not stacked): pass.
- Hot reload: editing the `<style module>` class: pass.
- Hot reload: deleting a child's style blocks (its colours go, the parent's `:deep` rule stays): pass.
- Hot reload: tapping the `v-bind()` line (reactive colour): pass. Not run as a bundle.
- The probe's headless tests (`npm test`) against the combined Vite build: 6 of 6 pass.

Tools: NativeScript CLI 9.1.1, @nativescript/android 9.1.1, vite 8.3.5, @vitejs/plugin-vue 6.0.10, tailwindcss 4.3.3, Node 25.9.0, macOS 26.5.

## Compatibility and risk

- Under HMR, `<style scoped>` rules now apply only to their own component, as they already do in bundle builds. An app that relied on them leaking to other components under HMR will see them stop applying there.
- Plain and preprocessor blocks now go through the app's postcss config under HMR, as in bundle builds.
- Under HMR, `url()`s that resolve into the app directory are registered as `~/` urls, so the file must ship with the app (`assets/` and `fonts/` are copied by default). Bundle builds keep plugin-vue's url handling; this PR does not change it.
- Non-Vue flavors are unaffected: the SFC routes load only with the Vue strategy (`websocket-framework-isolation.spec.ts` passes), the bundle keyframes rename runs only for the `vue` flavor, and `''` is acted on only for `sfc:` tags.
- An SFC without styles now registers `''` when it is evaluated. That costs one `removeTaggedAdditionalCSS` call, which finds nothing and restyles nothing unless the tag had rules.
- `/ns/asm` now runs plugin-vue's main transform for each SFC. Vite caches the result.
- With `isProduction: true` and HMR (rare), the id includes the source. A render-only edit to an SFC with scoped styles then keeps the old `__scopeId` while its css is registered with the new id.

### Interaction with other PRs

#{{PR:V3}} records each tagged stylesheet other than `app.css`, with its css, in `globalThis.__NS_CSS_TAG_ORDER__` and re-registers them to keep the cascade order. This PR adds a path that removes an `sfc:` tag when the SFC registers `''` (in `registerCss` in `entry-runtime.ts` and in the client's `applyCssText`). Whichever of the two merges second must also delete the tag from `__NS_CSS_TAG_ORDER__` on that path. Otherwise a later re-registration brings the removed rules back, and registering the same css again is skipped as unchanged.

## Related

- nativescript-vue/nativescript-vue#{{PR:N1}}: exports `useCssVars`, needed for runtime `v-bind()` with both bundlers.
- #{{PR:V2}}: re-assembles SFCs when an `@import`ed or `src` stylesheet changes. Builds on this PR.
- #{{PR:V3}}: keeps the cascade order when a tagged stylesheet is hot-replaced (see above).
- #{{PR:W1}}: `<style module>` support for `@nativescript/webpack`.
- #{{PR:C1}}: fixes core's `animation:` shorthand parser; the keyframes rename here works around that bug until apps run a core with the fix.
