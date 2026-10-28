Repository: NativeScript/NativeScript
Branch: fix/vite-deps-bundle-patched-deps
Base: main
PR title: fix(vite): key the HMR deps-bundle disk cache on patched dependencies
Issue title: [vite] HMR deps bundle disk cache is not invalidated when a dependency patch changes
Depends on: none
Merge notes: Independent. V5a, V5c and V6 also edit packages/vite/hmr/server/deps-bundle.ts (V5a and V5c also its spec) in hunks that do not overlap; all of them merged together without conflicts.
