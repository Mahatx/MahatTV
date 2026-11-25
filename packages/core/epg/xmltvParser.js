function decodeXmlEntities(str) {
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

function parseXmltvDate(dateStr) {
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

function parseXmltvIntoMaps(xml, channelsMap, programsMap, minTimeMs, maxTimeMs) {
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

module.exports = {
  decodeXmlEntities,
  parseXmltvDate,
  parseXmltvIntoMaps
};
