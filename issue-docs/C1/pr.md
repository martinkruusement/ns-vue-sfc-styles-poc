## PR Checklist

- [x] The PR title follows our guidelines: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#commit-messages.
- [x] There is an issue for the bug/feature this PR is for. To avoid wasting your time, it's best to open a suggestion issue first and wait for approval before working on it.
- [x] You have signed the [CLA](http://www.nativescript.org/cla).
- [x] All existing tests are passing: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/DevelopmentWorkflow.md#running-unit-tests-application. The only failures also fail on untouched `main`: 5 tests in `packages/vite/typescript-optional.spec.ts` and 16 configuration snapshot tests in `packages/webpack5`.
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

`keyframeAnimationsFromCSSProperty` in `packages/core/ui/styling/css-animation-parser.ts` splits an `animation:` shorthand into tokens and classifies each token with a regular expression that is not anchored to the whole token (`/\dm?s$/`, `/infinite|[\d.]+$/`, `/ease|linear|...|cubic-bezier/`, `/none|forwards|backwards|both/`, ...). The name is the first token that no classifier took. So a keyframe name that ends in a digit, or contains a keyword, can be taken for another field:

| `animation:` value | Parsed on `main` |
| --- | --- |
| `spin-7ba5bd90 1s linear infinite` | name `infinite`, iterations `NaN` |
| `pulse2 1s` | no name, iterations `NaN` |
| `fade-in-2s 1s` | no name, duration `NaN`, delay 1000 |
| `reverse-fade 1s`, `nonexistent 1s`, `both-ways 1s` | no name |
| `release-banner 1s` | throws `Invalid value for animation: release-banner` |

- Without its name, the animation does not play.
- Vue's `<style scoped>` renames keyframes to `<name>-<8 hex digits>` (`spin` becomes `spin-7ba5bd90`), with webpack and with Vite. A scoped animation written with the shorthand fails whenever the last hex digit is 0-9 (10 of the 16 values), unless an iteration count comes before the name.
- A name that contains `ease`, `linear`, `spring` or `cubic-bezier` (`release-banner` contains `ease`) and comes before any timing function is passed to `animationTimingFunctionConverter`, which throws. `CSSSource.parse()` catches the error and sets `_selectors = []`, so no rule of that stylesheet applies. The error is logged only when tracing is enabled.
- The longhand `animation-name` is not affected.

## What is the new behavior?

Each classifier now has to match the whole token:

- Times and iteration counts: CSS number syntax, with an optional sign, decimals with or without a leading zero, and an optional exponent (`.5s`, `+1s`, `1e3ms`, `2.5`, `1e1`). Times still end in lowercase `s` or `ms`.
- Keywords: exact matches, from the same lowercase sets as before.
- `cubic-bezier(`: anchored at the start only. A token that starts with it still goes to `animationTimingFunctionConverter`, which validates it as before. This keeps the existing spec input `cubic-bezier(0.42, 0.0, 1.0, 1.0);` working. Whitespace inside the parentheses was already kept in one token by `VALUE_SPLIT_RE`.

Each new expression matches a subset of what the old one matched, including every supported value the old one matched, so those values are classified as before. A token that only contains a keyword, or only ends in a digit, is no longer taken, so it remains available as the name. The examples above now give the names `spin-7ba5bd90` (1000 ms, linear, infinite), `pulse2`, `fade-in-2s`, `reverse-fade`, `nonexistent`, `both-ways` and `release-banner`, with the other fields as written, and the stylesheet is kept.

Closes #{{ISSUE}}.

## How it was tested

6 new tests in `packages/core/ui/styling/css-animation-parser.spec.ts`:

- 18 names that contain a keyword or end in a digit (`spin-7ba5bd90`, `pulse2`, `flash-250ms`, `release-banner`, `cubic-bezier-wave`, `nonexistent`, `both-ways`, ...). Each is tested with only a duration, before and after all other fields (`2s ease-in 1s 3 reverse forwards paused`), and single- and double-quoted.
- Every field next to `spin` and next to `spin-7ba5bd90`, with `cubic-bezier(0.1, 0.7, 1, 0.1)`.
- Two comma-separated animations whose names end in a digit.
- Every keyword placed before a name (`1s <keyword> fade`). This includes keywords whose value equals the default (`ease`, `normal`, `running`, ...), which no other test would notice going unclassified.
- Every time form as duration and delay (`.5s`, `+1s`, `1e3ms`, `1E3ms`, `2.5e-1s` and the existing ones), and negative delays.

Existing tests get more inputs: iteration counts `0`, `.5`, `+2`, `1e1`, and `cubic-bezier()` without spaces and with spaces inside the parentheses.

With the parser from `main`, the 3 tests in the first three bullets fail. The other 3 cover behaviour that must not change and pass on both.

`apps/automated/src/ui/animation/css-animation-tests.ts` gets `test_ReadTheAnimationPropertyWithKeywordOrDigitInName`. Through `StyleScope`, it checks that `spin-7ba5bd90 1s linear infinite` and `release-banner 1s` parse with the right fields, and that the `release-banner` stylesheet is not dropped.

| Command | This branch | `main` (6bb01eab6) |
| --- | --- | --- |
| `npx nx run core:test --skip-nx-cache` | 571 passed, 1 skipped | 565 passed, 1 skipped |
| `npx nx run vite:test --skip-nx-cache` | 1924 passed, 5 failed | 1924 passed, 5 failed |
| `npx nx run webpack5:test --skip-nx-cache` | 65 passed, 16 failed | 65 passed, 16 failed |
| `npx nx run apps-automated:test:android` (device) | 1695 OK, 0 failed | 1694 OK, 0 failed |

- The 5 vite failures are in `typescript-optional.spec.ts` (`The "paths[1]" argument must be of type string`). The 16 webpack5 failures are stale snapshots in `__tests__/configuration/*.spec.ts`.
- `core:build`, `vite:build`, `webpack5:build` and `workspace-plugin:test` pass. `core:lint`: 0 errors, 22 warnings, the same as `main`, none in the touched files. `npx nx format:check --base=main` is clean.
- The device run used a Samsung SM-X356B tablet (Android 16, API 36) over USB. The one extra passing test compared with `main` is the new one.

## Compatibility and risk

- No API change, no `.d.ts` change, no platform-specific code. The parsing runs at runtime in core, so the fix applies to iOS and Android, and to apps built with `@nativescript/webpack` or `@nativescript/vite`.
- Times, iteration counts, keywords and `cubic-bezier()` values are read as before, and a token equal to a keyword is still read as that keyword. `steps()`, `step-start` and `step-end` are still unsupported. A malformed `cubic-bezier(...)` still throws.
- Apart from the names this fixes, only invalid or unsupported tokens behave differently:
  - Malformed numbers that the old expressions passed to `parseFloat` (`2.`, `1.2.3`, `1s1s`, `0x10`) are no longer a time or an iteration count. They are ignored, or become the name when they come before it. For example, `spin 1s 2.` used to run 2 iterations and now runs 1.
  - Unsupported easing functions that contain a keyword, such as `linear(0, 0.5, 1)`, no longer throw, so the stylesheet is kept. After the name, they fall back to the default `ease`. Before the name, they are taken as the name, and that one animation finds no keyframes.
  - Tokens that only start with a keyword or with `cubic-bezier`, such as `linear;` or `cubic-bezierX(...)`, are no longer timing functions.

## Related

- #{{PR:V1}} makes `@nativescript/vite` append `x` to Vue scoped keyframe names that end in a digit, to work around this bug. The rename can be removed once this lands; keeping it is harmless.
- NativeScript/tailwind#{{PR:T1}} fixes `@nativescript/tailwind`'s expansion of `animation:` shorthands into longhands. Longhands do not go through the shorthand parser, so in Tailwind projects that expansion also avoids this bug for single animations. It stays harmless after this fix.
