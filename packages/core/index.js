const { detectStreamType, isLiveChannel } = require('./m3u8/liveFilter');
const { parseExtInf } = require('./m3u8/parser');
const { getQualityRank, getStatusRank, compareBySortMode, sortRawChannelItems } = require('./channels/sorter');
const { decodeXmlEntities, parseXmltvDate, parseXmltvIntoMaps } = require('./epg/xmltvParser');
const {
  EPG_ALIASES,
  normalizeEpgKey,
  getBaseChannelDedupeKey,
  rebuildEpgLookupIndex,
  resolveEpgChannelId
} = require('./epg/channelMatcher');
const { rankStreamVariant, buildGuideResponseForItems } = require('./epg/guideBuilder');
const { tryConvertXtreamToHls } = require('./streams/xtreamResolver');

module.exports = {
  detectStreamType,
  isLiveChannel,
  parseExtInf,
  getQualityRank,
  getStatusRank,
  compareBySortMode,
  sortRawChannelItems,
  decodeXmlEntities,
  parseXmltvDate,
  parseXmltvIntoMaps,
  EPG_ALIASES,
  normalizeEpgKey,
  getBaseChannelDedupeKey,
  rebuildEpgLookupIndex,
  resolveEpgChannelId,
  rankStreamVariant,
  buildGuideResponseForItems,
  tryConvertXtreamToHls
};
