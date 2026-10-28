## PR Checklist

- [x] The PR title follows our guidelines: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/CONTRIBUTING.md#commit-messages.
- [x] There is an issue for the bug/feature this PR is for. To avoid wasting your time, it's best to open a suggestion issue first and wait for approval before working on it.
- [x] You have signed the [CLA](http://www.nativescript.org/cla).
- [x] All existing tests are passing: https://github.com/NativeScript/NativeScript/blob/master/tools/notes/DevelopmentWorkflow.md#running-unit-tests-application.
  - The only failures also fail on untouched `main`: the 5 tests in `packages/vite/typescript-optional.spec.ts` (`The "paths[1]" argument must be of type string`) and the 16 snapshot tests in `packages/webpack5/__tests__/configuration/*.spec.ts` (their snapshots contain another machine's paths).
- [x] Tests for the changes are included - https://github.com/NativeScript/NativeScript/blob/master/tools/notes/WritingUnitTests.md.

## What is the current behavior?

With `@nativescript/vite` HMR, a stylesheet hot update (an `app.css` edit, a component stylesheet edit, or a Tailwind content-file edit that changes `app.css`) takes two steps:

1. The server broadcasts `ns:css-updates` with only the stylesheet's root-relative path.
2. The HMR client (`hmr/client/css-handler.ts`) fetches `<origin><path>?direct=1&t=<ts>` with the global `fetch()` and applies the response.

On the device, `fetch()` is core's `whatwg-fetch` polyfill, which sends each request through `new XMLHttpRequest()`, using whichever global `XMLHttpRequest` exists at that moment. Core installs its own `XMLHttpRequest` only when none exists yet (`globals/polyfills/polyfill-xhr`), and app code can replace it later. `@nativescript/canvas-polyfill` does: it defines its own global `XMLHttpRequest`, and with it the stylesheet request never settles. There is no error and no timeout:

- `handleCssUpdates` waits forever, and later updates in the same batch are never applied.
- The edit only shows up after a dev-server restart.
- For Angular, the deferred Tailwind stylesheet is awaited inside the serialized HMR cycle right before `reboot(true)`, so that reboot is held up as well.

Script and component hot updates load through ESM `import()` and keep working, so the failure looks css-specific. Core's `Http.getString` to the same URL works.

The protocol also costs one HTTP round trip per connected device per edit, for text the server already has.

## What is the new behavior?

The server sends the compiled stylesheet with the update, and the client applies it without a request.

- **Protocol** (`hmr/shared/protocol.ts`): `CssUpdateItem` gets an optional `cssText` field. `buildCssUpdateItem(path, { tag, cssText })` sets it only when `cssText` is a string.
- **Server compile** (`hmr/server/css-update-message.ts`): new `loadCssUpdateText(server, path)`.
  - It runs `server.transformRequest(path + '?direct')`, the same plugin pipeline that answered the device's `?direct=1` request.
  - If that throws or does not return plain css (for example a JS module), it parses the `?inline` module instead (`export default "<css>"`).
  - The result goes through `normalizeCssForDevice` (strips a BOM and `@charset`).
  - It never throws. It returns `null` when neither transform yields css, and the item is then sent without `cssText`.
- **Emitters**: all three include the text:
  - the `.css` branch of `runHotUpdatePrologue`;
  - the Tailwind content-file path in `processContentCssUpdate`, including the item deferred to the Angular update;
  - the connect-time sync in `maybeSendConnectCssSync`, which checks again that the socket is still open after the async compile.
- **Client** (`hmr/client/css-handler.ts`): `handleCssUpdates` applies `update.cssText` when it is present, and then needs no HTTP origin. Without it (an older server, or a stylesheet the server could not compile) it fetches as before through `fetchText`, which now:
  - prefers core's `Http.getString` (the platform HTTP stack, independent of the app's `XMLHttpRequest`) over `fetch()`;
  - gives up with a warning on a request that has not settled within `CSS_FETCH_TIMEOUT_MS` (10 s), so one hung request no longer blocks the rest.
- **Comments**: the comments that said the device fetches the stylesheet (`helpers/main-entry.ts`, the prologue in `websocket-hot-update.ts`, `FrameworkServerStrategy.ownsComponentStyleHmr`) now describe the new flow.

Closes #{{ISSUE}}.

## How was this tested?

New tests (29), in `packages/vite`:

- `hmr/server/css-update-message.spec.ts`: `loadCssUpdateText` returns the normalized `?direct` output; falls back to `?inline` when `?direct` throws or returns a JS module; returns `''` for an empty stylesheet and `null` when neither transform yields css; logs failures when verbose; appends to a path that already has a query. `buildCssUpdateItem` sets `cssText` only for a string.
- `hmr/server/websocket-hot-update.spec.ts`: `cssText` is carried in the global and component broadcasts, in the Tailwind content-file broadcast and in the item deferred to the framework, and omitted when the compile fails. Nothing is compiled for a framework-owned component style or for a content edit that leaves the Tailwind output unchanged.
- `hmr/server/css-connect-sync.spec.ts`: the connect-sync item carries `cssText`, omits it when the compile fails, and nothing is sent when the socket closes during the compile.
- `hmr/client/css-handler.spec.ts`: carried css is applied without a fetch, under the update's tag and without an HTTP origin; empty carried css is neither fetched nor applied; without `cssText` the client fetches `<origin><path>?direct=1&t=<timestamp>`, or skips the update when there is no origin. `fetchText` prefers `Http.getString`, falls back to `fetch()`, returns `''` on failure, gives up after `CSS_FETCH_TIMEOUT_MS` with a warning, and clears its timer once the request settles.

With the source changes reverted, 23 of the 29 new tests fail. The other 6 guard behaviour that must stay the same: no compile for framework-owned component styles or unchanged Tailwind output, no `cssText` when the compile fails (broadcast and connect-sync), the `fetch()` fallback without core `Http`, and skipping an update with neither text nor origin.

`npx vitest run hmr/server/css-update-message.spec.ts hmr/server/css-connect-sync.spec.ts hmr/server/websocket-hot-update.spec.ts hmr/client/css-handler.spec.ts` (in `packages/vite`): 4 files, 61 tests passed.

Commands, each with `--skip-nx-cache`:

| Command | This branch | `main` |
| --- | --- | --- |
| `npx nx run vite:test` | 1953 passed, 5 failed | 1924 passed, 5 failed |
| `npx nx run core:test` | 565 passed, 1 skipped | same |
| `npx nx run webpack5:test` | 65 passed, 16 failed | same |
| `npx nx run workspace-plugin:test` | passed | passed |
| `npx nx run vite:lint` | 3 errors, none in touched files | same 3 errors (`configuration/base.ts` `no-fallthrough` ×2, `hmr/server/css-device-module.ts` `no-irregular-whitespace`) |
| `npx nx run core:build`, `vite:build`, `webpack5:build` | passed | passed |

`npx nx format:check --base=main` is clean.

Also checked by hand against a real Vite 8.0.2 dev server (the version in this repository):

- `loadCssUpdateText(server, '/app/app.css')` equals `normalizeCssForDevice` of the body of `GET /app/app.css?direct=1` from the same server, for a stylesheet with an `@import`, a BOM and `@charset`.
- Inside a real `handleHotUpdate`, it returns the edited css after an `app.css` edit, after an edit to an `@import`ed partial, and after a content-file edit picked up through a PostCSS `dependency` message.

On a device: this branch was not run on a device on its own. A build that merges all PRs of this series (in this repository, nativescript-vue and NativeScript/tailwind), with no other changes, ran the probe app ({{PROBE_APP_URL}}) on a Samsung SM-X356B tablet (Android 16, API 36), checked by sampling pixel colours from screenshots. The check there that goes through this PR's code is the Vite hot-reload `app.css` edit, which passed: an ActionBar colour change and a rule with the same specificity as a component rule applied without a restart, and the component rule still won. The probe app does not replace `XMLHttpRequest`, so that run does not reproduce the hang; the fetch fallback and its timeout are covered only by the `fetchText` tests above.

## Compatibility and risk

- Wire compatibility, both ways:
  - Old client, new server: the client ignores `cssText` and fetches as before.
  - New client, old server: there is no `cssText`, so the client fetches, now with `Http.getString` first and the 10 s limit.
- The fetch fallback only runs for an older server or for a stylesheet neither transform could compile. `Http.getString` resolves a non-2xx response with its body, as `fetch().text()` did. A response slower than 10 s is now dropped with a warning instead of applied late.
- Intended changes: carried css is applied even when the client has no HTTP origin (such an update used to be skipped), and a hung request no longer blocks the rest of the batch or the Angular reboot. Empty carried css is not applied, the same as an empty fetch response before.
- Server work:
  - The stylesheet is compiled when the edit is detected, even with no device connected, instead of when a device requests it. If you prefer, the emitters can skip the compile while no client socket is open.
  - Vite caches the result in the module graph under `<path>?direct` (the device requested `?direct=1`). Both nodes are invalidated before `handleHotUpdate` runs.
  - For a Tailwind content-file edit that changes the output, the `?direct` compile that the device's request used to trigger now runs on the server right after `appCssState.refresh()`, and the framework update waits for it.
- Every connected client now receives the full stylesheet over the WebSocket up front. Per client this is the same text the `?direct=1` response carried.
- Angular + Analog `liveReload`: a component-style edit the framework owns (`ownsComponentStyleHmr`) still returns before anything is compiled, so its `?direct` module stays absent and Analog keeps emitting `angular:component-update`. A test pins this.
- Not changed, and still using `fetch()`:
  - the inline fallback `__nsBrowserRuntimeHandleCssUpdates` in `hmr/server/vite-plugin.ts`, which only runs when importing the shared css handler fails; it also ignores `cssText`;
  - the plain TypeScript (XML) flavor's re-fetch of edited `.xml` and `.css` files in `applyTypescriptRefresh` (`hmr/frameworks/typescript/client/strategy.ts`).
- `@nativescript/webpack` needs no counterpart: its hot updates are synced to the device by the CLI and loaded with `require`, with css inside the compiled modules, so it never fetches a stylesheet over HTTP.

## Related

- #{{PR:V2}} edits the same `ownsComponentStyleHmr` doc comment in `framework-strategy.ts` and the hook call just below the comment this PR edits in `websocket-hot-update.ts`. The overlap is trivial; whichever PR lands second rebases.
- #{{PR:V1}} and #{{PR:V3}} also edit `hmr/client/css-handler.spec.ts`, including its import line, and #{{PR:V3}} adds a function directly above `fetchText` in `hmr/client/css-handler.ts`. The conflicts are textual: keep both sets of imports, and #{{PR:V3}}'s function together with this PR's `fetchText`.
