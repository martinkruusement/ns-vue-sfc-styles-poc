# Vue SFC styles on NativeScript

A NativeScript-Vue 3 test app for Vue single-file-component `<style>` features, with both the
Vite and the webpack bundler.

![test cases](showcase.png "Test cases")

## Why this exists

Vue components describe their styles in `<style>` blocks: scoped rules, `v-bind()` to drive CSS
from component state, CSS modules, SCSS, and so on. With NativeScript's Vite bundler, most of
this does not work during development
([NativeScript/NativeScript#11185](https://github.com/NativeScript/NativeScript/issues/11185)).
Under `ns run` and `ns debug`, styles come out unscoped, edits to them don't hot-reload properly,
and a component using `v-bind()` in CSS crashes. Some features also fail in production bundles.
With webpack, `v-bind()` in CSS crashes the app too, `<style module>` does nothing, and a
hot-edited stylesheet can start overriding rules it shouldn't.

A series of changes, each prepared as a pull request to the official packages, fixes this. This app depends on the published
packages and applies the series to them as patches when it is installed; it can also run on the
published packages as they are, or on local builds of the pull-request branches. Its test screen
shows at a glance whether each feature works.

## What the screen tests

The app opens on a single screen. Each line on it is styled by one feature and says what it
should look like ("expect green", "expect blinking", …), so a wrong colour or a missing effect
points at a broken feature.

| Feature | Example |
| --- | --- |
| Scoped styles | `<style scoped>` rules apply to this component only and don't leak into children |
| `:deep()`, `:global()`, `:slotted()` | reach into a child, style globally, style content passed into a slot |
| `v-bind()` in CSS | `color: v-bind(color)`; tap the line to change the colour live |
| CSS modules | `<style module>`, used through `$style` |
| SCSS | `<style lang="scss">` with variables |
| `@import` and `<style src>` | styles pulled in from separate `.css` files |
| Scoped `@keyframes` | `animation:` shorthand with a keyframe defined in the component |
| Platform rules | `.ns-android` ancestor selectors |

Live editing is part of the test: with the app running under `ns run` or `ns debug`, changing
any of these styles must update the screen without a restart, replacing the old rules instead of
piling up on them. Edit a rule in `app/components/sfc-style-tests/StyleProbe.vue` and watch it
update.

## Running it

You need Node.js 22.12 or later, the [NativeScript CLI](https://docs.nativescript.org/setup/) and
an Android device or emulator.

```bash
npm install
```

`package.json` pins the published versions of the packages. Installing them applies the pull
requests to them from [`patches/`](patches/) (a `postinstall` step, with
[patch-package](https://github.com/ds300/patch-package)), so the app works right away. Run it with
one of these scripts:

| Script | Runs the app with |
| --- | --- |
| `npm run android:vite` | Vite, hot reload |
| `npm run android:vite:bundle` | Vite, regular bundle build (`--no-hmr`) |
| `npm run android:webpack` | webpack, hot reload |
| `npm run android:webpack:bundle` | webpack, regular bundle build (`--no-hmr`) |

`ios:` variants of the same four exist. The webpack build installs as a separate app
(`org.nativescript.vuesfcstylesdemo.webpack`), so both can stay on the device side by side.

## Switching the packages

The five packages the series changes (`@nativescript/core`, `@nativescript/vite`,
`@nativescript/webpack`, `nativescript-vue` and `@nativescript/tailwind`) can come from three
sources. `package.json` and `package-lock.json` stay the same whichever is installed.

| Command | Installs |
| --- | --- |
| `npm run packages` | nothing: shows the source and version of each of the five |
| `npm run packages:patched` | the published versions with the patches applied (the default after `npm install`) |
| `npm run packages:published` | the published versions as they are |
| `npm run packages:local` | builds of local checkouts of the branches |

Each switch also clears the dev-server caches, so the next `ns run` uses the packages as they now
are. `npm ci` returns to the default. A plain `npm install` keeps what is installed, except that
it puts the published copy of a package back when the local build has a different version number;
`npm run packages` then reports mixed sources, and `npm run packages:local` restores the builds.

### The published packages as they are

```bash
npm run packages:published
```

On them the app does not start: the probe uses `v-bind()` in CSS, and with either bundler its
setup fails with `useCssVars is not a function`, because `nativescript-vue` 3.1.2 does not export
that helper. Vite with hot reload stops on a blank screen; webpack crashes.
`npm run packages:patched` brings the fixes back.

### The patches

Each patch is for the exact published version in its file name, which is the version
`package.json` pins:

| Patch | Changes it contains (one branch per planned pull request) |
| --- | --- |
| `@nativescript+vite+8.0.21.patch` | [Vue SFC `<style>` blocks](https://github.com/martinkruusement/NativeScript/tree/feat/vite-vue-sfc-styles), [stylesheet dependency HMR](https://github.com/martinkruusement/NativeScript/tree/fix/vite-sfc-style-dependency-hmr), [cascade order on hot updates](https://github.com/martinkruusement/NativeScript/tree/fix/vite-css-cascade-order), [`app.css` hot updates](https://github.com/martinkruusement/NativeScript/tree/fix/vite-css-updates-carry-text), and four HMR deps-bundle fixes: [patched dependencies](https://github.com/martinkruusement/NativeScript/tree/fix/vite-deps-bundle-patched-deps), [exports-map subpaths](https://github.com/martinkruusement/NativeScript/tree/fix/vite-deps-bundle-exports-subpaths), [minified star re-exports](https://github.com/martinkruusement/NativeScript/tree/fix/vite-minified-star-reexports), [boot recording](https://github.com/martinkruusement/NativeScript/tree/fix/vite-hmr-boot-recording) |
| `@nativescript+webpack+5.0.39.patch` | [CSS modules](https://github.com/martinkruusement/NativeScript/tree/fix/webpack-vue-css-modules), [cascade order on hot updates](https://github.com/martinkruusement/NativeScript/tree/fix/webpack-css-hmr-cascade-order), [vue-loader 17](https://github.com/martinkruusement/NativeScript/tree/fix/webpack-vue-loader-17) |
| `nativescript-vue+3.1.2.patch` | [`useCssVars` and `useCssModule`](https://github.com/martinkruusement/nativescript-vue/tree/feat/use-css-vars) |
| `@nativescript+tailwind+4.1.0.patch` | [`animation:` shorthand expansion](https://github.com/martinkruusement/tailwind/tree/fix/animation-shorthand-expansion) |
| `@nativescript+core+9.1.3.patch` | [`animation:` shorthand parsing](https://github.com/martinkruusement/NativeScript/tree/fix/core-animation-shorthand-tokens) |

The same patches can be copied into another app that uses these exact versions and applied with
patch-package. Remove each one once a release of its package contains the fix.

### Local checkouts of the pull-request branches

To test the branches themselves, clone the forks next to this project and check out their
`sfc-styles-demo` branch, which merges the whole series into `main` with the conflicts between the
branches resolved:
[NativeScript](https://github.com/martinkruusement/NativeScript/tree/sfc-styles-demo),
[nativescript-vue](https://github.com/martinkruusement/nativescript-vue/tree/sfc-styles-demo) and
[tailwind](https://github.com/martinkruusement/tailwind/tree/sfc-styles-demo). To test only some of
the changes, merge their branches into `main` yourself; the Vite branches edit some of the same
files, so expect conflicts. Run `npm ci` in the NativeScript and nativescript-vue clones, then:

```bash
npm run packages:local
```

This builds `@nativescript/core`, `@nativescript/vite` and `@nativescript/webpack` in the
NativeScript clone and `nativescript-vue` in its clone, and installs the five packages as copies in
place of the published ones. Run it again after changing a branch; `npm run packages:local -- --no-build`
installs what the clones have already built. The script looks for the clones as `NativeScript`,
`nativescript-vue` and `tailwind` in the parent folder of this project. `CHECKOUTS` names another
folder, and `NS_REPO`, `NSVUE_REPO` and `TAILWIND_REPO` name single clones:

```bash
CHECKOUTS=../forks npm run packages:local
```

```bash
NS_REPO=~/src/NativeScript npm run packages:local
```

A package whose clone is missing stays as it is, so a NativeScript clone alone tests its three
packages together with the patched `nativescript-vue` and `@nativescript/tailwind`.
`npm run packages:patched` goes back to the published packages with the patches.

## Tests without a device

```bash
npm test
```

These check part of the dev-server behaviour (`:slotted()` support) without a device. All six
pass with the patches applied or with local builds; on the published packages as they are, three
of them fail.

## Updating the patches

After a change to one of the pull requests, build `@nativescript/core`, `@nativescript/vite` and
`@nativescript/webpack` in two NativeScript clones, one at upstream `main` and one with the merged
series (`npm ci`, then `npx nx run-many -t build -p core,vite,webpack5` in each), and build
nativescript-vue with the merged series (`npm ci && npm run build`). Then regenerate the patches:

```bash
NS_MAIN=../NativeScript-main NS_INTEGRATION=../NativeScript NSVUE_FIX=../nativescript-vue TAILWIND_FIX=../tailwind npm run patches:generate
```

nativescript-vue and tailwind are compared with their published releases. The script writes a
patch only when every file it touches is the same in the published package and in the `main`
build, and after applying it to a copy of the published package reproduces the series build; it
removes patches for other versions of the same package. It runs on macOS and Linux.

## Where to find the details

| Path | Contents |
| --- | --- |
| [`app/components/sfc-style-tests/`](app/components/sfc-style-tests/README.md) | the probe components and tests, with a list of what each file covers |
| [`patches/`](patches/) | the pull requests of the series as patches for the published packages |
| [`scripts/`](scripts/) | the scripts behind `packages:*` and `patches:generate` |

## Status

Tested on an Android device (Android 16) with both bundlers, with hot reload and with bundle
builds. iOS has not been tested, though none of the changes is platform-specific. Each change is
meant to become its own pull request upstream, from the branches linked above.

## License

[MIT-0](LICENSE): use, copy and adapt anything here, upstream included, with no attribution
required.
