# SFC `<style>` probe (verification fixture)

Fixture for Vue SFC `<style>` support (scoped, `:global()`, `:deep()`, `:slotted()`,
`v-bind()`, `<style module>`, `lang="scss"`, `@import`, `<style src>`, scoped `@keyframes`) with
the improved packages this project installs; the project README explains how they are built.

| File | Covers |
| --- | --- |
| `StyleProbe.vue` | the parent: scoped, `:global`, `v-bind()` (value and expression), scss, module, `@import`, keyframes, a `.ns-android` ancestor rule, `:deep` into the child, slot content passed to the slot host (its own scoped rule still applying to that content) |
| `StyleProbeChild.vue` | no leak of the parent's scoped rule, the parent's `:deep` target, `<style scoped src>` |
| `StyleProbeSlot.vue` | the slot host: `:slotted()` for default, named and fallback slot content, `:slotted(*)`, and its own label that `:slotted()` must not match |
| `StyleProbeSlotItem.vue` | a component passed as slot content (its root element receives the slot id) |
| `probe-partial.css`, `probe-child-src.css` | the `@import` partial and the `<style src>` file |
| `sfc-slotted.test.mjs` | headless tests for `:slotted()` (no device needed) |

## On a device

1. `app/components/Home.vue` already renders `<StyleProbe />`
   (`import StyleProbe from '@/components/sfc-style-tests/StyleProbe.vue'` in its
   `<script setup>`).
2. Run `ns debug android` (HMR) and `ns debug android --no-hmr` (bundle). Every label states
   what it expects; tap the `v-bind` label to toggle its colour.
3. Live edits (HMR): change a rule in any block, in `probe-partial.css` or in
   `probe-child-src.css`; delete every `:slotted()` rule in `StyleProbeSlot.vue`, save, restore
   them and save again. Each change must show without a restart.

## Headless

From the project root:

```bash
node --test 'app/components/sfc-style-tests/*.test.mjs'
```

The tests classify synthetic slot-host edits with `@nativescript/vite`'s change classifier (adding,
editing and removing `:slotted()` rules, and `:slotted()` in an unscoped block), and check that
the `renderSlot` detection recognises the `noSlotted` argument in real compiler output. They
then boot the Vite dev server the way `ns debug android` does (loopback only, on port 5198,
override with `SFC_PROBE_PORT`, with a temporary optimizer cache) and check `/ns/sfc-meta` for
`StyleProbeSlot.vue` and `StyleProbe.vue`, and the `renderSlot` calls and `-s` selectors of the
module `/ns/asm` assembles for `StyleProbeSlot.vue`.
