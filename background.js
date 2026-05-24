'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

const WARERA_ORIGIN      = 'https://app.warera.io';
const BACKEND_URL        = 'http://localhost:3000';
const CONNECT_URL        = `${BACKEND_URL}/api/auth/connect`;
const COOKIE_NAME        = 'jwt';
const OFFER_ID_RE        = /^[a-f0-9]{24}$/;
const API_BASE           = 'https://api3.warera.io';
const API4_BASE          = 'https://api4.warera.io';

// ── JWT helpers ────────────────────────────────────────────────────────────

function decodeJwtPayload(jwt) {
  try {
    const b64url = jwt.split('.')[1];
    if (!b64url) return null;
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────

async function getCookie(name, domain = '.warera.io') {
  const cookies = await chrome.cookies.getAll({ domain, name });
  if (cookies.length > 0) return cookies[0].value;
  const partitioned = await chrome.cookies.getAll({
    domain,
    name,
    partitionKey: { topLevelSite: 'https://warera.io' },
  });
  return partitioned.length > 0 ? partitioned[0].value : null;
}

// ── Game API helpers ──────────────────────────────────────────────────────

function buildAcceptLanguage() {
  const langs = navigator.languages || [navigator.language || 'en'];
  return langs.map((l, i) => i === 0 ? l : `${l};q=${Math.max(0.1, 1 - i * 0.1).toFixed(1)}`).join(',');
}

function buildClientHints() {
  const ua = navigator.userAgentData;
  if (!ua) return {};
  const brands = ua.brands.map(b => `"${b.brand}";v="${b.version}"`).join(', ');
  return {
    'sec-ch-ua':          brands,
    'sec-ch-ua-mobile':   ua.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': `"${ua.platform}"`,
  };
}

function api4Post(jwt, procedure, input) {
  return fetch(`${API4_BASE}/trpc/${procedure}?batch=1`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `jwt=${jwt}` },
    body:    JSON.stringify({ '0': input }),
  });
}

function buildEquippedItems(equipment, items) {
  const byId = new Map();
  for (const item of [...(items.weapons ?? []), ...(items.equipments ?? [])]) {
    if (item._id) byId.set(item._id, item);
  }
  const equipped = {};
  for (const [slot, value] of Object.entries(equipment)) {
    if (!OFFER_ID_RE.test(value)) continue;
    const item = byId.get(value);
    if (item) equipped[slot] = { code: item.code, skills: item.skills, state: item.state, maxState: item.maxState };
  }
  return equipped;
}

// ── IDENTIFY handler ──────────────────────────────────────────────────────

async function handleIdentify() {
  const jwt = await getCookie('jwt');
  if (!jwt) {
    return { userId: null, personalized: false };
  }

  const payload = decodeJwtPayload(jwt);
  const gameUserId = payload?.data?._id ?? payload?.id ?? payload?.userId ?? payload?.sub ?? null;

  if (!gameUserId) {
    console.warn('[Viltrumera] JWT found but no userId in payload');
    return { userId: null, personalized: false };
  }

  try {
    const resp = await fetch(`${BACKEND_URL}/api/premium/identify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ gameUserId }),
    });

    if (!resp.ok) {
      console.warn('[Viltrumera] identify endpoint returned', resp.status);
      return { userId: gameUserId, personalized: false };
    }

    const data = await resp.json();
    const result = {
      userId:      gameUserId,
      personalized: data.personalized ?? false,
      tipProgress: { total: data.tipTotal ?? 0, threshold: data.tipThreshold ?? 0 },
    };

    try {
      const [getMeResp, inventoryResp] = await Promise.all([
        api4Post(jwt, 'user.getMe', {}),
        api4Post(jwt, 'inventory.getById', {}),
      ]);

      let equipment = null;
      if (getMeResp.ok) {
        const getMeData = await getMeResp.json();
        const meResult  = getMeData?.[0]?.result?.data;
        const wealth    = meResult?.stats?.wealth;
        if (wealth) result.wealth = wealth;
        equipment = meResult?.equipment ?? null;
      }

      if (inventoryResp.ok && equipment) {
        const invData = await inventoryResp.json();
        const items   = invData?.[0]?.result?.data?.items;
        if (items) {
          const equippedItems = buildEquippedItems(equipment, items);
          if (Object.keys(equippedItems).length > 0) result.equippedItems = equippedItems;
        }
      }
    } catch (err) {
      console.warn('[Viltrumera] game data fetch failed:', err.message);
    }

    return result;
  } catch (err) {
    console.warn('[Viltrumera] identify fetch failed:', err.message);
    return { userId: gameUserId, personalized: false };
  }
}

// ── Shared cookie/header builder ──────────────────────────────────────────

async function buildGameHeaders() {
  const jwt         = await getCookie('jwt');
  const cfClearance = await getCookie('cf_clearance');
  if (!jwt || !cfClearance) return null;

  const vid = await getCookie('vid', '.app.warera.io');
  const gr  = await getCookie('gr',  '.app.warera.io');

  const headers = {
    'Accept':          '*/*',
    'Accept-Language': buildAcceptLanguage(),
    'Content-Type':    'application/json',
    'Cookie':          `jwt=${jwt}; cf_clearance=${cfClearance}`,
    'Origin':          'https://app.warera.io',
    'Referer':         'https://app.warera.io/',
    'User-Agent':      navigator.userAgent,
    ...buildClientHints(),
  };
  if (vid) headers['x-vid'] = vid;
  if (gr)  headers['x-gr']  = decodeURIComponent(gr);

  return { jwt, headers };
}

// ── FETCH_MU_ROSTER handler ───────────────────────────────────────────────

const MU_ROSTER_BATCH_SIZE = 20;

function parseMemberFromBatch(userId, liteResult, equipResult) {
  const skills     = liteResult.skills ?? {};
  const hpSkill    = skills.health ?? {};
  const hungerSkill = skills.hunger ?? {};
  const buffs      = liteResult.buffs ?? {};
  const buffCodes  = buffs.buffCodes  ?? [];
  const debuffCodes = buffs.debuffCodes ?? [];

  const hpCurrentPct     = hpSkill.total    ? (hpSkill.currentBarValue    / hpSkill.total)    * 100 : 0;
  const hungerCurrentPct = hungerSkill.total ? (hungerSkill.currentBarValue / hungerSkill.total) * 100 : 0;

  const equipment = {};
  const GEAR_SLOTS = ['weapon', 'helmet', 'chest', 'gloves', 'pants', 'boots'];
  for (const slot of GEAR_SLOTS) {
    const slotData = equipResult?.[slot] ?? null;
    equipment[slot] = slotData
      ? { code: slotData.code, stats: slotData.skills ?? {}, durability: slotData.state ?? 0, maxDurability: slotData.maxState ?? 0 }
      : null;
  }

  return {
    userId:       liteResult._id ?? userId,
    username:     liteResult.username ?? '',
    avatarUrl:    liteResult.avatarUrl ?? null,
    level:        liteResult.leveling?.level ?? 0,
    militaryRank: liteResult.militaryRank ?? 0,
    skills: {
      attack:          skills.attack?.level          ?? 0,
      precision:       skills.precision?.level       ?? 0,
      criticalChance:  skills.criticalChance?.level  ?? 0,
      criticalDamages: skills.criticalDamages?.level ?? 0,
      armor:           skills.armor?.level           ?? 0,
      dodge:           skills.dodge?.level           ?? 0,
      health:          hpSkill.level                 ?? 0,
      lootChance:      skills.lootChance?.level      ?? 0,
      hunger:          hungerSkill.level             ?? 0,
    },
    hpState:     { currentPct: hpCurrentPct,     hourlyRegen: hpSkill.hourlyBarRegen    ?? 0 },
    hungerState: { currentPct: hungerCurrentPct, hourlyRegen: hungerSkill.hourlyBarRegen ?? 0 },
    pillStatus: {
      active:       buffCodes.includes('cocain'),
      endsAt:       buffs.buffEndAt   ?? null,
      debuffActive: debuffCodes.length > 0,
      debuffEndsAt: buffs.debuffEndAt ?? null,
    },
    equipment,
    damagePotential: { damagePerHit: 0, attacksPerDay: 0, dailyDamage: 0 },
  };
}

async function handleFetchMuRoster(muId) {
  const game = await buildGameHeaders();
  if (!game) {
    console.warn('[Viltrumera] missing cookies for mu roster');
    return { success: false, error: 'Log into app.warera.io first', code: 'NO_COOKIES' };
  }
  const { headers } = game;

  // Fetch MU info
  let muName, muAvatarUrl, memberIds;
  try {
    const muInput = encodeURIComponent(JSON.stringify({ muId }));
    const muResp  = await fetch(`${API4_BASE}/trpc/mu.getById?input=${muInput}`, { headers });
    if (!muResp.ok) {
      console.warn('[Viltrumera] mu.getById returned', muResp.status);
      return { success: false, error: `Failed to fetch MU: ${muResp.status}`, code: 'API_ERROR' };
    }
    const muData   = await muResp.json();
    const muResult = muData?.result?.data;
    muName     = muResult?.name      ?? '';
    muAvatarUrl = muResult?.avatarUrl ?? null;
    memberIds  = muResult?.members   ?? [];
  } catch (err) {
    console.error('[Viltrumera] mu.getById failed:', err.message);
    return { success: false, error: err.message, code: 'UNKNOWN' };
  }

  // Batch-fetch profiles: getUserLite + fetchCurrentEquipment per member
  const members = [];
  for (let offset = 0; offset < memberIds.length; offset += MU_ROSTER_BATCH_SIZE) {
    const batch = memberIds.slice(offset, offset + MU_ROSTER_BATCH_SIZE);
    try {
      const procedures = [
        ...batch.map(() => 'user.getUserLite'),
        ...batch.map(() => 'inventory.fetchCurrentEquipment'),
      ].join(',');

      const input = {};
      batch.forEach((userId, j) => { input[String(j)]              = { userId }; });
      batch.forEach((userId, j) => { input[String(batch.length + j)] = { userId }; });

      const url  = `${API4_BASE}/trpc/${procedures}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.warn('[Viltrumera] roster batch failed at offset', offset, resp.status);
        continue;
      }
      const data = await resp.json();

      for (let j = 0; j < batch.length; j++) {
        const userId = batch[j];
        try {
          const liteResult  = data[j]?.result?.data;
          const equipResult = data[batch.length + j]?.result?.data;
          if (!liteResult) {
            console.warn('[Viltrumera] no getUserLite result for userId', userId);
            continue;
          }
          members.push(parseMemberFromBatch(userId, liteResult, equipResult));
        } catch (err) {
          console.warn('[Viltrumera] failed to parse member', userId, ':', err.message);
        }
      }
    } catch (err) {
      console.warn('[Viltrumera] roster batch error at offset', offset, ':', err.message);
    }
  }

  return {
    success: true,
    type:               'MU_ROSTER_RESULT',
    muName,
    muId,
    avatarUrl:          muAvatarUrl,
    memberCount:        members.length,
    members,
    totalDamagePotential: 0,
  };
}

// ── BUY_ITEM handler ──────────────────────────────────────────────────────

async function handleBuyItem(offerId, _slot, itemCode) {
  if (!OFFER_ID_RE.test(offerId)) {
    return { success: false, error: 'Invalid offer ID', code: 'UNKNOWN' };
  }

  const game = await buildGameHeaders();
  if (!game) {
    console.warn('[Viltrumera] missing cookies for buy');
    return { success: false, error: 'Log into app.warera.io first', code: 'NO_COOKIES' };
  }
  const { headers } = game;

  console.log('[Viltrumera] buying offer:', offerId);

  try {
    const resp = await fetch(`${API_BASE}/trpc/itemOffer.buyItem?batch=1`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ '0': { itemOfferId: offerId } }),
    });

    if (resp.status === 403) {
      console.warn('[Viltrumera] Cloudflare 403');
      return { success: false, error: 'Visit app.warera.io to refresh your session', code: 'CF_BLOCKED' };
    }

    const data      = await resp.json();
    const result    = Array.isArray(data) ? data[0] : data;
    const buyResult = result?.result?.data ?? result;

    if (result?.error) {
      const msg = result.error?.json?.message ?? result.error?.message ?? 'Purchase failed';
      console.warn('[Viltrumera] API error:', msg);
      return { success: false, error: msg, code: 'API_ERROR' };
    }

    console.log('[Viltrumera] buy success:', buyResult);

    let itemId = null;
    try {
      const invResp = await fetch(`${API_BASE}/trpc/inventory.getById?batch=1`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ '0': {} }),
      });
      const invData = await invResp.json();
      const inv     = Array.isArray(invData) ? invData[0]?.result?.data : invData?.result?.data;
      const items   = inv?.items;
      if (items && itemCode) {
        const candidates = [...(items.weapons ?? []), ...(items.equipments ?? [])]
          .filter(i => i.code === itemCode && i.lastAcquisitionAt);
        if (candidates.length > 0) {
          candidates.sort((a, b) => new Date(b.lastAcquisitionAt) - new Date(a.lastAcquisitionAt));
          itemId = candidates[0]._id ?? null;
        }
      }
    } catch (err) {
      console.warn('[Viltrumera] inventory fetch failed:', err.message);
    }

    return { success: true, data: buyResult, itemId };
  } catch (err) {
    console.error('[Viltrumera] fetch error:', err);
    return { success: false, error: err.message || 'Request failed', code: 'UNKNOWN' };
  }
}

// ── EQUIP_ITEMS handler ───────────────────────────────────────────────────

async function handleEquipItems(equipment) {
  const game = await buildGameHeaders();
  if (!game) {
    console.warn('[Viltrumera] missing cookies for equip');
    return { success: false, error: 'Log into app.warera.io first', code: 'NO_COOKIES' };
  }
  const { headers } = game;

  try {
    const resp = await fetch(`${API_BASE}/trpc/user.equipItems?batch=1`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ '0': equipment }),
    });

    if (resp.status === 403) {
      return { success: false, error: 'Visit app.warera.io to refresh your session', code: 'CF_BLOCKED' };
    }

    const data   = await resp.json();
    const result = Array.isArray(data) ? data[0] : data;

    if (result?.error) {
      const msg = result.error?.json?.message ?? result.error?.message ?? 'Equip failed';
      return { success: false, error: msg, code: 'API_ERROR' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Request failed', code: 'UNKNOWN' };
  }
}

// ── FETCH_INVENTORY handler ───────────────────────────────────────────────

async function handleFetchInventory() {
  const game = await buildGameHeaders();
  if (!game) {
    return { success: false, error: 'Log into app.warera.io first', code: 'NO_COOKIES' };
  }
  const { headers } = game;

  try {
    const resp = await fetch(`${API_BASE}/trpc/inventory.getById?batch=1`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ '0': {} }),
    });

    const data = await resp.json();
    const inv  = Array.isArray(data) ? data[0]?.result?.data : data?.result?.data;

    if (Array.isArray(data) ? data[0]?.error : data?.error) {
      const err = Array.isArray(data) ? data[0]?.error : data?.error;
      const msg = err?.json?.message ?? err?.message ?? 'Inventory fetch failed';
      return { success: false, error: msg, code: 'API_ERROR' };
    }

    return { success: true, items: inv?.items ?? {} };
  } catch (err) {
    return { success: false, error: err.message, code: 'UNKNOWN' };
  }
}

// ── JWT sync to backend ───────────────────────────────────────────────────

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

async function connect(jwt, attempt = 0) {
  const payload = decodeJwtPayload(jwt);
  const userId  = payload?.data?._id ?? null;

  try {
    const resp = await fetch(CONNECT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jwt }),
    });

    if (resp.ok) {
      await chrome.storage.local.set({ userId, connected: true, lastSync: Date.now() });
      console.debug('[Viltrumera] connected, user:', userId);
    } else {
      console.warn('[Viltrumera] connect rejected:', resp.status);
      await chrome.storage.local.set({ connected: false });
    }
  } catch (err) {
    if (attempt < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[attempt];
      console.debug(`[Viltrumera] backend unreachable, retry ${attempt + 1} in ${delay}ms:`, err.message);
      setTimeout(() => connect(jwt, attempt + 1), delay);
    } else {
      console.debug('[Viltrumera] backend unreachable after retries, giving up:', err.message);
      await chrome.storage.local.set({ connected: false });
    }
  }
}

async function disconnect() {
  await chrome.storage.local.set({ userId: null, connected: false });
  console.debug('[Viltrumera] JWT removed, cleared session');
}

async function syncFromCookie() {
  const cookie = await chrome.cookies.get({ url: WARERA_ORIGIN, name: COOKIE_NAME });
  if (cookie?.value) {
    await connect(cookie.value);
  } else {
    await disconnect();
  }
}

// ── Event listeners ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(syncFromCookie);
chrome.runtime.onStartup.addListener(syncFromCookie);

chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (cookie.name !== COOKIE_NAME) return;
  if (!cookie.domain.includes('warera.io')) return;
  if (removed) {
    disconnect();
  } else {
    connect(cookie.value);
  }
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url?.startsWith(WARERA_ORIGIN)) return;
  await syncFromCookie();
});

// ── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    console.log('[Viltrumera] background worker alive, ping from content script');
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'SYNC_NOW') {
    syncFromCookie().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'IDENTIFY') {
    handleIdentify().then(sendResponse);
    return true;
  }

  if (message.type === 'BUY_ITEM') {
    handleBuyItem(message.offerId, message.slot, message.itemCode).then(sendResponse);
    return true;
  }

  if (message.type === 'EQUIP_ITEMS') {
    handleEquipItems(message.equipment).then(sendResponse);
    return true;
  }

  if (message.type === 'FETCH_INVENTORY') {
    handleFetchInventory().then(sendResponse);
    return true;
  }

  if (message.type === 'FETCH_MU_ROSTER') {
    handleFetchMuRoster(message.muId).then(sendResponse);
    return true;
  }

  sendResponse({ success: false, error: 'Unknown action', code: 'UNKNOWN' });
});

// ── Periodic re-sync ───────────────────────────────────────────────────────

chrome.alarms.create('periodicSync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodicSync') syncFromCookie();
});

/* istanbul ignore next */
if (typeof module !== 'undefined') {
  module.exports = { decodeJwtPayload, handleIdentify };
}
