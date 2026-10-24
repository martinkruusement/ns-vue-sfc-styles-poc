<template>
  <StackLayout class="style-probe" padding="8">
    <Label class="probe-scoped" text="scoped: expect green (#00bb00)" />
    <Label class="probe-global" text="global in sfc: expect orange" />
    <Label class="probe-bind" :text="`v-bind: expect ${color} (tap to update reactive color)`" @tap="toggle" />
    <Label class="probe-bind-size" text="v-bind expression: expect fontSize 28" />
    <Label class="probe-scss" text="scss: expect teal (#008080)" />
    <Label class="probe-platform" text="platform ancestor (.ns-android): expect gold" />
    <StyleProbeChild class="probe-child" />
    <Label class="probe-anim" text="scoped keyframes + animation shorthand: expect blinking" />
    <Label :class="$style['probe-mod']" class="probe-mod-label" text="css module: expect #654321" />
    <Label class="probe-partial" text="@import partial (scoped): expect #fedcba" />
    <StyleProbeSlot class="probe-slot-host">
      <Label class="probe-slotted" text="slotted, default slot: expect #c71585, bold, italic (parent scoped)" />
      <StyleProbeSlotItem class="probe-slotted-comp" />
      <template #named>
        <Label class="probe-slotted-named" text="slotted, named slot: expect #2e8b57, bold" />
      </template>
    </StyleProbeSlot>
    <Label class="probe-slotted" text="same class outside the slot host: expect inherited colour (not #c71585), italic, not bold" />
  </StackLayout>
</template>

<script setup lang="ts">
import { ref } from 'nativescript-vue'
import StyleProbeChild from './StyleProbeChild.vue'
import StyleProbeSlot from './StyleProbeSlot.vue'
import StyleProbeSlotItem from './StyleProbeSlotItem.vue'

const theme = ref({ size: 28 })
const color = ref('#ff00ff')
const toggle = () => {
  color.value = color.value === '#ff00ff' ? '#00ffff' : '#ff00ff'
}
</script>

<style scoped>
@import './probe-partial.css';
.probe-scoped {
  color: #00bb00;
}
:global(.probe-global) {
  color: orange;
}
.probe-bind {
  color: v-bind(color);
}
.probe-bind-size {
  font-size: v-bind('theme.size');
}
.ns-android .probe-platform {
  color: gold;
}
/* must NOT leak into the child component's inner label */
.probe-child-inner {
  color: red;
}
/* :deep reaches into the child component */
.probe-child :deep(.probe-child-deep) {
  color: purple;
}
/* still applies to content passed into StyleProbeSlot: slotted content keeps this scope */
.probe-slotted {
  font-style: italic;
}
@keyframes probe-pulse {
  from {
    opacity: 0.3;
  }
  to {
    opacity: 1;
  }
}
.probe-anim {
  animation: probe-pulse 1s ease-in-out infinite alternate;
}
</style>

<style module>
.probe-mod {
  color: #654321;
}
</style>

<style lang="scss">
$teal: #008080;
.probe-scss {
  color: $teal;
}
</style>
