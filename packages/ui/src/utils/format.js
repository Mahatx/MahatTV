export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

export function formatHourMin(tsMs) {
  if (!tsMs) return '--:--';
  const d = new Date(tsMs);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function getSortLabel(sortBy) {
  const labels = {
    default: 'Ordem da Lista',
    az: 'Nome (A → Z)',
    za: 'Nome (Z → A)',
    online_first: 'Online Primeiro',
    favorites_first: 'Favoritos Primeiro',
    epg_first: 'Com Guia EPG Primeiro',
    quality: 'Maior Qualidade',
    category_az: 'Categoria (A → Z)'
  };
  return labels[sortBy] || 'Ordem da Lista';
}

export function sortClientItems(items, sortBy) {
  if (!sortBy || sortBy === 'default') return items;
  const list = [...items];
  const cmp = (a, b) => (a || '').localeCompare(b || '', 'pt-BR', { numeric: true, sensitivity: 'base' });
  const statusRank = (s) => (s === 'online' ? 0 : s === 'offline' ? 2 : 1);
  const qualityRank = (name) => {
    const u = (name || '').toUpperCase();
    if (u.includes('8K')) return 0;
    if (u.includes('4K') || u.includes('UHD')) return 1;
    if (u.includes('FHD') || u.includes('1080')) return 2;
    if (u.includes('HD') || u.includes('720')) return 3;
    return 4;
  };

  list.sort((a, b) => {
    switch (sortBy) {
      case 'az':
        return cmp(a.name, b.name);
      case 'za':
        return cmp(b.name, a.name);
      case 'online_first': {
        const d = statusRank(a.status) - statusRank(b.status);
        return d !== 0 ? d : cmp(a.name, b.name);
      }
      case 'epg_first': {
        const d = (a.epgNow ? 0 : 1) - (b.epgNow ? 0 : 1);
        return d !== 0 ? d : cmp(a.name, b.name);
      }
      case 'quality': {
        const d = qualityRank(a.name) - qualityRank(b.name);
        return d !== 0 ? d : cmp(a.name, b.name);
      }
      case 'category_az': {
        const d = cmp(a.group, b.group);
        return d !== 0 ? d : cmp(a.name, b.name);
      }
      case 'favorites_first':
      default:
        return cmp(a.name, b.name);
    }
  });
  return list;
}

export function tryConvertXtreamToHls(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 3 && parts[0] !== 'live' && parts[0] !== 'movie' && parts[0] !== 'series') {
      const streamId = parts[2].replace(/\.ts$/i, '');
      if (/^\d+$/.test(streamId)) {
        u.pathname = `/live/${parts[0]}/${parts[1]}/${streamId}.m3u8`;
        return u.toString();
      }
    }
    if (parts.length === 4 && parts[0] === 'live' && parts[3].toLowerCase().endsWith('.ts')) {
      const streamId = parts[3].replace(/\.ts$/i, '');
      u.pathname = `/live/${parts[1]}/${parts[2]}/${streamId}.m3u8`;
      return u.toString();
    }
  } catch {
    // URL inválida
  }
  return null;
}
