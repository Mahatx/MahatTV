import { apiClient } from '../../services/apiClient.js';
import { escapeHtml, escapeAttr, formatHourMin, getSortLabel } from '../../utils/format.js';

export function createEpgController({ state, els, onPlayChannel, onFetchItems }) {
  function setViewMode(mode) {
    state.viewMode = mode === 'epg' ? 'epg' : 'grid';
    const isEpg = state.viewMode === 'epg';

    if (els.viewModeGridBtn) {
      els.viewModeGridBtn.classList.toggle('active', !isEpg);
      els.viewModeGridBtn.setAttribute('aria-selected', String(!isEpg));
    }
    if (els.viewModeEpgBtn) {
      els.viewModeEpgBtn.classList.toggle('active', isEpg);
      els.viewModeEpgBtn.setAttribute('aria-selected', String(isEpg));
    }
    if (els.topEpgBtn) els.topEpgBtn.classList.toggle('accent-glow', isEpg);
    if (els.epgGuideSection) els.epgGuideSection.classList.toggle('hidden', !isEpg);
    if (els.itemsGrid) els.itemsGrid.classList.toggle('hidden', isEpg);
    if (els.paginationControls) els.paginationControls.classList.toggle('hidden', isEpg);
    if (els.bottomPagination && isEpg) els.bottomPagination.classList.add('hidden');

    if (isEpg) fetchEpgGuide();
    else onFetchItems();
  }

  function showEpgProgramDetail(channel, prog, isNow) {
    state.epgSelectedProgram = { channel, prog };
    els.epgDetailCard.classList.remove('hidden');

    if (prog.icon) {
      els.epgDetailThumb.src = prog.icon;
      els.epgDetailThumb.classList.remove('hidden');
      els.epgDetailThumb.onerror = () => els.epgDetailThumb.classList.add('hidden');
    } else {
      els.epgDetailThumb.classList.add('hidden');
    }

    els.epgDetailChannel.textContent = `📺 ${channel.name}`;
    els.epgDetailTime.textContent = `${isNow ? '● NO AR AGORA • ' : ''}${formatHourMin(prog.start)} – ${formatHourMin(prog.stop)}`;

    if (prog.category) {
      els.epgDetailCategory.textContent = prog.category;
      els.epgDetailCategory.classList.remove('hidden');
    } else {
      els.epgDetailCategory.classList.add('hidden');
    }

    els.epgDetailTitle.textContent = prog.title;
    els.epgDetailDesc.textContent = prog.desc || 'Sem sinopse detalhada informada pelo guia para este programa.';
    els.epgDetailPlayBtn.textContent = `▶ Assistir ${channel.name}`;
    els.epgDetailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderEpgGuide(data) {
    if (!data || !els.epgTimelineContainer) return;

    const updatedStr =
      data.epgStatus && data.epgStatus.lastUpdatedAt
        ? `Atualizado às ${formatHourMin(data.epgStatus.lastUpdatedAt)}`
        : 'EPG sincronizando...';

    const sortLabel = getSortLabel(state.sortBy);
    els.epgGuideSubtitle.textContent =
      `${data.matchedCount} de ${data.totalUniqueChannels} canais com programação • Exibindo ${data.totalDisplayed} • Ordem: ${sortLabel} • ${updatedStr}`;
    els.resultsSummary.textContent = `${data.totalDisplayed} canais no guia (${data.matchedCount} com EPG)`;

    if (!data.rows || !data.rows.length) {
      const msg = state.epgOnlyWithGuide
        ? 'Nenhum canal desta categoria possui grade EPG neste filtro. Desmarque "Só com guia" para ver todos os canais.'
        : 'Nenhum canal encontrado na categoria selecionada.';
      els.epgTimelineContainer.innerHTML = `<div class="epg-empty-state">${escapeHtml(msg)}</div>`;
      return;
    }

    const windowStart = data.windowStart;
    const windowEnd = data.windowEnd;
    const totalMs = Math.max(1, windowEnd - windowStart);
    const nowMs = data.now || Date.now();
    const nowPct = ((nowMs - windowStart) / totalMs) * 100;
    const showNowLine = nowPct >= 0 && nowPct <= 100;
    const trackMinWidth = Math.max(960, data.hours * 220);

    const inner = document.createElement('div');
    inner.className = 'epg-grid-inner';
    inner.style.minWidth = `${trackMinWidth + 220}px`;

    const rulerRow = document.createElement('div');
    rulerRow.className = 'epg-ruler-row';

    const corner = document.createElement('div');
    corner.className = 'epg-corner-cell';
    const dateLabel = new Date(windowStart).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    corner.innerHTML = `<span>Canais (${data.totalDisplayed})</span><span>${escapeHtml(dateLabel)}</span>`;
    rulerRow.appendChild(corner);

    const rulerTrack = document.createElement('div');
    rulerTrack.className = 'epg-ruler-track';

    const halfHourMs = 30 * 60 * 1000;
    for (let t = windowStart; t < windowEnd; t += halfHourMs) {
      const leftPct = ((t - windowStart) / totalMs) * 100;
      const tick = document.createElement('div');
      tick.className = 'epg-time-tick';
      tick.style.left = `${leftPct}%`;
      tick.textContent = formatHourMin(t);
      rulerTrack.appendChild(tick);
    }

    if (showNowLine) {
      const nowPill = document.createElement('div');
      nowPill.className = 'epg-now-pill';
      nowPill.style.left = `${nowPct}%`;
      nowPill.textContent = `AGORA ${formatHourMin(nowMs)}`;
      rulerTrack.appendChild(nowPill);
    }

    rulerRow.appendChild(rulerTrack);
    inner.appendChild(rulerRow);

    data.rows.forEach((row) => {
      const ch = row.channel;
      const isPlaying = state.currentStream && state.currentStream.url === ch.url;

      const rowEl = document.createElement('div');
      rowEl.className = `epg-row ${isPlaying ? 'is-playing' : ''}`;

      const chCell = document.createElement('div');
      chCell.className = 'epg-channel-cell';
      chCell.title = `Clique para assistir ${ch.name}`;

      const statusDotHtml =
        ch.status === 'online'
          ? '<span class="epg-status-dot online" title="Online"></span>'
          : ch.status === 'offline'
          ? '<span class="epg-status-dot offline" title="Offline"></span>'
          : '';

      const variantsHtml =
        row.variantsCount > 1
          ? `<span class="epg-variants-pill" title="${row.variantsCount} opções HD/FHD">+${row.variantsCount - 1}</span>`
          : '';

      chCell.innerHTML = `
        <div class="epg-ch-logo">
          ${
            ch.logo
              ? `<img src="${escapeAttr(ch.logo)}" alt="${escapeAttr(ch.name)}" loading="lazy" onerror="this.style.display='none';" />`
              : '📺'
          }
        </div>
        <div class="epg-ch-meta">
          <div class="epg-ch-name">${escapeHtml(ch.name)}</div>
          <div class="epg-ch-sub">
            ${statusDotHtml}
            <span>▶ Assistir</span>
            ${variantsHtml}
          </div>
        </div>
      `;

      chCell.addEventListener('click', () => {
        onPlayChannel(ch);
        document.querySelectorAll('.epg-row.is-playing').forEach((r) => r.classList.remove('is-playing'));
        rowEl.classList.add('is-playing');
      });

      const track = document.createElement('div');
      track.className = 'epg-track';

      if (showNowLine) {
        const line = document.createElement('div');
        line.className = 'epg-now-line';
        line.style.left = `${nowPct}%`;
        track.appendChild(line);
      }

      if (row.programs && row.programs.length > 0) {
        row.programs.forEach((prog) => {
          const clippedStart = Math.max(windowStart, prog.start);
          const clippedStop = Math.min(windowEnd, prog.stop);
          if (clippedStop <= clippedStart) return;

          const leftPct = ((clippedStart - windowStart) / totalMs) * 100;
          const widthPct = ((clippedStop - clippedStart) / totalMs) * 100;
          const isNow = prog.start <= nowMs && prog.stop > nowMs;
          const isPast = prog.stop <= nowMs;

          const block = document.createElement('div');
          block.className = `epg-prog-block ${isNow ? 'is-now' : ''} ${isPast ? 'is-past' : ''}`;
          block.style.left = `calc(${leftPct}% + 2px)`;
          block.style.width = `calc(${widthPct}% - 4px)`;
          block.title = `${prog.title} (${formatHourMin(prog.start)} - ${formatHourMin(prog.stop)})`;

          let progressHtml = '';
          if (isNow) {
            const dur = Math.max(1, prog.stop - prog.start);
            const pct = Math.min(100, Math.max(0, Math.round(((nowMs - prog.start) / dur) * 100)));
            progressHtml = `<div class="epg-prog-progress"><div class="epg-prog-progress-fill" style="width:${pct}%"></div></div>`;
          }

          block.innerHTML = `
            <div class="epg-prog-title">${isNow ? '● ' : ''}${escapeHtml(prog.title)}</div>
            <div class="epg-prog-time">${formatHourMin(prog.start)} – ${formatHourMin(prog.stop)}${prog.category ? ` • ${escapeHtml(prog.category)}` : ''}</div>
            ${progressHtml}
          `;

          block.addEventListener('click', () => {
            document.querySelectorAll('.epg-prog-block.is-selected').forEach((b) => b.classList.remove('is-selected'));
            block.classList.add('is-selected');
            showEpgProgramDetail(ch, prog, isNow);
          });

          block.addEventListener('dblclick', () => onPlayChannel(ch));
          track.appendChild(block);
        });
      } else {
        const noData = document.createElement('div');
        noData.className = 'epg-no-data-bar';
        noData.textContent = 'Sem grade EPG disponível para este canal • Clique para assistir ao vivo';
        noData.addEventListener('click', () => onPlayChannel(ch));
        track.appendChild(noData);
      }

      rowEl.appendChild(chCell);
      rowEl.appendChild(track);
      inner.appendChild(rowEl);
    });

    els.epgTimelineContainer.innerHTML = '';
    els.epgTimelineContainer.appendChild(inner);
  }

  async function fetchEpgGuide() {
    if (!els.epgTimelineContainer) return;

    const catLabel =
      state.typeFilter === 'FAV'
        ? '⭐ Meus Favoritos'
        : state.currentCategory === 'ALL'
        ? 'Todas as Categorias'
        : state.currentCategory;

    els.epgGuideTitle.textContent = `📅 Guia de Programação • ${catLabel}`;
    els.epgGuideSubtitle.textContent = 'Carregando grade de programação dos canais selecionados...';
    els.epgTimelineContainer.innerHTML = '<div class="epg-empty-state">⏳ Carregando Guia de Programação (EPG)...</div>';
    els.epgDetailCard.classList.add('hidden');

    try {
      let data;
      if (state.typeFilter === 'FAV') {
        const q = state.searchQuery.toLowerCase();
        const favItems = state.favorites.filter(
          (item) => !q || item.name.toLowerCase().includes(q) || item.group.toLowerCase().includes(q)
        );
        data = await apiClient.postEpgGuide({
          items: favItems,
          hours: state.epgHours,
          offsetMinutes: state.epgOffsetMinutes,
          dedupe: state.epgDedupe,
          onlyWithEpg: state.epgOnlyWithGuide,
          sortBy: state.sortBy,
          limit: 150
        });
      } else {
        data = await apiClient.getEpgGuide({
          playlist: state.currentPlaylist,
          category: state.currentCategory,
          search: state.searchQuery,
          type: state.typeFilter,
          sort: state.sortBy,
          hours: String(state.epgHours),
          offsetMinutes: String(state.epgOffsetMinutes),
          dedupe: state.epgDedupe ? '1' : '0',
          onlyWithEpg: state.epgOnlyWithGuide ? '1' : '0',
          limit: '150'
        });
      }
      state.epgData = data;
      renderEpgGuide(data);
    } catch (err) {
      console.error('Erro ao carregar guia EPG:', err);
      els.epgGuideSubtitle.textContent = 'Erro ao carregar o guia de programação.';
      els.epgTimelineContainer.innerHTML =
        '<div class="epg-empty-state">❌ Não foi possível carregar o guia de programação agora. Clique em "Atualizar EPG" para tentar novamente.</div>';
    }
  }

  async function loadPlayerChannelEpg(item) {
    if (!els.playerEpgBox) return;
    els.playerEpgBox.classList.add('hidden');
    if (els.tvHudEpgWrap) els.tvHudEpgWrap.classList.add('hidden');
    if (!item || !item.isLive) return;

    try {
      const data = await apiClient.getChannelEpg(item.name, item.tvgId);
      if (!state.currentStream || state.currentStream.url !== item.url) return;
      if (!data.matched || !data.current) return;

      const cur = data.current;
      const timeRange = `${formatHourMin(cur.start)} – ${formatHourMin(cur.stop)}`;
      els.playerEpgTime.textContent = timeRange;
      els.playerEpgTitle.textContent = cur.title;
      els.playerEpgProgressFill.style.width = `${cur.progress || 0}%`;

      if (cur.desc) {
        els.playerEpgDesc.textContent = cur.desc;
        els.playerEpgDesc.classList.remove('hidden');
      } else {
        els.playerEpgDesc.classList.add('hidden');
      }

      const next = data.upcoming && data.upcoming.length > 0 ? data.upcoming[0] : null;
      if (next) {
        els.playerEpgNext.innerHTML = `<strong>A seguir (${formatHourMin(next.start)}):</strong> ${escapeHtml(next.title)}`;
        els.playerEpgNext.classList.remove('hidden');
      } else {
        els.playerEpgNext.classList.add('hidden');
      }

      els.playerEpgBox.classList.remove('hidden');

      if (els.tvHudEpgWrap) {
        els.tvHudEpgTitle.textContent = cur.title;
        els.tvHudEpgTime.textContent = timeRange;
        els.tvHudEpgBarFill.style.width = `${cur.progress || 0}%`;
        if (next) {
          els.tvHudEpgNext.textContent = `A seguir (${formatHourMin(next.start)}): ${next.title}`;
          els.tvHudEpgNext.classList.remove('hidden');
        } else {
          els.tvHudEpgNext.classList.add('hidden');
        }
        els.tvHudEpgWrap.classList.remove('hidden');
      }
    } catch {
      // Silencioso
    }
  }

  function bindEvents() {
    if (els.viewModeGridBtn) els.viewModeGridBtn.addEventListener('click', () => setViewMode('grid'));
    if (els.viewModeEpgBtn) els.viewModeEpgBtn.addEventListener('click', () => setViewMode('epg'));
    if (els.topEpgBtn) {
      els.topEpgBtn.addEventListener('click', () => setViewMode(state.viewMode === 'epg' ? 'grid' : 'epg'));
    }
    if (els.epgPrevBtn) {
      els.epgPrevBtn.addEventListener('click', () => {
        state.epgOffsetMinutes -= 120;
        fetchEpgGuide();
      });
    }
    if (els.epgNowBtn) {
      els.epgNowBtn.addEventListener('click', () => {
        state.epgOffsetMinutes = -30;
        fetchEpgGuide();
      });
    }
    if (els.epgNextBtn) {
      els.epgNextBtn.addEventListener('click', () => {
        state.epgOffsetMinutes += 120;
        fetchEpgGuide();
      });
    }
    if (els.epgDedupeToggle) {
      els.epgDedupeToggle.addEventListener('change', (e) => {
        state.epgDedupe = e.target.checked;
        if (els.cfgEpgDedupeToggle) els.cfgEpgDedupeToggle.checked = state.epgDedupe;
        fetchEpgGuide();
      });
    }
    if (els.epgOnlyWithGuideToggle) {
      els.epgOnlyWithGuideToggle.addEventListener('change', (e) => {
        state.epgOnlyWithGuide = e.target.checked;
        if (els.cfgEpgOnlyWithGuideToggle) els.cfgEpgOnlyWithGuideToggle.checked = state.epgOnlyWithGuide;
        fetchEpgGuide();
      });
    }
    if (els.epgRefreshBtn) {
      els.epgRefreshBtn.addEventListener('click', async () => {
        els.epgRefreshBtn.disabled = true;
        els.epgRefreshBtn.textContent = '⏳ Atualizando...';
        try {
          await apiClient.refreshEpg();
          await fetchEpgGuide();
        } finally {
          els.epgRefreshBtn.disabled = false;
          els.epgRefreshBtn.textContent = '🔄 Atualizar EPG';
        }
      });
    }
    if (els.epgDetailCloseBtn) {
      els.epgDetailCloseBtn.addEventListener('click', () => {
        els.epgDetailCard.classList.add('hidden');
        state.epgSelectedProgram = null;
        document.querySelectorAll('.epg-prog-block.is-selected').forEach((el) => el.classList.remove('is-selected'));
      });
    }
    if (els.epgDetailPlayBtn) {
      els.epgDetailPlayBtn.addEventListener('click', () => {
        if (state.epgSelectedProgram && state.epgSelectedProgram.channel) {
          onPlayChannel(state.epgSelectedProgram.channel);
        }
      });
    }
  }

  return {
    bindEvents,
    setViewMode,
    fetchEpgGuide,
    loadPlayerChannelEpg
  };
}
