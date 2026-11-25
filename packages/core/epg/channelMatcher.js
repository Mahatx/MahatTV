const EPG_ALIASES = {
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

function normalizeEpgKey(raw, stripRegions = false) {
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

function getBaseChannelDedupeKey(item) {
  const normName = normalizeEpgKey(item.name, false);
  return normName || (item.tvgId ? normalizeEpgKey(item.tvgId, false) : (item.name || '').toLowerCase());
}

function rebuildEpgLookupIndex(channelsMap, programsByChannel) {
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
    if (!lookupIndex.has(key)) {
      lookupIndex.set(key, chId);
    }
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

function resolveEpgChannelId(item, lookupIndex) {
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

module.exports = {
  EPG_ALIASES,
  normalizeEpgKey,
  getBaseChannelDedupeKey,
  rebuildEpgLookupIndex,
  resolveEpgChannelId
};
