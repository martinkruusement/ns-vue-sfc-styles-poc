## Problem

`src/expandAnimations.js` uses the result of `parseSingle(decl.value)` from `@hookun/parse-animation-shorthand` as the parsed animation. Since 0.1.5 the parser returns `{ start, end, value }`; 0.1.4 returned the value object itself. The `^0.1.4` range resolves to 0.1.5 on a fresh install and in the release workflow (`npm install --no-package-lock`). Only this repo's `yarn.lock` still pins 0.1.4.

With 0.1.5 the plugin turns the wrapper into `animation-start`, `animation-end` and `animation-value` declarations and removes the shorthand. `removeUnsupported` then drops those. Every `animation:` declaration, except a value the parser rejects, disappears from every stylesheet the plugin processes (`app.css`, Vue SFC `<style>` blocks), with Vite and with webpack, so nothing declared with the shorthand animates:

```css
/* input */
.a { color: red; animation: spin 1s 2s ease-in-out infinite; }
/* output of 4.1.0 */
.a { color: red; }
```

Two more problems show once the result is unwrapped:

- **Time units** (already with 0.1.4). The parser returns times as millisecond numbers, and only durations that are a whole number of milliseconds were converted back (to seconds). Delays, and durations such as `333.3ms`, were written with no unit. Core's `timeConverter` multiplies a unit-less time by 1000, so `animation: spin 1s 2s` got `animation-delay: 2000`, a 2000-second delay.
- **Partial reads.** 0.1.5 stops reading at a `,`, or at the `(` of any function other than `cubic-bezier()` and `steps()`. For a list (`animation: a 1s, b 2s`) or a `var()` value (`animation: var(--animate-spin)`, from Tailwind v4's `animate-*` utilities), expanding the partial result would drop the rest of the value. 0.1.4 throws on both, and the plugin's `catch` keeps the shorthand.

## Change

- Use `parsed.value` when the parser returns the 0.1.5 wrapper, and the result itself otherwise.
- When the parser stopped before the end of the value (`parsed.end < decl.value.trimEnd().length`), keep the shorthand as written, as with 0.1.4. Core's own shorthand parser then handles comma-separated lists.
- Write `animation-duration` and `animation-delay` as `<n>ms`.

Output for the example above:

```css
.a { color: red; animation-name: spin; animation-iteration-count: infinite; animation-timing-function: ease-in-out; animation-delay: 2000ms; animation-duration: 1000ms; }
```

The rest of the output matches 0.1.4's: keyword longhands, `cubic-bezier()`/`steps()` serialization, `!important`, the order of the longhands, and keeping the shorthand when the parser throws.

Closes #{{ISSUE}}

## Tests

New `test/expand-animations.test.mjs` (`node:test`, like `test/parity.test.mjs`), 10 tests:

- expansion with ms times, including fractional and sub-second values;
- keywords, `cubic-bezier()`, `steps()`, `none` and `!important`;
- comma-separated lists and `var()` values kept as written;
- values the parser rejects, and longhands, left untouched;
- the 0.1.4 return shape, using a fresh copy of the plugin loaded against a `parseSingle` that returns the unwrapped value;
- the full `src/index.js` chain, so the longhands survive `removeUnsupported`.

| Command | `main` | This branch |
| --- | --- | --- |
| `node --test 'test/*.test.mjs'` (the release workflow's test step) | 15 passed | 25 passed (15 existing + 10 new) |

Measured with parser 0.1.5, the version the release workflow installs. With `src/expandAnimations.js` from `main`, 8 of the 10 new tests fail. The 2 that pass cover rejected values and longhands, which must not change. With the 0.1.4 that `yarn.lock` pins, all 25 pass as well: the 0.1.4-shape test builds that shape from whichever parser version is installed.

On a device: this branch was not run on a device by itself. It was part of one combined build of all the PRs in this series (NativeScript/NativeScript, nativescript-vue/nativescript-vue and this repository); this repository's code in that build is this branch, unchanged. The probe app ({{PROBE_APP_URL}}) depends on `@nativescript/tailwind`, so this plugin processes all its stylesheets. It was built against those packages and run on a Samsung SM-X356B tablet (Android 16) with `@nativescript/vite` and with `@nativescript/webpack`, each with hot reload and as a bundle. In all four runs, the probe line styled with `animation: probe-pulse 1s ease-in-out infinite alternate` in a `<style scoped>` block animates (checked from screenshots).

## Compatibility

- Both parser return shapes work, so the `^0.1.4` range and `yarn.lock` do not change.
- With parser 0.1.4, durations that are a whole number of milliseconds were written in seconds (`1s`, `0.25s`). They are now written in milliseconds (`1000ms`, `250ms`). Core reads both the same way.
- Delays, and durations that are not a whole number of milliseconds, change from a unit-less number, which core read as seconds, to `<n>ms`.
- The millisecond numbers come from the parser (`seconds * 1000`), so a few inputs carry float noise: `1.001s` gives `1000.9999999999999ms`, the same number that was written without a unit before. Core reads it correctly.
- With parser 0.1.5, `var()` values are kept instead of removed. Core reads `animation` from the raw declarations and does not resolve `var()` there, so Tailwind's `animate-*` utilities still need a change in core to animate.

## Related

- NativeScript/NativeScript#{{PR:C1}}: fixes core's own `animation:` shorthand parser, which misreads keyframe names that end in a digit (as Vue's scoped names can) or contain a keyword. This PR is still needed: the plugin currently removes `animation:` declarations before core sees them.
