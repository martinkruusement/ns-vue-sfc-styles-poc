Repository: NativeScript/NativeScript
Branch: fix/vite-hmr-boot-recording
Base: main
PR title: fix(vite): persist HMR boot recordings and merge partial boots
Issue title: [vite] HMR boot recording is never saved, and a short boot replaces the recorded closure
Depends on: none
Merge notes: No code dependency; the branch merges cleanly with V4, V5a and V5c. Merging after V5a is recommended, since recorded boots reach more deps-bundle code paths.
