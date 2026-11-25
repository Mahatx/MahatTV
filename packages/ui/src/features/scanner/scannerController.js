import { apiClient } from '../../services/apiClient.js';

export function createScannerController({ state, els, onToggleSidebar, onRefreshItems, onSelectOnline }) {
  function updateScannerUI(st) {
    if (!st) return;

    els.badgeSavedOnline.textContent = (st.savedOnlineTotal || 0).toLocaleString('pt-BR');
    els.badgeSavedOffline.textContent = (st.savedOfflineTotal || 0).toLocaleString('pt-BR');

    els.startScannerBtn.classList.toggle('hidden', Boolean(st.running));
    els.stopScannerBtn.classList.toggle('hidden', !st.running);

    const pct = st.totalToTest > 0 ? Math.min(100, Math.round((st.tested / st.totalToTest) * 100)) : 0;
    els.scannerProgressBar.style.width = `${pct}%`;

    els.scannerMetricProgress.textContent = `${(st.tested || 0).toLocaleString('pt-BR')} / ${(st.totalToTest || 0).toLocaleString('pt-BR')} (${pct}%)`;
    els.scannerMetricOnline.textContent = `✅ Online: ${(st.onlineFound || 0).toLocaleString('pt-BR')} (Salvos: ${(st.savedOnlineTotal || 0).toLocaleString('pt-BR')})`;
    els.scannerMetricOffline.textContent = `❌ Offline: ${(st.offlineFound || 0).toLocaleString('pt-BR')}`;
    els.scannerMetricSpeed.textContent = `⚡ ${st.speedPerSec || 0} canais/s`;

    if (st.running) {
      els.scannerCurrentItem.textContent = `Testando: ${st.currentUrl || '...'}`;
    } else if (st.tested > 0) {
      els.scannerCurrentItem.textContent = `Concluído! Canais salvos em "Ao Vivo Online" e em Canais-Online.m3u8.`;
    }
  }

  function startScannerPolling() {
    if (state.scannerPollTimer) clearInterval(state.scannerPollTimer);
    state.scannerPollTimer = setInterval(pollScannerStatus, 1200);
  }

  async function pollScannerStatus() {
    try {
      const st = await apiClient.getScannerStatus();
      updateScannerUI(st);

      if (st.running) {
        if (!state.scannerPollTimer) startScannerPolling();
        if (state.currentPlaylist === '__ONLINE__' || state.currentPlaylist === '__OFFLINE__') {
          onRefreshItems();
        }
      } else if (state.scannerPollTimer) {
        clearInterval(state.scannerPollTimer);
        state.scannerPollTimer = null;
        onRefreshItems();
      }
    } catch {
      // Ignorar falha temporária
    }
  }

  function bindEvents() {
    const toggleScannerPanel = () => {
      onToggleSidebar(false);
      els.scannerPanel.classList.toggle('hidden');
      if (!els.scannerPanel.classList.contains('hidden')) {
        els.scannerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    els.openScannerBtn.addEventListener('click', toggleScannerPanel);
    els.topScannerBtn.addEventListener('click', toggleScannerPanel);
    els.closeScannerBtn.addEventListener('click', () => els.scannerPanel.classList.add('hidden'));

    els.startScannerBtn.addEventListener('click', async () => {
      const scopeVal = els.scannerScopeSelect.value;
      const payload = {
        playlist: scopeVal === 'CURRENT_FILTER' ? state.currentPlaylist : scopeVal,
        category: scopeVal === 'CURRENT_FILTER' ? state.currentCategory : 'ALL',
        search: scopeVal === 'CURRENT_FILTER' ? state.searchQuery : '',
        maxItems: parseInt(els.scannerMaxSelect.value || '0', 10),
        fastHostSkip: els.scannerFastHost.checked,
        onlyUnchecked: els.scannerOnlyUnchecked.checked,
        concurrency: 25
      };

      const st = await apiClient.startScanner(payload);
      updateScannerUI(st);
      startScannerPolling();
    });

    els.stopScannerBtn.addEventListener('click', async () => {
      const st = await apiClient.stopScanner();
      updateScannerUI(st);
    });

    els.goToOnlineBtn.addEventListener('click', () => onSelectOnline());

    els.clearVerifiedBtn.addEventListener('click', async () => {
      if (!confirm('Deseja realmente apagar a lista salva de canais verificados (online/offline)?')) return;
      const st = await apiClient.clearScanner();
      updateScannerUI(st);
      onRefreshItems();
    });
  }

  return {
    bindEvents,
    updateScannerUI,
    pollScannerStatus
  };
}
