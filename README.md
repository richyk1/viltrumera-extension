# Viltrumera Extension

Silent bridge between your WarEra session and [viltrumera.app](https://viltrumera.app) — personalizes bounty tracking, inventory, market actions, and MU rosters using your own game session. The JWT credential never leaves your browser; only your public username is sent to the backend.

Built with [WXT](https://wxt.dev): one codebase, per-browser builds (Chrome/Edge MV3, Firefox MV2).

## Install (users)

Grab the latest zips from [Releases](https://github.com/richyk1/viltrumera-extension/releases/latest):

**Chrome / Edge / Brave** — `…-chrome.zip`
1. Extract the zip
2. `chrome://extensions` → enable **Developer mode**
3. **Load unpacked** → select the extracted folder

**Firefox** — `…-firefox.zip`
- Temporary install (resets on browser restart): `about:debugging` → *This Firefox* → **Load Temporary Add-on** → pick the zip
- Permanent installs require AMO signing (free, planned)

## Develop

```bash
pnpm install
pnpm dev            # Chrome with HMR
pnpm dev:firefox    # Firefox
```

## Build & package

```bash
pnpm build            # .output/chrome-mv3/
pnpm build:firefox    # .output/firefox-mv2/
pnpm zip              # .output/viltrumera-extension-<version>-chrome.zip
pnpm zip:firefox      # …-firefox.zip + …-sources.zip (for AMO review)
```

Layout: `entrypoints/background.js` (worker / background scripts), `entrypoints/content.js` (viltrumera.app bridge), `entrypoints/popup/`, shared code in `utils/`, static assets in `public/`. The manifest is generated per-browser from `wxt.config.ts`.

## Release

Every push to `main` auto-bumps the patch version, builds all targets, and publishes a GitHub release with the Chrome and Firefox zips (see `.github/workflows/release.yml`).
