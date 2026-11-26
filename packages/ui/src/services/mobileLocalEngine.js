import { CapacitorHttp } from '@capacitor/core';
import { sortClientItems, tryConvertXtreamToHls } from '../utils/format.js';
import { mobilePlaylistStore } from './mobilePlaylistStore.js';
import { mobileEpgService } from './mobileEpgService.js';

/**
 * Motor Mobile Autônomo (Standalone) para rodar 100% no celular (Android/iOS Capacitor)
 * quando não houver servidor MahatTV Desktop configurado na rede local.
 * - Armazena TODAS as listas (.m3u8) do repositório no IndexedDB (sem limite de 5 MB do localStorage)
 * - Sincronização real com GitHub (Ramys/Iptv-Brasil-2026) com progresso em tempo real e comparação de SHA
 * - Verificador de Canais Ao Vivo (Scanner) nativo via CapacitorHttp
 */
const GITHUB_OWNER = 'Ramys';
const GITHUB_REPO = 'Iptv-Brasil-2026';
const GITHUB_BRANCH = 'master';
const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`;
const REMOTE_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;

const BR_LIVE_LISTS = ['CanaisBR03.m3u8', 'Canais.m3u8', 'CanaisBR02.m3u8', 'CanaisBR04.m3u8'];
const ALL_LIVE_LISTS = ['CanaisBR03.m3u8', 'Canais.m3u8', 'CanaisBR02.m3u8', 'CanaisBR04.m3u8', 'CanaisIPTV.m3u8'];

// Lista de fallback caso a API do GitHub atinja rate-limit temporário
const FALLBACK_REPO_FILES = [
  { name: 'CanaisBR03.m3u8', remoteSize: 15_000 },
  { name: 'Canais.m3u8', remoteSize: 150_000 },
  { name: 'CanaisBR02.m3u8', remoteSize: 280_000 },
  { name: 'CanaisBR04.m3u8', remoteSize: 750_000 },
  { name: 'CanaisBR01.m3u8', remoteSize: 1_500_000 },
  { name: 'CanaisIPTV.m3u8', remoteSize: 4_500_000 },
  { name: 'Filmes-Series.m3u8', remoteSize: 16_000_000 }
];

const VERIFIED_STORAGE_KEY = 'mahattv_mobile_verified_v1';
const MAX_PARSED_CACHE = 4;

const cache = new Map(); // LRU de listas já parseadas em memória
const verifiedMap = new Map(); // url -> { url, status, checkedAt, statusCode, reason, item }
let seedLoadedPromise = null;
let seededFavorites = [];

function setParsedCache(name, parsed) {
  if (cache.has(name)) cache.delete(name);
  cache.set(name, parsed);
  while (cache.size > MAX_PARSED_CACHE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

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

function ensureSeedLoaded() {
  if (seedLoadedPromise) return seedLoadedPromise;
  seedLoadedPromise = (async () => {
    try {
      const res = await fetch('./seed/verified-online.json');
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr)) {
          let added = 0;
          for (const entry of arr) {
            if (entry && entry.url && entry.item && !verifiedMap.has(entry.url)) {
              verifiedMap.set(entry.url, entry);
              added++;
            }
          }
          if (added > 0) saveVerifiedToStorage(false);
        }
      }
    } catch {
      // Seed opcional
    }

    try {
      const resFav = await fetch('./seed/favorites.json');
      if (resFav.ok) {
        const favs = await resFav.json();
        if (Array.isArray(favs)) {
          seededFavorites = favs.filter((f) => f && typeof f === 'object' && f.url);
        }
      }
    } catch {
      // Seed opcional
    }
  })();
  return seedLoadedPromise;
}

let saveTimer = null;
function saveVerifiedToStorage(immediate = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const persist = () => {
    try {
      const compact = Array.from(verifiedMap.values()).slice(-2000);
      localStorage.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      try {
        const onlyOnline = Array.from(verifiedMap.values()).filter((e) => e.status === 'online');
        localStorage.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(onlyOnline));
      } catch {
        // Ignorar
      }
    }
  };
  if (immediate) persist();
  else saveTimer = setTimeout(persist, 2000);
}

loadVerifiedFromStorage();

// =========================================================
// SINCRONIZAÇÃO COMPLETA COM O REPOSITÓRIO GITHUB
// =========================================================
const githubSyncState = {
  repoUrl: GITHUB_REPO_URL,
  checking: false,
  updating: false,
  needsUpdate: false,
  outdatedCount: 0,
  totalRemoteFiles: 0,
  lastCheckedAt: null,
  lastCommitDate: null,
  lastCommitMessage: null,
  lastCommitSha: null,
  error: null,
  updateProgress: {
    currentFile: '',
    completedFiles: 0,
    totalFiles: 0,
    bytesDownloaded: 0,
    totalBytes: 0
  },
  files: []
};

async function fetchJsonWithFallback(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (fetchErr) {
    if (CapacitorHttp && typeof CapacitorHttp.get === 'function') {
      const res = await CapacitorHttp.get({
        url,
        headers: {
          'User-Agent': 'MahatTV-Glass-Stream-Player',
          Accept: 'application/vnd.github.v3+json'
        },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs
      });
      if (res.status >= 200 && res.status < 300) {
        return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    throw fetchErr;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadTextWithProgress(url, onBytes, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      const chunks = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (onBytes) onBytes(value.byteLength);
          chunks.push(decoder.decode(value, { stream: true }));
        }
      }
      chunks.push(decoder.decode());
      return { text: chunks.join(''), byteLength: totalBytes };
    }

    const text = await res.text();
    if (onBytes) onBytes(text.length);
    return { text, byteLength: text.length };
  } catch (fetchErr) {
    if (CapacitorHttp && typeof CapacitorHttp.get === 'function') {
      const res = await CapacitorHttp.get({
        url,
        headers: { 'User-Agent': 'MahatTV/2.2' },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        responseType: 'text'
      });
      if (res.status >= 200 && res.status < 300) {
        const text = typeof res.data === 'string' ? res.data : String(res.data || '');
        if (onBytes) onBytes(text.length);
        return { text, byteLength: text.length };
      }
      throw new Error(`HTTP ${res.status}`);
    }
    throw fetchErr;
  } finally {
    clearTimeout(timer);
  }
}

async function recomputeGithubStatusesFromLocal(remoteList) {
  const localMetaList = await mobilePlaylistStore.listMeta();
  const localByName = new Map(localMetaList.map((m) => [m.name, m]));

  const fileStatuses = [];
  let outdatedCount = 0;

  for (const remote of remoteList) {
    const local = localByName.get(remote.name);
    let status = 'up_to_date';
    if (!local) {
      status = 'missing_local';
      outdatedCount++;
    } else if (remote.sha && local.sha && local.sha !== remote.sha) {
      status = 'outdated';
      outdatedCount++;
    }

    const remoteSize = remote.size || remote.remoteSize || 0;
    fileStatuses.push({
      name: remote.name,
      remoteSize,
      remoteSizeMB: (remoteSize / (1024 * 1024)).toFixed(2),
      remoteSha: remote.sha || remote.remoteSha || '',
      localSize: local ? local.size : 0,
      localSha: local ? local.sha : null,
      status,
      downloadUrl:
        remote.download_url ||
        remote.downloadUrl ||
        `${REMOTE_BASE}/${encodeURIComponent(remote.name)}`
    });
  }

  githubSyncState.files = fileStatuses.sort((a, b) => a.remoteSize - b.remoteSize);
  githubSyncState.totalRemoteFiles = fileStatuses.length;
  githubSyncState.outdatedCount = outdatedCount;
  githubSyncState.needsUpdate = outdatedCount > 0;
}

async function checkGithubUpdatesMobile(force = false) {
  if (githubSyncState.checking || githubSyncState.updating) {
    return githubSyncState;
  }

  // Evita estourar rate-limit da API pública do GitHub durante polling
  if (!force && githubSyncState.lastCheckedAt && Date.now() - githubSyncState.lastCheckedAt < 10 * 60 * 1000) {
    if (githubSyncState.files.length) {
      await recomputeGithubStatusesFromLocal(githubSyncState.files);
    }
    return githubSyncState;
  }

  githubSyncState.checking = true;
  githubSyncState.error = null;

  try {
    const [contents, commitInfo] = await Promise.all([
      fetchJsonWithFallback(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents?ref=${GITHUB_BRANCH}`,
        12000
      ),
      fetchJsonWithFallback(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`,
        10000
      ).catch(() => null)
    ]);

    if (commitInfo && commitInfo.commit) {
      githubSyncState.lastCommitSha = (commitInfo.sha || '').slice(0, 7);
      githubSyncState.lastCommitDate = commitInfo.commit.committer?.date || commitInfo.commit.author?.date || null;
      githubSyncState.lastCommitMessage = commitInfo.commit.message || '';
    }

    const remoteM3u8 = Array.isArray(contents)
      ? contents.filter((item) => item.type === 'file' && item.name.toLowerCase().endsWith('.m3u8'))
      : [];

    await recomputeGithubStatusesFromLocal(remoteM3u8.length ? remoteM3u8 : FALLBACK_REPO_FILES);
    githubSyncState.lastCheckedAt = Date.now();
  } catch (err) {
    githubSyncState.error = err?.message || 'Erro ao consultar GitHub';
    // Fallback: mesmo se a API do GitHub der rate-limit (HTTP 403), usa a lista conhecida via raw.githubusercontent
    if (!githubSyncState.files.length) {
      await recomputeGithubStatusesFromLocal(FALLBACK_REPO_FILES);
    }
    githubSyncState.lastCheckedAt = Date.now();
  } finally {
    githubSyncState.checking = false;
  }

  return githubSyncState;
}

async function pullGithubUpdatesMobile(options = {}) {
  if (githubSyncState.updating) return githubSyncState;

  const { forceAll = false, targetFile = null } = options || {};

  if (!githubSyncState.files.length) {
    await checkGithubUpdatesMobile(true);
  }

  const toDownload = githubSyncState.files.filter((f) => {
    if (targetFile) return f.name === targetFile;
    if (forceAll) return true;
    return f.status === 'outdated' || f.status === 'missing_local';
  });

  if (!toDownload.length) {
    return githubSyncState;
  }

  githubSyncState.updating = true;
  githubSyncState.error = null;
  githubSyncState.updateProgress = {
    currentFile: toDownload[0].name,
    completedFiles: 0,
    totalFiles: toDownload.length,
    bytesDownloaded: 0,
    totalBytes: toDownload.reduce((acc, f) => acc + (f.remoteSize || 0), 0)
  };

  (async () => {
    try {
      for (const fileInfo of toDownload) {
        githubSyncState.updateProgress.currentFile = fileInfo.name;
        const { text, byteLength } = await downloadTextWithProgress(
          fileInfo.downloadUrl,
          (chunkBytes) => {
            githubSyncState.updateProgress.bytesDownloaded += chunkBytes;
          },
          60000
        );

        await mobilePlaylistStore.savePlaylist({
          name: fileInfo.name,
          sha: fileInfo.remoteSha || null,
          size: byteLength || fileInfo.remoteSize || text.length,
          text
        });

        cache.delete(fileInfo.name);
        githubSyncState.updateProgress.completedFiles++;
      }
    } catch (err) {
      githubSyncState.error = `Erro ao baixar lista: ${err?.message || 'falha de rede'}`;
    } finally {
      await recomputeGithubStatusesFromLocal(
        githubSyncState.files.length ? githubSyncState.files : FALLBACK_REPO_FILES
      );
      githubSyncState.updateProgress.currentFile = '';
      githubSyncState.updating = false;
    }
  })();

  return githubSyncState;
}

// =========================================================
// SCANNER & PARSER DE PLAYLISTS
// =========================================================
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

function extractAttr(line, attr) {
  const key = `${attr}="`;
  let idx = line.indexOf(key);
  if (idx === -1) {
    idx = line.toLowerCase().indexOf(key);
    if (idx === -1) return '';
  }
  const start = idx + key.length;
  const end = line.indexOf('"', start);
  return end === -1 ? '' : line.slice(start, end).trim();
}

function parseExtInf(line) {
  const commaIdx = line.lastIndexOf(',');
  const name = commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : '';
  return {
    name: name || extractAttr(line, 'tvg-name') || 'Canal',
    logo: extractAttr(line, 'tvg-logo'),
    group: extractAttr(line, 'group-title') || 'Canais Ao Vivo',
    tvgId: extractAttr(line, 'tvg-id')
  };
}

/**
 * Parser M3U8 de baixa memória (sem .split() gigante para listas de 15+ MB como Filmes-Series.m3u8)
 */
function parseM3u8Text(text, fileName) {
  const src = String(text || '');
  const len = src.length;
  const items = [];
  const categories = new Map();
  let liveCount = 0;
  let meta = null;
  let pos = 0;

  while (pos < len) {
    let nl = src.indexOf('\n', pos);
    if (nl === -1) nl = len;
    let end = nl;
    if (end > pos && src.charCodeAt(end - 1) === 13) end--;
    const line = src.slice(pos, end).trim();
    pos = nl + 1;

    if (!line) continue;
    if (line.charCodeAt(0) === 35) {
      if (line.startsWith('#EXTINF:')) {
        meta = parseExtInf(line);
      }
      continue;
    }

    if (line.startsWith('http://') || line.startsWith('https://')) {
      const m = meta || { name: `Canal #${items.length + 1}`, logo: '', group: 'Canais Ao Vivo', tvgId: '' };
      const type = detectType(line);
      const isLive = type !== 'mp4';
      if (isLive) liveCount++;
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

  return { items, liveCount, categories };
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
    return { items, liveCount: items.length, categories };
  }

  if (fileName === '__LIVE_BR__' || fileName === '__ALL_LIVE__' || fileName === '__ALL__') {
    const targetListNames = fileName === '__LIVE_BR__' ? BR_LIVE_LISTS : ALL_LIVE_LISTS;
    const items = [];
    const categories = new Map();
    const seen = new Set();
    const loadedLists = await Promise.all(
      targetListNames.map((name) => ensurePlaylistLoaded(name).catch(() => ({ items: [] })))
    );
    for (const data of loadedLists) {
      for (const it of data.items) {
        if (!it.isLive || seen.has(it.url)) continue;
        seen.add(it.url);
        items.push(it);
        categories.set(it.group, (categories.get(it.group) || 0) + 1);
      }
    }
    return { items, liveCount: items.length, categories };
  }

  if (cache.has(fileName)) return cache.get(fileName);

  // 1. Tenta carregar instantaneamente do IndexedDB
  let text = await mobilePlaylistStore.getText(fileName);

  // 2. Se ainda não existe localmente, baixa sob demanda do GitHub e salva no IndexedDB
  if (!text) {
    try {
      const ghEntry = githubSyncState.files.find((f) => f.name === fileName);
      const url = ghEntry?.downloadUrl || `${REMOTE_BASE}/${encodeURIComponent(fileName)}`;
      const res = await downloadTextWithProgress(url, null, 45000);
      text = res.text;
      if (text) {
        await mobilePlaylistStore.savePlaylist({
          name: fileName,
          sha: ghEntry?.remoteSha || null,
          size: res.byteLength || text.length,
          text
        });
      }
    } catch {
      text = '';
    }
  }

  const parsed = parseM3u8Text(text, fileName);
  setParsedCache(fileName, parsed);
  return parsed;
}

/**
 * Testa um canal ao vivo no Android/iOS com segurança (sem travar em streams .ts infinitos)
 */
async function probeUrlNative(url, method = 'HEAD', timeoutMs = 4500) {
  const headers = {
    'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
    Accept: '*/*'
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

  if (hlsCandidate) {
    try {
      const r = await probeUrlNative(hlsCandidate, 'GET', 4500);
      if ((r.code === 200 || r.code === 206) && !r.ct.includes('text/html') && !r.bodyStr.includes('<html')) {
        if (r.bodyStr.includes('#EXTM3U') || r.ct.includes('mpegurl') || r.ct.includes('video')) {
          return { online: true, statusCode: r.code, reason: 'HLS_OK' };
        }
      }
    } catch {
      // Segue para fallback HEAD
    }
  }

  try {
    const r = await probeUrlNative(streamUrl, 'HEAD', 4500);
    if ((r.code === 200 || r.code === 206) && !r.ct.includes('text/html')) {
      return { online: true, statusCode: r.code, reason: 'HEAD_OK' };
    }
    if (r.code === 405 || r.code === 501) {
      try {
        const resRange = await CapacitorHttp.request({
          url: streamUrl,
          method: 'GET',
          headers: {
            'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
            Range: 'bytes=0-2047'
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
  async getFavorites() {
    await ensureSeedLoaded();
    return { favorites: seededFavorites };
  },

  async getPlaylists() {
    await ensureSeedLoaded();
    // Aquece o cache/download do EPG brasileiro em segundo plano sem travar a abertura
    mobileEpgService.ensureLoaded({ waitIfEmpty: false }).catch(() => {});
    const localMeta = await mobilePlaylistStore.listMeta();
    const merged = new Map();

    // 1. Listas descobertas do GitHub (ou fallback das 7 listas conhecidas)
    const remoteSource = githubSyncState.files.length ? githubSyncState.files : FALLBACK_REPO_FILES;
    for (const f of remoteSource) {
      const size = f.remoteSize || 0;
      merged.set(f.name, {
        name: f.name,
        size,
        sizeMB: (size / (1024 * 1024)).toFixed(2),
        loaded: cache.has(f.name),
        downloaded: false
      });
    }

    // 2. Sobrescreve com metadados reais das listas já baixadas no IndexedDB
    for (const m of localMeta) {
      merged.set(m.name, {
        name: m.name,
        size: m.size || 0,
        sizeMB: m.sizeMB || ((m.size || 0) / (1024 * 1024)).toFixed(2),
        loaded: cache.has(m.name),
        downloaded: true
      });
    }

    const playlists = Array.from(merged.values()).sort((a, b) => a.size - b.size);
    return {
      playlists,
      scanner: getScannerSummary()
    };
  },

  async getCategories(playlistName) {
    await ensureSeedLoaded();
    const data = await ensurePlaylistLoaded(playlistName);
    const categories = Array.from(data.categories.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return {
      playlist: playlistName,
      totalItems: data.items.length,
      liveCount: typeof data.liveCount === 'number' ? data.liveCount : data.items.length,
      categories,
      scanner: getScannerSummary()
    };
  },

  async getItems(params) {
    await ensureSeedLoaded();
    const data = await ensurePlaylistLoaded(params.playlist || '__ONLINE__');
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
    const limit = Math.max(1, parseInt(params.limit || '30', 10));
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const nowMs = Date.now();
    const pageItems = list.slice(start, start + limit).map((it) => {
      const snap = mobileEpgService.getChannelProgramSnapshot(it, nowMs);
      if (snap && snap.current) {
        return {
          ...it,
          epgNow: {
            title: snap.current.title,
            start: snap.current.start,
            stop: snap.current.stop,
            progress: snap.current.progress
          }
        };
      }
      return it;
    });

    return {
      playlist: params.playlist,
      page,
      limit,
      total,
      totalPages,
      items: pageItems,
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
        const data = await ensurePlaylistLoaded(playlist);
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

  async getEpgGuide(params = {}) {
    await ensureSeedLoaded();
    await mobileEpgService.ensureLoaded({ waitIfEmpty: true });

    const data = await ensurePlaylistLoaded(params.playlist || '__ONLINE__');
    let list = data.items.filter((it) => it.isLive);

    if (params.category && params.category !== 'ALL') {
      list = list.filter((it) => it.group === params.category);
    }

    const typeFilter = params.type || 'ALL';
    if (typeFilter === 'ONLINE') {
      list = list.filter((it) => {
        const v = verifiedMap.get(it.url);
        return (v ? v.status : it.status) === 'online';
      });
    } else if (typeFilter === 'OFFLINE') {
      list = list.filter((it) => {
        const v = verifiedMap.get(it.url);
        return (v ? v.status : it.status) === 'offline';
      });
    } else if (typeFilter !== 'ALL' && typeFilter !== 'LIVE') {
      list = list.filter((it) => it.type === typeFilter);
    }

    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((it) => it.name.toLowerCase().includes(q) || it.group.toLowerCase().includes(q));
    }

    const favUrls = new Set();
    try {
      const storedFavs = JSON.parse(localStorage.getItem('iptv_favorites_v1') || '[]');
      if (Array.isArray(storedFavs)) storedFavs.forEach((f) => f && f.url && favUrls.add(f.url));
    } catch {
      // Ignorar
    }

    return mobileEpgService.buildGuideForItems(
      list,
      {
        hours: Math.min(24, Math.max(2, parseInt(params.hours || '6', 10))),
        offsetMinutes: parseInt(params.offsetMinutes || '-30', 10),
        dedupe: params.dedupe !== '0' && params.dedupe !== false,
        onlyWithEpg: params.onlyWithEpg === '1' || params.onlyWithEpg === true,
        sortBy: params.sort || params.sortBy || 'default',
        limit: Math.min(200, Math.max(10, parseInt(params.limit || '150', 10)))
      },
      { verifiedMap, favoriteUrlsSet: favUrls }
    );
  },

  async postEpgGuide(payload = {}) {
    await ensureSeedLoaded();
    await mobileEpgService.ensureLoaded({ waitIfEmpty: true });

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const favUrls = new Set(rawItems.map((it) => it && it.url).filter(Boolean));

    return mobileEpgService.buildGuideForItems(
      rawItems,
      {
        hours: Math.min(24, Math.max(2, parseInt(payload.hours || '6', 10))),
        offsetMinutes: parseInt(payload.offsetMinutes || '-30', 10),
        dedupe: payload.dedupe !== false && payload.dedupe !== '0',
        onlyWithEpg: Boolean(payload.onlyWithEpg),
        sortBy: payload.sortBy || payload.sort || 'default',
        limit: Math.min(200, Math.max(10, parseInt(payload.limit || '150', 10)))
      },
      { verifiedMap, favoriteUrlsSet: favUrls }
    );
  },

  async refreshEpg() {
    return mobileEpgService.refreshEpgData(true);
  },

  async getChannelEpg(name, tvgId) {
    return mobileEpgService.getChannelSchedule(name, tvgId);
  },

  async getGithubStatus(force = false) {
    return checkGithubUpdatesMobile(force);
  },

  async triggerGithubUpdate(options = {}) {
    return pullGithubUpdatesMobile(options);
  }
};
