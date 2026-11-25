const { sortRawChannelItems } = require('../../core');
const { sendJson, readJsonBody } = require('../utils/httpUtils');
const { proxyRequest } = require('../services/proxyService');

function filterItems(items, { category, typeFilter, search, verifiedMap }) {
  let filtered = items;

  if (category !== 'ALL') {
    filtered = filtered.filter((item) => item.group === category);
  }

  if (typeFilter === 'LIVE') {
    filtered = filtered.filter((item) => item.isLive);
  } else if (typeFilter === 'ONLINE') {
    filtered = filtered.filter((item) => {
      const v = verifiedMap.get(item.url);
      return v && v.status === 'online';
    });
  } else if (typeFilter === 'OFFLINE') {
    filtered = filtered.filter((item) => {
      const v = verifiedMap.get(item.url);
      return v && v.status === 'offline';
    });
  } else if (typeFilter !== 'ALL') {
    filtered = filtered.filter((item) => item.type === typeFilter);
  }

  if (search) {
    filtered = filtered.filter(
      (item) =>
        item.name.toLowerCase().includes(search) ||
        item.group.toLowerCase().includes(search)
    );
  }

  return filtered;
}

function createApiRouter(services) {
  const { storageService, playlistService, scannerService, epgService, githubSyncService } = services;

  return async function handleApiRoute(pathname, parsedUrl, req, res) {
    // 0. Health Check (usado pelo App Mobile para testar conexão LAN com o servidor)
    if (pathname === '/api/health') {
      const files = playlistService.getM3u8Files();
      const summary = scannerService.getScannerSummary();
      return sendJson(res, 200, {
        ok: true,
        app: 'MahatTV',
        playlistsCount: files.length,
        verifiedOnline: summary.savedOnlineTotal
      });
    }

    // 1. Playlists, Categorias e Itens
    if (pathname === '/api/playlists') {
      return sendJson(res, 200, {
        playlists: playlistService.getM3u8Files(),
        scanner: scannerService.getScannerSummary()
      });
    }

    if (pathname === '/api/categories') {
      const playlistName = parsedUrl.searchParams.get('playlist') || 'Canais.m3u8';
      const typeFilter = parsedUrl.searchParams.get('type') || 'ALL';
      const data = await playlistService.loadPlaylist(playlistName);

      let categoriesMap = data.categories;
      let totalItems = data.items.length;

      if (typeFilter === 'LIVE') {
        categoriesMap = new Map();
        totalItems = 0;
        for (const it of data.items) {
          if (!it.isLive) continue;
          totalItems++;
          categoriesMap.set(it.group, (categoriesMap.get(it.group) || 0) + 1);
        }
      }

      const categories = Array.from(categoriesMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      return sendJson(res, 200, {
        playlist: playlistName,
        totalItems,
        liveCount: data.liveCount,
        categories,
        scanner: scannerService.getScannerSummary()
      });
    }

    if (pathname === '/api/items') {
      const playlistName = parsedUrl.searchParams.get('playlist') || 'Canais.m3u8';
      const category = parsedUrl.searchParams.get('category') || 'ALL';
      const search = (parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
      const typeFilter = parsedUrl.searchParams.get('type') || 'ALL';
      const sortBy = parsedUrl.searchParams.get('sort') || 'default';
      const page = Math.max(1, parseInt(parsedUrl.searchParams.get('page') || '1', 10));
      const limit = Math.min(200, Math.max(1, parseInt(parsedUrl.searchParams.get('limit') || '60', 10)));

      const data = await playlistService.loadPlaylist(playlistName);
      let filtered = filterItems(data.items, {
        category,
        typeFilter,
        search,
        verifiedMap: storageService.verifiedMap
      });

      filtered = sortRawChannelItems(filtered, sortBy, {
        verifiedMap: storageService.verifiedMap,
        favoriteUrlsSet: storageService.favoriteUrlsSet,
        hasEpgFn: (it) => epgService.hasEpgForItem(it)
      });

      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const startIdx = (page - 1) * limit;
      const items = filtered.slice(startIdx, startIdx + limit).map((it) => {
        const v = storageService.verifiedMap.get(it.url);
        const snap = it.isLive ? epgService.getChannelProgramSnapshot(it) : null;
        return {
          ...it,
          status: v ? v.status : null,
          reason: v ? v.reason : null,
          epgNow:
            snap && snap.current
              ? {
                  title: snap.current.title,
                  start: snap.current.start,
                  stop: snap.current.stop,
                  progress: snap.current.progress
                }
              : null
        };
      });

      return sendJson(res, 200, {
        playlist: playlistName,
        page,
        limit,
        total,
        totalPages,
        items,
        scanner: scannerService.getScannerSummary()
      });
    }

    // 2. Verificador de Canais (Scanner)
    if (pathname === '/api/scanner/status') {
      return sendJson(res, 200, scannerService.getScannerSummary());
    }
    if (pathname === '/api/scanner/start' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await scannerService.startBatchScanner(body));
    }
    if (pathname === '/api/scanner/stop' && req.method === 'POST') {
      return sendJson(res, 200, scannerService.stopScanner());
    }
    if (pathname === '/api/scanner/clear' && req.method === 'POST') {
      return sendJson(res, 200, scannerService.clearVerified());
    }
    if (pathname === '/api/scanner/check-one' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.item || !body.item.url) {
        return sendJson(res, 400, { error: 'Item inválido' });
      }
      const result = await scannerService.checkOrForceSingleItem(body.item, body.forceStatus);
      return sendJson(res, 200, result);
    }

    // 3. Sincronização GitHub
    if (pathname === '/api/github/status') {
      const force = parsedUrl.searchParams.get('force') === '1';
      if (force || (!githubSyncService.githubSyncState.lastCheckedAt && !githubSyncService.githubSyncState.checking)) {
        await githubSyncService.checkGitHubUpdates();
      }
      return sendJson(res, 200, githubSyncService.githubSyncState);
    }
    if (pathname === '/api/github/update' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await githubSyncService.pullGitHubUpdates(body));
    }

    // 4. Favoritos (leitura bidirecional + persistência em storage/data/favorites.json)
    if (pathname === '/api/favorites' && req.method === 'GET') {
      return sendJson(res, 200, { favorites: storageService.getFavorites() });
    }
    if (pathname === '/api/favorites/sync' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const list = Array.isArray(body.favorites) ? body.favorites : Array.isArray(body.urls) ? body.urls : null;
      const count = list !== null ? storageService.syncFavorites(list) : storageService.favoriteUrlsSet.size;
      return sendJson(res, 200, { count });
    }

    // 5. Guia de Programação (EPG / XMLTV)
    if (pathname === '/api/epg/status') {
      return sendJson(res, 200, epgService.getEpgStatusSummary());
    }
    if (pathname === '/api/epg/refresh' && req.method === 'POST') {
      return sendJson(res, 200, await epgService.refreshEpgData(true));
    }
    if (pathname === '/api/epg/channel') {
      const name = parsedUrl.searchParams.get('name') || '';
      const tvgId = parsedUrl.searchParams.get('tvgId') || '';
      return sendJson(res, 200, epgService.getChannelSchedule({ name, tvgId }));
    }
    if (pathname === '/api/epg/guide') {
      if (!epgService.epgState.loaded && !epgService.epgState.loading) {
        await epgService.refreshEpgData(false);
      }

      let hours = Math.min(24, Math.max(2, parseInt(parsedUrl.searchParams.get('hours') || '6', 10)));
      let offsetMinutes = parseInt(parsedUrl.searchParams.get('offsetMinutes') || '-30', 10);
      let dedupe = parsedUrl.searchParams.get('dedupe') !== '0';
      let onlyWithEpg = parsedUrl.searchParams.get('onlyWithEpg') === '1';
      let sortBy = parsedUrl.searchParams.get('sort') || 'default';
      let limit = Math.min(300, Math.max(10, parseInt(parsedUrl.searchParams.get('limit') || '120', 10)));
      let rawItems = [];

      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (Array.isArray(body.items)) rawItems = body.items;
        if (typeof body.hours === 'number') hours = Math.min(24, Math.max(2, body.hours));
        if (typeof body.offsetMinutes === 'number') offsetMinutes = body.offsetMinutes;
        if (typeof body.dedupe === 'boolean') dedupe = body.dedupe;
        if (typeof body.onlyWithEpg === 'boolean') onlyWithEpg = body.onlyWithEpg;
        if (typeof body.sortBy === 'string') sortBy = body.sortBy;
        if (typeof body.limit === 'number') limit = Math.min(300, Math.max(10, body.limit));
      } else {
        const playlistName = parsedUrl.searchParams.get('playlist') || '__LIVE_BR__';
        const category = parsedUrl.searchParams.get('category') || 'ALL';
        const search = (parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
        const typeFilter = parsedUrl.searchParams.get('type') || 'ALL';

        const data = await playlistService.loadPlaylist(playlistName);
        rawItems = filterItems(data.items, {
          category,
          typeFilter,
          search,
          verifiedMap: storageService.verifiedMap
        });
      }

      const guide = epgService.buildGuideForItems(rawItems, {
        hours,
        offsetMinutes,
        dedupe,
        onlyWithEpg,
        sortBy,
        limit
      });
      return sendJson(res, 200, guide);
    }

    // 6. Proxy de Stream (Continuous TS + HLS)
    if (pathname === '/api/proxy') {
      const streamUrl = parsedUrl.searchParams.get('url');
      if (!streamUrl) {
        return sendJson(res, 400, { error: 'Parâmetro url é obrigatório' });
      }
      const isContinuousTs = parsedUrl.searchParams.get('continuous') === '1';
      const isSegment = parsedUrl.searchParams.get('segment') === '1';
      proxyRequest(streamUrl, req, res, { isContinuousTs, isSegment });
      return true;
    }

    return false;
  };
}

module.exports = {
  createApiRouter
};
