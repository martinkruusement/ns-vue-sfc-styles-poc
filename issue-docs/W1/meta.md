Repository: NativeScript/NativeScript
Branch: fix/webpack-vue-css-modules
Base: main
PR title: fix(webpack): support CSS modules for Vue <style module> blocks
Issue title: @nativescript/webpack: Vue <style module> has no effect ($style is the css2json stylesheet AST, not a class map)
Depends on: none
Merge notes: No file overlap with the other PRs (only css2json-loader and its spec). Without W2, a hot edit of one style block of an SFC still drops its other blocks' rules, as on main. Without C1, an `animation` shorthand that uses a `<style module>` keyframes name does not play (the scoped name ends in a digit).
