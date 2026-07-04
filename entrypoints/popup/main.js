import { getConfig } from "@/utils/config";
import "./style.css";

const FETCH_TIMEOUT = 2_000;

// ── Config (dev vs prod) ──────────────────────────────────────────────────

let _config = null;

async function cfg() {
  if (!_config) _config = await getConfig();
  return _config;
}

// ── DOM refs ──────────────────────────────────────────────────────────────

const identityCard = document.getElementById('identity-card');
const btnSync      = document.getElementById('btn-sync');
const btnDashboard = document.getElementById('btn-dashboard');
const footerServer = document.getElementById('footer-server');
const telemetryToggle = document.getElementById('telemetry-toggle');

// ── Helpers ───────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ── Fetch helpers ─────────────────────────────────────────────────────────

async function fetchIdentity() {
  try {
    const { BACKEND_URL } = await cfg();
    const resp = await fetch(`${BACKEND_URL}/api/auth/identity`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.player ?? null;
  } catch {
    return null;
  }
}

// ── Render ────────────────────────────────────────────────────────────────

function renderIdentity(storage, player) {
  if (player?.username) {
    const meta = [player.country, player.mu].filter(Boolean).map(esc).join(' &middot; ');
    const lastSync = storage.lastSync
      ? `<div class="player-sync">Synced ${fmtTime(storage.lastSync)}</div>`
      : '';
    identityCard.innerHTML =
      `<div class="player-name">` +
        `<span class="dot-connected"></span>${esc(player.username)}` +
      `</div>` +
      (meta ? `<div class="player-meta">${meta}</div>` : '') +
      lastSync;
  } else if (storage.connected || storage.userId) {
    identityCard.innerHTML =
      `<div class="player-pending">Syncing&hellip;</div>`;
  } else {
    identityCard.innerHTML =
      `<div class="player-prompt">` +
        `Log in to <a href="https://app.warera.io" target="_blank">app.warera.io</a> ` +
        `to connect your session.` +
      `</div>`;
  }
}

function renderFooter(config) {
  if (!config) return;
  try {
    const host = new URL(config.BACKEND_URL).host;
    footerServer.textContent = `Connected to ${host}`;
  } catch {
    footerServer.textContent = '';
  }
}

// ── Main refresh ──────────────────────────────────────────────────────────

async function refresh() {
  // Paint from cached storage immediately so the popup opens instantly and
  // never blocks on the network. Then update identity + footer once the
  // background calls resolve (fetchIdentity is time-boxed, so a slow or
  // unreachable backend can't stall the render).
  const storage = await browser.storage.local.get(['userId', 'connected', 'lastSync']);
  renderIdentity(storage, null);

  const [player, config] = await Promise.all([fetchIdentity(), cfg()]);
  renderIdentity(storage, player);
  renderFooter(config);
}

// ── Buttons ───────────────────────────────────────────────────────────────

btnSync.addEventListener('click', async () => {
  btnSync.disabled = true;
  btnSync.innerHTML = '<span class="spinner"></span>';
  try {
    await browser.runtime.sendMessage({ type: 'SYNC_NOW' });
    await refresh();
  } finally {
    btnSync.disabled = false;
    btnSync.textContent = 'Sync';
  }
});

btnDashboard.addEventListener('click', async () => {
  const { FRONTEND_URL } = await cfg();
  browser.tabs.create({ url: FRONTEND_URL });
});

// ── Init ──────────────────────────────────────────────────────────────────

const extVersionEl = document.getElementById('ext-version');
if (extVersionEl) {
  extVersionEl.textContent = `v${browser.runtime.getManifest().version}`;
}

if (telemetryToggle) {
  browser.storage.local.get('telemetryEnabled').then(({ telemetryEnabled }) => {
    telemetryToggle.checked = telemetryEnabled === true;
  });
  telemetryToggle.addEventListener('change', () => {
    browser.storage.local.set({ telemetryEnabled: telemetryToggle.checked });
  });
}

refresh();
