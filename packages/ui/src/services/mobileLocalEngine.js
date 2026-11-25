import { sortClientItems } from '../utils/format.js';

/**
 * Motor Mobile Autônomo (Standalone) para rodar 100% no celular (Android/iOS Capacitor)
 * quando não houver servidor MahatTV Desktop configurado na rede local.
 * Usa fetch nativo (CapacitorHttp habilitado) para baixar listas sem bloqueio de CORS.
 */
const REMOTE_BASE = 'https://raw.githubusercontent.com/Ramys/Iptv-Brasil-2026/master';
const MOBILE_PLAYLISTS = [
  { name: 'Canais.m3u8', sizeMB: '0.15' },
  { name: 'CanaisBR03.m3u8', sizeMB: '0.01' }
];

const cache = new Map();

function detectType(url) {
  const lower = (url || '').toLowerCase().split('?')[0];
  if (lower.endsWith('.mp4') || lower.endsWith('.mkv') || lower.includes('/movie/') || lower.includes('/series/')) {
    return 'mp4';
  }
  if (lower.endsWith('.m3u8')) return 'm3u8';
  return 'ts';
}

function parseExtInf(line) {
  const commaIdx = line.lastIndexOf(',');
  const name = commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : '';
  const getAttr = (attr) => {
    const m = line.match(new RegExp(`${attr}="([^"]*)"`, 'i'));
    return m ? m[1].trim() : '';
  };
  return {
    name: name || getAttr('tvg-name') || 'Canal',
    logo: getAttr('tvg-logo'),
    group: getAttr('group-title') || 'Canais Ao Vivo',
    tvgId: getAttr('tvg-id')
  };
}

function parseM3u8Text(text, fileName) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  const categories = new Map();
  let meta = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      meta = parseExtInf(line);
    } else if (!line.startsWith('#') && /^https?:\/\//i.test(line)) {
      const m = meta || { name: `Canal #${items.length + 1}`, logo: '', group: 'Canais Ao Vivo', tvgId: '' };
      const type = detectType(line);
      const isLive = type !== 'mp4';
      items.push({
        id: `${fileName}:${items.length}`,
        name: m.name,
        logo: m.logo,
        group: m.group,
        tvgId: m.tvgId,
        url: line,
        playlist: fileName,
        type,
        isLive,
        status: null
      });
      categories.set(m.group, (categories.get(m.group) || 0) + 1);
      meta = null;
    }
  }
  return { items, categories };
}

async function ensurePlaylistLoaded(fileName) {
  if (fileName === '__LIVE_BR__' || fileName === '__ALL_LIVE__' || fileName === '__ONLINE__' || fileName === '__OFFLINE__') {
    if (fileName === '__ONLINE__' || fileName === '__OFFLINE__') {
      return { items: [], categories: new Map() };
    }
    const items = [];
    const categories = new Map();
    const seen = new Set();
    for (const pl of MOBILE_PLAYLISTS) {
      const data = await ensurePlaylistLoaded(pl.name);
      for (const it of data.items) {
        if (!it.isLive || seen.has(it.url)) continue;
        seen.add(it.url);
        items.push(it);
        categories.set(it.group, (categories.get(it.group) || 0) + 1);
      }
    }
    return { items, categories };
  }

  if (cache.has(fileName)) return cache.get(fileName);

  const storageKey = `mahattv_mobile_pl_${fileName}`;
  let text = '';
  try {
    const res = await fetch(`${REMOTE_BASE}/${encodeURIComponent(fileName)}`);
    if (res.ok) {
      text = await res.text();
      try {
        localStorage.setItem(storageKey, text);
      } catch {
        // Quota excedida
      }
    }
  } catch {
    text = localStorage.getItem(storageKey) || '';
  }

  const parsed = parseM3u8Text(text, fileName);
  cache.set(fileName, parsed);
  return parsed;
}

const emptyScanner = {
  running: false,
  totalToTest: 0,
  tested: 0,
  onlineFound: 0,
  offlineFound: 0,
  speedPerSec: 0,
  savedOnlineTotal: 0,
  savedOfflineTotal: 0
};

export const mobileLocalEngine = {
  async getPlaylists() {
    return {
      playlists: MOBILE_PLAYLISTS.map((p) => ({ ...p, loaded: cache.has(p.name) })),
      scanner: emptyScanner
    };
  },

  async getCategories(playlistName) {
    const data = await ensurePlaylistLoaded(playlistName);
    const categories = Array.from(data.categories.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return {
      playlist: playlistName,
      totalItems: data.items.length,
      liveCount: data.items.length,
      categories,
      scanner: emptyScanner
    };
  },

  async getItems(params) {
    const data = await ensurePlaylistLoaded(params.playlist || '__LIVE_BR__');
    let list = data.items;
    if (params.category && params.category !== 'ALL') {
      list = list.filter((it) => it.group === params.category);
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((it) => it.name.toLowerCase().includes(q) || it.group.toLowerCase().includes(q));
    }
    if (params.sort && params.sort !== 'default') {
      list = sortClientItems(list, params.sort);
    }
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const limit = Math.max(1, parseInt(params.limit || '60', 10));
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;

    return {
      playlist: params.playlist,
      page,
      limit,
      total,
      totalPages,
      items: list.slice(start, start + limit),
      scanner: emptyScanner
    };
  },

  async getEpgGuide(params) {
    const itemsRes = await this.getItems({ ...params, page: 1, limit: 120 });
    const now = Date.now();
    const base = Math.floor(now / (30 * 60 * 1000)) * (30 * 60 * 1000);
    const hours = parseInt(params.hours || '6', 10);
    const offsetMinutes = parseInt(params.offsetMinutes || '-30', 10);
    const windowStart = base + offsetMinutes * 60 * 1000;
    const windowEnd = windowStart + hours * 60 * 60 * 1000;
    return {
      now,
      windowStart,
      windowEnd,
      hours,
      offsetMinutes,
      totalInCategory: itemsRes.total,
      totalUniqueChannels: itemsRes.items.length,
      totalDisplayed: itemsRes.items.length,
      matchedCount: 0,
      epgStatus: { loading: false, loaded: false, lastUpdatedAt: null },
      rows: itemsRes.items.map((ch) => ({
        channel: ch,
        variantsCount: 1,
        epgMatched: false,
        currentProgram: null,
        nextProgram: null,
        programs: []
      }))
    };
  },

  async getChannelEpg() {
    return { matched: false, current: null, upcoming: [] };
  },

  async getScannerStatus() {
    return emptyScanner;
  },

  async getGithubStatus() {
    return {
      checking: false,
      updating: false,
      needsUpdate: false,
      outdatedCount: 0,
      files: [],
      lastCheckedAt: Date.now()
    };
  }
};
