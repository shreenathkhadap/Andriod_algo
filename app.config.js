const dotenv = require('dotenv');
const fs = require('fs');

const APP_ENV = process.env.APP_ENV || process.env.EAS_BUILD_PROFILE || 'development';
const envFile = `.env.${APP_ENV}`;

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
  console.log(`✅ Loaded environment from: ${envFile}`);
} else {
  console.warn(`⚠️ Environment file not found: ${envFile}`);
}

module.exports = {
  expo: {
    name: "Aksha",
    slug: "AISurrveilance",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "aksha",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,

    // ── ADDED ─────────────────────────────────────────────────────
    owner: "arjadhav",

    ios: {
      bundleIdentifier: "com.aksha.mobileapp",
      supportsTablet: true
    },

    android: {
      package: "com.aksha.mobileapp",
      googleServicesFile: "./google-services.json",
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      edgeToEdgeEnabled: true,
      softwareKeyboardLayoutMode: "pan",

      // ── ADDED: Fix 2 foreground service permissions ───────────────
      permissions: [
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_DATA_SYNC",
        "FOREGROUND_SERVICE_REMOTE_MESSAGING",  // ← add this
        "POST_NOTIFICATIONS",                   // ← add this
        "RECEIVE_BOOT_COMPLETED"
      ]
    },

    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png"
    },

    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff"
        }
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/AkshaLogo.png",
          color: "#1F4E79"
        }
      ],
      [
        "expo-media-library",
        {
          photosPermission: "Allow Aksha to save alert images to your gallery.",
          savePhotosPermission: "Allow Aksha to save alert images to your gallery.",
          isAccessMediaLocationEnabled: true,
          granularPermissions: ["photo"]
        }
      ]
    ],

    experiments: {
      typedRoutes: true
    },

    extra: {
      eas: {
        // ── UPDATED: new project ID ───────────────────────────────
        projectId: "88ac1065-cca1-4f56-aa54-e6dcc8039896"
      },
      APP_ENV
    }
  }
};