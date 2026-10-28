## PR Checklist

- [x] The PR title follows our guidelines: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#commit-messages.
- [x] There is an issue for the bug/feature this PR is for. To avoid wasting your time, it's best to open a suggestion issue first and wait for approval before working on it.
- [x] You have signed the [CLA](http://www.nativescript.org/cla).
- [x] All existing tests are passing: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/DevelopmentWorkflow.md#running-unit-tests-application.
  - The only failures also fail on untouched `main`: the 5 tests in `packages/vite/typescript-optional.spec.ts` (`The "paths[1]" argument must be of type string`) and the 16 snapshot tests in `packages/webpack5/__tests__/configuration/*.spec.ts` (their snapshots contain another machine's paths).
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

This PR is stacked on #{{PR:V1}}, which compiles SFC `<style>` blocks on the HMR path. The behavior below is with #{{PR:V1}} applied.

During an HMR session, `/ns/asm` caches each assembled SFC under the hash of the SFC's own source. A `<style>` block can also depend on other files: an `@import`ed partial, a sass partial pulled in with `@use`/`@import`, or the file of a `<style src>` block. When one of those files changes, the cache key stays the same and no `ns:vue-sfc-registry-update` is sent. The device keeps the SFC's old scoped css until the `.vue` file itself changes or the session restarts.

What the device gets instead depends on the file:

- A `.css` file that is not an `app.css` dependency is handled as a component stylesheet. The prologue broadcasts `ns:css-updates` under the file's own tag, and the device fetches `?direct=1` and installs the file's unscoped css app-wide. Its rules then match views outside the component.
- A `.css` file that is an `app.css` dependency re-sends `app.css`. In a Tailwind v4 project every file Tailwind scans is one, and its automatic source detection includes `.css` files.
- A `.scss`, `.sass`, `.less`, `.styl` or `.stylus` file gets no style update, because the prologue's css branch only handles `.css`.

## What is the new behavior?

- **Dependency record** (`sfc-route-shared.ts`). `compileSfcStyles` records which stylesheets each SFC's styles read:
  - the `<style src>` file, recorded before it is read so that a file missing at compile time is still tracked;
  - the files Vite's css pipeline loaded for the block's sub-request (the `importedModules` of its module-graph node);
  - the `dependencies` of a direct `@vue/compiler-sfc` compile.

  `getSfcsDependingOnStylesheet(file)` reads the record. A failure while reading the module graph never affects the compile.
- **Cache reset** (`sfc-route-assemble.ts`). New `clearSfcAsmCache()` drops every cached assembly.
- **Re-assembly on a stylesheet edit** (`vue/server/strategy.ts`). On an edit to a `.css`, `.scss`, `.sass`, `.less`, `.styl` or `.stylus` file, the Vue strategy clears the assembler cache. It then collects the dependent SFCs from the record and from Vite's importer graph:
  - it follows `@import` chains, up to 8 levels;
  - an inline sub-request (`X.vue?vue&type=style…`) resolves to its own file;
  - a `<style src>` sub-request (`x.css?vue&type=style…`) resolves to the `.vue` that imports it;
  - SFCs outside the project root are skipped.

  After the prologue returns (so after its `ns:hmr-pending`, the same order as for a `.vue` edit), it sends one `ns:vue-sfc-registry-update` per SFC. The device re-fetches the SFC, its css re-registers under its `sfc:` tag, and the component re-renders in place (`rerenderOnly: true`).
- **`<style module>` reloads.** An SFC with a `<style module>` block, or one that cannot be read, gets `rerenderOnly: false`. A rerender would keep the old `__cssModules` class map, and CSS module class names can change with the css.
- **Same gates as the prologue.** For an edit the prologue ignores (no socket server, an excluded test path, or a file outside the HMR source scope), the strategy only clears the cache and sends nothing.
- **No app-wide install for SFC-only files.** When at least one SFC is re-assembled and every importer the graph knows for the edited file is an SFC style block, the Vue strategy claims the edit through `ownsComponentStyleHmr`, and the prologue skips its `ns:css-updates` broadcast (as it already does for Angular). The claim is stored per file and consumed when the prologue reads it, so concurrent hot updates of several files do not interfere. The broadcast is kept for a file the graph has not seen and for a file that any other module imports. For an `app.css` dependency the prologue does not consult the hook and re-sends `app.css` as before; the SFC is still re-assembled.
- **Hook signature** (`framework-strategy.ts`, `websocket-hot-update.ts`). `ownsComponentStyleHmr(server, file)` now receives the edited file. The Angular implementation ignores it and is unchanged.

Closes #{{ISSUE}}.

## How was this tested?

New tests (21):

- `sfc-route-shared.spec.ts`: the record of `<style src>` files (also a missing one), of the files the Vite pipeline read, and of sass partials from a direct compile; the client environment's module graph is used when present; compiling continues when the graph lookup throws.
- `sfc-route-assemble.spec.ts`: a cached assembly is served until `clearSfcAsmCache()` drops it.
- `strategy.spec.ts`: inline, `<style src>` and `@import`-chain dependents; the claim, and the kept broadcast for a file another module imports or the graph does not know; the reload for `<style module>`; sass partials; the prologue's gates; SFCs outside the root; per-file claims for concurrent updates; non-stylesheet edits leave the cache alone.
- `websocket-hot-update.spec.ts`: the hook receives the edited file, and the update summary is still emitted when it claims the edit.

Suites, each run with `--skip-nx-cache`:

| Command | This branch | `main` |
| --- | --- | --- |
| `npx nx run vite:test` | 2026 passed, 5 failed | 1924 passed, 5 failed |
| `npx nx run core:test` | 565 passed, 1 skipped | same |
| `npx nx run webpack5:test` | 65 passed, 16 failed | same |
| `npx nx run vite:lint` | 3 errors | same 3 errors |
| `npx nx run core:lint` | 0 errors, 22 warnings | same |

- `vite:test`: 171 files. #{{PR:V1}} alone has 2005 passed, so the 21 new tests account for the difference. The 5 failures are the `typescript-optional.spec.ts` ones listed above.
- `vite:lint`: the 3 errors are in `configuration/base.ts` (262:3, 268:3) and `hmr/server/css-device-module.ts` (24:23). This PR does not touch either file.
- `core:build`, `vite:build`, `webpack5:build` and `workspace-plugin:test` pass.

On a device: this branch was not run on a device by itself. It was merged with #{{PR:V1}} and the other fixes of this series (in this repository, nativescript-vue and NativeScript/tailwind) into one combined build. The probe app at {{PROBE_APP_URL}} was built against packages built from it, with no other patches. It ran on a Samsung SM-X356B tablet (Android 16, API 36), with Vite and with webpack, each in hot-reload and bundle mode. Each probe line was checked by sampling its pixel color from screenshots. The check for this PR is "Editing the `@import`ed partial" (a partial that a `<style scoped>` block `@import`s) with Vite hot reload: pass. The probe app uses Tailwind v4, which scans that partial, so the prologue handled the edit as an `app.css` dependency. The SFC that imports the partial also has a `<style module>` block, so its update was a reload (`rerenderOnly: false`). Not exercised on the device: the render-only update, the `ownsComponentStyleHmr` claim, edits to a `<style src>` file or a sass partial, and the scope gate. The unit tests above cover them.

## Compatibility and risk

- Only the Vue flavor's HMR behavior changes. Bundle builds and the other flavors are not affected. The SFC compiler modules are still imported lazily, and `websocket-framework-isolation.spec.ts` passes.
- In a Vue HMR session, every stylesheet edit clears the whole `/ns/asm` cache, so each SFC is recompiled the next time the device fetches it.
- A `.css` file that only SFC style blocks use, and that is not an `app.css` dependency, is no longer installed app-wide on a hot edit. Its rules now apply only through the SFC's scoped copy, as they do in a fresh session and in bundle builds.
- `FrameworkServerStrategy.ownsComponentStyleHmr` gains a `file` parameter. Implementations that ignore it compile and behave as before.
- Known limits:
  - Creating a `<style src>` file that was missing does not update the SFC, because Vite does not call `handleHotUpdate` for new files. The first edit after that does.
  - The record is never pruned, so editing a stylesheet that an SFC no longer uses still sends that SFC an update.

## Related

- Depends on #{{PR:V1}}. This branch is stacked on it, so please review and merge this PR after #{{PR:V1}}. Until #{{PR:V1}} is merged, the diff here shows both commits; only the last one (`fix(vite): re-assemble Vue SFCs …`) belongs to this PR.
- #{{PR:V7}} edits the `ownsComponentStyleHmr` doc comment in `framework-strategy.ts` and the comment above the hook call in `websocket-hot-update.ts`. The overlap is trivial; whichever PR lands second rebases.
