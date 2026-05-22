import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.STYLIQUE_DATA_DIR || (process.env.VERCEL === '1' ? path.join('/tmp', 'stylique-crm-data') : path.join(__dirname, 'data'));
const STATIC_DIR = path.resolve(process.env.STYLIQUE_STATIC_DIR || path.join(__dirname, '..', 'dist'));
const JWT_SECRET = process.env.STYLIQUE_JWT_SECRET || '';
const ADMIN_PASSWORD = process.env.STYLIQUE_ADMIN_PASSWORD || '';
const ALLOWED_ORIGIN = process.env.STYLIQUE_ALLOWED_ORIGIN || '*';
const MAX_BODY_BYTES = Number(process.env.STYLIQUE_MAX_BODY_BYTES || 1024 * 1024);
const CONNECTOR_TIMEOUT_MS = Number(process.env.STYLIQUE_CONNECTOR_TIMEOUT_MS || 15000);
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || '';
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || '';
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || '';
const MICROSOFT_CALENDAR_USER_ID = process.env.MICROSOFT_CALENDAR_USER_ID || '';
const MICROSOFT_DEFAULT_TIMEZONE = process.env.MICROSOFT_DEFAULT_TIMEZONE || 'Asia/Karachi';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'stylique_crm_state';
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

const DEFAULT_AUTH_USERS = {
  asjad: {
    password: 'Asjad-CRM-2026!',
    role: 'sdr',
  },
};

let graphTokenCache = { token: '', expiresAt: 0 };

const STATE_BUCKETS = new Set([
  'leads',
  'activities',
  'attendance',
  'employees',
  'kpi-actions',
  'kpi-definitions',
  'leave-requests',
  'package-pricing',
  'auth-users',
]);

const SDR_OWNED_BUCKETS = new Set(['leads', 'activities', 'attendance', 'kpi-actions', 'leave-requests']);
const ONBOARDING_BUCKETS = new Set(['leads', 'activities', 'attendance', 'leave-requests']);

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
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
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

async function getUsers() {
  let envUsers = {};
  if (process.env.STYLIQUE_USERS_JSON) {
    try {
      envUsers = JSON.parse(process.env.STYLIQUE_USERS_JSON);
    } catch {
      envUsers = {};
    }
  }
  const baseUsers = { ...DEFAULT_AUTH_USERS, ...envUsers };
  const stored = await readBucket('auth-users');
  if (!Array.isArray(stored) || stored.length === 0) return baseUsers;
  const storedUsers = Object.fromEntries(stored
    .filter(user => user?.id && user?.password)
    .map(user => [String(user.id), {
      password: String(user.password),
      role: String(user.role || envUsers[String(user.id)]?.role || 'user'),
    }])
  );
  return { ...baseUsers, ...storedUsers };
}

async function listAuthUsers() {
  const users = await getUsers();
  return Object.entries(users).map(([id, user]) => ({
    id,
    role: String(user.role || 'user'),
    password: String(user.password || ''),
  })).sort((a, b) => a.id.localeCompare(b.id));
}

async function saveAuthUsers(users) {
  const normalized = Array.isArray(users)
    ? users
        .filter(user => user?.id && user?.password)
        .map(user => ({
          id: String(user.id).trim(),
          role: String(user.role || 'user').trim(),
          password: String(user.password),
          updatedAt: new Date().toISOString(),
        }))
    : [];
  await writeBucket('auth-users', normalized);
  return normalized;
}

async function upsertAuthUser(userId, role, password) {
  if (!userId || !password) {
    return { status: 400, body: { ok: false, error: 'userId and password are required' } };
  }
  const current = await listAuthUsers();
  const id = String(userId).trim();
  const idx = current.findIndex(user => user.id === id);
  const next = {
    id,
    role: String(role || current[idx]?.role || 'user').trim(),
    password: String(password),
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) current[idx] = next; else current.push(next);
  await saveAuthUsers(current);
  return { status: 200, body: { ok: true, user: next } };
}

function canAccessBucket(user, bucket, method) {
  const role = String(user?.role || '');
  if (role === 'ceo' || role === 'coo') return true;
  if (role === 'operations') return method === 'GET';
  if (role === 'sdr') return ['GET', 'PUT'].includes(method) && SDR_OWNED_BUCKETS.has(bucket);
  if (role === 'onboarding') return ['GET', 'PUT'].includes(method) && ONBOARDING_BUCKETS.has(bucket);
  return false;
}

function normalizeBrandName(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function safeId(prefix = 'crm') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function contactAlreadyExists(contacts = [], email = '', name = '') {
  const e = String(email || '').trim().toLowerCase();
  const n = String(name || '').trim().toLowerCase();
  return contacts.some(c =>
    (e && String(c.email || '').toLowerCase() === e) ||
    (n && String(c.name || '').trim().toLowerCase() === n)
  );
}

async function ingestBookDemo(body, user) {
  const companyName = String(body.companyName || body.company || body.brand || '').trim();
  const contactName = String(body.contactName || body.name || '').trim();
  const contactEmail = String(body.contactEmail || body.email || '').trim();
  if (!companyName || !contactName) {
    return { status: 400, body: { ok: false, error: 'companyName and contactName are required' } };
  }

  const now = new Date().toISOString();
  const owner = String(body.owner || user.sub || '').trim() || 'abdullah';
  const leads = await readBucket('leads');
  const activities = await readBucket('activities');
  const existing = leads.find(lead => normalizeBrandName(lead.companyName) === normalizeBrandName(companyName));

  if (existing) {
    const baseContacts = Array.isArray(existing.contacts) && existing.contacts.length
      ? existing.contacts
      : [{
          id: safeId('contact'),
          name: existing.contactName,
          email: existing.contactEmail,
          phone: existing.contactPhone,
          linkedin: existing.linkedin,
          instagram: existing.instagram,
          reached: false,
        }];
    const contact = {
      id: safeId('contact'),
      name: contactName,
      email: contactEmail,
      phone: String(body.contactPhone || body.phone || '').trim() || undefined,
      reached: false,
    };
    const contacts = contactAlreadyExists(baseContacts, contact.email, contact.name) ? baseContacts : [...baseContacts, contact];
    Object.assign(existing, {
      contacts,
      secondaryContact: existing.secondaryContact || contacts[1] ? {
        name: contacts[1]?.name || existing.secondaryContact?.name || '',
        email: contacts[1]?.email || existing.secondaryContact?.email,
        phone: contacts[1]?.phone || existing.secondaryContact?.phone,
      } : existing.secondaryContact,
      source_detail: 'website_demo',
      inbound_type: 'direct_book_demo',
      updatedAt: now,
      notes: [existing.notes, body.note ? `[Book demo] ${String(body.note).trim()}` : 'Book demo request'].filter(Boolean).join('\n'),
    });
    activities.unshift({
      id: safeId('activity'),
      leadId: existing.id,
      type: 'stage-change',
      description: 'Book-a-demo contact merged into brand',
      createdAt: now,
      createdBy: user.sub,
    });
    await writeBucket('leads', leads);
    await writeBucket('activities', activities.slice(0, 500));
    return { status: 200, body: { ok: true, leadId: existing.id, merged: true } };
  }

  const lead = {
    id: safeId('lead'),
    companyName,
    contactName,
    contactEmail,
    contactPhone: String(body.contactPhone || body.phone || '').trim() || undefined,
    website: String(body.website || '').trim() || undefined,
    contacts: [{
      id: safeId('contact'),
      name: contactName,
      email: contactEmail,
      phone: String(body.contactPhone || body.phone || '').trim() || undefined,
      reached: false,
    }],
    contactsReachedCount: 0,
    pipeline: 'inbound',
    stage: 'inbound-new',
    assignedTo: owner,
    platform: String(body.platform || 'shopify'),
    entry_flow: 'inbound',
    inbound_type: 'direct_book_demo',
    source_detail: 'website_demo',
    action_owner: 'sdr',
    record_owner: owner,
    assigned_sdr: owner,
    notes: [String(body.note || '').trim(), 'Secondary contact missing'].filter(Boolean).join('\n'),
    createdAt: now,
    updatedAt: now,
    tasks: [{
      id: safeId('task'),
      title: 'Secondary contact missing',
      dueDate: now,
      completed: false,
      assignedTo: owner,
      type: 'outreach',
      autoGenerated: true,
      createdAt: now,
      priority: 'medium',
      reason: 'Book-a-demo brand has one contact',
      stageFamily: 'sdr',
    }],
    priority: 'medium',
    leadKey: normalizeBrandName(companyName),
  };
  leads.push(lead);
  activities.unshift({
    id: safeId('activity'),
    leadId: lead.id,
    type: 'stage-change',
    description: `Book-a-demo inbound created — ${companyName}`,
    createdAt: now,
    createdBy: user.sub,
  });
  await writeBucket('leads', leads);
  await writeBucket('activities', activities.slice(0, 500));
  return { status: 201, body: { ok: true, leadId: lead.id, merged: false } };
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

function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function readSupabaseBucket(bucket) {
  if (!STATE_BUCKETS.has(bucket)) return null;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_TABLE)}?bucket=eq.${encodeURIComponent(bucket)}&select=data&limit=1`,
    { headers: supabaseHeaders() },
  );
  if (response.status === 404) {
    throw new Error(`Supabase table "${SUPABASE_TABLE}" was not found`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Supabase read failed (${response.status}): ${text || response.statusText}`);
  }
  const rows = await response.json().catch(() => []);
  return rows?.[0]?.data ?? [];
}

async function writeSupabaseBucket(bucket, data) {
  if (!STATE_BUCKETS.has(bucket)) return false;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_TABLE)}`, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({
      bucket,
      data,
      updated_at: new Date().toISOString(),
    }),
  });
  if (response.status === 404) {
    throw new Error(`Supabase table "${SUPABASE_TABLE}" was not found`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Supabase write failed (${response.status}): ${text || response.statusText}`);
  }
  return true;
}

async function readBucket(bucket) {
  if (supabaseConfigured()) return readSupabaseBucket(bucket);
  const file = bucketPath(bucket);
  if (!file) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
}

async function writeBucket(bucket, data) {
  if (supabaseConfigured()) return writeSupabaseBucket(bucket, data);
  const file = bucketPath(bucket);
  if (!file) return false;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
  return true;
}

async function serveStatic(req, res, pathname, corsHeaders) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
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
    res.end(req.method === 'HEAD' ? undefined : data);
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
      res.end(req.method === 'HEAD' ? undefined : data);
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

function microsoftConfigured() {
  return Boolean(MICROSOFT_TENANT_ID && MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET && MICROSOFT_CALENDAR_USER_ID);
}

async function getMicrosoftGraphToken() {
  if (!microsoftConfigured()) {
    const error = new Error('Microsoft Graph is not configured');
    error.statusCode = 400;
    throw error;
  }
  if (graphTokenCache.token && Date.now() < graphTokenCache.expiresAt - 60000) {
    return graphTokenCache.token;
  }
  const body = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    client_secret: MICROSOFT_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const response = await fetch(`https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || 'Microsoft token request failed');
    error.statusCode = response.status;
    throw error;
  }
  graphTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return graphTokenCache.token;
}

async function createMicrosoftCalendarEvent(payload) {
  const token = await getMicrosoftGraphToken();
  const start = new Date(payload.startTime || payload.dateTime || payload.scheduled_at);
  if (!Number.isFinite(start.getTime())) {
    return { status: 400, body: { ok: false, error: 'Valid startTime is required' } };
  }
  const durationMinutes = Number(payload.durationMinutes || 30);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const timeZone = String(payload.timeZone || MICROSOFT_DEFAULT_TIMEZONE);
  const attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
  const eventBody = {
    subject: String(payload.subject || 'Stylique CRM meeting'),
    body: {
      contentType: 'HTML',
      content: String(payload.notes || payload.body || 'Scheduled from Stylique CRM'),
    },
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    attendees: attendees
      .filter(a => a?.email || a?.address || typeof a === 'string')
      .map(a => {
        const address = typeof a === 'string' ? a : a.email || a.address;
        const name = typeof a === 'string' ? a : a.name || address;
        return { emailAddress: { address, name }, type: 'required' };
      }),
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
  };
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MICROSOFT_CALENDAR_USER_ID)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: `outlook.timezone="${timeZone}"`,
    },
    body: JSON.stringify(eventBody),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { status: response.status, body: { ok: false, error: data.error?.message || 'Microsoft event create failed', data } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      provider: 'microsoft',
      eventId: data.id,
      joinUrl: data.onlineMeeting?.joinUrl || data.onlineMeetingUrl || '',
      webLink: data.webLink || '',
      raw: {
        id: data.id,
        isOnlineMeeting: data.isOnlineMeeting,
        onlineMeetingProvider: data.onlineMeetingProvider,
      },
    },
  };
}

export async function router(req, res) {
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

  if (!pathname.startsWith('/api/') && !pathname.startsWith('/auth/') && pathname !== '/health') {
    if (await serveStatic(req, res, pathname, corsHeaders)) return;
  }

  if (pathname === '/health' && req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      service: 'stylique-crm-api',
      authConfigured: Boolean(JWT_SECRET && ADMIN_PASSWORD),
      connectors: Object.fromEntries(Object.entries(CONNECTORS).map(([key, cfg]) => [
        key,
        { configured: Boolean(cfg.url && cfg.key), endpoint: Boolean(cfg.url), key: Boolean(cfg.key) },
      ])),
      microsoft: {
        configured: microsoftConfigured(),
        tenant: Boolean(MICROSOFT_TENANT_ID),
        clientId: Boolean(MICROSOFT_CLIENT_ID),
        clientSecret: Boolean(MICROSOFT_CLIENT_SECRET),
        calendarUser: Boolean(MICROSOFT_CALENDAR_USER_ID),
      },
      storage: {
        provider: supabaseConfigured() ? 'supabase' : 'json-file',
        durable: supabaseConfigured(),
        supabase: {
          configured: supabaseConfigured(),
          url: Boolean(SUPABASE_URL),
          serviceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
          table: SUPABASE_TABLE,
        },
      },
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
    const users = await getUsers();
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

  if (pathname === '/api/auth-users' && req.method === 'GET') {
    if (!['ceo', 'coo'].includes(String(user.role || ''))) {
      return send(res, 403, { ok: false, error: 'Forbidden' }, corsHeaders);
    }
    return send(res, 200, { ok: true, users: await listAuthUsers() }, corsHeaders);
  }

  if (pathname === '/api/auth-users' && req.method === 'PUT') {
    if (!['ceo', 'coo'].includes(String(user.role || ''))) {
      return send(res, 403, { ok: false, error: 'Forbidden' }, corsHeaders);
    }
    const body = await readBody(req);
    const saved = await saveAuthUsers(body.users || body.data || []);
    return send(res, 200, { ok: true, users: saved }, corsHeaders);
  }

  if (pathname === '/api/auth-users' && req.method === 'POST') {
    if (!['ceo', 'coo'].includes(String(user.role || ''))) {
      return send(res, 403, { ok: false, error: 'Forbidden' }, corsHeaders);
    }
    const body = await readBody(req);
    const result = await upsertAuthUser(body.userId || body.id, body.role, body.password);
    return send(res, result.status, result.body, corsHeaders);
  }

  const stateMatch = pathname.match(/^\/api\/state\/([a-z0-9-]+)$/);
  if (stateMatch && req.method === 'GET') {
    if (!canAccessBucket(user, stateMatch[1], req.method)) {
      return send(res, 403, { ok: false, error: 'Forbidden' }, corsHeaders);
    }
    const data = await readBucket(stateMatch[1]);
    if (data === null) return send(res, 404, { ok: false, error: 'Unknown state bucket' }, corsHeaders);
    return send(res, 200, { ok: true, data }, corsHeaders);
  }
  if (stateMatch && req.method === 'PUT') {
    if (!canAccessBucket(user, stateMatch[1], req.method)) {
      return send(res, 403, { ok: false, error: 'Forbidden' }, corsHeaders);
    }
    const body = await readBody(req);
    const ok = await writeBucket(stateMatch[1], body.data ?? body);
    if (!ok) return send(res, 404, { ok: false, error: 'Unknown state bucket' }, corsHeaders);
    return send(res, 200, { ok: true }, corsHeaders);
  }

  if (pathname === '/api/book-demo' && req.method === 'POST') {
    const role = String(user.role || '');
    if (!['ceo', 'coo', 'sdr'].includes(role)) {
      return send(res, 403, { ok: false, error: 'Forbidden' }, corsHeaders);
    }
    const result = await ingestBookDemo(await readBody(req), user);
    return send(res, result.status, result.body, corsHeaders);
  }

  if (pathname === '/api/calendar/microsoft/health' && req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      configured: microsoftConfigured(),
      tenant: Boolean(MICROSOFT_TENANT_ID),
      clientId: Boolean(MICROSOFT_CLIENT_ID),
      clientSecret: Boolean(MICROSOFT_CLIENT_SECRET),
      calendarUser: Boolean(MICROSOFT_CALENDAR_USER_ID),
      timeZone: MICROSOFT_DEFAULT_TIMEZONE,
    }, corsHeaders);
  }

  if (pathname === '/api/calendar/microsoft/events' && req.method === 'POST') {
    const role = String(user.role || '');
    if (!['ceo', 'coo', 'sdr'].includes(role)) {
      return send(res, 403, { ok: false, error: 'Forbidden' }, corsHeaders);
    }
    const result = await createMicrosoftCalendarEvent(await readBody(req));
    return send(res, result.status, result.body, corsHeaders);
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

  return send(res, 404, { ok: false, error: 'Not found' }, corsHeaders);
}

export function handleRequest(req, res) {
  return router(req, res).catch(error => {
    console.error('[stylique-api]', error);
    send(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'Internal server error' });
  });
}

if (process.env.VERCEL !== '1') {
  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`Stylique CRM API listening on :${PORT}`);
  });
}
