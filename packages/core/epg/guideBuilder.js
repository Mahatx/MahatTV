const { compareBySortMode } = require('../channels/sorter');
const { getBaseChannelDedupeKey, resolveEpgChannelId } = require('./channelMatcher');

function rankStreamVariant(item, verifiedMap) {
  const v = verifiedMap ? verifiedMap.get(item.url) : null;
  let score = 0;
  if (v && v.status === 'online') score += 1000;
  else if (v && v.status === 'offline') score -= 500;
  const upper = (item.name || '').toUpperCase();
  if (upper.includes('4K') || upper.includes('UHD')) score += 45;
  else if (upper.includes('FHD')) score += 35;
  else if (upper.includes('HD')) score += 25;
  if (upper.includes('H.265') || upper.includes('HEVC')) score -= 5;
  if (item.logo) score += 10;
  if (item.tvgId) score += 10;
  return score;
}

function buildGuideResponseForItems(rawItems, options = {}, deps = {}) {
  const {
    hours = 6,
    offsetMinutes = -30,
    dedupe = true,
    onlyWithEpg = false,
    sortBy = 'default',
    limit = 120
  } = options;

  const {
    verifiedMap,
    favoriteUrlsSet,
    epgChannels,
    programsByChannel,
    lookupIndex,
    epgStatus
  } = deps;

  const nowMs = Date.now();
  const baseHalfHour = Math.floor(nowMs / (30 * 60 * 1000)) * (30 * 60 * 1000);
  const windowStart = baseHalfHour + offsetMinutes * 60 * 1000;
  const windowEnd = windowStart + hours * 60 * 60 * 1000;

  const workingList = rawItems.map((it) => {
    const v = verifiedMap ? verifiedMap.get(it.url) : null;
    return {
      ...it,
      status: v ? v.status : it.status || null,
      reason: v ? v.reason : it.reason || null
    };
  });

  let groupedRows;
  if (dedupe) {
    const byKey = new Map();
    for (const it of workingList) {
      const key = getBaseChannelDedupeKey(it);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { primary: it, variants: [it] };
        byKey.set(key, entry);
      } else {
        entry.variants.push(it);
        if (rankStreamVariant(it, verifiedMap) > rankStreamVariant(entry.primary, verifiedMap)) {
          entry.primary = it;
        }
      }
    }
    groupedRows = Array.from(byKey.values());
  } else {
    groupedRows = workingList.map((it) => ({ primary: it, variants: [it] }));
  }

  let matchedCount = 0;
  const rows = [];

  for (let idx = 0; idx < groupedRows.length; idx++) {
    const grp = groupedRows[idx];
    const ch = grp.primary;
    const epgChId = resolveEpgChannelId(ch, lookupIndex);
    const epgProgs = epgChId && programsByChannel ? programsByChannel.get(epgChId) || [] : [];
    const epgMeta = epgChId && epgChannels ? epgChannels.get(epgChId) : null;

    const windowPrograms = [];
    let currentProgram = null;
    let nextProgram = null;

    for (let i = 0; i < epgProgs.length; i++) {
      const p = epgProgs[i];
      if (p.start <= nowMs && p.stop > nowMs) {
        const dur = Math.max(1, p.stop - p.start);
        currentProgram = {
          ...p,
          progress: Math.min(100, Math.max(0, Math.round(((nowMs - p.start) / dur) * 100)))
        };
        if (i + 1 < epgProgs.length) nextProgram = epgProgs[i + 1];
      } else if (!currentProgram && !nextProgram && p.start > nowMs) {
        nextProgram = p;
      }

      if (p.stop > windowStart && p.start < windowEnd) {
        windowPrograms.push(p);
      }
    }

    const hasSchedule = windowPrograms.length > 0 || Boolean(currentProgram);
    if (hasSchedule) matchedCount++;
    if (onlyWithEpg && !hasSchedule) continue;

    const isFavorite = favoriteUrlsSet
      ? grp.variants.some((vItem) => favoriteUrlsSet.has(vItem.url))
      : false;

    rows.push({
      channel: ch,
      variantsCount: grp.variants.length,
      isFavorite,
      epgMatched: hasSchedule,
      epgChannelId: epgChId,
      epgChannelName: epgMeta ? epgMeta.displayName : null,
      currentProgram,
      nextProgram,
      programs: windowPrograms,
      _sortMeta: {
        name: ch.name || '',
        group: ch.group || '',
        status: ch.status || null,
        isFavorite,
        hasEpg: hasSchedule,
        originalIndex: idx
      }
    });
  }

  rows.sort((a, b) => compareBySortMode(a._sortMeta, b._sortMeta, sortBy));

  const limitedRows = rows.slice(0, limit).map(({ _sortMeta, ...rest }) => rest);

  return {
    now: nowMs,
    windowStart,
    windowEnd,
    hours,
    offsetMinutes,
    sortBy,
    totalInCategory: rawItems.length,
    totalUniqueChannels: groupedRows.length,
    totalDisplayed: limitedRows.length,
    matchedCount,
    epgStatus,
    rows: limitedRows
  };
}

module.exports = {
  rankStreamVariant,
  buildGuideResponseForItems
};
