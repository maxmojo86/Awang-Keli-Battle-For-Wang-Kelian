import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.drmujahid.awangkeli',
  appName: 'Awang Keli',
  webDir: 'dist',
  // Production builds load bundled web assets directly from dist/ inside the Android app.
  // Do not set server.url for Play Store releases.
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#091116',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 750,
      launchAutoHide: true,
      backgroundColor: '#091116',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#091116',
    },
  },
};

export default config;
