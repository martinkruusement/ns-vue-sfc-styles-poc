Repository: NativeScript/NativeScript
Branch: fix/vite-deps-bundle-exports-subpaths
Base: main
PR title: fix(vite): honor package exports maps for extensionless subpaths in the deps bundle
Issue title: [vite] HMR deps bundle ignores package exports for extensionless subpaths and picks stub or source files
Depends on: none
Merge notes: Independent. V4, V5c and V6 also edit packages/vite/hmr/server/deps-bundle.ts (V4 and V5c also its spec) in separate hunks; this branch merges cleanly with each of them, and with V5c in any order.
