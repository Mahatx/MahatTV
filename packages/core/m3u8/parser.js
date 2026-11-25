function parseExtInf(line) {
  let name = '';
  const commaIdx = line.lastIndexOf(',');
  if (commaIdx !== -1) {
    name = line.slice(commaIdx + 1).trim();
  }

  const getAttr = (attrName) => {
    const regex = new RegExp(`${attrName}="([^"]*)"`, 'i');
    const match = line.match(regex);
    return match ? match[1].trim() : '';
  };

  const tvgName = getAttr('tvg-name');
  const tvgLogo = getAttr('tvg-logo');
  const groupTitle = getAttr('group-title') || 'Sem Categoria';
  const tvgId = getAttr('tvg-id');

  return {
    name: name || tvgName || 'Canal Sem Nome',
    logo: tvgLogo,
    group: groupTitle,
    tvgId
  };
}

module.exports = {
  parseExtInf
};
