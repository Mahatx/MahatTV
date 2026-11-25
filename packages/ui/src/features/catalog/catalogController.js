import { apiClient } from '../../services/apiClient.js';
import { escapeHtml, escapeAttr, sortClientItems } from '../../utils/format.js';

export function createCatalogController({
  state,
  els,
  onScannerUpdate,
  onPlayChannel,
  onFetchEpgGuide
}) {
  function toggleMobileSidebar(forceOpen) {
    const isOpen = typeof forceOpen === 'boolean' ? forceOpen : !els.sidebar.classList.contains('open');
    els.sidebar.classList.toggle('open', isOpen);
    els.sidebarBackdrop.classList.toggle('hidden', !isOpen);
  }

  function updateCategorySortButtonUI() {
    if (!els.catSortToggleBtn) return;
    if (state.categorySort === 'az') {
      els.catSortToggleBtn.textContent = '🔤 A–Z';
      els.catSortToggleBtn.title = 'Categorias em ordem alfabética (clique para ordenar por quantidade)';
    } else {
      els.catSortToggleBtn.textContent = '🔢 Qtd';
      els.catSortToggleBtn.title = 'Categorias por quantidade de canais (clique para ordenar A–Z)';
    }
  }

  function updateFavCounter() {
    els.favCount.textContent = state.favorites.length;
  }

  async function syncFavoritesToServer() {
    try {
      await apiClient.syncFavorites(state.favorites.map((f) => f.url).filter(Boolean));
    } catch {
      // Silencioso
    }
  }

  function resetFilterChipToAll() {
    if (state.typeFilter === 'FAV') {
      state.typeFilter = 'ALL';
      els.filterChips.forEach((c) => c.classList.toggle('active', c.dataset.type === 'ALL'));
    }
  }

  function updateMobileNavHighlight() {
    const isFav = state.typeFilter === 'FAV';
    els.mobNavFavs.classList.toggle('active', isFav);
    els.mobNavOnline.classList.toggle('active', !isFav && state.currentPlaylist === '__ONLINE__');
    els.mobNavLiveBR.classList.toggle('active', !isFav && state.currentPlaylist === '__LIVE_BR__');
  }

  function updateSidebarActiveState(playlistName) {
    els.btnViewOnline.classList.toggle('active', playlistName === '__ONLINE__');
    els.btnViewOffline.classList.toggle('active', playlistName === '__OFFLINE__');
    els.btnViewLiveBR.classList.toggle('active', playlistName === '__LIVE_BR__');
    els.btnViewAllLists.classList.toggle('active', playlistName === '__ALL_LIVE__');

    if (['__ONLINE__', '__OFFLINE__', '__LIVE_BR__', '__ALL_LIVE__'].includes(playlistName)) {
      els.playlistSelect.value = '';
      if (els.cfgPlaylistSelect) els.cfgPlaylistSelect.value = '';
    } else {
      els.playlistSelect.value = playlistName;
      if (els.cfgPlaylistSelect) els.cfgPlaylistSelect.value = playlistName;
    }

    updateMobileNavHighlight();
  }

  function updateActiveCategoryPill() {
    if (!els.activeCategoryPill) return;
    els.activeCategoryPill.textContent =
      state.currentCategory === 'ALL' ? '📂 Todas as Categorias' : `📂 ${state.currentCategory}`;
  }

  function updatePaginationUI() {
    els.resultsSummary.textContent = `${state.items.length} de ${state.totalItems.toLocaleString('pt-BR')} canais`;
    els.pageIndicator.textContent = `${state.page} / ${state.totalPages.toLocaleString('pt-BR')}`;
    els.pageIndicatorBottom.textContent = `Página ${state.page} de ${state.totalPages.toLocaleString('pt-BR')}`;

    const isFirst = state.page <= 1;
    const isLast = state.page >= state.totalPages;
    els.prevPageBtn.disabled = isFirst;
    els.nextPageBtn.disabled = isLast;
    els.prevPageBottomBtn.disabled = isFirst;
    els.nextPageBottomBtn.disabled = isLast;
    els.bottomPagination.classList.toggle('hidden', state.totalPages <= 1);
  }

  function toggleFavorite(item) {
    const idx = state.favorites.findIndex((f) => f.url === item.url);
    if (idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.push(item);

    localStorage.setItem('iptv_favorites_v1', JSON.stringify(state.favorites));
    updateFavCounter();
    syncFavoritesToServer();

    if (state.typeFilter === 'FAV') {
      if (state.viewMode === 'epg') onFetchEpgGuide();
      else renderFavorites();
    } else if (state.sortBy === 'favorites_first') {
      fetchItems();
    }
  }

  function renderGrid(items) {
    els.itemsGrid.innerHTML = '';

    if (!items.length) {
      const emptyHint =
        state.currentPlaylist === '__ONLINE__'
          ? 'Nenhum canal ao vivo verificado como Online ainda. Abra Configurações → Verificador para testar os canais!'
          : 'Nenhum canal encontrado para os filtros selecionados.';
      els.itemsGrid.innerHTML = `
        <div style="grid-column: 1/-1; padding: 48px 20px; text-align:center; color:#94a3b8;">
          ${escapeHtml(emptyHint)}
        </div>
      `;
      return;
    }

    items.forEach((item) => {
      const isFav = state.favorites.some((f) => f.url === item.url);
      const isPlaying = state.currentStream && state.currentStream.url === item.url;
      const statusClass =
        item.status === 'online' ? 'status-online' : item.status === 'offline' ? 'status-offline' : '';

      const card = document.createElement('div');
      card.className = `channel-card ${isPlaying ? 'active' : ''} ${statusClass}`;

      const badgeLabel = item.type === 'mp4' ? 'VOD' : item.type === 'm3u8' ? 'HLS' : 'LIVE';
      const statusPillHtml =
        item.status === 'online'
          ? `<span class="card-status-pill online">● ONLINE</span>`
          : item.status === 'offline'
          ? `<span class="card-status-pill offline">✕ OFFLINE</span>`
          : '';

      card.innerHTML = `
        <div class="card-thumb">
          <span class="card-type-badge ${item.type}">${badgeLabel}</span>
          <button class="fav-btn ${isFav ? 'favorited' : ''}" title="Favoritar">★</button>
          ${statusPillHtml}
          <button class="check-one-btn" title="Testar canal">⚡</button>
          <div class="card-logo-circle">
            ${
              item.logo
                ? `<img src="${escapeAttr(item.logo)}" alt="${escapeAttr(item.name)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                   <div class="card-thumb-fallback" style="display:none;">📺</div>`
                : `<div class="card-thumb-fallback">📺</div>`
            }
          </div>
        </div>
        <div class="card-body">
          <div class="card-title" title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</div>
          <div class="card-group" title="${escapeAttr(item.group)} • ${escapeAttr(item.playlist)}">${escapeHtml(item.group)}</div>
          ${
            item.epgNow
              ? `<div class="card-epg-now" title="Agora no ar: ${escapeAttr(item.epgNow.title)}">
                   <div class="card-epg-text">▶ ${escapeHtml(item.epgNow.title)}</div>
                   <div class="card-epg-bar"><div class="card-epg-bar-fill" style="width:${item.epgNow.progress || 0}%"></div></div>
                 </div>`
              : ''
          }
        </div>
      `;

      const favBtn = card.querySelector('.fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(item);
        favBtn.classList.toggle('favorited');
      });

      const checkBtn = card.querySelector('.check-one-btn');
      checkBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        checkBtn.textContent = '⏳';
        checkBtn.disabled = true;
        try {
          const data = await apiClient.checkSingleChannel(item);
          item.status = data.status;
          if (data.scanner) onScannerUpdate(data.scanner);
          renderGrid(state.items);
        } catch {
          checkBtn.textContent = '!';
        }
      });

      card.addEventListener('click', () => {
        document.querySelectorAll('.channel-card.active').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        onPlayChannel(item);
      });

      els.itemsGrid.appendChild(card);
    });
  }

  function renderFavorites() {
    const q = state.searchQuery.toLowerCase();
    const filtered = sortClientItems(
      state.favorites.filter(
        (item) => !q || item.name.toLowerCase().includes(q) || item.group.toLowerCase().includes(q)
      ),
      state.sortBy
    );
    state.items = filtered;
    state.totalItems = filtered.length;
    state.totalPages = 1;
    state.page = 1;
    if (els.activeCategoryPill) els.activeCategoryPill.textContent = '⭐ Meus Favoritos';
    updatePaginationUI();
    renderGrid(filtered);
  }

  async function fetchItems(scrollTop = false) {
    if (state.viewMode === 'epg') return onFetchEpgGuide();
    if (state.typeFilter === 'FAV') return renderFavorites();

    const data = await apiClient.getItems({
      playlist: state.currentPlaylist,
      category: state.currentCategory,
      search: state.searchQuery,
      type: state.typeFilter,
      sort: state.sortBy,
      page: String(state.page),
      limit: String(state.limit)
    });

    state.items = data.items || [];
    state.totalItems = data.total || 0;
    state.totalPages = data.totalPages || 1;
    if (data.scanner) onScannerUpdate(data.scanner);

    updatePaginationUI();
    renderGrid(state.items);

    if (scrollTop) els.itemsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCategories() {
    const filter = els.categorySearch.value.trim().toLowerCase();
    els.categoryList.innerHTML = '';

    const totalAll = state.categories.reduce((acc, c) => acc + c.count, 0);
    const allLi = document.createElement('li');
    allLi.className = `category-item ${state.currentCategory === 'ALL' ? 'active' : ''}`;
    allLi.innerHTML = `
      <span class="category-name">📂 Todas as Categorias</span>
      <span class="category-badge">${totalAll.toLocaleString('pt-BR')}</span>
    `;
    allLi.addEventListener('click', () => {
      state.currentCategory = 'ALL';
      state.page = 1;
      updateActiveCategoryPill();
      renderCategories();
      fetchItems();
      toggleMobileSidebar(false);
    });
    els.categoryList.appendChild(allLi);

    const filtered = filter
      ? state.categories.filter((c) => c.name.toLowerCase().includes(filter))
      : [...state.categories];

    if (state.categorySort === 'az') {
      filtered.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' }));
    } else {
      filtered.sort((a, b) => b.count - a.count);
    }

    filtered.forEach((cat) => {
      const li = document.createElement('li');
      li.className = `category-item ${state.currentCategory === cat.name ? 'active' : ''}`;
      li.innerHTML = `
        <span class="category-name" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</span>
        <span class="category-badge">${cat.count.toLocaleString('pt-BR')}</span>
      `;
      li.addEventListener('click', () => {
        state.currentCategory = cat.name;
        state.page = 1;
        updateActiveCategoryPill();
        renderCategories();
        fetchItems();
        toggleMobileSidebar(false);
      });
      els.categoryList.appendChild(li);
    });
  }

  async function selectPlaylist(playlistName) {
    state.currentPlaylist = playlistName;
    state.currentCategory = 'ALL';
    state.page = 1;
    updateSidebarActiveState(playlistName);
    updateActiveCategoryPill();

    const labelMap = {
      __ONLINE__: '✅ Canais Ao Vivo Online',
      __OFFLINE__: '❌ Canais Ao Vivo Offline',
      __LIVE_BR__: '🇧🇷 Canais Ao Vivo (Brasil)',
      __ALL_LIVE__: '🌐 Todos Ao Vivo (Global)'
    };
    const displayTitle = labelMap[playlistName] || playlistName;

    els.playlistStats.textContent = `Carregando ${displayTitle}...`;
    els.resultsSummary.textContent = `Carregando ${displayTitle}...`;
    els.itemsGrid.innerHTML =
      '<div style="grid-column: 1/-1; padding: 48px; text-align:center; color:#94a3b8;">Carregando canais...</div>';

    try {
      const data = await apiClient.getCategories(playlistName, state.typeFilter);
      state.categories = data.categories || [];
      if (data.scanner) onScannerUpdate(data.scanner);

      els.categoryCount.textContent = state.categories.length;
      const liveNote =
        typeof data.liveCount === 'number' && data.liveCount !== data.totalItems
          ? ` (${data.liveCount.toLocaleString('pt-BR')} ao vivo)`
          : '';
      els.playlistStats.textContent = `${data.totalItems.toLocaleString('pt-BR')} itens${liveNote} • ${state.categories.length} categorias`;
      renderCategories();
      await fetchItems();
    } catch (err) {
      els.playlistStats.textContent = 'Erro ao carregar lista.';
      console.error(err);
    }
  }

  async function fetchPlaylists() {
    const data = await apiClient.getPlaylists();
    state.playlists = data.playlists || [];
    if (data.scanner) onScannerUpdate(data.scanner);

    els.playlistSelect.innerHTML = '<option value="">-- Selecione um arquivo .m3u8 --</option>';
    if (els.cfgPlaylistSelect) {
      els.cfgPlaylistSelect.innerHTML = '<option value="">-- Selecione um arquivo .m3u8 --</option>';
    }
    state.playlists.forEach((pl) => {
      const opt = document.createElement('option');
      opt.value = pl.name;
      opt.textContent = `${pl.name} (${pl.sizeMB} MB)`;
      if (pl.name === state.currentPlaylist) opt.selected = true;
      els.playlistSelect.appendChild(opt);

      if (els.cfgPlaylistSelect) {
        const opt2 = opt.cloneNode(true);
        opt2.selected = pl.name === state.currentPlaylist;
        els.cfgPlaylistSelect.appendChild(opt2);
      }
    });
  }

  function bindEvents() {
    if (els.channelSortSelect) els.channelSortSelect.value = state.sortBy;
    updateCategorySortButtonUI();
    updateFavCounter();

    els.openSidebarBtn.addEventListener('click', () => toggleMobileSidebar(true));
    els.closeSidebarBtn.addEventListener('click', () => toggleMobileSidebar(false));
    els.sidebarBackdrop.addEventListener('click', () => toggleMobileSidebar(false));

    els.mobNavOnline.addEventListener('click', () => {
      resetFilterChipToAll();
      selectPlaylist('__ONLINE__');
      toggleMobileSidebar(false);
    });
    els.mobNavLiveBR.addEventListener('click', () => {
      resetFilterChipToAll();
      selectPlaylist('__LIVE_BR__');
      toggleMobileSidebar(false);
    });
    els.mobNavCategories.addEventListener('click', () => toggleMobileSidebar());
    els.mobNavScanner.addEventListener('click', () => {
      toggleMobileSidebar(false);
      els.scannerPanel.classList.toggle('hidden');
      if (!els.scannerPanel.classList.contains('hidden')) {
        els.scannerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    els.mobNavFavs.addEventListener('click', () => {
      toggleMobileSidebar(false);
      const favChip = document.getElementById('favFilterBtn');
      if (favChip) favChip.click();
    });

    els.btnViewOnline.addEventListener('click', () => {
      selectPlaylist('__ONLINE__');
      toggleMobileSidebar(false);
    });
    els.btnViewOffline.addEventListener('click', () => {
      selectPlaylist('__OFFLINE__');
      toggleMobileSidebar(false);
    });
    els.btnViewLiveBR.addEventListener('click', () => {
      selectPlaylist('__LIVE_BR__');
      toggleMobileSidebar(false);
    });
    els.btnViewAllLists.addEventListener('click', () => {
      selectPlaylist('__ALL_LIVE__');
      toggleMobileSidebar(false);
    });
    els.playlistSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        selectPlaylist(e.target.value);
        toggleMobileSidebar(false);
      }
    });

    if (els.catSortToggleBtn) {
      els.catSortToggleBtn.addEventListener('click', () => {
        state.categorySort = state.categorySort === 'az' ? 'count' : 'az';
        localStorage.setItem('mahattv_cat_sort', state.categorySort);
        updateCategorySortButtonUI();
        renderCategories();
      });
    }
    if (els.channelSortSelect) {
      els.channelSortSelect.addEventListener('change', (e) => {
        state.sortBy = e.target.value || 'default';
        localStorage.setItem('mahattv_sort_by', state.sortBy);
        state.page = 1;
        if (state.viewMode === 'epg') onFetchEpgGuide();
        else fetchItems();
      });
    }

    els.categorySearch.addEventListener('input', () => renderCategories());

    let searchTimeout = null;
    els.searchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      els.clearSearchBtn.classList.toggle('hidden', !val);
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.searchQuery = val.trim();
        state.page = 1;
        fetchItems();
      }, 260);
    });

    els.clearSearchBtn.addEventListener('click', () => {
      els.searchInput.value = '';
      els.clearSearchBtn.classList.add('hidden');
      state.searchQuery = '';
      state.page = 1;
      fetchItems();
    });

    els.filterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        els.filterChips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        state.typeFilter = chip.dataset.type;
        state.page = 1;
        updateMobileNavHighlight();
        if (state.typeFilter === 'FAV') {
          if (state.viewMode === 'epg') onFetchEpgGuide();
          else renderFavorites();
        } else {
          fetchItems();
        }
      });
    });

    const goPrev = () => {
      if (state.page > 1) {
        state.page--;
        fetchItems(true);
      }
    };
    const goNext = () => {
      if (state.page < state.totalPages) {
        state.page++;
        fetchItems(true);
      }
    };

    els.prevPageBtn.addEventListener('click', goPrev);
    els.nextPageBtn.addEventListener('click', goNext);
    els.prevPageBottomBtn.addEventListener('click', goPrev);
    els.nextPageBottomBtn.addEventListener('click', goNext);
  }

  return {
    bindEvents,
    toggleMobileSidebar,
    fetchPlaylists,
    selectPlaylist,
    fetchItems,
    toggleFavorite,
    syncFavoritesToServer
  };
}
