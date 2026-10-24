<template>
  <StackLayout class="probe-slot-root">
    <Label class="probe-slotted probe-slot-own" text="slot host's own label (:slotted and the parent's scoped rule must NOT apply): expect #333333, not bold, not italic" />
    <slot />
    <slot name="named" />
    <slot name="fallback">
      <Label class="probe-slotted-fallback" text="slot fallback (Vue marks it slotted too): expect #b8860b, bold" />
    </slot>
  </StackLayout>
</template>

<script setup lang="ts"></script>

<style scoped>
/* listed first: a :slotted rule below that wrongly matched this label would win the tie */
.probe-slot-own {
  color: #333333;
}
:slotted(.probe-slotted) {
  color: #c71585;
}
:slotted(.probe-slotted-named) {
  color: #2e8b57;
}
:slotted(.probe-slotted-comp) {
  color: #8b4513;
}
:slotted(.probe-slotted-fallback) {
  color: #b8860b;
}
/* compiles to a bare attribute selector, [data-v-<id>-s] */
:slotted(*) {
  font-weight: bold;
}
</style>
