export function createTvModeController({
  state,
  els,
  onPlayChannel,
  onStopPlayer,
  onToggleFavorite,
  onToggleSidebar,
  onOpenSettings,
  onSetViewMode,
  onSyncSettingsStream,
  onWakeControls
}) {
  function setTvOverlayOpen(open) {
    if (open && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    document.body.classList.toggle('tv-overlay-open', Boolean(open));
    if (open) {
      els.videoWrapper.classList.add('controls-idle');
    } else {
      onToggleSidebar(false);
      els.videoWrapper.classList.remove('controls-idle');
    }
  }

  function enterTvImmersiveMode() {
    document.body.classList.add('tv-active');
    setTvOverlayOpen(false);
    onWakeControls(3200);
  }

  function exitTvAndStopPlayer() {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    onStopPlayer();
    state.currentStream = null;
    document.body.classList.remove('tv-active', 'tv-overlay-open');
    els.playerSection.classList.add('hidden');
    if (els.tvErrorToast) els.tvErrorToast.classList.add('hidden');
    onSyncSettingsStream();
  }

  function updateTvHudForChannel(item) {
    if (!item) return;
    if (els.tvHudTitle) els.tvHudTitle.textContent = item.name;
    if (els.tvHudCategory) els.tvHudCategory.textContent = item.group || 'TV Ao Vivo';
    if (els.tvOverlayNowPlaying) els.tvOverlayNowPlaying.textContent = `● Assistindo: ${item.name}`;
    if (els.tvHudLogoImg) {
      els.tvHudLogoImg.src = item.logo || 'logo.png';
      els.tvHudLogoImg.onerror = () => {
        els.tvHudLogoImg.src = 'logo.png';
      };
    }
    if (els.tvHudFavBtn) {
      const isFav = state.favorites.some((f) => f.url === item.url);
      els.tvHudFavBtn.classList.toggle('favorited', isFav);
      els.tvHudFavBtn.title = isFav ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos';
    }
  }

  function getZappingChannelList() {
    if (state.viewMode === 'epg' && state.epgData && Array.isArray(state.epgData.rows) && state.epgData.rows.length) {
      return state.epgData.rows.map((r) => r.channel).filter(Boolean);
    }
    if (state.typeFilter === 'FAV' && state.favorites.length) {
      return state.favorites;
    }
    return state.items || [];
  }

  function zapChannel(delta) {
    const list = getZappingChannelList();
    if (!list.length || !state.currentStream) return;
    const curIdx = list.findIndex((c) => c.url === state.currentStream.url);
    const nextIdx = curIdx === -1 ? 0 : (curIdx + delta + list.length) % list.length;
    onPlayChannel(list[nextIdx]);
  }

  function bindEvents() {
    if (els.tvOpenChannelsBtn) {
      els.tvOpenChannelsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setTvOverlayOpen(true);
      });
    }
    if (els.tvOpenGuideBtn) {
      els.tvOpenGuideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setTvOverlayOpen(true);
        if (state.viewMode !== 'epg') onSetViewMode('epg');
      });
    }
    if (els.tvOverlayCloseBtn) els.tvOverlayCloseBtn.addEventListener('click', () => setTvOverlayOpen(false));
    if (els.tvOverlayBackdrop) els.tvOverlayBackdrop.addEventListener('click', () => setTvOverlayOpen(false));
    if (els.tvExitBtn) {
      els.tvExitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exitTvAndStopPlayer();
      });
    }
    if (els.tvPrevChannelBtn) {
      els.tvPrevChannelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        zapChannel(-1);
      });
    }
    if (els.tvNextChannelBtn) {
      els.tvNextChannelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        zapChannel(1);
      });
    }
    if (els.tvHudFavBtn) {
      els.tvHudFavBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.currentStream) return;
        onToggleFavorite(state.currentStream);
        updateTvHudForChannel(state.currentStream);
      });
    }
    if (els.tvHudSettingsBtn) {
      els.tvHudSettingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
        onOpenSettings();
      });
    }
    if (els.tvErrorRetryBtn) {
      els.tvErrorRetryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.currentStream) onPlayChannel(state.currentStream);
      });
    }
    if (els.tvErrorNextBtn) {
      els.tvErrorNextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        zapChannel(1);
      });
    }
    if (els.tvErrorChannelsBtn) {
      els.tvErrorChannelsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setTvOverlayOpen(true);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('tv-active')) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        if (els.settingsModalBackdrop && !els.settingsModalBackdrop.classList.contains('hidden')) return;
        if (document.body.classList.contains('tv-overlay-open')) setTvOverlayOpen(false);
        else exitTvAndStopPlayer();
        return;
      }

      if (isTyping || document.body.classList.contains('tv-overlay-open')) return;

      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        zapChannel(-1);
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        zapChannel(1);
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setTvOverlayOpen(true);
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        setTvOverlayOpen(true);
        if (state.viewMode !== 'epg') onSetViewMode('epg');
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        els.videoPlayer.muted = !els.videoPlayer.muted;
      }
    });
  }

  return {
    bindEvents,
    enterTvImmersiveMode,
    exitTvAndStopPlayer,
    setTvOverlayOpen,
    updateTvHudForChannel
  };
}
