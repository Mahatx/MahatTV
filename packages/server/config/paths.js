const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function resolvePaths(overrides = {}) {
  const rootDir = overrides.rootDir || REPO_ROOT;
  const playlistsDir =
    overrides.playlistsDir ||
    process.env.MAHATTV_PLAYLISTS_DIR ||
    path.join(rootDir, 'storage', 'playlists');
  const dataDir =
    overrides.dataDir ||
    process.env.MAHATTV_DATA_DIR ||
    path.join(rootDir, 'storage', 'data');
  const uiDir =
    overrides.uiDir ||
    process.env.MAHATTV_UI_DIR ||
    path.join(rootDir, 'packages', 'ui');
  const uiPublicDir = path.join(uiDir, 'public');

  if (!fs.existsSync(playlistsDir)) {
    fs.mkdirSync(playlistsDir, { recursive: true });
  }
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  return {
    rootDir,
    playlistsDir,
    dataDir,
    uiDir,
    uiPublicDir,
    verifiedJsonPath: path.join(dataDir, 'verified-streams.json'),
    onlineM3u8Path: path.join(playlistsDir, 'Canais-Online.m3u8'),
    offlineM3u8Path: path.join(dataDir, 'Canais-Offline.m3u8'),
    epgCachePath: path.join(dataDir, 'epg-cache.json'),
    favoritesJsonPath: path.join(dataDir, 'favorites.json')
  };
}

module.exports = {
  resolvePaths
};
