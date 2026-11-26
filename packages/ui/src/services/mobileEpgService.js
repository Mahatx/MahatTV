import {
  parseXmltvIntoMaps,
  rebuildEpgLookupIndex,
  resolveEpgChannelId,
  buildGuideResponseForItems
} from '../utils/epgCore.js';
import { platformBridge } from './platformBridge.js';
import { mobilePlaylistStore } from './mobilePlaylistStore.js';

const EPG_SOURCES = [
  { name: 'EPGShare BR1', url: 'https://epgshare01.online/epgshare01/epg_ripper_BR1.xml.gz' },
  { name: 'EPGShare BR2', url: 'https://epgshare01.online/epgshare01/epg_ripper_BR2.xml.gz' }
];
const EPG_CACHE_KEY = '__EPG_CACHE_V1__';
const EPG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

const epgState = {
  loading: false,
  loaded: false,
  lastUpdatedAt: null,
  channelsCount: 0,
  programsCount: 0,
  sourcesLoaded: [],
  error: null,
  channels: new Map(),
  programsByChannel: new Map(),
  lookupIndex: new Map()
};

let cacheInitPromise = null;
let activeRefreshPromise = null;

function getEpgStatusSummary() {
  return {
    loading: epgState.loading,
    loaded: epgState.loaded,
    lastUpdatedAt: epgState.lastUpdatedAt,
    channelsCount: epgState.channelsCount,
    programsCount: epgState.programsCount,
    sourcesLoaded: epgState.sourcesLoaded,
    error: epgState.error
  };
}

async function fetchXmltvSource(sourceUrl, timeoutMs = 30000) {
  const nativeProxy = platformBridge.getLocalStreamProxyBaseUrl();

  // Caminho 1 (preferido no APK): proxy local Java em 127.0.0.1 com gunzip nativo (zero CORS)
  if (nativeProxy) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const gunzipFlag = sourceUrl.toLowerCase().endsWith('.gz') ? '&gunzip=1' : '';
      const proxyUrl = `${nativeProxy}/proxy?url=${encodeURIComponent(sourceUrl)}${gunzipFlag}`;
      const res = await fetch(proxyUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  // Caminho 2 (fallback Web/WebView): fetch direto + DecompressionStream('gzip')
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(sourceUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (sourceUrl.toLowerCase().endsWith('.gz') && typeof DecompressionStream !== 'undefined' && res.body) {
      const ds = new DecompressionStream('gzip');
      const decompressedStream = res.body.pipeThrough(ds);
      return await new Response(decompressedStream).text();
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadCacheFromIndexedDb() {
  if (cacheInitPromise) return cacheInitPromise;
  cacheInitPromise = (async () => {
    try {
      const raw = await mobilePlaylistStore.getBlobText(EPG_CACHE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.lastUpdatedAt || !Array.isArray(data.channels) || !Array.isArray(data.programs)) {
        return false;
      }

      epgState.channels.clear();
      epgState.programsByChannel.clear();
      for (const ch of data.channels) {
        epgState.channels.set(ch.id, ch);
      }
      let totalPrograms = 0;
      for (const [chId, progs] of data.programs) {
        epgState.programsByChannel.set(chId, progs);
        totalPrograms += progs.length;
      }

      epgState.lastUpdatedAt = data.lastUpdatedAt;
      epgState.sourcesLoaded = data.sourcesLoaded || [];
      epgState.channelsCount = epgState.channels.size;
      epgState.programsCount = totalPrograms;
      epgState.loaded = totalPrograms > 0;
      epgState.lookupIndex = rebuildEpgLookupIndex(epgState.channels, epgState.programsByChannel);

      const ageMs = Date.now() - data.lastUpdatedAt;
      return ageMs < EPG_REFRESH_INTERVAL_MS && totalPrograms > 0;
    } catch {
      return false;
    }
  })();
  return cacheInitPromise;
}

async function saveCacheToIndexedDb() {
  try {
    const payload = {
      lastUpdatedAt: epgState.lastUpdatedAt,
      sourcesLoaded: epgState.sourcesLoaded,
      channels: Array.from(epgState.channels.values()),
      programs: Array.from(epgState.programsByChannel.entries())
    };
    await mobilePlaylistStore.setBlobText(EPG_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignorar falha de persistência
  }
}

async function refreshEpgData(force = false) {
  await loadCacheFromIndexedDb();

  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  if (
    !force &&
    epgState.loaded &&
    epgState.lastUpdatedAt &&
    Date.now() - epgState.lastUpdatedAt < EPG_REFRESH_INTERVAL_MS
  ) {
    return getEpgStatusSummary();
  }

  activeRefreshPromise = (async () => {
    epgState.loading = true;
    epgState.error = null;
    const startedAt = Date.now();
    const minTimeMs = startedAt - 6 * 60 * 60 * 1000;
    const maxTimeMs = startedAt + 36 * 60 * 60 * 1000;

    try {
      const nextChannels = new Map();
      const nextPrograms = new Map();
      const sourcesOk = [];

      const results = await Promise.allSettled(
        EPG_SOURCES.map(async (src) => {
          const xml = await fetchXmltvSource(src.url);
          return { src, xml };
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.xml) {
          parseXmltvIntoMaps(r.value.xml, nextChannels, nextPrograms, minTimeMs, maxTimeMs);
          sourcesOk.push(r.value.src.name);
        }
      }

      if (nextPrograms.size === 0) {
        throw new Error('Nenhuma fonte EPG retornou programação válida');
      }

      let totalPrograms = 0;
      for (const [chId, list] of nextPrograms.entries()) {
        list.sort((a, b) => a.start - b.start);
        const deduped = [];
        for (const p of list) {
          const prev = deduped[deduped.length - 1];
          if (prev && prev.start === p.start && prev.title === p.title) continue;
          deduped.push(p);
        }
        nextPrograms.set(chId, deduped);
        totalPrograms += deduped.length;
      }

      epgState.channels = nextChannels;
      epgState.programsByChannel = nextPrograms;
      epgState.channelsCount = nextChannels.size;
      epgState.programsCount = totalPrograms;
      epgState.sourcesLoaded = sourcesOk;
      epgState.lastUpdatedAt = Date.now();
      epgState.loaded = true;
      epgState.lookupIndex = rebuildEpgLookupIndex(epgState.channels, epgState.programsByChannel);

      // Persiste em segundo plano no IndexedDB
      saveCacheToIndexedDb();
    } catch (err) {
      epgState.error = err?.message || 'Erro ao atualizar EPG';
    } finally {
      epgState.loading = false;
      activeRefreshPromise = null;
    }

    return getEpgStatusSummary();
  })();

  return activeRefreshPromise;
}

export const mobileEpgService = {
  getStatus() {
    return getEpgStatusSummary();
  },

  async ensureLoaded({ waitIfEmpty = false } = {}) {
    const fresh = await loadCacheFromIndexedDb();
    if (fresh) return getEpgStatusSummary();
    if (waitIfEmpty && !epgState.loaded) {
      return refreshEpgData(false);
    }
    // Dispara atualização em segundo plano sem travar a tela inicial
    refreshEpgData(false).catch(() => {});
    return getEpgStatusSummary();
  },

  refreshEpgData,

  getChannelProgramSnapshot(item, nowMs = Date.now()) {
    if (!epgState.loaded || !item || !item.isLive) return null;
    const epgChId = resolveEpgChannelId(item, epgState.lookupIndex);
    if (!epgChId) return null;
    const progs = epgState.programsByChannel.get(epgChId);
    if (!progs || !progs.length) return null;

    let current = null;
    let next = null;

    for (let i = 0; i < progs.length; i++) {
      const p = progs[i];
      if (p.start <= nowMs && p.stop > nowMs) {
        const duration = Math.max(1, p.stop - p.start);
        const progress = Math.min(100, Math.max(0, Math.round(((nowMs - p.start) / duration) * 100)));
        current = { ...p, progress };
        if (i + 1 < progs.length) next = progs[i + 1];
        break;
      }
      if (p.start > nowMs) {
        next = p;
        break;
      }
    }

    const chMeta = epgState.channels.get(epgChId);
    return {
      epgChannelId: epgChId,
      epgChannelName: chMeta ? chMeta.displayName : epgChId,
      current,
      next
    };
  },

  async getChannelSchedule(name, tvgId, nowMs = Date.now()) {
    await this.ensureLoaded({ waitIfEmpty: false });
    if (!epgState.loaded) {
      return { matched: false, current: null, upcoming: [], epgStatus: getEpgStatusSummary() };
    }
    const epgChId = resolveEpgChannelId({ name, tvgId, isLive: true }, epgState.lookupIndex);
    if (!epgChId) {
      return { matched: false, current: null, upcoming: [], epgStatus: getEpgStatusSummary() };
    }
    const progs = epgState.programsByChannel.get(epgChId) || [];
    const chMeta = epgState.channels.get(epgChId);
    let current = null;
    const upcoming = [];
    for (const p of progs) {
      if (p.start <= nowMs && p.stop > nowMs) {
        const dur = Math.max(1, p.stop - p.start);
        current = {
          ...p,
          progress: Math.min(100, Math.max(0, Math.round(((nowMs - p.start) / dur) * 100)))
        };
      } else if (p.start > nowMs && upcoming.length < 6) {
        upcoming.push(p);
      }
    }
    return {
      matched: Boolean(current || upcoming.length),
      epgChannelId: epgChId,
      epgChannelName: chMeta ? chMeta.displayName : epgChId,
      current,
      upcoming,
      epgStatus: getEpgStatusSummary()
    };
  },

  buildGuideForItems(rawItems, options = {}, { verifiedMap, favoriteUrlsSet } = {}) {
    return buildGuideResponseForItems(rawItems, options, {
      verifiedMap,
      favoriteUrlsSet,
      epgChannels: epgState.channels,
      programsByChannel: epgState.programsByChannel,
      lookupIndex: epgState.lookupIndex,
      epgStatus: getEpgStatusSummary()
    });
  }
};
