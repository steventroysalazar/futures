const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const BINANCE_REST_HOSTS = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com',
  'https://fapi3.binance.com',
];
const BINANCE_WS = 'wss://fstream.binance.com/ws';
const REPORT_DIR = path.join(ROOT, 'reports');
const JOURNAL_FILE = path.join(REPORT_DIR, 'signal-journal.json');
const proxyWarningState = new Map();
const PROXY_WARNING_INTERVAL_MS = 30000;
const NEWS_CACHE_MS = 5 * 60 * 1000;
const NEWS_FEEDS = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
];
let newsCache = { updatedAt: 0, items: [] };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
if (!fs.existsSync(JOURNAL_FILE)) fs.writeFileSync(JOURNAL_FILE, '[]\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/api/binance') return await proxyBinance(url, res);
    if (url.pathname === '/api/stream') return streamBinance(url, req, res);
    if (url.pathname === '/api/journal') return journalApi(req, res);
    if (url.pathname === '/api/news') return await newsApi(res);
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error('[server]', error);
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

async function proxyBinance(url, res) {
  const endpoint = url.searchParams.get('endpoint');
  if (!endpoint || !endpoint.startsWith('/fapi/')) {
    return sendJson(res, 400, { error: 'Missing or invalid endpoint' });
  }

  let lastError = null;
  for (const host of BINANCE_REST_HOSTS) {
    const target = new URL(host + endpoint);
    url.searchParams.forEach((value, key) => {
      if (key !== 'endpoint') target.searchParams.set(key, value);
    });

    try {
      const response = await fetch(target);
      const body = await response.text();
      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    } catch (error) {
      lastError = error;
      logProxyWarning(host, endpoint, error);
    }
  }

  sendJson(res, 502, {
    error: 'Binance REST proxy unavailable',
    detail: lastError?.message || 'Network error',
  });
}

async function newsApi(res) {
  const now = Date.now();
  if (newsCache.items.length && now - newsCache.updatedAt < NEWS_CACHE_MS) {
    return sendJson(res, 200, newsCache);
  }

  const settled = await Promise.allSettled(NEWS_FEEDS.map(async feed => {
    const response = await fetch(feed.url, {
      signal: AbortSignal.timeout(9000),
      headers: {
        'User-Agent': 'FuturesEdge/1.0 (+local dashboard)',
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    });
    if (!response.ok) throw new Error(`${feed.name} ${response.status}`);
    return parseFeed(await response.text(), feed.name);
  }));

  const items = settled
    .flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .filter(item => item.title && item.link)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 60);

  settled
    .filter(result => result.status === 'rejected')
    .forEach(result => console.warn('[news]', result.reason.message || result.reason));

  newsCache = { updatedAt: now, items };
  sendJson(res, 200, newsCache);
}

function parseFeed(xml, source) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(block => {
    const title = cleanXmlText(readXmlTag(block, 'title'));
    const link = cleanXmlText(readXmlTag(block, 'link')) || readAtomLink(block);
    const description = cleanXmlText(readXmlTag(block, 'description') || readXmlTag(block, 'summary') || readXmlTag(block, 'content:encoded'));
    const dateText = cleanXmlText(readXmlTag(block, 'pubDate') || readXmlTag(block, 'published') || readXmlTag(block, 'updated'));
    const parsedDate = dateText ? Date.parse(dateText) : NaN;
    return {
      source,
      title,
      link,
      description: description.slice(0, 220),
      publishedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now(),
    };
  });
}

function readXmlTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? match[1] : '';
}

function readAtomLink(block) {
  const match = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return match ? cleanXmlText(match[1]) : '';
}

function cleanXmlText(value) {
  return decodeHtml(String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function logProxyWarning(host, endpoint, error) {
  const key = `${host}:${endpoint}`;
  const now = Date.now();
  const state = proxyWarningState.get(key) || { count: 0, lastLog: 0 };
  state.count += 1;

  if (now - state.lastLog >= PROXY_WARNING_INTERVAL_MS) {
    const repeated = state.count > 1 ? ` (${state.count} failures in the last window)` : '';
    console.warn('[binance proxy]', host, endpoint, error.message || error, repeated);
    state.count = 0;
    state.lastLog = now;
  }

  proxyWarningState.set(key, state);
}

function streamBinance(url, req, res) {
  const stream = url.searchParams.get('stream');
  if (!stream || stream.includes('/') || stream.includes('\\')) {
    return sendJson(res, 400, { error: 'Missing or invalid stream' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`event: status\ndata: {"connected":false,"stream":"${stream}"}\n\n`);

  let closed = false;
  let ws = null;
  let reconnectTimer = null;
  let attempts = 0;

  function connect() {
    if (closed) return;
    ws = new WebSocket(`${BINANCE_WS}/${stream}`);

    ws.onopen = () => {
      attempts = 0;
      res.write(`event: status\ndata: {"connected":true,"stream":"${stream}"}\n\n`);
    };

    ws.onmessage = (event) => {
      res.write(`data: ${event.data}\n\n`);
    };

    ws.onerror = (event) => {
      console.warn('[stream error]', stream, event.message || event.type || 'error');
    };

    ws.onclose = () => {
      if (closed) return;
      res.write(`event: status\ndata: {"connected":false,"stream":"${stream}"}\n\n`);
      attempts += 1;
      reconnectTimer = setTimeout(connect, Math.min(attempts * 2000, 15000));
    };
  }

  req.on('close', () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  });

  connect();
}

function journalApi(req, res) {
  if (req.method === 'GET') {
    const body = fs.readFileSync(JOURNAL_FILE, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(body || '[]');
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '[]');
        fs.writeFileSync(JOURNAL_FILE, JSON.stringify(parsed, null, 2) + '\n');
        sendJson(res, 200, { ok: true, path: JOURNAL_FILE });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid JSON' });
      }
    });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

function serveStatic(urlPath, res) {
  const cleanPath = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const filePath = path.resolve(ROOT, cleanPath.replace(/^[/\\]+/, ''));
  if (!filePath.startsWith(ROOT)) return sendText(res, 403, 'Forbidden');

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return sendText(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

server.listen(PORT, () => {
  console.log(`Futures Edge local backend running at http://localhost:${PORT}`);
  console.log(`Journal file: ${JOURNAL_FILE}`);
});
