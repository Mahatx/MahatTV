const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { detectStreamType, isLiveChannel, parseExtInf } = require('../../core');

function createPlaylistService(paths, storageService) {
  const playlistCache = new Map();

  function getM3u8Files() {
    if (!fs.existsSync(paths.playlistsDir)) return [];
    const entries = fs.readdirSync(paths.playlistsDir, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.toLowerCase().endsWith('.m3u8') &&
          e.name !== 'Canais-Online.m3u8'
      )
      .map((e) => {
        const fullPath = path.join(paths.playlistsDir, e.name);
        const stat = fs.statSync(fullPath);
        const cached = playlistCache.get(e.name);
        return {
          name: e.name,
          size: stat.size,
          sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
          loaded: Boolean(cached && cached.mtimeMs === stat.mtimeMs),
          itemCount: cached ? cached.items.length : null,
          liveCount: cached ? cached.liveCount : null,
          categoryCount: cached ? cached.categories.size : null
        };
      })
      .sort((a, b) => a.size - b.size);
  }

  async function loadPlaylist(fileName) {
    const { verifiedMap } = storageService;

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

      return { mtimeMs: Date.now(), size: 0, items, liveCount: items.length, categories };
    }

    if (fileName === '__LIVE_BR__') {
      const brFiles = ['CanaisBR03.m3u8', 'Canais.m3u8', 'CanaisBR02.m3u8', 'CanaisBR04.m3u8'];
      const items = [];
      const categories = new Map();
      const seenUrls = new Set();

      for (const fName of brFiles) {
        if (!fs.existsSync(path.join(paths.playlistsDir, fName))) continue;
        const pl = await loadPlaylist(fName);
        for (const it of pl.items) {
          if (!it.isLive || seenUrls.has(it.url)) continue;
          seenUrls.add(it.url);
          items.push(it);
          categories.set(it.group, (categories.get(it.group) || 0) + 1);
        }
      }
      return { mtimeMs: Date.now(), size: 0, items, liveCount: items.length, categories };
    }

    if (fileName === '__ALL_LIVE__' || fileName === '__ALL__') {
      const liveCapableFiles = [
        'CanaisBR03.m3u8',
        'Canais.m3u8',
        'CanaisBR02.m3u8',
        'CanaisBR04.m3u8',
        'CanaisIPTV.m3u8'
      ];
      const items = [];
      const categories = new Map();
      const seenUrls = new Set();

      for (const fName of liveCapableFiles) {
        if (!fs.existsSync(path.join(paths.playlistsDir, fName))) continue;
        const pl = await loadPlaylist(fName);
        for (const it of pl.items) {
          if (!it.isLive || seenUrls.has(it.url)) continue;
          seenUrls.add(it.url);
          items.push(it);
          categories.set(it.group, (categories.get(it.group) || 0) + 1);
        }
      }
      return { mtimeMs: Date.now(), size: 0, items, liveCount: items.length, categories };
    }

    const fullPath = path.join(paths.playlistsDir, fileName);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Arquivo não encontrado: ${fileName}`);
    }

    const stat = fs.statSync(fullPath);
    const cached = playlistCache.get(fileName);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached;
    }

    console.log(`[Parser] Carregando ${fileName} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)...`);
    const startTime = Date.now();

    const items = [];
    let liveCount = 0;
    const categories = new Map();
    let currentMeta = null;

    const fileStream = fs.createReadStream(fullPath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        currentMeta = parseExtInf(line);
      } else if (line.startsWith('#')) {
        continue;
      } else if (line.startsWith('http://') || line.startsWith('https://')) {
        const meta = currentMeta || {
          name: `Stream #${items.length + 1}`,
          logo: '',
          group: 'Sem Categoria',
          tvgId: ''
        };

        const isLive = isLiveChannel(line, meta.name, meta.group, fileName);
        if (isLive) liveCount++;

        const item = {
          id: `${fileName}:${items.length}`,
          name: meta.name,
          logo: meta.logo,
          group: meta.group,
          tvgId: meta.tvgId,
          url: line,
          playlist: fileName,
          type: detectStreamType(line),
          isLive
        };

        items.push(item);
        categories.set(meta.group, (categories.get(meta.group) || 0) + 1);
        currentMeta = null;
      }
    }

    const result = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      items,
      liveCount,
      categories
    };

    playlistCache.set(fileName, result);
    console.log(
      `[Parser] ${fileName} concluído em ${Date.now() - startTime}ms (${liveCount} canais ao vivo / ${items.length} total).`
    );
    return result;
  }

  function invalidateCache(fileName) {
    if (fileName) playlistCache.delete(fileName);
    else playlistCache.clear();
  }

  return {
    getM3u8Files,
    loadPlaylist,
    invalidateCache
  };
}

module.exports = {
  createPlaylistService
};
