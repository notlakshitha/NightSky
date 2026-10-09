const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const O = require('./js/core/observing');
const AI = require('./js/core/ai-guide');
const ROOT = __dirname;
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (fs.existsSync(file))
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z_0-9]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
}
loadEnv();
const cache = new Map();
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://hoirqrkdgbmvpwutwuwj.supabase.co; connect-src 'self' http: https:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function requestGuard(req) {
  const configured = (process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '')
    .split(',')
    .filter(Boolean)
    .map((value) => new URL(value.trim()).origin);
  const localPort = req.socket.localPort;
  const allowed = [
    `http://localhost:${localPort}`,
    `http://127.0.0.1:${localPort}`,
    `http://[::1]:${localPort}`,
    ...configured,
  ];
  if (!allowed.some((value) => new URL(value).host === req.headers.host))
    throw error('Host not allowed.', 403);
}
function limitRequest(security, req, route) {
  const now = Date.now(),
    ip = req.socket.remoteAddress;
  for (const [key, bucket] of security.limits)
    if (now - bucket.start >= 60000) security.limits.delete(key);
  if (security.limits.size >= 3000 && !security.limits.has(ip + route))
    throw error('Service busy. Try again later.', 429);
  const key = ip + route;
  const bucket = security.limits.get(key) || { start: now, count: 0 };
  const maximum = route === '/api/plan' ? 6 : route === '/api/places' ? 10 : 40;
  if (++bucket.count > maximum) throw error('Please wait a minute before trying again.', 429);
  security.limits.set(key, bucket);
}
function takePaidSlot(security, service, maximum, concurrent) {
  const day = new Date().toISOString().slice(0, 10);
  const bucket = security.paid[service] || { day, calls: 0, active: 0 };
  if (bucket.day !== day) {
    bucket.day = day;
    bucket.calls = 0;
  }
  if (bucket.active >= concurrent || bucket.calls >= maximum)
    throw error(
      'The connected service request limit has been reached. Try a calculated plan or Ollama.',
      429,
    );
  bucket.active++;
  bucket.calls++;
  security.paid[service] = bucket;
  return () => {
    bucket.active--;
  };
}
async function readJson(response) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1048576) throw error('The connected service returned too much data.', 502);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw error('The connected service returned invalid data.', 502);
  }
}
function error(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function send(res, status, value) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
async function upstream(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeout || 15000),
  });
  if (!response.ok)
    throw error('The connected service is unavailable. Please try again later.', 502);
  const result = await readJson(response);
  if (result.error) throw error('The connected service could not complete this request.', 502);
  return result;
}
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  const entry = { value: null, expires: Date.now() + 900000 };
  entry.value = Promise.resolve()
    .then(fn)
    .catch((cause) => {
      if (cache.get(key) === entry) cache.delete(key);
      throw cause;
    });
  cache.set(key, entry);
  return entry.value;
}
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
    throw error('Use application/json.', 415);
  if (Number(req.headers['content-length']) > 12000) throw error('Request too large.', 413);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 12000) throw error('Request too large.', 413);
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw error('Invalid JSON.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw error('Expected a JSON object.');
  if (
    Object.keys(input).some(
      (key) => !['location', 'date', 'minutes', 'direction', 'equipment', 'target'].includes(key),
    )
  )
    throw error('Unsupported request field.');
  return input;
}
function locationFrom(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ['lat', 'lon'].some(
      (key) =>
        !['string', 'number'].includes(typeof value[key]) || String(value[key]).trim() === '',
    )
  )
    throw error('Choose a valid location.');
  const location = { lat: Number(value.lat), lon: Number(value.lon) };
  if (!O.validLocation(location)) throw error('Choose a valid location.');
  return location;
}
async function searchPlaces(location, kind, security) {
  const l = location,
    lat = l.lat.toFixed(2),
    lon = l.lon.toFixed(2);
  const result = await cached(`${kind}:${lat},${lon}`, async () => {
    const release = takePaidSlot(
      security,
      'search',
      Math.max(1, Math.min(10000, Number(process.env.SEARCH_DAILY_LIMIT) || 100)),
      3,
    );
    try {
      return await upstream(
        'https://serpapi.com/search.json?' +
          new URLSearchParams(
            kind === 'events'
              ? {
                  engine: 'google',
                  q: `public stargazing astronomy observing events near ${lat}, ${lon}`,
                  api_key: process.env.SERPAPI_API_KEY,
                }
              : {
                  engine: 'google_maps',
                  type: 'search',
                  q: 'observatory astronomy stargazing',
                  ll: `@${lat},${lon},10z`,
                  api_key: process.env.SERPAPI_API_KEY,
                },
          ),
      );
    } finally {
      release();
    }
  });
  const rows = kind === 'events' ? result.organic_results || [] : result.local_results || [];
  return {
    kind,
    results: rows.slice(0, 6).map((p) => ({
      title: p.title,
      address: p.address || p.snippet || '',
      hours: p.hours || p.open_state || 'Night access unverified',
      lat: p.gps_coordinates?.latitude,
      lon: p.gps_coordinates?.longitude,
      url:
        kind === 'events'
          ? p.link
          : p.website ||
            p.links?.website ||
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.title + ' ' + (p.address || ''))}`,
    })),
    retrievedAt: new Date().toISOString(),
  };
}
async function api(req, res, url, security) {
  const allowedOrigins = [
    `http://localhost:${req.socket.localPort}`,
    `http://127.0.0.1:${req.socket.localPort}`,
    `http://[::1]:${req.socket.localPort}`,
    ...(process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '')
      .split(',')
      .filter(Boolean)
      .map((value) => new URL(value.trim()).origin),
  ];
  if (
    req.headers['sec-fetch-site'] === 'cross-site' ||
    (req.headers.origin && !allowedOrigins.includes(req.headers.origin))
  )
    throw error('Origin not allowed.', 403);
  if (req.headers['x-nightsky-request'] !== '1')
    throw error('Use the NightSky app to make this request.', 403);
  if (!['/api/config', '/api/geocode', '/api/places', '/api/plan'].includes(url.pathname))
    throw error('Not found.', 404);
  const allowedMethod = url.pathname === '/api/plan' ? 'POST' : 'GET';
  if (req.method !== allowedMethod) throw error('Method not allowed.', 405);
  limitRequest(security, req, url.pathname);
  const q = Object.fromEntries(url.searchParams);
  if (url.pathname === '/api/config') {
    loadEnv();
    return send(res, 200, {
      serpapi: !!process.env.SERPAPI_API_KEY,
      gemma: !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
      model: process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it',
    });
  }
  if (url.pathname === '/api/geocode') {
    const name = String(q.q || '').trim();
    if (name.length < 2 || name.length > 100)
      throw error('Enter a city name with 2–100 characters.');
    const result = await cached('geo:' + name.toLowerCase(), () =>
      upstream(
        'https://geocoding-api.open-meteo.com/v1/search?' +
          new URLSearchParams({ name, count: '6', language: 'en' }),
      ),
    );
    return send(res, 200, {
      results: (result.results || []).map((c) => ({
        name: [c.name, c.admin1, c.country].filter(Boolean).join(', '),
        lat: c.latitude,
        lon: c.longitude,
        timezone: c.timezone,
      })),
    });
  }
  if (url.pathname === '/api/places') {
    if (!process.env.SERPAPI_API_KEY)
      throw error(
        'Nearby search is not connected yet. You can still plan an observing session from your own location.',
        503,
      );
    return send(
      res,
      200,
      await searchPlaces(locationFrom(q), q.kind === 'events' ? 'events' : 'places', security),
    );
  }
  if (url.pathname === '/api/plan') {
    loadEnv();
    const input = await body(req);
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey)
      throw error('Gemma is unavailable. Use Ollama in Settings or a calculated plan.', 503);
    const l = locationFrom(input.location || {}),
      date = new Date(input.date);
    if (
      !Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() < 2000 ||
      date.getUTCFullYear() > 2100
    )
      throw error('Choose a date between 2000 and 2100.');
    if (![10, 15, 20].includes(input.minutes)) throw error('Choose a 10, 15 or 20 minute session.');
    if (!['', 'N', 'E', 'S', 'W'].includes(input.direction || ''))
      throw error('Invalid viewing direction.');
    if (input.equipment && !['eyes', 'binoculars', 'telescope'].includes(input.equipment))
      throw error('Invalid equipment.');
    if (input.target && !O.entries.some((c) => c.key === input.target))
      throw error('Invalid constellation.');
    const equipment = ['eyes', 'binoculars', 'telescope'].includes(input.equipment)
      ? input.equipment
      : 'eyes';
    const sky = O.snapshot(l, date, false),
      options = {
        minutes: Number(input.minutes),
        direction: input.direction || '',
        equipment,
        target: input.target || '',
      };
    const baseline = O.fieldPlan(sky, options),
      targets = O.candidates(sky, options);
    if (!targets.length) throw error(baseline.introduction);
    if (process.env.SERPAPI_API_KEY) {
      try {
        const nearby = await searchPlaces(l, 'places', security);
        baseline.places = nearby.results
          .filter((p) => /^https?:\/\//i.test(p.url || ''))
          .map((p, i) => ({
            id: 'place-' + i,
            title: String(p.title || '').slice(0, 200),
            address: String(p.address || '').slice(0, 500),
            url: p.url,
          }));
      } catch {
        baseline.places = [];
      }
    }
    const model = process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';
    if (!/^gemma-4-[a-z0-9-]+$/.test(model))
      throw error('Configure a supported Gemma 4 model on the server.', 503);
    const release = takePaidSlot(
      security,
      'ai',
      Math.max(1, Math.min(10000, Number(process.env.AI_DAILY_LIMIT) || 100)),
      2,
    );
    let result;
    try {
      result = await upstream(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          timeout: 90000,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: AI.prompt(baseline, equipment) }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 2400,
              thinkingConfig: { thinkingLevel: 'minimal' },
            },
          }),
        },
      );
    } finally {
      release();
    }
    const text = (result.candidates?.[0]?.content?.parts || [])
      .filter((p) => !p.thought)
      .map((p) => p.text || '')
      .join('');
    try {
      return send(res, 200, AI.parse(text, baseline, 'Gemma 4 · Google AI Studio'));
    } catch (e) {
      throw error(e.message, 502);
    }
  }
  throw error('Not found.', 404);
}
function createServer() {
  const security = { limits: new Map(), paid: {} };
  const server = http.createServer(async (req, res) => {
    try {
      requestGuard(req);
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        throw error('Invalid URL.');
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url, security);
      if (!['GET', 'HEAD'].includes(req.method)) throw error('Method not allowed.', 405);
      if (url.pathname === '/health') return send(res, 200, { ok: true });
      let name;
      try {
        name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      } catch {
        throw error('Invalid URL.');
      }
      if (
        !/^\/(index\.html|sw\.js|manifest\.webmanifest|(?:css|js|assets)\/[a-zA-Z0-9_./-]+)$/.test(
          name,
        ) ||
        name.includes('..') ||
        name.split('/').some((part) => part.startsWith('.'))
      )
        throw error('Not found.', 404);
      const file = path.join(ROOT, name);
      if (
        ![
          '.html',
          '.js',
          '.css',
          '.json',
          '.webmanifest',
          '.png',
          '.svg',
          '.jpg',
          '.jpeg',
          '.avif',
          '.webp',
          '.txt',
          '.woff2',
        ].includes(path.extname(file))
      )
        throw error('Not found.', 404);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw error('Not found.', 404);
      const real = fs.realpathSync(file);
      if (!real.startsWith(fs.realpathSync(ROOT) + path.sep)) throw error('Not found.', 404);
      const type =
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json',
          '.webmanifest': 'application/manifest+json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.avif': 'image/avif',
          '.webp': 'image/webp',
          '.woff2': 'font/woff2',
          '.txt': 'text/plain',
        }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (e) {
      send(res, e.status || 502, {
        error: e.status ? e.message : 'The service could not be reached. Please try again.',
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 40;
  return server;
}
if (require.main === module)
  createServer().listen(Number(process.env.PORT) || 4173, process.env.HOST || '127.0.0.1', () =>
    console.log('NightSky: http://localhost:' + (process.env.PORT || 4173)),
  );
module.exports = { createServer, validatePlan: AI.validate };
