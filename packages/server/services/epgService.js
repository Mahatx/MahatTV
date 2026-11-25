const fs = require('fs');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');
const {
  parseXmltvIntoMaps,
  rebuildEpgLookupIndex,
  resolveEpgChannelId,
  buildGuideResponseForItems
} = require('../../core');

const EPG_SOURCES = [
  { name: 'EPGShare BR1', url: 'https://epgshare01.online/epgshare01/epg_ripper_BR1.xml.gz' },
  { name: 'EPGShare BR2', url: 'https://epgshare01.online/epgshare01/epg_ripper_BR2.xml.gz' }
];
const EPG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

function downloadXmlBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Muitos redirecionamentos no EPG'));
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(
      parsed,
      {
        headers: { 'User-Agent': 'MahatTV/1.0' },
        timeout: 25000
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, parsed).toString();
          return downloadXmlBuffer(nextUrl, redirectCount + 1).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        const stream = url.toLowerCase().endsWith('.gz') ? res.pipe(zlib.createGunzip()) : res;
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timeout ao baixar EPG')));
    req.on('error', reject);
  });
}

function createEpgService(paths, storageService) {
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

  function saveEpgCacheToDisk() {
    try {
      const payload = {
        lastUpdatedAt: epgState.lastUpdatedAt,
        sourcesLoaded: epgState.sourcesLoaded,
        channels: Array.from(epgState.channels.values()),
        programs: Array.from(epgState.programsByChannel.entries())
      };
      fs.writeFileSync(paths.epgCachePath, JSON.stringify(payload), 'utf8');
    } catch (err) {
      console.error('[EPG] Erro ao salvar cache em disco:', err.message);
    }
  }

  function loadEpgCacheFromDisk() {
    try {
      if (!fs.existsSync(paths.epgCachePath)) return false;
      const raw = fs.readFileSync(paths.epgCachePath, 'utf8');
      const data = JSON.parse(raw);
      if (!data || !data.lastUpdatedAt || !Array.isArray(data.channels) || !Array.isArray(data.programs)) {
        return false;
      }

      const ageMs = Date.now() - data.lastUpdatedAt;
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

      console.log(
        `[EPG] Cache carregado do disco: ${epgState.channelsCount} canais, ${epgState.programsCount} programas ` +
          `(idade: ${Math.round(ageMs / 60000)} min).`
      );
      return ageMs < EPG_REFRESH_INTERVAL_MS && totalPrograms > 0;
    } catch (err) {
      console.error('[EPG] Erro ao ler cache do disco:', err.message);
      return false;
    }
  }

  async function refreshEpgData(force = false) {
    if (epgState.loading) return getEpgStatusSummary();
    if (
      !force &&
      epgState.loaded &&
      epgState.lastUpdatedAt &&
      Date.now() - epgState.lastUpdatedAt < EPG_REFRESH_INTERVAL_MS
    ) {
      return getEpgStatusSummary();
    }

    epgState.loading = true;
    epgState.error = null;
    const startedAt = Date.now();
    const minTimeMs = startedAt - 6 * 60 * 60 * 1000;
    const maxTimeMs = startedAt + 36 * 60 * 60 * 1000;

    try {
      console.log('[EPG] Baixando guia de programação brasileiro (XMLTV)...');
      const nextChannels = new Map();
      const nextPrograms = new Map();
      const sourcesOk = [];

      const results = await Promise.allSettled(
        EPG_SOURCES.map(async (src) => {
          const xml = await downloadXmlBuffer(src.url);
          return { src, xml };
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          parseXmltvIntoMaps(r.value.xml, nextChannels, nextPrograms, minTimeMs, maxTimeMs);
          sourcesOk.push(r.value.src.name);
        } else {
          console.warn('[EPG] Falha em uma fonte EPG:', r.reason?.message || r.reason);
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
      saveEpgCacheToDisk();

      console.log(
        `[EPG] Guia carregado em ${Date.now() - startedAt}ms: ${epgState.channelsCount} canais, ${epgState.programsCount} programas (${sourcesOk.join(' + ')}).`
      );
    } catch (err) {
      epgState.error = err.message;
      console.error('[EPG] Erro ao atualizar guia:', err.message);
    } finally {
      epgState.loading = false;
    }

    return getEpgStatusSummary();
  }

  function hasEpgForItem(item) {
    return Boolean(epgState.loaded && item && item.isLive && resolveEpgChannelId(item, epgState.lookupIndex));
  }

  function getChannelProgramSnapshot(item, nowMs = Date.now()) {
    if (!epgState.loaded) return null;
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
  }

  function getChannelSchedule(item, nowMs = Date.now()) {
    const epgChId = resolveEpgChannelId(item, epgState.lookupIndex);
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
  }

  function buildGuideForItems(rawItems, options = {}) {
    return buildGuideResponseForItems(rawItems, options, {
      verifiedMap: storageService.verifiedMap,
      favoriteUrlsSet: storageService.favoriteUrlsSet,
      epgChannels: epgState.channels,
      programsByChannel: epgState.programsByChannel,
      lookupIndex: epgState.lookupIndex,
      epgStatus: getEpgStatusSummary()
    });
  }

  return {
    EPG_REFRESH_INTERVAL_MS,
    epgState,
    getEpgStatusSummary,
    loadEpgCacheFromDisk,
    refreshEpgData,
    hasEpgForItem,
    getChannelProgramSnapshot,
    getChannelSchedule,
    buildGuideForItems
  };
}

module.exports = {
  createEpgService
};
