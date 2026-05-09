import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.STYLIQUE_DATA_DIR || path.join(__dirname, 'data');
const STATIC_DIR = path.resolve(process.env.STYLIQUE_STATIC_DIR || path.join(__dirname, '..', 'dist'));
const JWT_SECRET = process.env.STYLIQUE_JWT_SECRET || '';
const ADMIN_PASSWORD = process.env.STYLIQUE_ADMIN_PASSWORD || '';
const ALLOWED_ORIGIN = process.env.STYLIQUE_ALLOWED_ORIGIN || '*';
const MAX_BODY_BYTES = Number(process.env.STYLIQUE_MAX_BODY_BYTES || 1024 * 1024);
const CONNECTOR_TIMEOUT_MS = Number(process.env.STYLIQUE_CONNECTOR_TIMEOUT_MS || 15000);
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const CONNECTOR_WINDOW_MS = 60 * 1000;
const CONNECTOR_MAX_ATTEMPTS = 60;

const allowedOrigins = ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
const loginAttempts = new Map();
const connectorAttempts = new Map();

const CONNECTORS = {
  claude: {
    label: 'Claude',
    url: process.env.CONNECTOR_CLAUDE_URL || '',
    key: process.env.CONNECTOR_CLAUDE_API_KEY || '',
  },
  codex: {
    label: 'Codex',
    url: process.env.CONNECTOR_CODEX_URL || '',
    key: process.env.CONNECTOR_CODEX_API_KEY || '',
  },
  clort: {
    label: 'Clort',
    url: process.env.CONNECTOR_CLORT_URL || '',
    key: process.env.CONNECTOR_CLORT_API_KEY || '',
  },
  botex: {
    label: 'Botex',
    url: process.env.CONNECTOR_BOTEX_URL || '',
    key: process.env.CONNECTOR_BOTEX_API_KEY || '',
  },
};

const STATE_BUCKETS = new Set([
  'leads',
  'activities',
  'attendance',
  'employees',
  'kpi-actions',
  'kpi-definitions',
  'leave-requests',
  'package-pricing',
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return ALLOWED_ORIGIN === '*' ? '*' : allowedOrigins[0] || '';
  if (ALLOWED_ORIGIN === '*') return '*';
  return allowedOrigins.includes(origin) ? origin : '';
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': headers['Access-Control-Allow-Origin'] || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function rateLimit(bucket, key, limit, windowMs) {
  const now = Date.now();
  const entry = bucket.get(key);
  if (!entry || now > entry.resetAt) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function getUsers() {
  if (!process.env.STYLIQUE_USERS_JSON) return {};
  try {
    return JSON.parse(process.env.STYLIQUE_USERS_JSON);
  } catch {
    return {};
  }
}

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  if (!JWT_SECRET) throw new Error('STYLIQUE_JWT_SECRET is required');
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verify(token) {
  if (!JWT_SECRET) return null;
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return verify(token);
}

function bucketPath(bucket) {
  if (!STATE_BUCKETS.has(bucket)) return null;
  return path.join(DATA_DIR, `${bucket}.json`);
}

async function readBucket(bucket) {
  const file = bucketPath(bucket);
  if (!file) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
}

async function writeBucket(bucket, data) {
  const file = bucketPath(bucket);
  if (!file) return false;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
  return true;
}

async function serveStatic(req, res, pathname, corsHeaders) {
  if (req.method !== 'GET') return false;
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, '');
  const target = path.join(STATIC_DIR, normalized);
  if (!target.startsWith(STATIC_DIR)) return false;

  let file = target;
  try {
    const data = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      ...corsHeaders,
    });
    res.end(data);
    return true;
  } catch {
    if (requested.startsWith('/api/') || requested.startsWith('/auth/') || requested === '/health') return false;
    file = path.join(STATIC_DIR, 'index.html');
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES['.html'],
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        ...corsHeaders,
      });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }
}

async function proxyConnector(key, payload, mode = 'invoke') {
  const connector = CONNECTORS[key];
  if (!connector) return { status: 404, body: { ok: false, error: 'Unknown connector' } };
  if (!connector.url) return { status: 400, body: { ok: false, error: 'Connector endpoint is not configured' } };
  if (!connector.key) return { status: 400, body: { ok: false, error: 'Connector API key is not configured' } };
  if (!/^https?:\/\//i.test(connector.url)) {
    return { status: 400, body: { ok: false, error: 'Connector endpoint must be http(s)' } };
  }

  const target = mode === 'ping' ? connector.url : connector.url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECTOR_TIMEOUT_MS);
  const response = await fetch(target, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${connector.key}`,
      'X-Stylique-Connector': key,
    },
    body: JSON.stringify(payload || { ping: true }),
  }).finally(() => clearTimeout(timeout));
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: response.ok ? 200 : response.status, body: { ok: response.ok, connector: key, data: parsed } };
}

async function router(req, res) {
  const corsOrigin = getCorsOrigin(req);
  if (!corsOrigin && req.headers.origin) {
    return send(res, 403, { ok: false, error: 'Origin not allowed' }, { 'Access-Control-Allow-Origin': 'null' });
  }
  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin || '*',
    Vary: 'Origin',
  };
  if (req.method === 'OPTIONS') return send(res, 204, undefined, corsHeaders);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

  if (pathname === '/health' && req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      service: 'stylique-crm-api',
      authConfigured: Boolean(JWT_SECRET && ADMIN_PASSWORD),
      connectors: Object.fromEntries(Object.entries(CONNECTORS).map(([key, cfg]) => [
        key,
        { configured: Boolean(cfg.url && cfg.key), endpoint: Boolean(cfg.url), key: Boolean(cfg.key) },
      ])),
    }, corsHeaders);
  }

  if (pathname === '/auth/login' && req.method === 'POST') {
    if (!rateLimit(loginAttempts, ip, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS)) {
      return send(res, 429, { ok: false, error: 'Too many login attempts' }, corsHeaders);
    }
    const body = await readBody(req);
    if (!JWT_SECRET || !ADMIN_PASSWORD) {
      return send(res, 503, { ok: false, error: 'Auth is not configured on the backend' }, corsHeaders);
    }
    const users = getUsers();
    const user = users[String(body.userId)] || { password: ADMIN_PASSWORD, role: String(body.role || 'user') };
    if (!body.userId || !sameSecret(body.password, user.password)) {
      return send(res, 401, { ok: false, error: 'Invalid credentials' }, corsHeaders);
    }
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const token = sign({ sub: String(body.userId), role: String(user.role || 'user'), exp });
    return send(res, 200, { ok: true, token, expiresAt: exp }, corsHeaders);
  }

  const user = requireAuth(req);
  if (!user) return send(res, 401, { ok: false, error: 'Unauthorized' }, corsHeaders);

  if (pathname === '/auth/me' && req.method === 'GET') {
    return send(res, 200, { ok: true, user }, corsHeaders);
  }

  const stateMatch = pathname.match(/^\/api\/state\/([a-z0-9-]+)$/);
  if (stateMatch && req.method === 'GET') {
    const data = await readBucket(stateMatch[1]);
    if (data === null) return send(res, 404, { ok: false, error: 'Unknown state bucket' }, corsHeaders);
    return send(res, 200, { ok: true, data }, corsHeaders);
  }
  if (stateMatch && req.method === 'PUT') {
    const body = await readBody(req);
    const ok = await writeBucket(stateMatch[1], body.data ?? body);
    if (!ok) return send(res, 404, { ok: false, error: 'Unknown state bucket' }, corsHeaders);
    return send(res, 200, { ok: true }, corsHeaders);
  }

  const connectorMatch = pathname.match(/^\/api\/connectors\/(claude|codex|clort|botex)\/(ping|invoke)$/);
  if (connectorMatch && req.method === 'POST') {
    if (!rateLimit(connectorAttempts, `${ip}:${connectorMatch[1]}`, CONNECTOR_MAX_ATTEMPTS, CONNECTOR_WINDOW_MS)) {
      return send(res, 429, { ok: false, error: 'Too many connector requests' }, corsHeaders);
    }
    const [, key, mode] = connectorMatch;
    const result = await proxyConnector(key, await readBody(req), mode);
    return send(res, result.status, result.body, corsHeaders);
  }

  if (await serveStatic(req, res, pathname, corsHeaders)) return;

  return send(res, 404, { ok: false, error: 'Not found' }, corsHeaders);
}

const server = http.createServer((req, res) => {
  router(req, res).catch(error => {
    console.error('[stylique-api]', error);
    send(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`Stylique CRM API listening on :${PORT}`);
});
