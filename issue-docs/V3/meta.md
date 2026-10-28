Repository: NativeScript/NativeScript
Branch: fix/vite-css-cascade-order
Base: main
PR title: fix(vite): keep the cascade order when a tagged stylesheet is hot-replaced
Issue title: @nativescript/vite: a hot-replaced stylesheet moves to the end of the cascade with HMR (app.css starts winning equal-specificity ties)
Depends on: none
Merge notes: Whichever of V1 and V3 merges second must also delete the tag from `__NS_CSS_TAG_ORDER__` when an SFC registers '' (in `registerCss` and `applyCssText`). Textual conflicts with V1 (`hmr/entry-runtime.ts`, `hmr/client/css-handler.spec.ts`) and V7 (`hmr/client/css-handler.ts` and its spec) need a rebase for whichever lands later.
