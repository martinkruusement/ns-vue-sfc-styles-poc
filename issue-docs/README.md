# Upstream pull requests, ready to submit

Fourteen pull requests to three official repositories. Each is one commit on its own branch in the
clones next to this folder, based on the repository's `main` (V2 is stacked on V1). The branches
are pushed to the forks under `martinkruusement` (remote `fork` in each clone); no issue or PR
has been posted.

Each folder holds the exact texts:

- `meta.md`: repository, branch, PR title, issue title, dependencies and merge notes
- `issue.md`: the issue to file first (V1 closes the existing NativeScript/NativeScript#11185 instead)
- `pr.md`: the pull-request description

Placeholders are filled in when you post with `submit.mjs` (below): `{{ISSUE}}` is the PR's own
issue, `{{PR:<ID>}}` another PR from this list, `{{PROBE_APP_URL}}` the public URL of
vue-sfc-styles-demo.

## The pull requests

| ID | Repository | Branch | Title | Depends on |
| --- | --- | --- | --- | --- |
| V1 | NativeScript/NativeScript | `feat/vite-vue-sfc-styles` | feat(vite): compile Vue SFC `<style>` blocks for the device | — (closes #11185) |
| V2 | NativeScript/NativeScript | `fix/vite-sfc-style-dependency-hmr` | fix(vite): re-assemble Vue SFCs when a stylesheet their `<style>` depends on changes | V1 (stacked) |
| V3 | NativeScript/NativeScript | `fix/vite-css-cascade-order` | fix(vite): keep the cascade order when a tagged stylesheet is hot-replaced | — |
| V4 | NativeScript/NativeScript | `fix/vite-deps-bundle-patched-deps` | fix(vite): key the HMR deps-bundle disk cache on patched dependencies | — |
| V5a | NativeScript/NativeScript | `fix/vite-deps-bundle-exports-subpaths` | fix(vite): honor package exports maps for extensionless subpaths in the deps bundle | — |
| V5c | NativeScript/NativeScript | `fix/vite-minified-star-reexports` | fix(vite): detect minified export*from star re-exports | — |
| V6 | NativeScript/NativeScript | `fix/vite-hmr-boot-recording` | fix(vite): persist HMR boot recordings and merge partial boots | after V5a (recommended) |
| V7 | NativeScript/NativeScript | `fix/vite-css-updates-carry-text` | fix(vite): deliver compiled css in ns:css-updates instead of fetching it on the device | — |
| C1 | NativeScript/NativeScript | `fix/core-animation-shorthand-tokens` | fix(core): anchor the animation shorthand token classifiers | — |
| W1 | NativeScript/NativeScript | `fix/webpack-vue-css-modules` | fix(webpack): support CSS modules for Vue `<style module>` blocks | — |
| W2 | NativeScript/NativeScript | `fix/webpack-css-hmr-cascade-order` | fix(webpack): keep the cascade order when a stylesheet is hot-replaced | — |
| W3 | NativeScript/NativeScript | `fix/webpack-vue-loader-17` | fix(webpack): configure the Vue rules for vue-loader 17 | — |
| N1 | nativescript-vue/nativescript-vue | `feat/use-css-vars` | feat: add useCssVars and useCssModule for SFC `<style>` blocks | — |
| T1 | NativeScript/tailwind | `fix/animation-shorthand-expansion` | fix: expand animation shorthand with the current parser output and explicit time units | — |

The `meta.md` files hold the exact titles; the backticks above are only for display.

A fifteenth change, V5b (`fix/vite-deps-bundle-bare-builtins`, rewriting bare Node builtin imports in the
deps bundle to `node:`), was dropped from the series: on runtime 9.1 it only helps `util`, `url` and
`module`, and the Vite docs ask for Node-only packages to be kept out of `dependencies`. Its texts
are kept in [`dropped/V5b/`](dropped/V5b/) and its branch is still on the fork; it is not submitted.

### When branches touch the same files

The branches are independent of each other, but some edit the same files. Whichever lands later
needs a rebase:

- V1 and V3: `hmr/entry-runtime.ts` and `hmr/client/css-handler.spec.ts`. The PR that merges
  second must also delete a tag from `__NS_CSS_TAG_ORDER__` when an SFC registers `''`, in both
  `registerCss` (entry runtime) and `applyCssText` (client). Otherwise a later `app.css` edit brings
  back the rules of a removed `<style>` block.
- V3 and V7: `hmr/client/css-handler.ts` and its spec (V3's `keepCascadeOrder` sits next to V7's
  new `fetchText`).
- V7 and V2: two comments in `framework-strategy.ts` and `websocket-hot-update.ts`.

## Suggested order

1. C1, T1, W3 (each a few lines plus tests)
2. N1 (the runtime helper `v-bind()` needs, with both bundlers)
3. V5c, V5a, V4, then V6 (Vite dev-server fixes)
4. V7, then V3 and W2 (the cascade-order fix for each bundler)
5. V1, then V2 once V1 is merged (or as a stacked PR, saying so)
6. W1
