function tryConvertXtreamToHls(rawUrl) {
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

module.exports = {
  tryConvertXtreamToHls
};
