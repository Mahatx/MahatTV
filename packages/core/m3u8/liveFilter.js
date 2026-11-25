function detectStreamType(streamUrl) {
  const lower = (streamUrl || '').toLowerCase().split('?')[0];
  if (
    lower.endsWith('.mp4') ||
    lower.endsWith('.mkv') ||
    lower.endsWith('.avi') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.flv')
  ) {
    return 'mp4';
  }
  if (lower.includes('/movie/') || lower.includes('/series/')) {
    return 'mp4';
  }
  if (lower.endsWith('.m3u8')) return 'm3u8';
  return 'ts';
}

/**
 * Identifica se o item é realmente um Canal de Transmissão Ao Vivo (e não Filme/Série VOD)
 */
function isLiveChannel(streamUrl, name = '', group = '', fileName = '') {
  if ((fileName || '').toLowerCase() === 'filmes-series.m3u8') return false;

  const lowerUrl = (streamUrl || '').toLowerCase().split('?')[0];
  if (
    lowerUrl.endsWith('.mp4') ||
    lowerUrl.endsWith('.mkv') ||
    lowerUrl.endsWith('.avi') ||
    lowerUrl.endsWith('.mov') ||
    lowerUrl.endsWith('.flv') ||
    lowerUrl.includes('/movie/') ||
    lowerUrl.includes('/series/')
  ) {
    return false;
  }

  if (/\bS\d{1,2}\s*E\d{1,3}\b/i.test(name)) {
    return false;
  }

  const upperGroup = (group || '').toUpperCase();
  const isChannelGroup =
    upperGroup.includes('CANAIS') || upperGroup.includes('CANAL') || upperGroup.includes('24H');
  if (
    !isChannelGroup &&
    (upperGroup.startsWith('FILMES') ||
      upperGroup.startsWith('SÉRIES') ||
      upperGroup.startsWith('SERIES') ||
      upperGroup.includes('⭐SÉRIES') ||
      upperGroup.includes('⭐FILMES') ||
      upperGroup.includes('VOD'))
  ) {
    return false;
  }

  return true;
}

module.exports = {
  detectStreamType,
  isLiveChannel
};
