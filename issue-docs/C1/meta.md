Repository: NativeScript/NativeScript
Branch: fix/core-animation-shorthand-tokens
Base: main
PR title: fix(core): anchor the animation shorthand token classifiers
Issue title: @nativescript/core: animation shorthand misreads keyframe names that end in a digit or contain a keyword, and can drop the whole stylesheet
Depends on: none
Merge notes: Independent; no other branch in this series touches packages/core or apps/automated. Once this ships, the keyframe rename in V1 can be removed in a follow-up (leaving it is harmless).
