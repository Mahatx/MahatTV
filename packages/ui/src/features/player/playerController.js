import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { apiClient } from '../../services/apiClient.js';
import { platformBridge } from '../../services/platformBridge.js';
import { escapeHtml, tryConvertXtreamToHls } from '../../utils/format.js';

export function createPlayerController({
  state,
  els,
  onScannerUpdate,
  onChannelStarted,
  onChannelStopped,
  onLoadChannelEpg
}) {
  let hlsPlayer = null;
  let mpegtsPlayer = null;
  let autoReconnectTimer = null;
  let startupTimeoutTimer = null;
  let liveEdgeWatchdogTimer = null;
  let controlsIdleTimer = null;

  function updateLiveBadgeUI(isAtLiveEdge, customText) {
    if (!els.ctrlLiveEdgeBtn || !els.ctrlLiveText) return;
    if (isAtLiveEdge) {
      els.ctrlLiveEdgeBtn.classList.add('is-live-edge');
      els.ctrlLiveEdgeBtn.classList.remove('is-behind');
      els.ctrlLiveText.textContent = customText || 'AO VIVO';
    } else {
      els.ctrlLiveEdgeBtn.classList.remove('is-live-edge');
      els.ctrlLiveEdgeBtn.classList.add('is-behind');
      els.ctrlLiveText.textContent = customText || '⚡ SINCRONIZAR AO VIVO';
    }
  }

  function wakeControls(timeoutMs = 2600) {
    els.videoWrapper.classList.remove('controls-idle');
    clearTimeout(controlsIdleTimer);
    if (!els.videoPlayer.paused) {
      controlsIdleTimer = setTimeout(() => {
        if (!els.videoPlayer.paused && !document.body.classList.contains('tv-overlay-open')) {
          els.videoWrapper.classList.add('controls-idle');
        }
      }, timeoutMs);
    }
  }

  function jumpToLiveEdge(forceSnap = false) {
    const video = els.videoPlayer;
    if (!video || !state.currentStream) return;

    try {
      if (hlsPlayer) {
        if (forceSnap && typeof hlsPlayer.liveSyncPosition === 'number' && hlsPlayer.liveSyncPosition > 0) {
          if (hlsPlayer.liveSyncPosition - video.currentTime > 6) {
            video.currentTime = hlsPlayer.liveSyncPosition;
          }
        }
        updateLiveBadgeUI(true, 'AO VIVO');
        return;
      }

      if (video.buffered && video.buffered.length > 0) {
        const bufferEnd = video.buffered.end(video.buffered.length - 1);
        const lag = bufferEnd - video.currentTime;
        const safeMargin = 4.0;

        if ((forceSnap && lag > 8) || lag > 35) {
          video.currentTime = Math.max(0, bufferEnd - safeMargin);
          video.playbackRate = 1.0;
          updateLiveBadgeUI(true, 'AO VIVO');
        } else if (lag > 18) {
          video.playbackRate = 1.04;
          updateLiveBadgeUI(true, 'AO VIVO');
        } else if (lag < 8 && video.playbackRate !== 1.0) {
          video.playbackRate = 1.0;
          updateLiveBadgeUI(true, 'AO VIVO');
        }
      }
    } catch {
      // Ignorar se buffer ainda inicializando
    }
  }

  function startLiveEdgeWatchdog() {
    if (liveEdgeWatchdogTimer) clearInterval(liveEdgeWatchdogTimer);
    liveEdgeWatchdogTimer = setInterval(() => {
      const video = els.videoPlayer;
      if (!video || video.paused || !state.currentStream) return;
      if (state.currentStream.type === 'mp4' && !state.currentStream.isLive) return;
      jumpToLiveEdge(false);
    }, 4000);
  }

  function stopPlayer() {
    if (autoReconnectTimer) {
      clearTimeout(autoReconnectTimer);
      autoReconnectTimer = null;
    }
    if (startupTimeoutTimer) {
      clearTimeout(startupTimeoutTimer);
      startupTimeoutTimer = null;
    }
    if (liveEdgeWatchdogTimer) {
      clearInterval(liveEdgeWatchdogTimer);
      liveEdgeWatchdogTimer = null;
    }
    if (hlsPlayer) {
      hlsPlayer.destroy();
      hlsPlayer = null;
    }
    if (mpegtsPlayer) {
      mpegtsPlayer.pause();
      mpegtsPlayer.unload();
      mpegtsPlayer.detachMediaElement();
      mpegtsPlayer.destroy();
      mpegtsPlayer = null;
    }
    els.videoPlayer.onplaying = null;
    els.videoPlayer.oncanplay = null;
    els.videoPlayer.onerror = null;
    els.videoPlayer.pause();
    els.videoPlayer.playbackRate = 1.0;
    els.videoPlayer.removeAttribute('src');
    els.videoPlayer.load();
  }

  async function reportStreamStatusFromPlayer(item, status) {
    try {
      const data = await apiClient.checkSingleChannel(item, status);
      item.status = status;
      if (data.scanner) onScannerUpdate(data.scanner);
    } catch {
      // Silencioso
    }
  }

  function playStream(item, options = {}) {
    const {
      forceContinuousTs = false,
      forceNativeVideo = false,
      nativeFallbackUrl = null,
      tsAttempt = 0
    } = options;
    state.currentStream = item;
    stopPlayer();

    els.playerSection.classList.remove('hidden');
    els.playerErrorBox.classList.add('hidden');
    if (els.tvErrorToast) els.tvErrorToast.classList.add('hidden');
    els.playerOverlay.classList.remove('hidden');
    els.playerStatusText.textContent = forceNativeVideo
      ? `Abrindo ${item.name} no decodificador nativo...`
      : `Sincronizando ${item.name} ao vivo...`;

    els.nowPlayingTitle.textContent = item.name;
    if (els.ctrlChannelMiniTitle) els.ctrlChannelMiniTitle.textContent = item.name;
    els.nowPlayingGroup.textContent = `${item.group} • Lista: ${item.playlist}`;
    els.nowPlayingUrl.textContent = item.url;
    els.openExternalBtn.href = item.url;
    updateLiveBadgeUI(true, 'AO VIVO');

    onChannelStarted(item);
    onLoadChannelEpg(item);

    const hasNativeProxy = Boolean(platformBridge.getLocalStreamProxyBaseUrl());
    const useProxy = els.useProxyToggle.checked && (!platformBridge.isStandaloneMobile() || hasNativeProxy);
    const useSmartAntiFreeze = els.smartHlsToggle.checked && !forceContinuousTs;
    const isNativeMobile = platformBridge.isMobileNative();
    const isMobile = isNativeMobile || window.innerWidth <= 960;
    const canNativeHls = Boolean(els.videoPlayer.canPlayType('application/vnd.apple.mpegurl'));

    let markedOnline = false;
    const hideOverlayAndMarkOnline = () => {
      if (startupTimeoutTimer) {
        clearTimeout(startupTimeoutTimer);
        startupTimeoutTimer = null;
      }
      els.playerOverlay.classList.add('hidden');
      els.playerErrorBox.classList.add('hidden');
      if (els.tvErrorToast) els.tvErrorToast.classList.add('hidden');
      updateLiveBadgeUI(true, 'AO VIVO');
      if (!markedOnline) {
        markedOnline = true;
        reportStreamStatusFromPlayer(item, 'online');
      }
    };

    const showError = (msg) => {
      if (startupTimeoutTimer) {
        clearTimeout(startupTimeoutTimer);
        startupTimeoutTimer = null;
      }
      els.playerOverlay.classList.add('hidden');
      els.playerErrorBox.classList.remove('hidden');
      els.playerErrorBox.innerHTML = `<strong>Aviso de Reprodução:</strong><br/>${escapeHtml(msg)}`;
      if (els.tvErrorToast && els.tvErrorText) {
        els.tvErrorText.textContent = msg;
        els.tvErrorToast.classList.remove('hidden');
      }
    };

    els.videoPlayer.onplaying = hideOverlayAndMarkOnline;
    els.videoPlayer.oncanplay = hideOverlayAndMarkOnline;
    startLiveEdgeWatchdog();

    const convertedHlsUrl = item.type === 'ts' && useSmartAntiFreeze ? tryConvertXtreamToHls(item.url) : null;

    // Caminho Nativo HTML5/Hardware (Android MediaPlayer/ExoPlayer — decodifica H.265/HEVC e MP2/AC-3)
    if (forceNativeVideo) {
      els.nowPlayingBadge.textContent = 'AO VIVO • NATIVO HW';
      const targetUrl = nativeFallbackUrl || (useProxy ? apiClient.buildProxyUrl(item.url, { continuous: item.type === 'ts' }) : item.url);
      startupTimeoutTimer = setTimeout(() => {
        if (state.currentStream && state.currentStream.url === item.url && !markedOnline) {
          showError('Canal indisponível ou codec incompatível com este aparelho. Tente o próximo canal.');
        }
      }, 13000);

      els.videoPlayer.onerror = () => {
        if (state.currentStream && state.currentStream.url === item.url && !markedOnline) {
          showError('Este canal está offline ou usa codec incompatível no player embutido. Tente o próximo canal ou "Abrir Direto".');
        }
      };
      els.videoPlayer.src = targetUrl;
      els.videoPlayer.play().catch(() => {});
      return;
    }

    // Timeout de segurança para não ficar girando infinitamente se o servidor travar
    startupTimeoutTimer = setTimeout(() => {
      if (state.currentStream && state.currentStream.url === item.url && !markedOnline) {
        if (convertedHlsUrl) {
          playStream(item, { forceContinuousTs: true, tsAttempt: 0 });
        } else if (isNativeMobile && !forceNativeVideo) {
          const fallbackUrl = useProxy ? apiClient.buildProxyUrl(item.url, { continuous: item.type === 'ts' }) : item.url;
          playStream(item, { forceNativeVideo: true, nativeFallbackUrl: fallbackUrl });
        } else {
          showError('Tempo esgotado ao conectar ao canal. Tente novamente ou pule para o próximo canal.');
        }
      }
    }, isMobile ? 12000 : 18000);

    if (item.type === 'm3u8' || convertedHlsUrl) {
      const targetHlsUrl = convertedHlsUrl || item.url;
      const proxiedHlsUrl = useProxy ? apiClient.buildProxyUrl(targetHlsUrl) : targetHlsUrl;
      els.nowPlayingBadge.textContent = convertedHlsUrl ? 'AO VIVO • HLS TEMPO REAL' : 'AO VIVO • HLS';

      // No Android nativo, canais H.265/HEVC funcionam melhor direto no decodificador nativo de hardware
      const isHevcNamed = /\b(h\.?265|hevc)\b/i.test(item.name || '');
      if (isNativeMobile && isHevcNamed && canNativeHls) {
        playStream(item, { forceNativeVideo: true, nativeFallbackUrl: proxiedHlsUrl });
        return;
      }

      if (Hls && Hls.isSupported()) {
        let mediaRecoverAttempts = 0;
        let fallbackTriggered = false;

        hlsPlayer = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: isMobile ? 10 : 30,
          maxBufferLength: isMobile ? 18 : 45,
          maxMaxBufferLength: isMobile ? 36 : 90,
          liveSyncDurationCount: isMobile ? 2 : 2.5,
          liveMaxLatencyDurationCount: isMobile ? 5 : 6,
          maxLiveSyncPlaybackRate: 1.04,
          manifestLoadingTimeOut: isMobile ? 7000 : 12000,
          levelLoadingTimeOut: isMobile ? 7000 : 12000,
          fragLoadingTimeOut: isMobile ? 9000 : 15000,
          manifestLoadingMaxRetry: isMobile ? 1 : 4,
          levelLoadingMaxRetry: isMobile ? 1 : 4,
          fragLoadingMaxRetry: isMobile ? 2 : 5
        });

        hlsPlayer.loadSource(proxiedHlsUrl);
        hlsPlayer.attachMedia(els.videoPlayer);

        hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
          els.videoPlayer.play().catch(() => {});
        });

        hlsPlayer.on(Hls.Events.ERROR, (_, data) => {
          if (fallbackTriggered) return;

          // Failover IMEDIATO (<0.3s) quando servidor Xtream retorna 403/404/502/503 no manifesto .m3u8
          const httpCode = data?.response?.code || 0;
          if (
            convertedHlsUrl &&
            (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR) &&
            httpCode >= 400
          ) {
            fallbackTriggered = true;
            playStream(item, { forceContinuousTs: true, tsAttempt: 0 });
            return;
          }

          // Erro de codec no MSE (ex.: H.265/HEVC disfarçado em canal FHD): tenta decodificador nativo no Android
          if (
            isNativeMobile &&
            canNativeHls &&
            (data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR ||
              data.details === Hls.ErrorDetails.FRAG_PARSING_ERROR)
          ) {
            fallbackTriggered = true;
            playStream(item, { forceNativeVideo: true, nativeFallbackUrl: proxiedHlsUrl });
            return;
          }

          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              if (mediaRecoverAttempts < 1) {
                mediaRecoverAttempts++;
                hlsPlayer.recoverMediaError();
                return;
              }
              if (isNativeMobile && canNativeHls) {
                fallbackTriggered = true;
                playStream(item, { forceNativeVideo: true, nativeFallbackUrl: proxiedHlsUrl });
                return;
              }
            }
            if (convertedHlsUrl) {
              fallbackTriggered = true;
              playStream(item, { forceContinuousTs: true, tsAttempt: 0 });
              return;
            }
            if (isNativeMobile && canNativeHls) {
              fallbackTriggered = true;
              playStream(item, { forceNativeVideo: true, nativeFallbackUrl: proxiedHlsUrl });
              return;
            }
            showError(`Erro HLS (${data.details || 'Stream indisponível ou offline'}).`);
          }
        });
      } else if (canNativeHls) {
        playStream(item, { forceNativeVideo: true, nativeFallbackUrl: proxiedHlsUrl });
      }
      return;
    }

    if (item.type === 'ts') {
      els.nowPlayingBadge.textContent = 'AO VIVO • TS CONTÍNUO';
      const tsUrl = useProxy ? apiClient.buildProxyUrl(item.url, { continuous: true }) : item.url;
      const fullTsUrl = new URL(tsUrl, window.location.origin).toString();

      if (mpegts && mpegts.getFeatureList().mseLivePlayback) {
        let handledError = false;
        mpegtsPlayer = mpegts.createPlayer(
          {
            type: 'mpegts',
            isLive: true,
            url: fullTsUrl
          },
          {
            enableWorker: true,
            enableStashBuffer: true,
            stashInitialSize: isMobile ? 128 * 1024 : 384 * 1024,
            liveBufferLatencyChasing: false,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: isMobile ? 20 : 60,
            autoCleanupMinBackwardDuration: isMobile ? 10 : 30
          }
        );

        mpegtsPlayer.attachMediaElement(els.videoPlayer);
        mpegtsPlayer.load();
        mpegtsPlayer.play().catch(() => {});

        mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
          if (handledError) return;
          if (!state.currentStream || state.currentStream.url !== item.url) return;
          handledError = true;

          // Erro de codec/MSE (ex.: áudio MP2 no Eurosport ou vídeo HEVC): nunca entra em loop; tenta player nativo HW
          if (errorType === mpegts.ErrorTypes.MEDIA_ERROR) {
            if (isNativeMobile) {
              playStream(item, { forceNativeVideo: true, nativeFallbackUrl: fullTsUrl });
            } else {
              showError(`Codec não suportado pelo navegador (${errorDetail}). Use "Abrir Direto" (VLC/MX Player) ou pule para o próximo canal.`);
            }
            return;
          }

          // Erro HTTP definitivo (403/404/410/502): não fica tentando reconectar infinitamente
          const httpCode = errorInfo?.code || 0;
          if (httpCode >= 400 && httpCode < 600) {
            showError(`Servidor do canal recusou a conexão (HTTP ${httpCode}). Tente o próximo canal.`);
            return;
          }

          // Erro de rede transitório: apenas 1 tentativa rápida antes de exibir erro limpo
          if (tsAttempt < 1) {
            els.playerStatusText.textContent = 'Reconectando transmissão ao vivo...';
            els.playerOverlay.classList.remove('hidden');
            clearTimeout(autoReconnectTimer);
            autoReconnectTimer = setTimeout(() => {
              if (state.currentStream && state.currentStream.url === item.url) {
                playStream(item, { forceContinuousTs: true, tsAttempt: tsAttempt + 1 });
              }
            }, 800);
          } else {
            showError(`Conexão instável ou canal offline (${errorDetail || errorType}).`);
          }
        });
      } else if (isNativeMobile) {
        playStream(item, { forceNativeVideo: true, nativeFallbackUrl: fullTsUrl });
      } else {
        showError('Seu navegador não suporta Media Source Extensions para MPEG-TS.');
      }
      return;
    }

    els.nowPlayingBadge.textContent = 'VOD • MP4';
    const mp4Url = useProxy ? apiClient.buildProxyUrl(item.url) : item.url;
    els.videoPlayer.src = mp4Url;
    els.videoPlayer.onerror = () => {
      showError('O arquivo de vídeo (.mp4) não pôde ser carregado ou está offline no servidor de origem.');
    };
    els.videoPlayer.play().catch(() => {});
  }

  function bindEvents() {
    const video = els.videoPlayer;

    const togglePlay = () => {
      if (video.paused) {
        jumpToLiveEdge(true);
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    const syncVolumeUI = () => {
      const isMuted = video.muted || video.volume === 0;
      els.iconVolOn.classList.toggle('hidden', isMuted);
      els.iconVolOff.classList.toggle('hidden', !isMuted);
      els.ctrlVolumeSlider.value = isMuted ? 0 : video.volume;
    };

    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        (els.videoWrapper.requestFullscreen || video.requestFullscreen).call(els.videoWrapper);
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    };

    els.closePlayerBtn.addEventListener('click', () => onChannelStopped());
    els.smartHlsToggle.addEventListener('change', () => {
      if (els.cfgSmartHlsToggle) els.cfgSmartHlsToggle.checked = els.smartHlsToggle.checked;
      if (state.currentStream) playStream(state.currentStream);
    });
    els.useProxyToggle.addEventListener('change', () => {
      if (els.cfgUseProxyToggle) els.cfgUseProxyToggle.checked = els.useProxyToggle.checked;
      if (state.currentStream) playStream(state.currentStream);
    });
    els.retryStreamBtn.addEventListener('click', () => {
      if (state.currentStream) playStream(state.currentStream);
    });
    els.forceTsBtn.addEventListener('click', () => {
      if (state.currentStream) playStream(state.currentStream, { forceContinuousTs: true });
    });
    els.copyUrlBtn.addEventListener('click', async () => {
      if (!state.currentStream) return;
      try {
        const copied = await platformBridge.copyText(state.currentStream.url);
        if (!copied) throw new Error('no-clipboard');
        const original = els.copyUrlBtn.textContent;
        els.copyUrlBtn.textContent = '✅ Copiado!';
        setTimeout(() => (els.copyUrlBtn.textContent = original), 1500);
      } catch {
        alert('URL: ' + state.currentStream.url);
      }
    });

    els.ctrlPlayPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlay();
    });
    video.addEventListener('click', () => {
      wakeControls();
      togglePlay();
    });
    video.addEventListener('dblclick', () => toggleFullscreen());

    video.addEventListener('play', () => {
      els.iconPlay.classList.add('hidden');
      els.iconPause.classList.remove('hidden');
      updateLiveBadgeUI(true);
    });
    video.addEventListener('pause', () => {
      els.iconPlay.classList.remove('hidden');
      els.iconPause.classList.add('hidden');
      updateLiveBadgeUI(false, 'PAUSADO • VOLTAR AO VIVO');
      els.videoWrapper.classList.remove('controls-idle');
    });

    els.ctrlMuteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.muted = !video.muted;
      syncVolumeUI();
    });
    els.ctrlVolumeSlider.addEventListener('input', (e) => {
      video.volume = parseFloat(e.target.value);
      video.muted = video.volume === 0;
      syncVolumeUI();
    });
    els.ctrlLiveEdgeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToLiveEdge(true);
      if (video.paused) video.play().catch(() => {});
    });
    els.ctrlPipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (video.requestPictureInPicture) {
          await video.requestPictureInPicture();
        }
      } catch {
        // Sem suporte PiP
      }
    });
    els.ctrlFullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullscreen();
    });

    els.videoWrapper.addEventListener('mousemove', () => wakeControls());
    els.videoWrapper.addEventListener('touchstart', () => wakeControls(), { passive: true });
    els.videoWrapper.addEventListener('mouseleave', () => {
      if (!video.paused) els.videoWrapper.classList.add('controls-idle');
    });
  }

  return {
    bindEvents,
    playStream,
    stopPlayer,
    wakeControls
  };
}
