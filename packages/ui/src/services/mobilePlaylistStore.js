/**
 * Armazenamento persistente via IndexedDB para todas as listas (.m3u8) no APK Android/Mobile.
 * Ao contrário do localStorage (limite de ~5 MB), o IndexedDB suporta centenas de MB
 * de forma assíncrona, sem travar a interface e separando metadados do conteúdo bruto.
 */
const DB_NAME = 'mahattv_playlists_db';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_CONTENTS = 'contents';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB indisponível'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(STORE_CONTENTS)) {
        db.createObjectStore(STORE_CONTENTS, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('Erro ao abrir IndexedDB'));
    };
  });
  return dbPromise;
}

export const mobilePlaylistStore = {
  async listMeta() {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readonly');
        const req = tx.objectStore(STORE_META).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  },

  async getMeta(name) {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readonly');
        const req = tx.objectStore(STORE_META).get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  },

  async getText(name) {
    try {
      const db = await openDb();
      const rec = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CONTENTS, 'readonly');
        const req = tx.objectStore(STORE_CONTENTS).get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (rec && typeof rec.text === 'string') return rec.text;
    } catch {
      // Fallback para cache legado do localStorage
    }
    try {
      return localStorage.getItem(`mahattv_mobile_pl_${name}`) || '';
    } catch {
      return '';
    }
  },

  async savePlaylist({ name, sha = null, size = 0, text = '' }) {
    const byteSize = size || text.length;
    const meta = {
      name,
      sha,
      size: byteSize,
      sizeMB: (byteSize / (1024 * 1024)).toFixed(2),
      updatedAt: Date.now()
    };
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_META, STORE_CONTENTS], 'readwrite');
        tx.objectStore(STORE_META).put(meta);
        tx.objectStore(STORE_CONTENTS).put({ name, text });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      // Limpa eventual cópia antiga no localStorage para liberar espaço
      try {
        localStorage.removeItem(`mahattv_mobile_pl_${name}`);
      } catch {
        // Ignorar
      }
      return meta;
    } catch {
      // Último recurso para arquivos pequenos
      try {
        if (text.length < 400_000) {
          localStorage.setItem(`mahattv_mobile_pl_${name}`, text);
        }
      } catch {
        // Ignorar
      }
      return meta;
    }
  }
};
