import { apiClient } from '../../services/apiClient.js';

export function createSettingsController({
  state,
  els,
  onToggleSidebar,
  onPlayChannel,
  onFetchItems,
  onFetchEpgGuide,
  onSelectPlaylist,
  onCheckGithub,
  onUpdateTvHud,
  onSetTvOverlayOpen
}) {
  function syncSettingsCurrentStreamUI() {
    if (!els.cfgCurrentStreamBox) return;
    if (state.currentStream) {
      els.cfgCurrentStreamBox.classList.remove('hidden');
      if (els.cfgCurrentStreamName) els.cfgCurrentStreamName.textContent = state.currentStream.name;
      if (els.cfgOpenExternalBtn) els.cfgOpenExternalBtn.href = state.currentStream.url;
    } else {
      els.cfgCurrentStreamBox.classList.add('hidden');
    }
  }

  function applyUiMode(mode) {
    state.uiMode = mode === 'complete' ? 'complete' : 'simple';
    localStorage.setItem('mahattv_ui_mode', state.uiMode);

    const isSimple = state.uiMode === 'simple';
    document.body.classList.toggle('ui-simple', isSimple);

    if (els.modeSimpleCard) els.modeSimpleCard.classList.toggle('active', isSimple);
    if (els.modeCompleteCard) els.modeCompleteCard.classList.toggle('active', !isSimple);

    if (isSimple && state.currentStream) {
      document.body.classList.add('tv-active');
      document.body.classList.remove('tv-overlay-open');
      onUpdateTvHud(state.currentStream);
    } else {
      document.body.classList.remove('tv-active', 'tv-overlay-open');
    }

    if (isSimple && state.typeFilter === 'OFFLINE') {
      state.typeFilter = 'ALL';
      els.filterChips.forEach((c) => c.classList.toggle('active', c.dataset.type === 'ALL'));
      onFetchItems();
    }
  }

  function openSettingsModal() {
    if (!els.settingsModalBackdrop) return;
    onToggleSidebar(false);
    if (els.cfgSmartHlsToggle && els.smartHlsToggle) els.cfgSmartHlsToggle.checked = els.smartHlsToggle.checked;
    if (els.cfgUseProxyToggle && els.useProxyToggle) els.cfgUseProxyToggle.checked = els.useProxyToggle.checked;
    if (els.cfgEpgDedupeToggle) els.cfgEpgDedupeToggle.checked = state.epgDedupe;
    if (els.cfgEpgOnlyWithGuideToggle) els.cfgEpgOnlyWithGuideToggle.checked = state.epgOnlyWithGuide;
    syncSettingsCurrentStreamUI();
    els.settingsModalBackdrop.classList.remove('hidden');
  }

  function closeSettingsModal() {
    if (!els.settingsModalBackdrop) return;
    els.settingsModalBackdrop.classList.add('hidden');
  }

  function bindEvents() {
    applyUiMode(state.uiMode);

    if (els.openSettingsBtn) els.openSettingsBtn.addEventListener('click', openSettingsModal);
    if (els.closeSettingsBtn) els.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    if (els.settingsModalBackdrop) {
      els.settingsModalBackdrop.addEventListener('click', (e) => {
        if (e.target === els.settingsModalBackdrop) closeSettingsModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.settingsModalBackdrop && !els.settingsModalBackdrop.classList.contains('hidden')) {
        closeSettingsModal();
      }
    });

    if (els.modeSimpleCard) els.modeSimpleCard.addEventListener('click', () => applyUiMode('simple'));
    if (els.modeCompleteCard) els.modeCompleteCard.addEventListener('click', () => applyUiMode('complete'));

    if (els.cfgSmartHlsToggle) {
      els.cfgSmartHlsToggle.addEventListener('change', (e) => {
        if (els.smartHlsToggle) els.smartHlsToggle.checked = e.target.checked;
        if (state.currentStream) onPlayChannel(state.currentStream);
      });
    }
    if (els.cfgUseProxyToggle) {
      els.cfgUseProxyToggle.addEventListener('change', (e) => {
        if (els.useProxyToggle) els.useProxyToggle.checked = e.target.checked;
        if (state.currentStream) onPlayChannel(state.currentStream);
      });
    }

    if (els.cfgRetryStreamBtn) {
      els.cfgRetryStreamBtn.addEventListener('click', () => {
        if (state.currentStream) {
          onPlayChannel(state.currentStream);
          closeSettingsModal();
        }
      });
    }
    if (els.cfgForceTsBtn) {
      els.cfgForceTsBtn.addEventListener('click', () => {
        if (state.currentStream) {
          onPlayChannel(state.currentStream, { forceContinuousTs: true });
          closeSettingsModal();
        }
      });
    }
    if (els.cfgCopyUrlBtn) {
      els.cfgCopyUrlBtn.addEventListener('click', async () => {
        if (!state.currentStream) return;
        try {
          await navigator.clipboard.writeText(state.currentStream.url);
          const orig = els.cfgCopyUrlBtn.textContent;
          els.cfgCopyUrlBtn.textContent = '✅ Copiado!';
          setTimeout(() => (els.cfgCopyUrlBtn.textContent = orig), 1500);
        } catch {
          alert('URL: ' + state.currentStream.url);
        }
      });
    }

    if (els.cfgEpgDedupeToggle) {
      els.cfgEpgDedupeToggle.addEventListener('change', (e) => {
        state.epgDedupe = e.target.checked;
        if (els.epgDedupeToggle) els.epgDedupeToggle.checked = state.epgDedupe;
        if (state.viewMode === 'epg') onFetchEpgGuide();
      });
    }
    if (els.cfgEpgOnlyWithGuideToggle) {
      els.cfgEpgOnlyWithGuideToggle.addEventListener('change', (e) => {
        state.epgOnlyWithGuide = e.target.checked;
        if (els.epgOnlyWithGuideToggle) els.epgOnlyWithGuideToggle.checked = state.epgOnlyWithGuide;
        if (state.viewMode === 'epg') onFetchEpgGuide();
      });
    }
    if (els.cfgRefreshEpgBtn) {
      els.cfgRefreshEpgBtn.addEventListener('click', async () => {
        els.cfgRefreshEpgBtn.disabled = true;
        els.cfgRefreshEpgBtn.textContent = '⏳ Atualizando EPG...';
        try {
          await apiClient.refreshEpg();
          if (state.viewMode === 'epg') await onFetchEpgGuide();
          else await onFetchItems();
        } finally {
          els.cfgRefreshEpgBtn.disabled = false;
          els.cfgRefreshEpgBtn.textContent = '🔄 Atualizar Guia EPG Agora';
        }
      });
    }

    if (els.cfgOpenScannerBtn) {
      els.cfgOpenScannerBtn.addEventListener('click', () => {
        closeSettingsModal();
        if (document.body.classList.contains('tv-active')) onSetTvOverlayOpen(true);
        els.scannerPanel.classList.remove('hidden');
        els.scannerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (els.cfgOpenGithubBtn) {
      els.cfgOpenGithubBtn.addEventListener('click', () => {
        closeSettingsModal();
        if (document.body.classList.contains('tv-active')) onSetTvOverlayOpen(true);
        els.githubPanel.classList.remove('hidden');
        els.githubPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        onCheckGithub(false);
      });
    }
    if (els.cfgPlaylistSelect) {
      els.cfgPlaylistSelect.addEventListener('change', (e) => {
        if (e.target.value) {
          onSelectPlaylist(e.target.value);
          closeSettingsModal();
          if (document.body.classList.contains('tv-active')) onSetTvOverlayOpen(true);
        }
      });
    }

    if (window.mahatDesktop && els.cfgDesktopTools && els.cfgOpenPlaylistsFolderBtn) {
      els.cfgDesktopTools.classList.remove('hidden');
      els.cfgOpenPlaylistsFolderBtn.addEventListener('click', () => {
        window.mahatDesktop.openPlaylistsFolder();
      });
    }
  }

  return {
    bindEvents,
    openSettingsModal,
    closeSettingsModal,
    syncSettingsCurrentStreamUI
  };
}
