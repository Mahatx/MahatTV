import { state } from './state/store.js';
import { queryDomElements } from './state/dom.js';
import { createScannerController } from './features/scanner/scannerController.js';
import { createGithubSyncController } from './features/githubSync/githubSyncController.js';
import { createPlayerController } from './features/player/playerController.js';
import { createEpgController } from './features/epg/epgController.js';
import { createCatalogController } from './features/catalog/catalogController.js';
import { createTvModeController } from './features/tvMode/tvModeController.js';
import { createSettingsController } from './features/settings/settingsController.js';

document.addEventListener('DOMContentLoaded', async () => {
  const els = queryDomElements();

  // Referências cruzadas resolvidas via callbacks para manter cada feature desacoplada
  let scanner;
  let githubSync;
  let player;
  let epg;
  let catalog;
  let tvMode;
  let settings;

  scanner = createScannerController({
    state,
    els,
    onToggleSidebar: (open) => catalog.toggleMobileSidebar(open),
    onRefreshItems: () => catalog.fetchItems(),
    onSelectOnline: () => catalog.selectPlaylist('__ONLINE__')
  });

  githubSync = createGithubSyncController({
    state,
    els,
    onToggleSidebar: (open) => catalog.toggleMobileSidebar(open),
    onReloadCatalog: async () => {
      await catalog.fetchPlaylists();
      await catalog.selectPlaylist(state.currentPlaylist);
    }
  });

  player = createPlayerController({
    state,
    els,
    onScannerUpdate: (st) => scanner.updateScannerUI(st),
    onChannelStarted: (item) => {
      tvMode.updateTvHudForChannel(item);
      if (state.uiMode === 'simple') {
        tvMode.enterTvImmersiveMode();
      } else if (window.innerWidth <= 960) {
        els.playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      settings.syncSettingsCurrentStreamUI();
    },
    onChannelStopped: () => tvMode.exitTvAndStopPlayer(),
    onLoadChannelEpg: (item) => epg.loadPlayerChannelEpg(item)
  });

  epg = createEpgController({
    state,
    els,
    onPlayChannel: (ch) => player.playStream(ch),
    onFetchItems: () => catalog.fetchItems()
  });

  catalog = createCatalogController({
    state,
    els,
    onScannerUpdate: (st) => scanner.updateScannerUI(st),
    onPlayChannel: (ch) => player.playStream(ch),
    onFetchEpgGuide: () => epg.fetchEpgGuide()
  });

  tvMode = createTvModeController({
    state,
    els,
    onPlayChannel: (ch, opts) => player.playStream(ch, opts),
    onStopPlayer: () => player.stopPlayer(),
    onToggleFavorite: (ch) => catalog.toggleFavorite(ch),
    onToggleSidebar: (open) => catalog.toggleMobileSidebar(open),
    onOpenSettings: () => settings.openSettingsModal(),
    onSetViewMode: (mode) => epg.setViewMode(mode),
    onSyncSettingsStream: () => settings.syncSettingsCurrentStreamUI(),
    onWakeControls: (ms) => player.wakeControls(ms)
  });

  settings = createSettingsController({
    state,
    els,
    onToggleSidebar: (open) => catalog.toggleMobileSidebar(open),
    onPlayChannel: (ch, opts) => player.playStream(ch, opts),
    onFetchItems: () => catalog.fetchItems(),
    onFetchEpgGuide: () => epg.fetchEpgGuide(),
    onSelectPlaylist: (pl) => catalog.selectPlaylist(pl),
    onCheckGithub: (force) => githubSync.checkGithubStatus(force),
    onUpdateTvHud: (ch) => tvMode.updateTvHudForChannel(ch),
    onSetTvOverlayOpen: (open) => tvMode.setTvOverlayOpen(open)
  });

  // Inicializar eventos de todos os módulos
  catalog.bindEvents();
  scanner.bindEvents();
  githubSync.bindEvents();
  player.bindEvents();
  epg.bindEvents();
  tvMode.bindEvents();
  settings.bindEvents();

  // Carga inicial
  catalog.syncFavoritesToServer();
  await catalog.fetchPlaylists();
  await catalog.selectPlaylist(state.currentPlaylist);
  scanner.pollScannerStatus();
  githubSync.checkGithubStatus(false);
  setInterval(() => githubSync.checkGithubStatus(false), 15 * 60 * 1000);
});
