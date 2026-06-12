import { defineConfig } from "wxt";

// One codebase → per-browser builds. WXT targets MV3 for Chromium and MV2 for
// Firefox by default, generating the right background (service worker vs
// scripts), action vs browser_action, and permission merging per target.
export default defineConfig({
  manifest: ({ browser }) => ({
    name: "Viltrumera",
    description:
      "Silent bridge — personalizes your Viltrumera experience using your WarEra username",
    permissions: ["cookies", "storage", "tabs", "alarms"],
    host_permissions: [
      "https://*.warera.io/*",
      "https://warera.io/*",
      "https://api.viltrumera.app/*",
      "https://viltrumera.app/*",
      "http://localhost:3000/*",
      "http://localhost:5173/*",
    ],
    action: {
      default_title: "Viltrumera",
    },
    ...(browser === "firefox" && {
      // Required for AMO signing (free) and stable addon identity.
      browser_specific_settings: {
        gecko: {
          id: "viltrumera@viltrumera.app",
          strict_min_version: "115.0",
        },
      },
    }),
  }),
});
