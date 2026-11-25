const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function serveStaticFile(pathname, paths, res) {
  const cleanRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const hasDist = fs.existsSync(path.join(paths.uiDistDir, 'index.html'));

  const searchBases = hasDist
    ? [paths.uiDistDir, paths.uiPublicDir]
    : [paths.uiDir, paths.uiPublicDir];

  for (const baseDir of searchBases) {
    const resolvedBase = path.resolve(baseDir);
    const candidate = path.resolve(resolvedBase, cleanRel);
    if (!candidate.startsWith(resolvedBase)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      const isImmutableAsset = cleanRel.startsWith('assets/');
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': isImmutableAsset
          ? 'public, max-age=31536000, immutable'
          : ext === '.png' || ext === '.ico'
          ? 'public, max-age=3600'
          : 'no-cache'
      });
      return fs.createReadStream(candidate).pipe(res);
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Não encontrado');
}

module.exports = {
  sendJson,
  readJsonBody,
  serveStaticFile
};
