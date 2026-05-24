# Viltrumera Extension

A Chrome extension that bridges your [WarEra](https://warera.io) game session to the [Viltrumera](https://viltrumera.app) dashboard. It reads your existing browser session and forwards it to the backend so the dashboard can show personalized data.

## What it does

- **Session forwarding** -- Reads your WarEra JWT cookie and sends it to the Viltrumera backend. This is how the dashboard knows who you are.
- **Player identification** -- Fetches your profile, wealth, and equipped items so the dashboard can show your current loadout and personalize recommendations.
- **MU roster** -- Fetches your Military Unit's member list with skill levels, gear, HP/hunger status, and pill state. Used by the Compare page on the dashboard.
- **Market actions** -- Buys items and equips gear on your behalf when you click "Buy" or "Equip" in the dashboard's market view.
- **Inventory access** -- Reads your inventory so the dashboard can show what you own and suggest upgrades.

## What it does NOT do

- **No data collection.** Your JWT, inventory, and profile data are sent only to the Viltrumera backend you configure. Nothing is sent to any third party.
- **No game automation.** The extension does not fight battles, train skills, work companies, or perform any automated gameplay actions.
- **No background scraping.** It only makes API calls when you or the dashboard explicitly request them (plus a lightweight cookie sync every 5 minutes to keep the session alive).
- **No modification of game pages.** The extension does not inject scripts into warera.io or alter the game UI in any way.
- **No tracking or analytics.** There are no telemetry calls, no usage tracking, no fingerprinting.

## Permissions explained

| Permission | Why |
|---|---|
| `cookies` | Read the `jwt` and `cf_clearance` cookies from `warera.io` to authenticate API calls |
| `storage` | Store connection state locally (user ID, sync timestamp) |
| `tabs` | Detect when you visit `app.warera.io` to trigger a session sync |
| `alarms` | Periodic cookie re-sync every 5 minutes to keep the session fresh |
| `host_permissions: *.warera.io` | Make API calls to the WarEra game servers on your behalf |
| `host_permissions: localhost` | Communicate with the Viltrumera backend running locally or via the dashboard |

## How it works

1. When you log into `app.warera.io`, Chrome sets a `jwt` cookie.
2. The extension detects this cookie and sends it to the Viltrumera backend (`/api/auth/connect`).
3. The dashboard's frontend loads a content script that asks the extension to identify you.
4. From that point, the dashboard can request data (roster, inventory) or actions (buy, equip) through the extension, which proxies them to the WarEra API using your session cookies.

All communication between the dashboard and the extension happens via `window.postMessage` with source tags (`viltrumera` / `viltrumera-ext`) so messages can't be spoofed by other scripts.

## Installation

The extension is not on the Chrome Web Store. Install it manually:

1. Clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select this folder
5. Log into [app.warera.io](https://app.warera.io) -- the extension will pick up your session automatically

## Configuration

The extension connects to `http://localhost:3000` by default. If your Viltrumera backend runs elsewhere, edit the `BACKEND_URL` constant in `background.js`.

## Architecture

```
background.js    Service worker -- handles JWT sync, API proxying, all message handlers
content.js       Injected into the dashboard page -- bridges postMessage to chrome.runtime
popup.html/js    Extension popup -- shows connection status, player info, subsystems
popup.css        Popup styling
manifest.json    Chrome extension manifest (Manifest V3)
```

## Security considerations

- The extension has access to your WarEra session token. Only install it if you trust the source.
- Your JWT is sent to the configured `BACKEND_URL`. If you're running the dashboard locally, that's `localhost`. If you're using a hosted instance, your JWT travels over the network to that server.
- The extension never stores your JWT persistently -- it reads it from Chrome's cookie store each time it's needed.
- Cookie reads use Chrome's partitioned cookie API as a fallback, so the extension works correctly with third-party cookie restrictions.

## License

MIT
