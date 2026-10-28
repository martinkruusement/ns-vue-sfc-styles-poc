Repository: NativeScript/NativeScript
Branch: fix/vite-deps-bundle-bare-builtins
Base: main
PR title: fix(vite): route bare Node builtin imports through node: in the deps bundle
Issue title: [vite] HMR deps bundle keeps bare Node builtin imports like "util" that the device cannot resolve
Depends on: none
Merge notes: Independent. V4, V5a, V5c and V6 also edit packages/vite/hmr/server/deps-bundle.ts or its spec, in separate hunks; all merged into the combined branch without conflicts.
