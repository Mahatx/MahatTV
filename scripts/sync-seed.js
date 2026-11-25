const fs = require('fs');
const path = require('path');

/**
 * Gera seeds compactos em packages/ui/public/seed/ a partir de storage/data/
 * para que o APK Mobile (e builds web estáticos) já levem os canais verificados
 * como Online e os Favoritos prontos ao instalar em outro dispositivo.
 */
const ROOT = path.resolve(__dirname, '..');
const VERIFIED_SRC = path.join(ROOT, 'storage', 'data', 'verified-streams.json');
const FAVORITES_SRC = path.join(ROOT, 'storage', 'data', 'favorites.json');
const SEED_DIR = path.join(ROOT, 'packages', 'ui', 'public', 'seed');

fs.mkdirSync(SEED_DIR, { recursive: true });

let onlineEntries = [];
if (fs.existsSync(VERIFIED_SRC)) {
  try {
    const all = JSON.parse(fs.readFileSync(VERIFIED_SRC, 'utf8'));
    if (Array.isArray(all)) {
      onlineEntries = all.filter((e) => e && e.status === 'online' && e.url && e.item);
    }
  } catch (err) {
    console.warn('[Seed] Aviso ao ler verified-streams.json:', err.message);
  }
}

let favorites = [];
if (fs.existsSync(FAVORITES_SRC)) {
  try {
    const rawFavs = JSON.parse(fs.readFileSync(FAVORITES_SRC, 'utf8'));
    if (Array.isArray(rawFavs)) {
      favorites = rawFavs;
    }
  } catch (err) {
    console.warn('[Seed] Aviso ao ler favorites.json:', err.message);
  }
}

fs.writeFileSync(path.join(SEED_DIR, 'verified-online.json'), JSON.stringify(onlineEntries), 'utf8');
fs.writeFileSync(path.join(SEED_DIR, 'favorites.json'), JSON.stringify(favorites), 'utf8');

console.log(
  `[Seed] Empacotados ${onlineEntries.length} canais online verificados e ${favorites.length} favoritos em packages/ui/public/seed/`
);
