import type { UserConfig } from "vite";
import { defineConfig, mergeConfig } from "vite";
import { vueConfig } from "@nativescript/vite/vue";

export default defineConfig(({ mode }): UserConfig => {
  return mergeConfig(vueConfig({ mode }), {})
})
