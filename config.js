'use strict';

const ENV = {
  dev: {
    BACKEND_URL:  'http://localhost:3000',
    FRONTEND_URL: 'http://localhost:5173',
  },
  prod: {
    BACKEND_URL:  'https://api.viltrumera.app',
    FRONTEND_URL: 'https://viltrumera.app',
  },
};

async function getConfig() {
  const self  = await chrome.management.getSelf();
  const isDev = self.installType === 'development';
  return isDev ? ENV.dev : ENV.prod;
}
