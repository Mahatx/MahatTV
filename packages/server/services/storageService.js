const fs = require('fs');
const { isLiveChannel } = require('../../core');

function createStorageService(paths) {
  const verifiedMap = new Map();
  const favoriteUrlsSet = new Set();
  const favoriteItemsMap = new Map(); // url -> full channel item
  let saveTimer = null;

  function saveVerifiedToDisk() {
    try {
      const allEntries = Array.from(verifiedMap.values());
      fs.writeFileSync(paths.verifiedJsonPath, JSON.stringify(allEntries), 'utf8');

      const onlineLines = ['#EXTM3U'];
      const offlineLines = ['#EXTM3U'];

      for (const entry of allEntries) {
        const it = entry.item;
        if (!it || !isLiveChannel(it.url, it.name, it.group, it.playlist)) continue;
        const extinf = `#EXTINF:-1 tvg-id="${it.tvgId || ''}" tvg-name="${it.name || ''}" tvg-logo="${it.logo || ''}" group-title="${it.group || 'Sem Categoria'}",${it.name || 'Canal'}`;
        if (entry.status === 'online') {
          onlineLines.push(extinf, it.url);
        } else if (entry.status === 'offline') {
          offlineLines.push(extinf, it.url);
        }
      }

      fs.writeFileSync(paths.onlineM3u8Path, onlineLines.join('\n') + '\n', 'utf8');
      fs.writeFileSync(paths.offlineM3u8Path, offlineLines.join('\n') + '\n', 'utf8');
    } catch (err) {
      console.error('[Verificador] Erro ao salvar arquivos verificados:', err.message);
    }
  }

  function scheduleSaveVerified(immediate = false) {
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) {
      saveVerifiedToDisk();
    } else {
      saveTimer = setTimeout(saveVerifiedToDisk, 2500);
    }
  }

  function loadVerifiedFromDisk() {
    try {
      if (fs.existsSync(paths.verifiedJsonPath)) {
        const raw = fs.readFileSync(paths.verifiedJsonPath, 'utf8');
        const arr = JSON.parse(raw);
        let removedVod = 0;
        if (Array.isArray(arr)) {
          for (const entry of arr) {
            if (entry && entry.url && entry.item) {
              const it = entry.item;
              if (isLiveChannel(it.url, it.name, it.group, it.playlist)) {
                it.isLive = true;
                verifiedMap.set(entry.url, entry);
              } else {
                removedVod++;
              }
            }
          }
        }
        console.log(
          `[Verificador] Carregados ${verifiedMap.size} canais ao vivo verificados do disco` +
            (removedVod > 0 ? ` (${removedVod} filmes/séries ignorados e limpos).` : '.')
        );
        if (removedVod > 0) {
          saveVerifiedToDisk();
        }
      }
    } catch (err) {
      console.error('[Verificador] Erro ao carregar cache de verificados:', err.message);
    }
  }

  function loadFavoritesFromDisk() {
    try {
      if (fs.existsSync(paths.favoritesJsonPath)) {
        const arr = JSON.parse(fs.readFileSync(paths.favoritesJsonPath, 'utf8'));
        if (Array.isArray(arr)) {
          arr.forEach((entry) => {
            if (typeof entry === 'string' && entry) {
              favoriteUrlsSet.add(entry);
            } else if (entry && typeof entry === 'object' && entry.url) {
              favoriteUrlsSet.add(entry.url);
              favoriteItemsMap.set(entry.url, entry);
            }
          });
        }
      }
    } catch {
      // Ignorar erro de leitura
    }
  }

  function saveFavoritesToDisk() {
    try {
      const payload = Array.from(favoriteUrlsSet).map((url) => favoriteItemsMap.get(url) || { url });
      fs.writeFileSync(paths.favoritesJsonPath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // Ignorar erro de escrita
    }
  }

  function getFavorites() {
    return Array.from(favoriteItemsMap.values());
  }

  function syncFavorites(favoritesOrUrls = []) {
    favoriteUrlsSet.clear();
    favoriteItemsMap.clear();
    for (const entry of favoritesOrUrls) {
      if (typeof entry === 'string' && entry) {
        favoriteUrlsSet.add(entry);
      } else if (entry && typeof entry === 'object' && entry.url) {
        favoriteUrlsSet.add(entry.url);
        favoriteItemsMap.set(entry.url, entry);
      }
    }
    saveFavoritesToDisk();
    return favoriteUrlsSet.size;
  }

  loadVerifiedFromDisk();
  loadFavoritesFromDisk();

  return {
    verifiedMap,
    favoriteUrlsSet,
    scheduleSaveVerified,
    saveVerifiedToDisk,
    getFavorites,
    syncFavorites
  };
}

module.exports = {
  createStorageService
};
