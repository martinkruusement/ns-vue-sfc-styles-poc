## PR Checklist

- [x] The PR title follows our guidelines: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#commit-messages.
- [x] There is an issue for the bug/feature this PR is for. To avoid wasting your time, it's best to open a suggestion issue first and wait for approval before working on it.
- [x] You have signed the [CLA](http://www.nativescript.org/cla).
- [x] All existing tests are passing: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/DevelopmentWorkflow.md#running-unit-tests-application. The only failures also fail on untouched `main`: 5 tests in `packages/vite/typescript-optional.spec.ts` and 16 configuration snapshot tests in `packages/webpack5`.
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

`@nativescript/core` breaks ties between selectors of equal specificity by registration order. `removeTaggedAdditionalCSS(tag)` followed by `addTaggedAdditionalCSS(css, tag)` puts the tag at the end of the application selector list.

The Vite HMR appliers replace a stylesheet with exactly that pair:

- `__NS_HMR_APPLY_CSS__` (`app.css`) and `__NS_REGISTER_CSS__` (component stylesheets: Vue SFC `<style>`, `.css` imported from code) in `hmr/entry-runtime.ts`.
- `applyCssText` in `hmr/client/css-handler.ts`, used for `ns:css-updates` (for example imported `.css` and Angular `styleUrls` edits).

So in an HMR session:

- After any `app.css` hot edit, `app.css` wins every equal-specificity tie against the component stylesheets already registered. In builds without HMR, and normally at boot, `app.css` is registered first and loses those ties.
- A re-registered component stylesheet moves behind every component stylesheet registered after it.
- At cold boot, component css queued in `__NS_PENDING_CSS__` before the applier is installed is drained before `app.css` is applied, so `app.css` ends up after it.

Nothing is logged. A rule that applied before the edit stops applying; a restart restores it.

Example: `app.css` has `.title { color: red; }` and a component stylesheet has `.title { color: green; }`. The label is green at boot and turns red after any `app.css` hot edit.

## What is the new behavior?

The entry runtime and the HMR client record each component tag and its css in a `Map`, in first-registration order. The map is shared as `globalThis.__NS_CSS_TAG_ORDER__`, because the two are separate modules. After a tagged replace, they re-register the tags that must stay behind the replaced one:

- `app.css` replaced (`__NS_HMR_APPLY_CSS__`, and the cold-boot AST path): every recorded component tag.
- A known component tag replaced (`__NS_REGISTER_CSS__`, `applyCssText`): only the tags recorded after it. `Map.set` keeps the tag at its original position.
- A new component tag: it is recorded and nothing else is touched, since it is already last.

Also:

- A component tag registered again with unchanged css (for example an SFC re-assembled after a script-only edit) is skipped: no remove/add and no restyle.
- The entry runtime exposes its loop as `globalThis.__NS_CSS_REAPPLY_AFTER__(tag | null)`. `applyCssText` calls it, and runs the same loop itself when it is missing.
- When app code imports `app.css`, `/ns/m` also registers it as a component tag under the file's path. A global stylesheet update (`handleCssUpdates`) now refreshes that copy too. Otherwise its old rules, which now stay behind `app.css`, would win ties against the edit.
- A tag is recorded only after its tagged add succeeds. When the tagged API is missing or a tagged replace throws, behaviour is unchanged and nothing is recorded.
- Both globals are declared in `hmr/shared/ns-globals.ts`.

Closes #{{ISSUE}}.

## How it was tested

23 new unit tests: 12 in `hmr/entry-runtime.spec.ts`, 11 in `hmr/client/css-handler.spec.ts`. They use a fake core that keeps the application selector list in registration order, and they assert the resulting order. They cover:

- an `app.css` replace;
- a known tag keeping its position, and only the tags after it being re-registered;
- a new tag;
- the unchanged-css skip;
- cold boot (AST and raw text) with pending component css;
- the map shared between entry runtime and client, delegation to `__NS_CSS_REAPPLY_AFTER__`, and the local fallback;
- the refresh of an `app.css` copy imported from code;
- paths that must not change: `addCss` fallback, no tagged API, a failed tagged add or replace.

`cd packages/vite && npx vitest run hmr/entry-runtime.spec.ts hmr/client/css-handler.spec.ts`: 40 passed. With the three source files taken from `main`, 19 of the 23 new tests fail. The other 4 cover paths that must not change.

| Command | This branch | `main` (6bb01eab6) |
| --- | --- | --- |
| `npx nx run vite:test --skip-nx-cache` | 1947 passed, 5 failed | 1924 passed, 5 failed |
| `npx nx run core:test --skip-nx-cache` | 565 passed, 1 skipped | 565 passed, 1 skipped |
| `npx nx run webpack5:test --skip-nx-cache` | 65 passed, 16 failed | 65 passed, 16 failed |

- The 5 vite failures are in `typescript-optional.spec.ts` (`The "paths[1]" argument must be of type string`). The 16 webpack5 failures are stale snapshots in `__tests__/configuration/*.spec.ts`.
- `core:build`, `vite:build`, `webpack5:build` and `workspace-plugin:test` pass.
- `core:lint`: 0 errors, 22 warnings. `vite:lint`: the 3 errors `main` already has, in `configuration/base.ts` and `hmr/server/css-device-module.ts`, which this PR does not touch.

On a device: this branch was not run on a device by itself. It was run in one build that merges it with my other PRs for `@nativescript/vite`, `@nativescript/webpack`, `@nativescript/core`, nativescript-vue and `@nativescript/tailwind` (among them #{{PR:V1}}, which the Vue SFC probes need on Vite, and #{{PR:W2}}), with no other changes. The probe app at {{PROBE_APP_URL}} was built against those packages and run on a Samsung SM-X356B tablet (Android 16). Each check was made with both Vite and webpack, by sampling pixel colours from screenshots:

- In an HMR session, adding an `app.css` rule with the same specificity as a component rule (red against the component's orange): the component rule still wins, and the rest of the `app.css` edit (an ActionBar colour change) applies.
- In an HMR session, recolouring a scoped rule and then deleting it: the rule is replaced, not stacked.
- Every probe line is styled correctly at start-up, with HMR and in a bundle build.

## Compatibility and risk

- **HMR dev sessions only.** Builds without HMR (`ns build`, `--no-hmr`) do not run this code. Their `app.css` / `ns-bundle-css` registration in `helpers/main-entry.ts` is untouched.
- **No API change.** The two globals are new, and each side works without the other's: the client runs the loop itself when `__NS_CSS_REAPPLY_AFTER__` is missing, and the map is created on first use.
- **Cost.** An `app.css` hot edit now re-registers every recorded component tag, and a component edit re-registers the tags recorded after it. Each re-registration is one css parse plus one `removeTaggedAdditionalCSS`, which scans core's application rule list. This is most visible in Tailwind projects, where template edits that add classes regenerate `app.css`. A core primitive that replaces a tag's rules in place would remove most of this cost. This PR uses only the current API.
- **Unchanged-css skip.** It assumes nothing outside these appliers removes a recorded tag from core. Nothing in `packages/vite` does so today. #{{PR:V1}} adds such a removal (see Related).
- **Not covered.** Stylesheets that a framework renderer installs itself, without these appliers, are not recorded and keep today's behaviour.
- **Known limitation: shared partials.** Take a partial that both `app.css` and a component stylesheet `@import`. An edit to it is sent as an `app.css` update only, so the component's copy keeps its old rules, as on `main`. On `main` the re-added `app.css` then won ties, so the new value showed. Now the stale copy stays behind `app.css`, which is its order in a bundle build, and its old value wins until that component stylesheet is registered again (its own edit, or a restart).

## Related

- #{{PR:W2}}: the same bug with `@nativescript/webpack` HMR, fixed there.
- #{{PR:V1}}: removes an SFC's tag from core when the SFC registers `''` (no style rules left, for example after its last `<style>` block was deleted). Whichever of the two merges second must also delete that tag from `__NS_CSS_TAG_ORDER__`. Otherwise the next `app.css` edit re-adds the removed rules from the map, and restoring the same `<style>` block later is skipped as unchanged.
