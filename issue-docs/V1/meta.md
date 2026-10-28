Repository: NativeScript/NativeScript
Branch: feat/vite-vue-sfc-styles
Base: main
PR title: feat(vite): compile Vue SFC <style> blocks for the device
Issue: #11185 (existing)
Depends on: none
Merge notes: V2 is stacked on this branch, so merge V1 first. Whichever of V1 and V3 merges second must also delete the tag from `__NS_CSS_TAG_ORDER__` when an SFC registers '' (entry-runtime `registerCss` and the client's `applyCssText`). Textual conflicts: with V3 in packages/vite/hmr/entry-runtime.ts and packages/vite/hmr/client/css-handler.spec.ts, and with V7 in packages/vite/hmr/client/css-handler.spec.ts (import line); whichever lands second rebases.
