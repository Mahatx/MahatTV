import { CapacitorHttp } from '@capacitor/core';
import { sortClientItems, tryConvertXtreamToHls } from '../utils/format.js';

/**
 * Motor Mobile Autônomo (Standalone) para rodar 100% no celular (Android/iOS Capacitor)
 * quando não houver servidor MahatTV Desktop configurado na rede local.
 * Inclui parser M3U8, persistência local e Verificador de Canais Ao Vivo (Scanner) nativo.
 */
const REMOTE_BASE = 'https://raw.githubusercontent.com/Ramys/Iptv-Brasil-2026/master';
const MOBILE_PLAYLISTS = [
  { name: 'CanaisBR03.m3u8', sizeMB: '0.01' },
  { name: 'Canais.m3u8', sizeMB: '0.15' }
];
const VERIFIED_STORAGE_KEY = 'mahattv_mobile_verified_v1';

const cache = new Map();
const verifiedMap = new Map(); // url -> { url, status, checkedAt, statusCode, reason, item }

function loadVerifiedFromStorage() {
  try {
    const raw = localStorage.getItem(VERIFIED_STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (entry && entry.url && entry.item) {
          verifiedMap.set(entry.url, entry);
        }
      }
    }
  } catch {
    // Ignorar cache corrompido
  }
}

let saveTimer = null;
function saveVerifiedToStorage(immediate = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const persist = () => {
    try {
      const compact = Array.from(verifiedMap.values()).slice(-2000);
      localStorage.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // Se atingir cota do localStorage, salva apenas os canais online
      try {
        const onlyOnline = Array.from(verifiedMap.values()).filter((e) => e.status === 'online');
        localStorage.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(onlyOnline));
      } catch {
        // Ignorar
      }
    }
  };
  if (immediate) persist();
  else saveTimer = setTimeout(persist, 1200);
}

loadVerifiedFromStorage();

const scannerState = {
  running: false,
  stopRequested: false,
  scope: '__LIVE_BR__',
  fastHostSkip: true,
  totalToTest: 0,
  tested: 0,
  onlineFound: 0,
  offlineFound: 0,
  skippedDeadHost: 0,
  currentUrl: '',
  startedAt: null,
  finishedAt: null,
  deadHosts: new Set(),
  hostStats: new Map()
};

function getScannerSummary() {
  let onlineTotal = 0;
  let offlineTotal = 0;
  for (const v of verifiedMap.values()) {
    if (v.status === 'online') onlineTotal++;
    else if (v.status === 'offline') offlineTotal++;
  }

  const elapsedSec = scannerState.startedAt
    ? Math.max(1, Math.floor(((scannerState.finishedAt || Date.now()) - scannerState.startedAt) / 1000))
    : 0;

  return {
    running: scannerState.running,
    scope: scannerState.scope,
    fastHostSkip: scannerState.fastHostSkip,
    totalToTest: scannerState.totalToTest,
    tested: scannerState.tested,
    onlineFound: scannerState.onlineFound,
    offlineFound: scannerState.offlineFound,
    skippedDeadHost: scannerState.skippedDeadHost,
    currentUrl: scannerState.currentUrl,
    deadHostsCount: scannerState.deadHosts.size,
    speedPerSec: elapsedSec > 0 ? Number((scannerState.tested / elapsedSec).toFixed(1)) : 0,
    savedOnlineTotal: onlineTotal,
    savedOfflineTotal: offlineTotal
  };
}

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

async function nativeTextGet(url, timeoutMs = 12000) {
  try {
    if (CapacitorHttp && typeof CapacitorHttp.get === 'function') {
      const res = await CapacitorHttp.get({
        url,
        headers: { 'User-Agent': 'MahatTV/2.2' },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        responseType: 'text'
      });
      if (res.status >= 200 && res.status < 300) {
        return typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
      }
      throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    // Fallback para fetch padrão
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function ensurePlaylistLoaded(fileName) {
  if (fileName === '__ONLINE__' || fileName === '__OFFLINE__') {
    const targetStatus = fileName === '__ONLINE__' ? 'online' : 'offline';
    const items = [];
    const categories = new Map();
    for (const entry of verifiedMap.values()) {
      if (entry.status === targetStatus && entry.item) {
        const it = { ...entry.item, status: entry.status, isLive: true };
        items.push(it);
        categories.set(it.group, (categories.get(it.group) || 0) + 1);
      }
    }
    return { items, categories };
  }

  if (fileName === '__LIVE_BR__' || fileName === '__ALL_LIVE__' || fileName === '__ALL__') {
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
    text = await nativeTextGet(`${REMOTE_BASE}/${encodeURIComponent(fileName)}`, 15000);
    if (text) {
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

/**
 * Testa um canal ao vivo no Android/iOS com segurança (sem travar em streams .ts infinitos!):
 * 1. Para URLs .m3u8 (ou Xtream .ts convertida para .m3u8), faz GET leve do manifesto (~500 bytes).
 * 2. Para demais URLs .ts, usa HEAD (lê apenas cabeçalhos HTTP sem baixar fluxo infinito) com timeout curto.
 */
async function probeUrlNative(url, method = 'HEAD', timeoutMs = 4500) {
  const headers = {
    'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
    'Accept': '*/*'
  };

  if (CapacitorHttp && typeof CapacitorHttp.request === 'function') {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      responseType: 'text'
    });
    const code = res.status || 0;
    const ct = String(res.headers?.['Content-Type'] || res.headers?.['content-type'] || '').toLowerCase();
    const bodyStr = typeof res.data === 'string' ? res.data.slice(0, 256) : '';
    return { code, ct, bodyStr };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, signal: controller.signal });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const bodyStr = method === 'GET' ? (await res.text()).slice(0, 256) : '';
    return { code: res.status, ct, bodyStr };
  } finally {
    clearTimeout(timer);
  }
}

async function checkSingleStreamMobile(streamUrl) {
  const hlsCandidate = streamUrl.toLowerCase().split('?')[0].endsWith('.m3u8')
    ? streamUrl
    : tryConvertXtreamToHls(streamUrl);

  // Tentativa 1: testar manifesto HLS (.m3u8) — resposta finita, super rápida e confiável
  if (hlsCandidate) {
    try {
      const r = await probeUrlNative(hlsCandidate, 'GET', 4500);
      if ((r.code === 200 || r.code === 206) && !r.ct.includes('text/html') && !r.bodyStr.includes('<html')) {
        if (r.bodyStr.includes('#EXTM3U') || r.ct.includes('mpegurl') || r.ct.includes('video')) {
          return { online: true, statusCode: r.code, reason: 'HLS_OK' };
        }
      }
    } catch {
      // Segue para fallback HEAD na URL original
    }
  }

  // Tentativa 2: HEAD na URL original (não baixa stream contínuo infinito)
  try {
    const r = await probeUrlNative(streamUrl, 'HEAD', 4500);
    if ((r.code === 200 || r.code === 206) && !r.ct.includes('text/html')) {
      return { online: true, statusCode: r.code, reason: 'HEAD_OK' };
    }
    if (r.code === 405 || r.code === 501) {
      // Servidor não aceita HEAD: tenta Range mínimo de 2 KB
      try {
        const resRange = await CapacitorHttp.request({
          url: streamUrl,
          method: 'GET',
          headers: {
            'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
            'Range': 'bytes=0-2047'
          },
          connectTimeout: 4000,
          readTimeout: 4000,
          responseType: 'text'
        });
        if (resRange.status === 200 || resRange.status === 206) {
          return { online: true, statusCode: resRange.status, reason: 'RANGE_OK' };
        }
      } catch {
        // Offline
      }
    }
    return { online: false, statusCode: r.code, reason: r.code ? `HTTP_${r.code}` : 'OFFLINE' };
  } catch (err) {
    return { online: false, statusCode: 0, reason: err?.message || 'TIMEOUT' };
  }
}

export const mobileLocalEngine = {
  async getPlaylists() {
    return {
      playlists: MOBILE_PLAYLISTS.map((p) => ({ ...p, loaded: cache.has(p.name) })),
      scanner: getScannerSummary()
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
      scanner: getScannerSummary()
    };
  },

  async getItems(params) {
    const data = await ensurePlaylistLoaded(params.playlist || '__LIVE_BR__');
    let list = data.items.map((it) => {
      const v = verifiedMap.get(it.url);
      return {
        ...it,
        status: v ? v.status : it.status || null,
        reason: v ? v.reason : null
      };
    });

    if (params.category && params.category !== 'ALL') {
      list = list.filter((it) => it.group === params.category);
    }

    const typeFilter = params.type || 'ALL';
    if (typeFilter === 'LIVE') {
      list = list.filter((it) => it.isLive);
    } else if (typeFilter === 'ONLINE') {
      list = list.filter((it) => it.status === 'online');
    } else if (typeFilter === 'OFFLINE') {
      list = list.filter((it) => it.status === 'offline');
    } else if (typeFilter !== 'ALL') {
      list = list.filter((it) => it.type === typeFilter);
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
      scanner: getScannerSummary()
    };
  },

  async getScannerStatus() {
    return getScannerSummary();
  },

  async startScanner(options = {}) {
    if (scannerState.running) return getScannerSummary();

    const {
      playlist = '__LIVE_BR__',
      category = 'ALL',
      search = '',
      onlyUnchecked = true,
      fastHostSkip = true,
      maxItems = 0
    } = options;

    scannerState.running = true;
    scannerState.stopRequested = false;
    scannerState.scope = playlist;
    scannerState.fastHostSkip = Boolean(fastHostSkip);
    scannerState.tested = 0;
    scannerState.onlineFound = 0;
    scannerState.offlineFound = 0;
    scannerState.skippedDeadHost = 0;
    scannerState.currentUrl = 'Carregando lista de canais ao vivo...';
    scannerState.startedAt = Date.now();
    scannerState.finishedAt = null;
    scannerState.deadHosts.clear();
    scannerState.hostStats.clear();

    (async () => {
      try {
        // Mapear listas grandes que não existem no standalone para __LIVE_BR__
        const safeScope =
          playlist === 'CanaisBR02.m3u8' || playlist === 'CanaisBR04.m3u8' ? '__LIVE_BR__' : playlist;
        const data = await ensurePlaylistLoaded(safeScope);
        let candidates = data.items.filter((it) => it.isLive);

        if (category !== 'ALL') {
          candidates = candidates.filter((it) => it.group === category);
        }
        if (search) {
          const q = search.toLowerCase();
          candidates = candidates.filter(
            (it) => it.name.toLowerCase().includes(q) || it.group.toLowerCase().includes(q)
          );
        }

        const queue = [];
        const seen = new Set();
        for (const it of candidates) {
          if (seen.has(it.url)) continue;
          if (onlyUnchecked && verifiedMap.has(it.url)) continue;
          seen.add(it.url);
          queue.push(it);
          if (maxItems > 0 && queue.length >= maxItems) break;
        }

        scannerState.totalToTest = queue.length;
        let cursor = 0;

        const worker = async () => {
          while (!scannerState.stopRequested) {
            const idx = cursor++;
            if (idx >= queue.length) break;

            const item = queue[idx];
            scannerState.currentUrl = `${item.name} [${item.group}]`;

            let hostKey = '';
            try {
              hostKey = new URL(item.url).host;
            } catch {
              hostKey = '';
            }

            if (scannerState.fastHostSkip && hostKey && scannerState.deadHosts.has(hostKey)) {
              verifiedMap.set(item.url, {
                url: item.url,
                status: 'offline',
                checkedAt: Date.now(),
                statusCode: 0,
                reason: 'HOST_OFFLINE',
                item
              });
              scannerState.tested++;
              scannerState.offlineFound++;
              scannerState.skippedDeadHost++;
              continue;
            }

            const res = await checkSingleStreamMobile(item.url);

            if (hostKey) {
              const st = scannerState.hostStats.get(hostKey) || { ok: 0, fail: 0 };
              if (res.online) {
                st.ok++;
              } else {
                st.fail++;
                if (st.ok === 0 && st.fail >= 8) {
                  scannerState.deadHosts.add(hostKey);
                }
              }
              scannerState.hostStats.set(hostKey, st);
            }

            const status = res.online ? 'online' : 'offline';
            verifiedMap.set(item.url, {
              url: item.url,
              status,
              checkedAt: Date.now(),
              statusCode: res.statusCode,
              reason: res.reason,
              item
            });

            scannerState.tested++;
            if (res.online) scannerState.onlineFound++;
            else scannerState.offlineFound++;

            if (scannerState.tested % 10 === 0) {
              saveVerifiedToStorage(false);
            }
          }
        };

        const workersCount = Math.min(8, Math.max(1, queue.length));
        await Promise.all(Array.from({ length: workersCount }, () => worker()));
      } catch (err) {
        console.error('[Mobile Scanner] Erro:', err);
      } finally {
        scannerState.running = false;
        scannerState.finishedAt = Date.now();
        scannerState.currentUrl = '';
        saveVerifiedToStorage(true);
      }
    })();

    return getScannerSummary();
  },

  async stopScanner() {
    scannerState.stopRequested = true;
    return getScannerSummary();
  },

  async clearScanner() {
    scannerState.stopRequested = true;
    verifiedMap.clear();
    saveVerifiedToStorage(true);
    return getScannerSummary();
  },

  async checkSingleChannel(item, forceStatus) {
    if (!item || !item.url) return { status: 'offline', scanner: getScannerSummary() };

    if (forceStatus === 'online' || forceStatus === 'offline') {
      verifiedMap.set(item.url, {
        url: item.url,
        status: forceStatus,
        checkedAt: Date.now(),
        statusCode: forceStatus === 'online' ? 200 : 0,
        reason: forceStatus === 'online' ? 'PLAYER_OK' : 'PLAYER_ERR',
        item: { ...item, isLive: true }
      });
      saveVerifiedToStorage(false);
      return { url: item.url, status: forceStatus, scanner: getScannerSummary() };
    }

    const res = await checkSingleStreamMobile(item.url);
    const status = res.online ? 'online' : 'offline';
    verifiedMap.set(item.url, {
      url: item.url,
      status,
      checkedAt: Date.now(),
      statusCode: res.statusCode,
      reason: res.reason,
      item: { ...item, isLive: true }
    });
    saveVerifiedToStorage(true);
    return {
      url: item.url,
      status,
      reason: res.reason,
      statusCode: res.statusCode,
      scanner: getScannerSummary()
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
