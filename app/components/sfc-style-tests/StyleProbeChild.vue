<template>
  <StackLayout class="probe-child-root">
    <Label class="probe-child-inner" text="child inner (parent scoped rule must NOT apply): expect navy" />
    <Label class="probe-child-deep" text="child deep (parent :deep rule): expect purple" />
    <Label class="probe-child-src" text="external style src (scoped): expect #0f0f0f" />
  </StackLayout>
</template>

<script setup lang="ts"></script>

<style scoped>
.probe-child-inner {
  color: navy;
}
</style>

<style scoped src="./probe-child-src.css"></style>
