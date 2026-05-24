'use strict';

const ENDPOINTS = {
  local: {
    BACKEND_URL:  'http://localhost:3000',
    FRONTEND_URL: 'http://localhost:5173',
  },
  prod: {
    BACKEND_URL:  'https://api.viltrumera.app',
    FRONTEND_URL: 'https://viltrumera.app',
  },
};

let _cached = null;

async function getConfig() {
  if (_cached) return _cached;
  try {
    const res = await fetch(`${ENDPOINTS.local.BACKEND_URL}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (res.ok) {
      _cached = ENDPOINTS.local;
      return _cached;
    }
  } catch {}
  _cached = ENDPOINTS.prod;
  return _cached;
}

function getCachedConfig() {
  return _cached;
}
