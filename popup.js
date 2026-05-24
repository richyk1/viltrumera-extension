'use strict';

const BACKEND_URL    = 'https://api.viltrumera.app';
const FRONTEND_URL   = 'https://viltrumera.app';
const REFRESH_MS     = 5_000;
const FETCH_TIMEOUT  = 3_000;

const RECORDER_STATES = new Set([
  'waiting_for_jwt', 'discovering', 'connecting',
  'fetching_tokens', 'active', 'reconnecting',
]);

// ── DOM refs ──────────────────────────────────────────────────────────────

const serverDot     = document.getElementById('server-dot');
const serverLabel   = document.getElementById('server-label');
const playerContent = document.getElementById('player-content');
const subsystemList = document.getElementById('subsystem-list');
const sessionDetail = document.getElementById('session-details');
const btnSync       = document.getElementById('btn-sync');
const btnDashboard  = document.getElementById('btn-dashboard');

// ── Fetch helpers ─────────────────────────────────────────────────────────

async function fetchStatus() {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/status`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function fetchIdentity() {
  try {
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

function renderServerStatus(online) {
  if (online) {
    serverDot.className = 'dot green';
    serverLabel.textContent = 'Server online';
  } else {
    serverDot.className = 'dot red';
    serverLabel.textContent = 'Server offline';
  }
}

function renderPlayer(storage, player) {
  if (player?.username) {
    playerContent.innerHTML =
      `<div class="player-name">${esc(player.username)}</div>` +
      `<div class="player-meta">` +
        (player.country ? `${esc(player.country)}` : '') +
        (player.mu      ? ` &middot; ${esc(player.mu)}` : '') +
      `</div>`;
  } else if (storage.connected && storage.userId) {
    playerContent.innerHTML =
      `<div class="player-name">${esc(String(storage.userId).slice(0, 8))}…</div>` +
      `<div class="player-meta">Identity pending</div>`;
  } else {
    playerContent.innerHTML =
      `<div class="player-prompt">` +
        `Log in to <a href="https://app.warera.io" target="_blank">app.warera.io</a> ` +
        `to personalize your experience.` +
      `</div>`;
  }
}

const STATE_DOT = {
  active: 'green',
  idle:   'yellow',
  error:  'red',
  paused: 'grey',
};

function subsystemRow(name, state, detail) {
  const dotClass = STATE_DOT[state] ?? 'grey';
  return `<div class="subsystem-row">` +
    `<div class="subsystem-left">` +
      `<span class="dot ${dotClass}"></span>` +
      `<span class="subsystem-name">${esc(name)}</span>` +
    `</div>` +
    `<div class="subsystem-right">${esc(detail ?? state ?? '—')}</div>` +
  `</div>`;
}

function fmtSecs(secs) {
  if (secs == null) return null;
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

function marketState(m) {
  if (!m.jwt_connected) return 'paused';
  if (m.deals_found > 0) return 'active';
  return 'idle';
}

function renderSubsystems(status) {
  if (!status) {
    subsystemList.innerHTML =
      `<div class="subsystem-row"><span style="color:var(--text-muted);font-size:11px">No data — server offline</span></div>`;
    return;
  }

  const rows = [];

  const m = status.market;
  if (m !== undefined) {
    const state  = marketState(m);
    const poll   = fmtSecs(m.last_poll_secs_ago);
    const detail = `${m.deals_found ?? 0} deals · ${m.offers_cached ?? 0} cached` +
                   (poll ? ` · ${poll}` : '');
    rows.push(subsystemRow('Market', state, detail));
  }

  const r = status.recorder;
  if (r !== undefined) {
    const rawState = r.state ?? '';
    const dotState =
      rawState === 'active'                                          ? 'active' :
      rawState === 'waiting_for_jwt'                                ? 'paused' :
      ['discovering','connecting','fetching_tokens','reconnecting'].includes(rawState) ? 'idle' :
      'idle';
    const detail = `${r.total_persisted ?? 0} hits · ${r.battles_subscribed ?? 0} battles`;
    rows.push(subsystemRow('Recorder', dotState, detail));
  }

  const w = status.watcher;
  if (w !== undefined) {
    const poll   = fmtSecs(w.last_poll_secs_ago);
    const detail = `${w.active_battles ?? 0} battles · ${w.wars_watched ?? 0} wars` +
                   (poll ? ` · ${poll}` : '');
    rows.push(subsystemRow('Watcher', 'active', detail));
  }

  if (rows.length === 0) {
    subsystemList.innerHTML =
      `<div class="subsystem-row"><span style="color:var(--text-muted);font-size:11px">No subsystem data</span></div>`;
  } else {
    subsystemList.innerHTML = rows.join('');
  }
}

function kvRow(key, val, valClass) {
  return `<div class="kv-row">` +
    `<span class="kv-key">${esc(key)}</span>` +
    `<span class="kv-val${valClass ? ' ' + valClass : ''}">${esc(val)}</span>` +
  `</div>`;
}

function renderSession(storage, status) {
  const hasCookie = Boolean(storage.connected || storage.userId);
  const jwtLive   = status?.market?.jwt_connected ?? null;
  const lastSync  = storage.lastSync ? fmtTime(storage.lastSync) : null;

  const rows = [];
  rows.push(kvRow('Cookie present', hasCookie ? 'yes' : 'no', hasCookie ? 'yes' : 'no'));
  rows.push(kvRow('JWT accepted',   jwtLive === null ? '?' : (jwtLive ? 'yes' : 'no'), jwtLive ? 'yes' : (jwtLive === false ? 'no' : '')));
  rows.push(kvRow('Last synced', lastSync ?? '—'));
  if (storage.userId) rows.push(kvRow('User ID', String(storage.userId).slice(0, 12) + '…'));

  sessionDetail.innerHTML = rows.join('');
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Main refresh cycle ────────────────────────────────────────────────────

async function refresh() {
  const [storage, status, player] = await Promise.all([
    chrome.storage.local.get(['userId', 'connected', 'lastSync']),
    fetchStatus(),
    fetchIdentity(),
  ]);

  renderServerStatus(status !== null);
  renderPlayer(storage, player);
  renderSubsystems(status);
  renderSession(storage, status);
}

// ── Buttons ───────────────────────────────────────────────────────────────

btnSync.addEventListener('click', async () => {
  btnSync.disabled = true;
  btnSync.innerHTML = '<span class="spinner"></span>';
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
    await refresh();
  } finally {
    btnSync.disabled = false;
    btnSync.textContent = 'Sync Now';
  }
});

btnDashboard.addEventListener('click', () => {
  chrome.tabs.create({ url: FRONTEND_URL });
});

// ── Init ──────────────────────────────────────────────────────────────────

refresh();
const timer = setInterval(refresh, REFRESH_MS);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInterval(timer);
});
