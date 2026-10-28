Repository: NativeScript/NativeScript
Branch: fix/vite-sfc-style-dependency-hmr
Base: main
PR title: fix(vite): re-assemble Vue SFCs when a stylesheet their <style> depends on changes
Issue title: [Vite, Vue] Editing a stylesheet that an SFC <style> imports does not update the component under HMR
Depends on: V1
Merge notes: Submit only after V1's PR exists: the issue links V1's PR, and `submit.mjs --refresh` updates PR bodies, not issues. Merge after V1. The branch contains V1's commit (85d66eda8) below its own; once V1 lands, rebase onto main so only the V2 commit remains. Trivial overlap with V7 in comments of framework-strategy.ts and websocket-hot-update.ts (the two branches' versions merge without conflict); whichever lands second rebases.
