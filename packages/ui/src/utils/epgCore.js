/**
 * Núcleo ESM de EPG Brasileiro para execução direta no navegador / Android APK:
 * - Parser XMLTV (canais e grade de programas)
 * - Matcher inteligente de canais brasileiros (aliases + normalização de regiões/qualidade)
 * - Construtor de Timeline EPG com agrupamento HD/FHD e ordenação unificada
 */

export const EPG_ALIASES = {
  ae: 'aee',
  aande: 'aee',
  tcpipoca: 'telecinepipoca',
  tcaction: 'telecineaction',
  tcfun: 'telecinefun',
  tccult: 'telecinecult',
  tctouch: 'telecinetouch',
  tcpremium: 'telecinepremium',
  idinvestigacaodiscovery: 'investigacaodiscovery',
  id: 'investigacaodiscovery',
  discoverytlc: 'tlc',
  discoveryhh: 'discoveryhomeehealth',
  discoveryhomehealth: 'discoveryhomeehealth',
  homehealth: 'discoveryhomeehealth',
  discoverytheater: 'discoverytheater',
  natgeo: 'nationalgeographic',
  history: 'thehistorychannel',
  historychannel: 'thehistorychannel',
  h2: 'history2',
  warner: 'warnerchannel',
  warnertv: 'warnerchannel',
  universal: 'universaltv',
  universalchannel: 'universaltv',
  tcm: 'tcmturnerclassic',
  tcmclassic: 'tcmturnerclassic',
  paramount: 'paramountnetwork',
  paramountchannel: 'paramountnetwork',
  star: 'starchannel',
  foxsports: 'espn4',
  foxsports1: 'espn4',
  foxsports2: 'espn5',
  sporttv: 'sportv',
  sporttv1: 'sportv',
  sporttv2: 'sportv2',
  sporttv3: 'sportv3',
  sporttv4: 'sportv4',
  sportv1: 'sportv',
  premiere1: 'premiereclubes',
  premiere: 'premiereclubes',
  globosp: 'globo',
  globorj: 'globo',
  globomg: 'globo',
  globonacional: 'globo',
  redeglobo: 'globo',
  recordsp: 'record',
  recordrj: 'record',
  recordtv: 'record',
  bandsp: 'band',
  bandrj: 'band',
  bandeirantes: 'band',
  bandnews: 'bandnews',
  bandsports: 'bandsports',
  sbtsp: 'sbt',
  sbtrj: 'sbt',
  redetv: 'redetv',
  tvcultura: 'cultura',
  cultura: 'cultura',
  canalbrazil: 'canalbrasil',
  megapix: 'megapix',
  space: 'space',
  tntseries: 'tntseries',
  tntnovelas: 'tntnovelas',
  cnn: 'cnnbrasil',
  cnnbr: 'cnnbrasil',
  globonews: 'globonews',
  cartoon: 'cartoonnetwork',
  cn: 'cartoonnetwork',
  nick: 'nickelodeon',
  nickjr: 'nickjr',
  gloobinho: 'gloobinho',
  syfy: 'usa',
  usachannel: 'usa',
  studiouniversal: 'studiouniversal',
  adultswim: 'adultswim',
  animalplanet: 'animalplanet',
  foodnetwork: 'foodnetwork',
  hgtv: 'hgtv',
  comedycentral: 'comedycentral',
  mtv: 'mtv',
  bis: 'bis',
  off: 'off',
  gnt: 'gnt',
  viva: 'viva',
  multishow: 'multishow',
  combate: 'combate',
  futura: 'futura',
  curta: 'curta',
  arte1: 'arte1'
};

const BR_REGIONS_REGEX =
  /\b(sao\s*paulo|rio\s*de\s*janeiro|belo\s*horizonte|porto\s*alegre|curitiba|salvador|recife|fortaleza|brasilia|campinas|bahia|minas|nordeste|paulista|carioca|gaucha|parana|pernambuco|ceara|amazonas|para|goias|santa\s*catarina|espirito\s*santo|sp|rj|mg|rs|ba|pr|df|pe|ce|pa|sc|go|es|am|ma|pb|rn|al|se|pi|mt|ms|ro|ac|ap|rr|to)\b/gi;

const ptBrCollator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

export function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

export function parseXmltvDate(dateStr) {
  if (!dateStr) return 0;
  const m = dateStr
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!m) return 0;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const hour = parseInt(m[4], 10);
  const min = parseInt(m[5], 10);
  const sec = parseInt(m[6], 10);
  let utcMs = Date.UTC(year, month, day, hour, min, sec);
  if (m[7]) {
    const sign = m[7] === '+' ? 1 : -1;
    const offH = parseInt(m[8], 10);
    const offM = parseInt(m[9], 10);
    utcMs -= sign * (offH * 60 + offM) * 60 * 1000;
  }
  return utcMs;
}

export function parseXmltvIntoMaps(xml, channelsMap, programsMap, minTimeMs, maxTimeMs) {
  const chRegex = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g;
  let m;
  while ((m = chRegex.exec(xml)) !== null) {
    const id = decodeXmlEntities(m[1]);
    const body = m[2];
    const dnMatch = body.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/);
    const iconMatch = body.match(/<icon\s+src="([^"]+)"/);
    const displayName = dnMatch ? decodeXmlEntities(dnMatch[1]) : id;
    const icon = iconMatch ? decodeXmlEntities(iconMatch[1]) : '';
    if (!channelsMap.has(id)) {
      channelsMap.set(id, { id, displayName, icon });
    }
  }

  const progRegex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/g;
  while ((m = progRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const startAttr = (attrs.match(/start="([^"]+)"/) || [])[1];
    const stopAttr = (attrs.match(/stop="([^"]+)"/) || [])[1];
    const chAttr = (attrs.match(/channel="([^"]+)"/) || [])[1];
    if (!startAttr || !chAttr) continue;

    const start = parseXmltvDate(startAttr);
    const stop = stopAttr ? parseXmltvDate(stopAttr) : start + 30 * 60 * 1000;
    if (!start || stop <= start) continue;
    if (stop < minTimeMs || start > maxTimeMs) continue;

    const channelId = decodeXmlEntities(chAttr);
    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    if (!titleMatch) continue;
    const descMatch = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/);
    const catMatch = body.match(/<category[^>]*>([\s\S]*?)<\/category>/);
    const iconMatch = body.match(/<icon\s+src="([^"]+)"/);

    const prog = {
      start,
      stop,
      title: decodeXmlEntities(titleMatch[1]),
      desc: descMatch ? decodeXmlEntities(descMatch[1]) : '',
      category: catMatch ? decodeXmlEntities(catMatch[1]) : '',
      icon: iconMatch ? decodeXmlEntities(iconMatch[1]) : ''
    };

    let list = programsMap.get(channelId);
    if (!list) {
      list = [];
      programsMap.set(channelId, list);
    }
    list.push(prog);
  }
}

export function normalizeEpgKey(raw, stripRegions = false) {
  let s = String(raw || '').toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/^[a-z0-9\s.\-]+\/[a-z]{2}\s*\.*/i, '');
  s = s.replace(/^(br|pt|bra)\s*[:|\-]\s*/i, '');
  s = s.replace(/\.br$/i, '');
  s = s.replace(/&amp;|&|\band\b/g, 'e');
  s = s.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, '');
  s = s.replace(
    /\b(fhd|uhd|4k|8k|hd|sd|h\.?265|h\.?264|\.265|\.264|hevc|60fps|30fps|br|pt|bra|backup|alt|alternativo|nacional|sub|dub|leg|tv)\b/gi,
    ' '
  );
  if (stripRegions) {
    s = s.replace(BR_REGIONS_REGEX, ' ');
  }
  s = s.replace(/[^a-z0-9]/g, '');
  return s;
}

export function getBaseChannelDedupeKey(item) {
  const normName = normalizeEpgKey(item.name, false);
  return normName || (item.tvgId ? normalizeEpgKey(item.tvgId, false) : (item.name || '').toLowerCase());
}

export function rebuildEpgLookupIndex(channelsMap, programsByChannel) {
  const lookupIndex = new Map();

  const rankedChannels = Array.from(channelsMap.values()).sort((a, b) => {
    const progsA = programsByChannel.get(a.id) || [];
    const progsB = programsByChannel.get(b.id) || [];
    const scoreA = progsA.length + (progsA.some((p) => p.desc) ? 500 : 0);
    const scoreB = progsB.length + (progsB.some((p) => p.desc) ? 500 : 0);
    return scoreB - scoreA;
  });

  const registerKey = (key, chId) => {
    if (!key) return;
    if (!lookupIndex.has(key)) lookupIndex.set(key, chId);
  };

  for (const ch of rankedChannels) {
    const progs = programsByChannel.get(ch.id);
    if (!progs || progs.length === 0) continue;

    registerKey(ch.id.toLowerCase(), ch.id);
    const normId = normalizeEpgKey(ch.id, false);
    const normDn = normalizeEpgKey(ch.displayName, false);
    const normIdNoReg = normalizeEpgKey(ch.id, true);
    const normDnNoReg = normalizeEpgKey(ch.displayName, true);

    registerKey(normId, ch.id);
    registerKey(normDn, ch.id);
    registerKey(normIdNoReg, ch.id);
    registerKey(normDnNoReg, ch.id);

    if (EPG_ALIASES[normId]) registerKey(EPG_ALIASES[normId], ch.id);
    if (EPG_ALIASES[normDn]) registerKey(EPG_ALIASES[normDn], ch.id);
  }

  return lookupIndex;
}

export function resolveEpgChannelId(item, lookupIndex) {
  if (!lookupIndex || lookupIndex.size === 0 || !item) return null;

  const candidates = [];
  if (item.tvgId) {
    const rawId = item.tvgId.toLowerCase().trim();
    const normId = normalizeEpgKey(item.tvgId, false);
    const normIdNoReg = normalizeEpgKey(item.tvgId, true);
    candidates.push(rawId, normId, EPG_ALIASES[normId], normIdNoReg, EPG_ALIASES[normIdNoReg]);
  }
  if (item.name) {
    const normName = normalizeEpgKey(item.name, false);
    const normNameNoReg = normalizeEpgKey(item.name, true);
    candidates.push(normName, EPG_ALIASES[normName], normNameNoReg, EPG_ALIASES[normNameNoReg]);
    const withoutTrailingDigit = normNameNoReg.replace(/\d+$/, '');
    if (withoutTrailingDigit.length >= 4 && withoutTrailingDigit !== normNameNoReg) {
      candidates.push(withoutTrailingDigit, EPG_ALIASES[withoutTrailingDigit]);
    }
  }

  for (const key of candidates) {
    if (!key) continue;
    const hit = lookupIndex.get(key);
    if (hit) return hit;
  }
  return null;
}

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

export function buildGuideResponseForItems(rawItems, options = {}, deps = {}) {
  const {
    hours = 6,
    offsetMinutes = -30,
    dedupe = true,
    onlyWithEpg = false,
    sortBy = 'default',
    limit = 120
  } = options;

  const { verifiedMap, favoriteUrlsSet, epgChannels, programsByChannel, lookupIndex, epgStatus } = deps;

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
