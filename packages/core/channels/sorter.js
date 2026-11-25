function getQualityRank(name) {
  const upper = (name || '').toUpperCase();
  if (upper.includes('8K')) return 0;
  if (upper.includes('4K') || upper.includes('UHD')) return 1;
  if (upper.includes('FHD') || upper.includes('1080')) return 2;
  if (upper.includes('HD') || upper.includes('720')) return 3;
  return 4;
}

function getStatusRank(status) {
  if (status === 'online') return 0;
  if (status === 'offline') return 2;
  return 1;
}

const ptBrCollator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function compareBySortMode(aInfo, bInfo, sortMode) {
  switch (sortMode) {
    case 'az':
      return ptBrCollator.compare(aInfo.name, bInfo.name);
    case 'za':
      return ptBrCollator.compare(bInfo.name, aInfo.name);
    case 'online_first': {
      const diff = getStatusRank(aInfo.status) - getStatusRank(bInfo.status);
      return diff !== 0 ? diff : ptBrCollator.compare(aInfo.name, bInfo.name);
    }
    case 'favorites_first': {
      const favDiff = (aInfo.isFavorite ? 0 : 1) - (bInfo.isFavorite ? 0 : 1);
      if (favDiff !== 0) return favDiff;
      const stDiff = getStatusRank(aInfo.status) - getStatusRank(bInfo.status);
      return stDiff !== 0 ? stDiff : ptBrCollator.compare(aInfo.name, bInfo.name);
    }
    case 'epg_first': {
      const epgDiff = (aInfo.hasEpg ? 0 : 1) - (bInfo.hasEpg ? 0 : 1);
      if (epgDiff !== 0) return epgDiff;
      const stDiff = getStatusRank(aInfo.status) - getStatusRank(bInfo.status);
      return stDiff !== 0 ? stDiff : ptBrCollator.compare(aInfo.name, bInfo.name);
    }
    case 'quality': {
      const qDiff = getQualityRank(aInfo.name) - getQualityRank(bInfo.name);
      if (qDiff !== 0) return qDiff;
      const stDiff = getStatusRank(aInfo.status) - getStatusRank(bInfo.status);
      return stDiff !== 0 ? stDiff : ptBrCollator.compare(aInfo.name, bInfo.name);
    }
    case 'category_az': {
      const gDiff = ptBrCollator.compare(aInfo.group, bInfo.group);
      return gDiff !== 0 ? gDiff : ptBrCollator.compare(aInfo.name, bInfo.name);
    }
    case 'default':
    default:
      return aInfo.originalIndex - bInfo.originalIndex;
  }
}

function sortRawChannelItems(items, sortMode, context = {}) {
  if (!sortMode || sortMode === 'default') return items;

  const { verifiedMap, favoriteUrlsSet, hasEpgFn } = context;

  const decorated = items.map((it, idx) => {
    const v = verifiedMap ? verifiedMap.get(it.url) : null;
    const status = v ? v.status : it.status || null;
    const isFavorite = favoriteUrlsSet ? favoriteUrlsSet.has(it.url) : false;
    const hasEpg = sortMode === 'epg_first' && hasEpgFn ? Boolean(hasEpgFn(it)) : false;
    return {
      item: it,
      name: it.name || '',
      group: it.group || '',
      status,
      isFavorite,
      hasEpg,
      originalIndex: idx
    };
  });

  decorated.sort((a, b) => compareBySortMode(a, b, sortMode));
  return decorated.map((d) => d.item);
}

module.exports = {
  getQualityRank,
  getStatusRank,
  compareBySortMode,
  sortRawChannelItems
};
