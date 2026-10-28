Repository: NativeScript/NativeScript
Branch: fix/webpack-vue-loader-17
Base: main
PR title: fix(webpack): configure the Vue rules for vue-loader 17
Issue title: [webpack] Vue 3 HMR builds log "Failed to patch VueLoader": the Vue config still targets vue-loader 15
Depends on: none
Merge notes: Independent. Touches only packages/webpack5/src/configuration/vue.ts, its spec and snapshot; the other webpack5 PRs in this series (W1, W2) change different files.
