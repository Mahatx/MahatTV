import { apiClient } from '../../services/apiClient.js';
import { escapeHtml } from '../../utils/format.js';

export function createGithubSyncController({ state, els, onToggleSidebar, onReloadCatalog }) {
  function renderGithubStatus(st) {
    if (!st || !els.ghMiniStatusText) return;

    if (st.updating) {
      els.ghStatusDot.className = 'gh-dot checking';
      els.ghMiniStatusText.textContent = `Baixando ${st.updateProgress?.currentFile || 'listas'}...`;
      els.quickUpdateGithubBtn.classList.add('hidden');
    } else if (st.checking) {
      els.ghStatusDot.className = 'gh-dot checking';
      els.ghMiniStatusText.textContent = 'Verificando GitHub...';
    } else if (st.needsUpdate) {
      els.ghStatusDot.className = 'gh-dot needs-update';
      els.ghMiniStatusText.textContent = `🟠 ${st.outdatedCount} lista(s) para atualizar!`;
      els.quickUpdateGithubBtn.classList.remove('hidden');
    } else {
      els.ghStatusDot.className = 'gh-dot up-to-date';
      els.ghMiniStatusText.textContent = 'Listas 100% Atualizadas';
      els.quickUpdateGithubBtn.classList.add('hidden');
    }

    if (els.settingsUpdateDot) {
      els.settingsUpdateDot.classList.toggle('hidden', !st.needsUpdate || st.updating);
    }
    if (els.cfgGithubStatusText) {
      els.cfgGithubStatusText.textContent = st.updating
        ? `Baixando ${st.updateProgress?.currentFile || 'listas'}...`
        : st.needsUpdate
        ? `🟠 ${st.outdatedCount} lista(s) para atualizar`
        : '🟢 Listas 100% atualizadas';
    }

    if (els.pullGithubUpdatesBtn) {
      els.pullGithubUpdatesBtn.classList.toggle('hidden', !st.needsUpdate || st.updating);
    }

    if (els.ghCommitInfo) {
      const dateStr = st.lastCommitDate ? new Date(st.lastCommitDate).toLocaleString('pt-BR') : '-';
      const checkedStr = st.lastCheckedAt ? new Date(st.lastCheckedAt).toLocaleTimeString('pt-BR') : '-';
      els.ghCommitInfo.innerHTML = `
        Último commit no GitHub: <strong>${escapeHtml(dateStr)}</strong>
        ${st.lastCommitSha ? `<code>(${escapeHtml(st.lastCommitSha)})</code>` : ''}
        • Verificado às ${escapeHtml(checkedStr)}
      `;
    }

    if (els.ghUpdateProgressBox) {
      els.ghUpdateProgressBox.classList.toggle('hidden', !st.updating);
      if (st.updating && st.updateProgress) {
        const p = st.updateProgress;
        const pct = p.totalBytes > 0 ? Math.min(100, Math.round((p.bytesDownloaded / p.totalBytes) * 100)) : 0;
        els.ghUpdateProgressBar.style.width = `${pct}%`;
        const mbDone = (p.bytesDownloaded / (1024 * 1024)).toFixed(1);
        const mbTotal = (p.totalBytes / (1024 * 1024)).toFixed(1);
        els.ghUpdateProgressText.textContent = `Baixando ${p.currentFile} (${p.completedFiles + 1}/${p.totalFiles}) • ${mbDone} MB / ${mbTotal} MB (${pct}%)`;
      }
    }

    if (els.ghFilesList && Array.isArray(st.files)) {
      els.ghFilesList.innerHTML = '';
      st.files.forEach((f) => {
        const isOk = f.status === 'up_to_date';
        const card = document.createElement('div');
        card.className = `gh-file-card ${isOk ? '' : 'outdated'}`;
        const badgeText =
          f.status === 'up_to_date'
            ? '✅ Atualizada'
            : f.status === 'missing_local'
            ? '🆕 Nova Lista'
            : '🔄 Atualização Disponível';

        card.innerHTML = `
          <div class="gh-file-top">
            <span class="gh-file-name">${escapeHtml(f.name)}</span>
            <span class="gh-file-badge ${isOk ? 'ok' : 'warn'}">${badgeText}</span>
          </div>
          <div class="gh-file-meta">
            <span>Tamanho: ${f.remoteSizeMB} MB</span>
            <span>SHA: ${(f.remoteSha || '').slice(0, 7)}</span>
          </div>
        `;
        els.ghFilesList.appendChild(card);
      });
    }
  }

  function startGithubPolling() {
    if (state.githubPollTimer) clearInterval(state.githubPollTimer);
    state.githubPollTimer = setInterval(async () => {
      try {
        const st = await apiClient.getGithubStatus(false);
        renderGithubStatus(st);
        if (!st.updating) {
          clearInterval(state.githubPollTimer);
          state.githubPollTimer = null;
          await onReloadCatalog();
        }
      } catch {
        // Ignorar
      }
    }, 1000);
  }

  async function triggerGithubUpdate(options = {}) {
    try {
      const st = await apiClient.triggerGithubUpdate(options);
      renderGithubStatus(st);
      startGithubPolling();
    } catch (err) {
      console.error('Erro ao iniciar download do GitHub:', err);
    }
  }

  async function checkGithubStatus(force = false) {
    try {
      if (force && els.ghMiniStatusText) {
        els.ghMiniStatusText.textContent = 'Consultando GitHub...';
        els.ghStatusDot.className = 'gh-dot checking';
      }
      const st = await apiClient.getGithubStatus(force);
      renderGithubStatus(st);

      if (st.needsUpdate && !st.updating && els.ghAutoUpdateToggle && els.ghAutoUpdateToggle.checked) {
        triggerGithubUpdate({ forceAll: false });
      } else if (st.updating) {
        startGithubPolling();
      }
    } catch {
      if (els.ghMiniStatusText) {
        els.ghMiniStatusText.textContent = 'Erro ao checar GitHub';
      }
    }
  }

  function bindEvents() {
    const toggleGhPanel = () => {
      onToggleSidebar(false);
      els.githubPanel.classList.toggle('hidden');
      if (!els.githubPanel.classList.contains('hidden')) {
        els.githubPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        checkGithubStatus(false);
      }
    };

    if (els.openGithubPanelBtn) els.openGithubPanelBtn.addEventListener('click', toggleGhPanel);
    if (els.topGithubBtn) els.topGithubBtn.addEventListener('click', toggleGhPanel);
    if (els.closeGithubPanelBtn) {
      els.closeGithubPanelBtn.addEventListener('click', () => els.githubPanel.classList.add('hidden'));
    }
    if (els.ghAutoUpdateToggle) {
      els.ghAutoUpdateToggle.checked = localStorage.getItem('iptv_gh_autoupdate') !== 'false';
      els.ghAutoUpdateToggle.addEventListener('change', (e) => {
        localStorage.setItem('iptv_gh_autoupdate', e.target.checked ? 'true' : 'false');
      });
    }
    if (els.checkGithubNowBtn) els.checkGithubNowBtn.addEventListener('click', () => checkGithubStatus(true));
    if (els.pullGithubUpdatesBtn) {
      els.pullGithubUpdatesBtn.addEventListener('click', () => triggerGithubUpdate({ forceAll: false }));
    }
    if (els.quickUpdateGithubBtn) {
      els.quickUpdateGithubBtn.addEventListener('click', () => {
        els.githubPanel.classList.remove('hidden');
        triggerGithubUpdate({ forceAll: false });
      });
    }
    if (els.forcePullAllGithubBtn) {
      els.forcePullAllGithubBtn.addEventListener('click', () => {
        if (!confirm('Deseja baixar novamente todas as 7 listas (.m3u8) direto do GitHub?')) return;
        triggerGithubUpdate({ forceAll: true });
      });
    }
  }

  return {
    bindEvents,
    checkGithubStatus
  };
}
