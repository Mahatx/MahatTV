const http = require('http');
const https = require('https');
const { URL } = require('url');
const { isLiveChannel } = require('../../core');

function checkSingleStream(streamUrl, timeoutMs = 5500, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 4) {
      return resolve({ online: false, statusCode: 0, reason: 'TOO_MANY_REDIRECTS', netError: false });
    }

    let parsed;
    try {
      parsed = new URL(streamUrl);
    } catch {
      return resolve({ online: false, statusCode: 0, reason: 'INVALID_URL', netError: false });
    }

    const client = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const req = client.request(
      parsed,
      {
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
          'Accept': '*/*',
          'Connection': 'close'
        }
      },
      (res) => {
        const code = res.statusCode || 0;

        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.destroy();
          try {
            const nextUrl = new URL(res.headers.location, parsed).toString();
            return checkSingleStream(nextUrl, timeoutMs, redirectCount + 1).then(finish);
          } catch {
            return finish({ online: false, statusCode: code, reason: 'BAD_REDIRECT', netError: false });
          }
        }

        if (code !== 200 && code !== 206) {
          res.destroy();
          return finish({ online: false, statusCode: code, reason: `HTTP_${code}`, netError: false });
        }

        const contentType = (res.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('text/html')) {
          res.destroy();
          return finish({ online: false, statusCode: code, reason: 'HTML_RESPONSE', netError: false });
        }

        let bytesRead = 0;
        let firstChunkStr = '';

        res.on('data', (chunk) => {
          bytesRead += chunk.length;
          if (!firstChunkStr && chunk.length > 0) {
            firstChunkStr = chunk.slice(0, 128).toString('utf8');
          }

          if (bytesRead > 0) {
            res.destroy();
            req.destroy();
            if (firstChunkStr.includes('<html') || firstChunkStr.includes('<!DOCTYPE html')) {
              return finish({ online: false, statusCode: code, reason: 'HTML_BODY', netError: false });
            }
            return finish({ online: true, statusCode: code, reason: 'OK', netError: false });
          }
        });

        res.on('end', () => {
          if (bytesRead > 0) {
            finish({ online: true, statusCode: code, reason: 'OK', netError: false });
          } else {
            finish({ online: false, statusCode: code, reason: 'EMPTY_STREAM', netError: false });
          }
        });

        res.on('error', () => {
          if (bytesRead > 0) {
            finish({ online: true, statusCode: code, reason: 'OK', netError: false });
          } else {
            finish({ online: false, statusCode: code, reason: 'STREAM_READ_ERR', netError: false });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      finish({ online: false, statusCode: 0, reason: 'TIMEOUT', netError: true });
    });

    req.on('error', (err) => {
      finish({ online: false, statusCode: 0, reason: err.code || 'NET_ERR', netError: true });
    });

    req.end();
  });
}

function createScannerService(paths, storageService, playlistService) {
  const { verifiedMap, scheduleSaveVerified } = storageService;

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
      savedOfflineTotal: offlineTotal,
      onlineFilePath: paths.onlineM3u8Path
    };
  }

  async function startBatchScanner(options = {}) {
    if (scannerState.running) {
      return getScannerSummary();
    }

    const {
      playlist = '__LIVE_BR__',
      category = 'ALL',
      search = '',
      onlyUnchecked = true,
      fastHostSkip = true,
      concurrency = 25,
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
    scannerState.currentUrl = 'Filtrando apenas canais de transmissão ao vivo...';
    scannerState.startedAt = Date.now();
    scannerState.finishedAt = null;
    scannerState.deadHosts.clear();
    scannerState.hostStats.clear();

    (async () => {
      try {
        const data = await playlistService.loadPlaylist(playlist);
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

        const uniqueQueue = [];
        const seen = new Set();
        for (const it of candidates) {
          if (seen.has(it.url)) continue;
          if (onlyUnchecked && verifiedMap.has(it.url)) continue;
          seen.add(it.url);
          uniqueQueue.push(it);
          if (maxItems > 0 && uniqueQueue.length >= maxItems) break;
        }

        scannerState.totalToTest = uniqueQueue.length;
        let cursor = 0;

        const worker = async () => {
          while (!scannerState.stopRequested) {
            const idx = cursor++;
            if (idx >= uniqueQueue.length) break;

            const item = uniqueQueue[idx];
            scannerState.currentUrl = `${item.name} [${item.group}] (${item.playlist})`;

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

            const res = await checkSingleStream(item.url, 5500);

            if (hostKey) {
              const st = scannerState.hostStats.get(hostKey) || { ok: 0, fail: 0 };
              if (res.online) {
                st.ok++;
              } else {
                st.fail++;
                if (st.ok === 0 && st.fail >= 12) {
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

            if (scannerState.tested % 20 === 0) {
              scheduleSaveVerified(false);
            }
          }
        };

        const workersCount = Math.min(concurrency, Math.max(1, uniqueQueue.length));
        const workers = Array.from({ length: workersCount }, () => worker());
        await Promise.all(workers);
      } catch (err) {
        console.error('[Verificador] Erro durante execução do scanner:', err);
      } finally {
        scannerState.running = false;
        scannerState.finishedAt = Date.now();
        scannerState.currentUrl = '';
        scheduleSaveVerified(true);
        console.log(
          `[Verificador Ao Vivo] Finalizado! Testados: ${scannerState.tested}, Online: ${scannerState.onlineFound}, Offline: ${scannerState.offlineFound}`
        );
      }
    })();

    return getScannerSummary();
  }

  function stopScanner() {
    scannerState.stopRequested = true;
    return getScannerSummary();
  }

  function clearVerified() {
    if (scannerState.running) scannerState.stopRequested = true;
    verifiedMap.clear();
    scheduleSaveVerified(true);
    return getScannerSummary();
  }

  async function checkOrForceSingleItem(item, forceStatus) {
    const isLive = isLiveChannel(item.url, item.name, item.group, item.playlist);

    if (forceStatus === 'online' || forceStatus === 'offline') {
      if (isLive) {
        verifiedMap.set(item.url, {
          url: item.url,
          status: forceStatus,
          checkedAt: Date.now(),
          statusCode: forceStatus === 'online' ? 200 : 0,
          reason: forceStatus === 'online' ? 'PLAYER_OK' : 'PLAYER_ERR',
          item: { ...item, isLive: true }
        });
        scheduleSaveVerified(false);
      }
      return {
        url: item.url,
        status: forceStatus,
        scanner: getScannerSummary()
      };
    }

    const checkRes = await checkSingleStream(item.url, 6000);
    const status = checkRes.online ? 'online' : 'offline';
    if (isLive) {
      verifiedMap.set(item.url, {
        url: item.url,
        status,
        checkedAt: Date.now(),
        statusCode: checkRes.statusCode,
        reason: checkRes.reason,
        item: { ...item, isLive: true }
      });
      scheduleSaveVerified(true);
    }

    return {
      url: item.url,
      status,
      reason: checkRes.reason,
      statusCode: checkRes.statusCode,
      scanner: getScannerSummary()
    };
  }

  return {
    getScannerSummary,
    startBatchScanner,
    stopScanner,
    clearVerified,
    checkOrForceSingleItem
  };
}

module.exports = {
  createScannerService,
  checkSingleStream
};
