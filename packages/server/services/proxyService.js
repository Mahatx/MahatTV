const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Proxy de Stream com suporte a:
 * 1. Reescrita de manifestos HLS (.m3u8) e segmentos (&segment=1)
 * 2. Modo Contínuo Auto-Reconexão (&continuous=1) para streams .ts ao vivo
 */
function proxyRequest(originalUrlStr, req, res, options = {}) {
  const { isContinuousTs = false, isSegment = false } = options;

  let clientClosed = false;
  let activeUpstreamReq = null;
  let headersSentToClient = false;
  let reconnectAttempts = 0;

  req.on('close', () => {
    clientClosed = true;
    if (activeUpstreamReq) {
      activeUpstreamReq.destroy();
    }
  });

  function connectUpstream(targetUrlStr, redirectCount = 0) {
    if (clientClosed) return;

    if (redirectCount > 6) {
      if (!headersSentToClient) {
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Muitos redirecionamentos no stream.' }));
      } else {
        res.end();
      }
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrlStr);
    } catch {
      if (!headersSentToClient) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'URL de stream inválida.' }));
      } else {
        res.end();
      }
      return;
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
      'Accept': '*/*',
      'Connection': 'keep-alive'
    };

    if (!isContinuousTs && req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const proxyReq = client.request(
      parsedUrl,
      {
        method: 'GET',
        headers,
        timeout: 12000
      },
      (proxyRes) => {
        proxyReq.setTimeout(0);

        if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
          const nextUrl = new URL(proxyRes.headers.location, parsedUrl).toString();
          proxyRes.resume();
          return connectUpstream(nextUrl, redirectCount + 1);
        }

        const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
        const isM3u8 =
          !isSegment &&
          !isContinuousTs &&
          (parsedUrl.pathname.toLowerCase().endsWith('.m3u8') ||
            contentType.includes('mpegurl') ||
            contentType.includes('x-mpegurl'));

        if (isM3u8 && proxyRes.statusCode === 200) {
          let body = '';
          proxyRes.setEncoding('utf8');
          proxyRes.on('data', (chunk) => {
            body += chunk;
          });
          proxyRes.on('end', () => {
            if (clientClosed) return;
            const rewritten = body
              .split(/\r?\n/)
              .map((line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return line;
                try {
                  const absUrl = new URL(trimmed, parsedUrl).toString();
                  const isSubM3u8 = absUrl.toLowerCase().split('?')[0].endsWith('.m3u8');
                  return `/api/proxy?url=${encodeURIComponent(absUrl)}${isSubM3u8 ? '' : '&segment=1'}`;
                } catch {
                  return line;
                }
              })
              .join('\n');

            res.writeHead(200, {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(rewritten);
          });
          return;
        }

        if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
          if (!headersSentToClient) {
            res.writeHead(proxyRes.statusCode, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: `HTTP ${proxyRes.statusCode}` }));
          } else if (isContinuousTs && !clientClosed && reconnectAttempts < 50) {
            reconnectAttempts++;
            proxyRes.resume();
            setTimeout(() => connectUpstream(originalUrlStr, 0), 300);
          } else {
            res.end();
          }
          return;
        }

        if (!headersSentToClient) {
          headersSentToClient = true;
          const responseHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Range',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
            'Cache-Control': 'no-cache, no-store'
          };

          if (isContinuousTs) {
            responseHeaders['Content-Type'] = 'video/mp2t';
            responseHeaders['Connection'] = 'keep-alive';
          } else {
            if (proxyRes.headers['content-type']) {
              responseHeaders['Content-Type'] = proxyRes.headers['content-type'];
            } else if (parsedUrl.pathname.endsWith('.mp4')) {
              responseHeaders['Content-Type'] = 'video/mp4';
            } else {
              responseHeaders['Content-Type'] = 'video/mp2t';
            }

            if (proxyRes.headers['content-length']) {
              responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
            }
            if (proxyRes.headers['content-range']) {
              responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
            }
            if (proxyRes.headers['accept-ranges']) {
              responseHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
            }
          }

          res.writeHead(proxyRes.statusCode || 200, responseHeaders);
        }

        if (isContinuousTs) {
          let chunkBytes = 0;
          proxyRes.on('data', (chunk) => {
            if (!clientClosed) {
              chunkBytes += chunk.length;
              res.write(chunk);
            }
          });

          proxyRes.on('end', () => {
            if (clientClosed) return;
            if (chunkBytes > 0) reconnectAttempts = 0;
            else reconnectAttempts++;

            if (reconnectAttempts < 80) {
              setTimeout(() => connectUpstream(originalUrlStr, 0), 80);
            } else {
              res.end();
            }
          });

          proxyRes.on('error', () => {
            if (clientClosed) return;
            reconnectAttempts++;
            if (reconnectAttempts < 80) {
              setTimeout(() => connectUpstream(originalUrlStr, 0), 250);
            } else {
              res.end();
            }
          });
        } else {
          proxyRes.pipe(res);
        }
      }
    );

    activeUpstreamReq = proxyReq;

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('Timeout ao conectar ao servidor de stream'));
    });

    proxyReq.on('error', (err) => {
      if (clientClosed) return;
      if (isContinuousTs && headersSentToClient && reconnectAttempts < 50) {
        reconnectAttempts++;
        setTimeout(() => connectUpstream(originalUrlStr, 0), 300);
        return;
      }
      if (!headersSentToClient && !res.headersSent) {
        res.writeHead(502, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: `Falha ao conectar no stream: ${err.message}` }));
      } else {
        res.end();
      }
    });

    proxyReq.end();
  }

  connectUpstream(originalUrlStr, 0);
}

module.exports = {
  proxyRequest
};
