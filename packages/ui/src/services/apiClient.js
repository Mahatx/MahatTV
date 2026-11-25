/**
 * Camada de abstração de API do MahatTV.
 * Permite apontar para o servidor local (Web/Desktop Electron) ou,
 * futuramente, para uma bridge nativa / servidor na LAN (Mobile Capacitor).
 */
const API_BASE = window.__MAHATTV_API_BASE__ || '';

async function requestJson(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options);
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
  getPlaylists: () => requestJson('/api/playlists'),
  getCategories: (playlist, type) =>
    requestJson(`/api/categories?playlist=${encodeURIComponent(playlist)}&type=${encodeURIComponent(type)}`),
  getItems: (params) => requestJson(`/api/items?${new URLSearchParams(params).toString()}`),

  syncFavorites: (urls) => postJson('/api/favorites/sync', { urls }),

  getScannerStatus: () => requestJson('/api/scanner/status'),
  startScanner: (payload) => postJson('/api/scanner/start', payload),
  stopScanner: () => postJson('/api/scanner/stop'),
  clearScanner: () => postJson('/api/scanner/clear'),
  checkSingleChannel: (item, forceStatus) => postJson('/api/scanner/check-one', { item, forceStatus }),

  getGithubStatus: (force = false) => requestJson(`/api/github/status${force ? '?force=1' : ''}`),
  triggerGithubUpdate: (options) => postJson('/api/github/update', options),

  getEpgGuide: (params) => requestJson(`/api/epg/guide?${new URLSearchParams(params).toString()}`),
  postEpgGuide: (payload) => postJson('/api/epg/guide', payload),
  refreshEpg: () => postJson('/api/epg/refresh'),
  getChannelEpg: (name, tvgId) =>
    requestJson(`/api/epg/channel?${new URLSearchParams({ name: name || '', tvgId: tvgId || '' }).toString()}`),

  buildProxyUrl: (url, { continuous = false } = {}) =>
    `${API_BASE}/api/proxy?url=${encodeURIComponent(url)}${continuous ? '&continuous=1' : ''}`
};
