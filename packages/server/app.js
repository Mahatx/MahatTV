const http = require('http');
const { URL } = require('url');
const { resolvePaths } = require('./config/paths');
const { sendJson, serveStaticFile } = require('./utils/httpUtils');
const { createStorageService } = require('./services/storageService');
const { createPlaylistService } = require('./services/playlistService');
const { createScannerService } = require('./services/scannerService');
const { createEpgService } = require('./services/epgService');
const { createGithubSyncService } = require('./services/githubSyncService');
const { createApiRouter } = require('./routes/apiRouter');

function createAppServer(options = {}) {
  const paths = resolvePaths(options);
  const storageService = createStorageService(paths);
  const playlistService = createPlaylistService(paths, storageService);
  const scannerService = createScannerService(paths, storageService, playlistService);
  const epgService = createEpgService(paths, storageService);
  const githubSyncService = createGithubSyncService(paths, playlistService);

  const handleApiRoute = createApiRouter({
    storageService,
    playlistService,
    scannerService,
    epgService,
    githubSyncService
  });

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (pathname.startsWith('/api/')) {
        const handled = await handleApiRoute(pathname, parsedUrl, req, res);
        if (handled !== false) return;
        return sendJson(res, 404, { error: 'Endpoint não encontrado' });
      }

      serveStaticFile(pathname, paths, res);
    } catch (err) {
      console.error('[Erro no Servidor]:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: err.message || 'Erro interno no servidor' });
      }
    }
  });

  const timers = [];

  async function warmup() {
    try {
      await playlistService.loadPlaylist('CanaisBR03.m3u8');
      await playlistService.loadPlaylist('Canais.m3u8');
    } catch {
      // Ignorar se listas ainda não existirem localmente (ex: primeira execução limpa)
    }

    githubSyncService.checkGitHubUpdates();
    timers.push(setInterval(() => githubSyncService.checkGitHubUpdates(), 30 * 60 * 1000));

    const epgCacheFresh = epgService.loadEpgCacheFromDisk();
    if (!epgCacheFresh) {
      epgService.refreshEpgData(false);
    }
    timers.push(setInterval(() => epgService.refreshEpgData(false), epgService.EPG_REFRESH_INTERVAL_MS));
  }

  server.on('close', () => {
    timers.forEach((t) => clearInterval(t));
    timers.length = 0;
  });

  return {
    server,
    paths,
    warmup,
    services: {
      storageService,
      playlistService,
      scannerService,
      epgService,
      githubSyncService
    }
  };
}

function startServer(options = {}) {
  const port = options.port !== undefined ? options.port : Number(process.env.PORT || 3000);
  const host = options.host || '0.0.0.0';
  const app = createAppServer(options);

  return new Promise((resolve, reject) => {
    app.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n⚠️  A porta ${port} já está em uso por outra instância do servidor!`);
        console.error(`👉 O player já deve estar aberto em: http://localhost:${port}`);
        console.error(`   (Se quiser reiniciar, feche o outro terminal ou encerre o processo node.exe)\n`);
      }
      reject(err);
    });

    app.server.listen(port, host, async () => {
      const actualPort = app.server.address().port;
      console.log(`\n==================================================`);
      console.log(`  📺 MahatTV • Glass Stream Player rodando!`);
      console.log(`  👉 Acesse: http://localhost:${actualPort}`);
      console.log(`  📂 Playlists: ${app.paths.playlistsDir}`);
      console.log(`==================================================\n`);
      app.warmup();
      resolve({ ...app, port: actualPort });
    });
  });
}

module.exports = {
  createAppServer,
  startServer
};
