<template>
    <Frame>
        <Page>
            <ActionBar>
                <Label text="Home"/>
            </ActionBar>

            <GridLayout>
                <StyleProbe/>
            </GridLayout>
        </Page>
    </Frame>
</template>

<script setup lang="ts">
  import { computed } from 'nativescript-vue'
  import StyleProbe from '@/components/sfc-style-tests/StyleProbe.vue'

  const message = computed(() => "Blank {N}-Vue app");
</script>
