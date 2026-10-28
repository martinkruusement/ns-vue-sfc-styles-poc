Repository: NativeScript/NativeScript
Branch: fix/vite-css-updates-carry-text
Base: main
PR title: fix(vite): deliver compiled css in ns:css-updates instead of fetching it on the device
Issue title: [vite] CSS hot updates never apply when the app replaces the global XMLHttpRequest (e.g. @nativescript/canvas-polyfill)
Depends on: none
Merge notes: Independent. Trivial comment overlap with V2 (framework-strategy.ts, websocket-hot-update.ts; merges without conflict). Textual conflicts with V1 and V3 in packages/vite/hmr/client/css-handler.spec.ts (import line; V2's branch shows the same one while it still carries V1's commit), and with V3 in css-handler.ts (keepCascadeOrder sits directly above fetchText; keep V3's function and V7's fetchText). Whichever lands second rebases.
