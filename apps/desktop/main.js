const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const { startServer } = require('../../packages/server/app');

let mainWindow = null;
let embeddedServer = null;
let serverInfo = null;

// Garantir instância única do aplicativo Desktop
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function getRuntimeDirs() {
  const repoRoot = path.resolve(__dirname, '..', '..');

  if (app.isPackaged) {
    const userData = app.getPath('userData');
    const playlistsDir = path.join(userData, 'playlists');
    const dataDir = path.join(userData, 'data');

    fs.mkdirSync(playlistsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    // Na primeira execução em um novo PC, copia canais verificados e favoritos empacotados
    const seedPairs = [
      [path.join(repoRoot, 'storage', 'data', 'verified-streams.json'), path.join(dataDir, 'verified-streams.json')],
      [path.join(repoRoot, 'storage', 'data', 'favorites.json'), path.join(dataDir, 'favorites.json')],
      [path.join(repoRoot, 'storage', 'playlists', 'Canais-Online.m3u8'), path.join(playlistsDir, 'Canais-Online.m3u8')]
    ];
    for (const [src, dest] of seedPairs) {
      try {
        if (!fs.existsSync(dest) && fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      } catch (err) {
        console.warn('[MahatTV Desktop] Aviso ao copiar seed inicial:', err.message);
      }
    }

    return {
      playlistsDir,
      dataDir,
      uiDir: path.join(__dirname, '..', '..', 'packages', 'ui')
    };
  }

  return {
    playlistsDir: path.join(repoRoot, 'storage', 'playlists'),
    dataDir: path.join(repoRoot, 'storage', 'data'),
    uiDir: path.join(repoRoot, 'packages', 'ui')
  };
}

function createMainWindow(port, dirs) {
  const isSmokeTest = process.env.MAHATTV_SMOKE_TEST === '1';
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';

  mainWindow = new BrowserWindow({
    title: 'MahatTV',
    width: 1380,
    height: 860,
    minWidth: 920,
    minHeight: 600,
    backgroundColor: '#060913',
    icon: path.join(__dirname, 'build', iconFile),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Remover menu padrão para visual limpo estilo app nativo de streaming
  Menu.setApplicationMenu(null);

  // Abrir links externos no navegador padrão do sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Atalho F11 para tela cheia nativa no Windows/Linux
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!isSmokeTest) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    if (isSmokeTest) {
      try {
        const title = await mainWindow.webContents.executeJavaScript('document.title');
        const hasDesktopBridge = await mainWindow.webContents.executeJavaScript('Boolean(window.mahatDesktop)');
        console.log(`[Desktop SmokeTest] OK | title="${title}" | bridge=${hasDesktopBridge} | port=${port}`);
        app.quit();
      } catch (err) {
        console.error('[Desktop SmokeTest] FAILED:', err);
        app.exit(1);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

function registerIpcHandlers(port, dirs) {
  ipcMain.handle('mahat:get-info', () => ({
    isDesktop: true,
    platform: process.platform,
    version: app.getVersion(),
    apiBaseUrl: `http://127.0.0.1:${port}`,
    playlistsDir: dirs.playlistsDir,
    dataDir: dirs.dataDir
  }));

  ipcMain.handle('mahat:toggle-fullscreen', () => {
    if (!mainWindow) return false;
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });

  ipcMain.handle('mahat:open-playlists-folder', async () => {
    await shell.openPath(dirs.playlistsDir);
    return true;
  });
}

app.whenReady().then(async () => {
  try {
    const dirs = getRuntimeDirs();
    serverInfo = await startServer({
      port: 0,
      host: '127.0.0.1',
      playlistsDir: dirs.playlistsDir,
      dataDir: dirs.dataDir,
      uiDir: dirs.uiDir
    });
    embeddedServer = serverInfo.server;

    registerIpcHandlers(serverInfo.port, dirs);
    createMainWindow(serverInfo.port, dirs);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(serverInfo.port, dirs);
      }
    });
  } catch (err) {
    console.error('[MahatTV Desktop] Falha ao iniciar servidor embarcado:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (embeddedServer) {
    try {
      embeddedServer.close();
    } catch {
      // Ignorar ao encerrar
    }
    embeddedServer = null;
  }
});
