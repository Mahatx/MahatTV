package com.mahatx.mahattv;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Proxy HTTP local embarcado em 127.0.0.1 para reprodução nativa de IPTV e EPG no Android WebView.
 * - Elimina bloqueios de CORS em hls.js, mpegts.js e player nativo HTML5
 * - Envia User-Agent compatível (VLC) exigido por servidores Xtream/IPTV
 * - Usa HTTP/1.1 Transfer-Encoding: chunked real para fluxos .ts contínuos (zero bufferização)
 * - Alinha reconexões contínuas no byte de sincronia MPEG-TS (0x47) para não corromper o demuxer
 * - Reescreve manifestos HLS (.m3u8) e descomprime feeds EPG (.xml.gz) com gunzip=1
 */
public class LocalStreamProxy {
    private static final String TAG = "MahatTVProxy";
    private static final int PREFERRED_PORT = 18765;
    private static final String VLC_UA = "VLC/3.0.20 LibVLC/3.0.20";
    private static final Pattern URI_ATTR_PATTERN = Pattern.compile("URI=\"([^\"]+)\"");
    private static final byte[] CRLF = new byte[]{'\r', '\n'};
    private static final byte[] CHUNK_EOF = new byte[]{'0', '\r', '\n', '\r', '\n'};

    private volatile boolean running = false;
    private ServerSocket serverSocket;
    private int port = 0;
    private Thread acceptThread;
    private ExecutorService workerPool;

    public synchronized void start() {
        if (running) return;
        try {
            InetAddress loopback = InetAddress.getByName("127.0.0.1");
            try {
                serverSocket = new ServerSocket(PREFERRED_PORT, 64, loopback);
            } catch (IOException busy) {
                serverSocket = new ServerSocket(0, 64, loopback);
            }
            port = serverSocket.getLocalPort();
            running = true;
            workerPool = Executors.newCachedThreadPool();

            acceptThread = new Thread(this::acceptLoop, "MahatTV-LocalProxy-Accept");
            acceptThread.setDaemon(true);
            acceptThread.start();
            Log.i(TAG, "Proxy local de streams iniciado em http://127.0.0.1:" + port);
        } catch (Exception e) {
            Log.e(TAG, "Falha ao iniciar proxy local de streams", e);
            running = false;
            port = 0;
        }
    }

    public int getPort() {
        return running ? port : 0;
    }

    public synchronized void stop() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {}
            serverSocket = null;
        }
        if (workerPool != null) {
            workerPool.shutdownNow();
            workerPool = null;
        }
    }

    private void acceptLoop() {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                client.setTcpNoDelay(true);
                client.setSoTimeout(30000);
                ExecutorService pool = workerPool;
                if (pool != null && !pool.isShutdown()) {
                    pool.submit(() -> handleClient(client));
                } else {
                    client.close();
                }
            } catch (IOException e) {
                if (running) {
                    Log.w(TAG, "Erro ao aceitar conexão no proxy: " + e.getMessage());
                }
            }
        }
    }

    private void handleClient(Socket client) {
        try (Socket s = client) {
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(s.getInputStream(), StandardCharsets.ISO_8859_1)
            );
            OutputStream rawOut = new BufferedOutputStream(s.getOutputStream(), 32768);

            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) return;

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0].trim().toUpperCase();
            String rawTarget = parts[1].trim();

            Map<String, String> headers = new HashMap<>();
            String headerLine;
            while ((headerLine = reader.readLine()) != null && !headerLine.isEmpty()) {
                int colon = headerLine.indexOf(':');
                if (colon > 0) {
                    headers.put(
                        headerLine.substring(0, colon).trim().toLowerCase(),
                        headerLine.substring(colon + 1).trim()
                    );
                }
            }

            if ("OPTIONS".equals(method)) {
                sendSimpleResponse(rawOut, 204, "No Content", "text/plain", new byte[0]);
                return;
            }

            String path = rawTarget;
            String query = "";
            int qIdx = rawTarget.indexOf('?');
            if (qIdx >= 0) {
                path = rawTarget.substring(0, qIdx);
                query = rawTarget.substring(qIdx + 1);
            }

            if ("/health".equals(path)) {
                byte[] body = ("{\"ok\":true,\"port\":" + port + "}").getBytes(StandardCharsets.UTF_8);
                sendSimpleResponse(rawOut, 200, "OK", "application/json", body);
                return;
            }

            if (!"/proxy".equals(path)) {
                byte[] body = "{\"error\":\"Not found\"}".getBytes(StandardCharsets.UTF_8);
                sendSimpleResponse(rawOut, 404, "Not Found", "application/json", body);
                return;
            }

            Map<String, String> params = parseQuery(query);
            String targetUrl = params.get("url");
            if (targetUrl == null || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
                byte[] body = "{\"error\":\"URL invalida\"}".getBytes(StandardCharsets.UTF_8);
                sendSimpleResponse(rawOut, 400, "Bad Request", "application/json", body);
                return;
            }

            boolean isContinuous = "1".equals(params.get("continuous"));
            boolean isSegment = "1".equals(params.get("segment"));
            boolean gunzip = "1".equals(params.get("gunzip"));
            String rangeHeader = headers.get("range");

            proxyStream(targetUrl, method, isContinuous, isSegment, gunzip, rangeHeader, rawOut);
        } catch (IOException ignored) {
            // Cliente fechou a conexão (ex: usuário trocou de canal)
        } catch (Exception e) {
            Log.w(TAG, "Erro no proxy local: " + e.getMessage());
        }
    }

    private void proxyStream(
        String originalUrl,
        String method,
        boolean isContinuous,
        boolean isSegment,
        boolean gunzip,
        String rangeHeader,
        OutputStream clientOut
    ) throws IOException {
        boolean headersSent = false;
        boolean useChunked = false;
        int reconnects = 0;

        try {
            while (running) {
                HttpURLConnection conn = null;
                try {
                    UpstreamResult up = openUpstreamWithRedirects(originalUrl, method, isContinuous, rangeHeader);
                    conn = up.connection;
                    int status = conn.getResponseCode();
                    String finalUrl = up.finalUrl;
                    String contentType = conn.getContentType() != null ? conn.getContentType() : "";
                    String lowerCt = contentType.toLowerCase();
                    String lowerPath = stripQuery(finalUrl).toLowerCase();

                    if (status >= 400) {
                        if (!headersSent) {
                            byte[] err = ("{\"error\":\"HTTP " + status + "\"}").getBytes(StandardCharsets.UTF_8);
                            sendSimpleResponse(clientOut, status, "Upstream Error", "application/json", err);
                        }
                        return;
                    }

                    boolean isM3u8 = !isSegment && !isContinuous && !gunzip && (
                        lowerPath.endsWith(".m3u8") ||
                        lowerCt.contains("mpegurl") ||
                        lowerCt.contains("x-mpegurl")
                    );

                    if (isM3u8 && status == 200) {
                        String playlistText = readTextLimited(conn.getInputStream(), 4 * 1024 * 1024);
                        String rewritten = rewriteM3u8(playlistText, finalUrl);
                        byte[] outBytes = rewritten.getBytes(StandardCharsets.UTF_8);
                        sendSimpleResponse(clientOut, 200, "OK", "application/vnd.apple.mpegurl", outBytes);
                        return;
                    }

                    if (!headersSent) {
                        headersSent = true;
                        long contentLength = (!isContinuous && !gunzip) ? conn.getContentLengthLong() : -1;
                        useChunked = !"HEAD".equals(method) && (isContinuous || gunzip || contentLength < 0);

                        StringBuilder sb = new StringBuilder();
                        sb.append("HTTP/1.1 ").append(status).append(status == 206 ? " Partial Content\r\n" : " OK\r\n");
                        sb.append("Access-Control-Allow-Origin: *\r\n");
                        sb.append("Access-Control-Allow-Headers: Range, Content-Type, Origin, Accept\r\n");
                        sb.append("Access-Control-Expose-Headers: Content-Length, Content-Range\r\n");
                        sb.append("Cache-Control: no-cache, no-store\r\n");

                        if (isContinuous) {
                            sb.append("Content-Type: video/mp2t\r\n");
                        } else if (gunzip) {
                            sb.append("Content-Type: application/xml; charset=utf-8\r\n");
                        } else {
                            String respCt = contentType;
                            if (respCt.isEmpty()) {
                                respCt = lowerPath.endsWith(".mp4") ? "video/mp4" : "video/mp2t";
                            }
                            sb.append("Content-Type: ").append(respCt).append("\r\n");
                            if (contentLength >= 0) {
                                sb.append("Content-Length: ").append(contentLength).append("\r\n");
                            }
                            String contentRange = conn.getHeaderField("Content-Range");
                            if (contentRange != null) {
                                sb.append("Content-Range: ").append(contentRange).append("\r\n");
                            }
                            String acceptRanges = conn.getHeaderField("Accept-Ranges");
                            if (acceptRanges != null) {
                                sb.append("Accept-Ranges: ").append(acceptRanges).append("\r\n");
                            }
                        }

                        if (useChunked) {
                            sb.append("Transfer-Encoding: chunked\r\n");
                        }
                        sb.append("Connection: close\r\n\r\n");
                        clientOut.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
                        clientOut.flush();
                    }

                    if ("HEAD".equals(method)) {
                        return;
                    }

                    long bytesCopied = 0;
                    boolean needTsAlign = isContinuous && reconnects > 0;
                    InputStream upstreamRaw = conn.getInputStream();
                    InputStream decodedStream = gunzip ? new GZIPInputStream(upstreamRaw, 32768) : upstreamRaw;
                    try (InputStream in = new BufferedInputStream(decodedStream, 32768)) {
                        byte[] buf = new byte[16384];
                        int read;
                        while (running && (read = in.read(buf)) != -1) {
                            int offset = 0;
                            if (needTsAlign) {
                                offset = findTsSyncOffset(buf, read);
                                if (offset < 0) continue;
                                needTsAlign = false;
                            }
                            int len = read - offset;
                            if (len <= 0) continue;

                            if (useChunked) {
                                writeChunk(clientOut, buf, offset, len);
                            } else {
                                clientOut.write(buf, offset, len);
                            }
                            bytesCopied += len;
                            if (isContinuous) {
                                clientOut.flush();
                            }
                        }
                        clientOut.flush();
                    }

                    if (!isContinuous) {
                        return;
                    }

                    // Modo contínuo .ts: se servidor derrubou após entregar dados, reconecta suavemente
                    if (bytesCopied > 0) {
                        reconnects = 1; // força alinhamento 0x47 no próximo pacote
                    } else {
                        reconnects++;
                    }
                    if (reconnects >= 10) {
                        return;
                    }
                    try {
                        Thread.sleep(150);
                    } catch (InterruptedException ie) {
                        return;
                    }
                } catch (IOException ioe) {
                    if (!headersSent) {
                        byte[] err = ("{\"error\":\"Falha upstream\"}").getBytes(StandardCharsets.UTF_8);
                        try {
                            sendSimpleResponse(clientOut, 502, "Bad Gateway", "application/json", err);
                        } catch (IOException ignored) {}
                        return;
                    }
                    if (!isContinuous || reconnects >= 6) {
                        return;
                    }
                    reconnects++;
                    try {
                        Thread.sleep(250);
                    } catch (InterruptedException ie) {
                        return;
                    }
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }
        } finally {
            if (headersSent && useChunked) {
                try {
                    clientOut.write(CHUNK_EOF);
                    clientOut.flush();
                } catch (IOException ignored) {}
            }
        }
    }

    private static int findTsSyncOffset(byte[] buf, int len) {
        for (int i = 0; i < len; i++) {
            if (buf[i] == 0x47) {
                if (i + 188 >= len || buf[i + 188] == 0x47) {
                    return i;
                }
            }
        }
        return -1;
    }

    private static void writeChunk(OutputStream out, byte[] data, int offset, int length) throws IOException {
        byte[] sizeHex = Integer.toHexString(length).getBytes(StandardCharsets.ISO_8859_1);
        out.write(sizeHex);
        out.write(CRLF);
        out.write(data, offset, length);
        out.write(CRLF);
    }

    private static class UpstreamResult {
        final HttpURLConnection connection;
        final String finalUrl;

        UpstreamResult(HttpURLConnection connection, String finalUrl) {
            this.connection = connection;
            this.finalUrl = finalUrl;
        }
    }

    private UpstreamResult openUpstreamWithRedirects(
        String startUrl,
        String method,
        boolean isContinuous,
        String rangeHeader
    ) throws IOException {
        String current = startUrl;
        for (int i = 0; i < 6; i++) {
            URL u = new URL(current);
            HttpURLConnection conn = (HttpURLConnection) u.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("HEAD".equals(method) ? "HEAD" : "GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("User-Agent", VLC_UA);
            conn.setRequestProperty("Accept", "*/*");
            conn.setRequestProperty("Connection", "keep-alive");
            if (!isContinuous && rangeHeader != null && !rangeHeader.isEmpty()) {
                conn.setRequestProperty("Range", rangeHeader);
            }

            int code = conn.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.isEmpty()) {
                    throw new IOException("Redirect sem Location");
                }
                current = new URL(u, loc).toString();
                continue;
            }
            return new UpstreamResult(conn, current);
        }
        throw new IOException("Muitos redirecionamentos");
    }

    private String rewriteM3u8(String content, String baseUrl) {
        URL base;
        try {
            base = new URL(baseUrl);
        } catch (Exception e) {
            return content;
        }

        StringBuilder out = new StringBuilder(content.length() + 512);
        String[] lines = content.split("\\r?\\n");
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                out.append('\n');
                continue;
            }
            if (trimmed.startsWith("#")) {
                if (trimmed.contains("URI=\"")) {
                    Matcher m = URI_ATTR_PATTERN.matcher(line);
                    StringBuffer sb = new StringBuffer();
                    while (m.find()) {
                        String rel = m.group(1);
                        String wrapped = wrapProxyUrl(base, rel);
                        m.appendReplacement(sb, Matcher.quoteReplacement("URI=\"" + wrapped + "\""));
                    }
                    m.appendTail(sb);
                    out.append(sb).append('\n');
                } else {
                    out.append(line).append('\n');
                }
                continue;
            }

            out.append(wrapProxyUrl(base, trimmed)).append('\n');
        }
        return out.toString();
    }

    private String wrapProxyUrl(URL baseUrl, String rawTarget) {
        try {
            String abs = new URL(baseUrl, rawTarget).toString();
            boolean isSubPlaylist = stripQuery(abs).toLowerCase().endsWith(".m3u8");
            String encoded = URLEncoder.encode(abs, "UTF-8");
            return "http://127.0.0.1:" + port + "/proxy?url=" + encoded + (isSubPlaylist ? "" : "&segment=1");
        } catch (Exception e) {
            return rawTarget;
        }
    }

    private static String stripQuery(String url) {
        int q = url.indexOf('?');
        return q >= 0 ? url.substring(0, q) : url;
    }

    private static String readTextLimited(InputStream in, int maxBytes) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int read;
        while ((read = in.read(buf)) != -1) {
            total += read;
            if (total > maxBytes) break;
            baos.write(buf, 0, read);
        }
        return new String(baos.toByteArray(), StandardCharsets.UTF_8);
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> map = new HashMap<>();
        if (query == null || query.isEmpty()) return map;
        String[] pairs = query.split("&");
        for (String pair : pairs) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                try {
                    String k = URLDecoder.decode(pair.substring(0, eq), "UTF-8");
                    String v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                    map.put(k, v);
                } catch (Exception ignored) {}
            }
        }
        return map;
    }

    private static void sendSimpleResponse(
        OutputStream out,
        int code,
        String reason,
        String contentType,
        byte[] body
    ) throws IOException {
        String headers =
            "HTTP/1.1 " + code + " " + reason + "\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Range, Content-Type, Origin, Accept\r\n" +
            "Access-Control-Max-Age: 86400\r\n" +
            "Content-Type: " + contentType + "\r\n" +
            "Content-Length: " + body.length + "\r\n" +
            "Cache-Control: no-cache, no-store\r\n" +
            "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        if (body.length > 0) {
            out.write(body);
        }
        out.flush();
    }
}
