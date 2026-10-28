Repository: NativeScript/NativeScript
Branch: fix/webpack-css-hmr-cascade-order
Base: main
PR title: fix(webpack): keep the cascade order when a stylesheet is hot-replaced
Issue title: @nativescript/webpack: a hot-replaced stylesheet moves to the end of the cascade with HMR (app.css starts winning equal-specificity ties)
Depends on: none
Merge notes: No file overlap with W1 or W3, and independent of V3 (separate package and global), so these can merge in any order.
