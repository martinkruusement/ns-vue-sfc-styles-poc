import { NativeScriptConfig } from '@nativescript/core';

// Same app built with webpack; selected with `ns run --config nativescript.webpack.config`.
// A separate id lets both builds stay installed side by side.
export default {
  id: 'org.nativescript.vuesfcstylesdemo.webpack',
  appPath: 'app',
  appResourcesPath: 'App_Resources',
  android: {
    v8Flags: '--expose_gc',
    markingMode: 'none'
  },
  bundler: 'webpack',
  bundlerConfigPath: 'webpack.config.js',
} as NativeScriptConfig;
