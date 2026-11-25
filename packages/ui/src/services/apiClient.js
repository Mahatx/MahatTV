import { platformBridge } from './platformBridge.js';
import { mobileLocalEngine } from './mobileLocalEngine.js';

/**
 * Camada de abstração de API do MahatTV.
 * - Web / Electron / Mobile conectado ao servidor LAN -> chama /api/*
 * - Mobile nativo sem servidor LAN -> usa mobileLocalEngine (modo autônomo)
 */
async function requestJson(path, options) {
  const base = platformBridge.getApiBaseUrl();
  const res = await fetch(`${base}${path}`, options);
  return res.json();
}

function postJson(path, body) {
  return requestJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
}

export const apiClient = {
  async checkHealth(customBaseUrl) {
    const clean = String(customBaseUrl || '').trim().replace(/\/+$/, '');
    const res = await fetch(`${clean}/api/health`, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  getPlaylists: () =>
    platformBridge.isStandaloneMobile() ? mobileLocalEngine.getPlaylists() : requestJson('/api/playlists'),

  getCategories: (playlist, type) =>
    platformBridge.isStandaloneMobile()
      ? mobileLocalEngine.getCategories(playlist, type)
      : requestJson(`/api/categories?playlist=${encodeURIComponent(playlist)}&type=${encodeURIComponent(type)}`),

  getItems: (params) =>
    platformBridge.isStandaloneMobile()
      ? mobileLocalEngine.getItems(params)
      : requestJson(`/api/items?${new URLSearchParams(params).toString()}`),

  syncFavorites: (urls) =>
    platformBridge.isStandaloneMobile() ? Promise.resolve({ count: urls.length }) : postJson('/api/favorites/sync', { urls }),

  getScannerStatus: () =>
    platformBridge.isStandaloneMobile() ? mobileLocalEngine.getScannerStatus() : requestJson('/api/scanner/status'),

  startScanner: (payload) =>
    platformBridge.isStandaloneMobile() ? mobileLocalEngine.getScannerStatus() : postJson('/api/scanner/start', payload),

  stopScanner: () =>
    platformBridge.isStandaloneMobile() ? mobileLocalEngine.getScannerStatus() : postJson('/api/scanner/stop'),

  clearScanner: () =>
    platformBridge.isStandaloneMobile() ? mobileLocalEngine.getScannerStatus() : postJson('/api/scanner/clear'),

  checkSingleChannel: (item, forceStatus) =>
    platformBridge.isStandaloneMobile()
      ? Promise.resolve({ url: item.url, status: forceStatus || 'online' })
      : postJson('/api/scanner/check-one', { item, forceStatus }),

  getGithubStatus: (force = false) =>
    platformBridge.isStandaloneMobile()
      ? mobileLocalEngine.getGithubStatus()
      : requestJson(`/api/github/status${force ? '?force=1' : ''}`),

  triggerGithubUpdate: (options) =>
    platformBridge.isStandaloneMobile() ? mobileLocalEngine.getGithubStatus() : postJson('/api/github/update', options),

  getEpgGuide: (params) =>
    platformBridge.isStandaloneMobile()
      ? mobileLocalEngine.getEpgGuide(params)
      : requestJson(`/api/epg/guide?${new URLSearchParams(params).toString()}`),

  postEpgGuide: (payload) =>
    platformBridge.isStandaloneMobile()
      ? mobileLocalEngine.getEpgGuide(payload)
      : postJson('/api/epg/guide', payload),

  refreshEpg: () =>
    platformBridge.isStandaloneMobile() ? Promise.resolve({ loaded: false }) : postJson('/api/epg/refresh'),

  getChannelEpg: (name, tvgId) =>
    platformBridge.isStandaloneMobile()
      ? mobileLocalEngine.getChannelEpg(name, tvgId)
      : requestJson(`/api/epg/channel?${new URLSearchParams({ name: name || '', tvgId: tvgId || '' }).toString()}`),

  buildProxyUrl: (url, { continuous = false } = {}) => {
    if (platformBridge.isStandaloneMobile()) {
      return url;
    }
    const base = platformBridge.getApiBaseUrl();
    return `${base}/api/proxy?url=${encodeURIComponent(url)}${continuous ? '&continuous=1' : ''}`;
  }
};
