#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SAMPLE_PATH = path.join(ROOT, 'data', 'sample-agent.json');
const SPECTORA_ORIGIN = 'https://connect.spectora.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_000_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png'
};

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https://static.wixstatic.com; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY'
});

function loadEnvFile(filePath = path.join(ROOT, '.env'), env = process.env) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`Invalid .env line for ${filePath}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[match[1]] === undefined) env[match[1]] = value;
  }
}

function validatedHttpsUrl(value, name) {
  if (!value) return value;
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${name} must be a valid HTTPS URL`);
  return url.href;
}

function validatedOrigin(value, name) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a bare HTTPS origin`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be a bare HTTPS origin`);
  }
  return url.origin;
}

function validatedColor(value, name) {
  if (!value) return value;
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${name} must be a six-digit hex color`);
  return value.toLowerCase();
}

function validatedAssetPath(value, name) {
  if (!value) return value;
  if (!/^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || value.includes('..')) {
    throw new Error(`${name} must be a local /assets/ path without traversal`);
  }
  return value;
}

function validatedPositiveDecimalId(value, name) {
  const text = String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`${name} must be a positive decimal identifier`);
  return text;
}

function createConfig(env = process.env) {
  const mode = env.PORTAL_MODE || 'demo';
  if (!['demo', 'live'].includes(mode)) throw new Error('PORTAL_MODE must be either demo or live');
  if (mode === 'live') {
    const missing = ['SPECTORA_API_KEY', 'SPECTORA_COMPANY_ID', 'PORTAL_SIGNING_SECRET'].filter(name => !env[name]);
    if (missing.length) throw new Error(`Live mode is missing: ${missing.join(', ')}`);
    if (Buffer.byteLength(env.PORTAL_SIGNING_SECRET, 'utf8') < 32) throw new Error('PORTAL_SIGNING_SECRET must be at least 32 bytes');
    validatedPositiveDecimalId(env.SPECTORA_COMPANY_ID, 'SPECTORA_COMPANY_ID');
  }
  const port = Number(env.PORT || 3005);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  return {
    mode,
    port,
    apiKey: String(env.SPECTORA_API_KEY || '').trim().replace(/^Bearer\s+/i, ''),
    companyId: mode === 'live' ? validatedPositiveDecimalId(env.SPECTORA_COMPANY_ID, 'SPECTORA_COMPANY_ID') : '',
    signingSecret: env.PORTAL_SIGNING_SECRET || '',
    adminAccessKey: String(env.ADMIN_ACCESS_KEY || '').trim(),
    googleDrive: {
      projectNumber: String(env.GOOGLE_CLOUD_PROJECT_NUMBER || '').trim(),
      poolId: String(env.GOOGLE_WORKLOAD_IDENTITY_POOL_ID || '').trim(),
      providerId: String(env.GOOGLE_WORKLOAD_IDENTITY_PROVIDER_ID || '').trim(),
      serviceAccountEmail: String(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL || '').trim(),
      backupFolderId: String(env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || '').trim()
    },
    publicOrigin: validatedOrigin(
      env.PORTAL_PUBLIC_ORIGIN || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : ''),
      'PORTAL_PUBLIC_ORIGIN'
    ),
    upstreamTimeoutMs: boundedInteger(env.UPSTREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 100, 30_000),
    upstreamMaxBytes: boundedInteger(env.UPSTREAM_MAX_BYTES, DEFAULT_MAX_BYTES, 1024, 5_000_000),
    rateLimitMax: boundedInteger(env.RATE_LIMIT_MAX, 60, 1, 1000),
    rateLimitWindowMs: boundedInteger(env.RATE_LIMIT_WINDOW_MS, 60_000, 1000, 3_600_000),
    branding: {
      appName: env.PORTAL_APP_NAME,
      name: env.COMPANY_NAME,
      tagline: env.COMPANY_TAGLINE,
      license: env.COMPANY_LICENSE,
      phone: env.COMPANY_PHONE,
      website: validatedHttpsUrl(env.COMPANY_WEBSITE, 'COMPANY_WEBSITE'),
      bookingUrl: validatedHttpsUrl(env.BOOKING_URL, 'BOOKING_URL'),
      whatsappUrl: validatedHttpsUrl(env.WHATSAPP_URL, 'WHATSAPP_URL'),
      brand: {
        primary: validatedColor(env.BRAND_PRIMARY_COLOR, 'BRAND_PRIMARY_COLOR'),
        accentText: validatedColor(env.BRAND_ACCENT_TEXT_COLOR, 'BRAND_ACCENT_TEXT_COLOR'),
        ink: validatedColor(env.BRAND_INK_COLOR, 'BRAND_INK_COLOR'),
        muted: validatedColor(env.BRAND_MUTED_COLOR, 'BRAND_MUTED_COLOR'),
        surface: validatedColor(env.BRAND_SURFACE_COLOR, 'BRAND_SURFACE_COLOR'),
        background: validatedColor(env.BRAND_BACKGROUND_COLOR, 'BRAND_BACKGROUND_COLOR'),
        border: validatedColor(env.BRAND_BORDER_COLOR, 'BRAND_BORDER_COLOR'),
        success: validatedColor(env.BRAND_SUCCESS_COLOR, 'BRAND_SUCCESS_COLOR'),
        focus: validatedColor(env.BRAND_FOCUS_COLOR, 'BRAND_FOCUS_COLOR')
      }
    },
    demoAgent: {
      firstName: env.DEMO_AGENT_FIRST_NAME,
      lastName: env.DEMO_AGENT_LAST_NAME,
      agency: env.DEMO_AGENT_AGENCY,
      city: env.DEMO_AGENT_CITY,
      state: env.DEMO_AGENT_STATE,
      photoUrl: validatedAssetPath(env.DEMO_AGENT_PHOTO_PATH, 'DEMO_AGENT_PHOTO_PATH')
    },
    demoTier: {
      label: env.DEMO_TIER_LABEL
    }
  };
}

function boundedInteger(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Configuration value must be an integer from ${min} to ${max}`);
  return number;
}

function authError(message, statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

class UpstreamHttpError extends Error {
  constructor(upstreamStatus) {
    super(`Spectora API returned ${upstreamStatus}`);
    this.name = 'UpstreamHttpError';
    this.upstreamStatus = upstreamStatus;
  }
}

function signGrantPayload(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function createGrant(connectionId, secret, options = {}) {
  const validatedConnectionId = validatedPositiveDecimalId(connectionId, 'Spectora connection ID');
  if (Buffer.byteLength(secret || '', 'utf8') < 32) throw new Error('A signing secret of at least 32 bytes is required');
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds ?? 2_592_000;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 7_776_000) throw new Error('Grant TTL must be between 1 and 7776000 seconds');
  const payload = Buffer.from(JSON.stringify({ v: 1, connectionId: validatedConnectionId, exp: now + ttlSeconds })).toString('base64url');
  return `${payload}.${signGrantPayload(payload, secret)}`;
}

function verifyGrant(grant, requestedConnectionId, secret, options = {}) {
  const fail = () => { throw authError('Invalid or expired portal grant'); };
  validatedPositiveDecimalId(requestedConnectionId, 'Spectora connection ID');
  if (typeof grant !== 'string') fail();
  const [payloadPart, signaturePart, extra] = grant.split('.');
  if (!payloadPart || !signaturePart || extra) fail();
  const expected = Buffer.from(signGrantPayload(payloadPart, secret));
  const supplied = Buffer.from(signaturePart);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) fail();
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')); } catch { fail(); }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (payload.v !== 1 || !/^[1-9][0-9]*$/.test(payload.connectionId) || !Number.isSafeInteger(payload.exp) || payload.exp <= now) fail();
  if (payload.connectionId !== requestedConnectionId) throw authError('Portal grant is not valid for this connection', 403);
  return payload;
}

function readSampleAgent() {
  return JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
}

function applyCustomization(sample, branding, demoAgent, demoTier) {
  const company = { ...sample.company, brand: { ...sample.company.brand } };
  for (const [key, value] of Object.entries(branding)) {
    if (key === 'brand') {
      for (const [color, colorValue] of Object.entries(value)) if (colorValue) company.brand[color] = colorValue;
    } else if (value) {
      company[key] = value;
    }
  }
  const agent = { ...sample.agent };
  for (const [key, value] of Object.entries(demoAgent)) if (value) agent[key] = value;
  const tier = { ...sample.tier };
  for (const [key, value] of Object.entries(demoTier)) if (value) tier[key] = value;
  return { ...sample, company, agent, tier };
}

function headers(extra = {}) {
  return { ...SECURITY_HEADERS, ...extra };
}

function sendJson(res, status, payload) {
  res.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
  res.end(JSON.stringify(payload));
}

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  return match?.[1];
}

function constantTimeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function adminAuthorized(req, config) {
  return constantTimeTextEqual(req.headers['x-admin-key'], config.adminAccessKey);
}

function readJsonBody(req, maxBytes = 16_384) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(authError('Request body too large', 413));
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(authError('Malformed JSON request', 400));
      }
    });
    req.on('error', reject);
  });
}

function resolvePortalOrigin(req, config) {
  if (config.publicOrigin) return config.publicOrigin;
  const host = String(req.headers.host || '').trim();
  if (!/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(host)) throw authError('Portal public origin is not configured', 500);
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto === 'http' && /^localhost(?::|$)/.test(host) ? 'http' : 'https';
  return `${protocol}://${host}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function requestJson(url, options = {}, body = null, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    const target = url instanceof URL ? url : new URL(url);
    const request = https.request(target, options, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          reject(new Error('External API response exceeded size limit'));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw || '{}'); } catch {}
        resolve({
          statusCode: Number(response.statusCode || 0),
          headers: response.headers,
          raw,
          json
        });
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('External API request timed out')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function googleDriveAccessToken(config) {
  const drive = config.googleDrive || {};
  const oidcToken = String(process.env.VERCEL_OIDC_TOKEN || '').trim();

  if (
    !drive.projectNumber ||
    !drive.poolId ||
    !drive.providerId ||
    !drive.serviceAccountEmail ||
    !drive.backupFolderId
  ) {
    throw authError('Google Drive Workload Identity is not configured', 503);
  }
  if (!oidcToken) {
    throw authError('Vercel OIDC token is unavailable in this deployment', 503);
  }

  const audience = `//iam.googleapis.com/projects/${drive.projectNumber}/locations/global/workloadIdentityPools/${drive.poolId}/providers/${drive.providerId}`;
  const exchangeForm = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    audience,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    subject_token: oidcToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt'
  }).toString();

  const exchange = await requestJson(
    'https://sts.googleapis.com/v1/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(exchangeForm)
      },
      timeout: 15_000
    },
    exchangeForm,
    300_000
  );

  if (exchange.statusCode < 200 || exchange.statusCode > 299 || !exchange.json?.access_token) {
    const message = exchange.json?.error_description || exchange.json?.error || `Google STS returned HTTP ${exchange.statusCode}`;
    throw new Error(message);
  }

  const impersonationBody = JSON.stringify({
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
    lifetime: '3600s'
  });
  const serviceAccount = encodeURIComponent(drive.serviceAccountEmail);
  const impersonationUrl =
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`;

  const impersonation = await requestJson(
    impersonationUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${exchange.json.access_token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(impersonationBody)
      },
      timeout: 15_000
    },
    impersonationBody,
    300_000
  );

  if (
    impersonation.statusCode < 200 ||
    impersonation.statusCode > 299 ||
    !impersonation.json?.accessToken
  ) {
    const message = impersonation.json?.error?.message || `Google IAM Credentials returned HTTP ${impersonation.statusCode}`;
    throw new Error(message);
  }

  return impersonation.json.accessToken;
}

async function googleDriveListChildren(accessToken, parentId) {
  const params = new URLSearchParams({
    q: `'${parentId}' in parents and trashed = false`,
    pageSize: '1000',
    fields: 'files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  });
  const url = new URL(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const response = await requestJson(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    timeout: 15_000
  });
  if (response.statusCode < 200 || response.statusCode > 299 || !Array.isArray(response.json?.files)) {
    const message = response.json?.error?.message || `Google Drive returned HTTP ${response.statusCode}`;
    throw new Error(message);
  }
  return response.json.files;
}

function dateToBackupLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
  const [year, month, day] = String(value).split('-');
  return `${month}/${day}/${year}`;
}

function assertCompanyScope(records, companyId) {
  for (const record of records) {
    const attributeId = record?.attributes?.company_id;
    if (String(attributeId ?? '') !== String(companyId)) {
      throw authError('Upstream company scope mismatch', 403);
    }
    if (record.relationships && Object.hasOwn(record.relationships, 'company')) {
      const relationship = record.relationships.company;
      const resource = relationship?.data;
      if (!resource || Array.isArray(resource) || typeof resource !== 'object' || resource.type !== 'company' || String(resource.id ?? '') !== String(companyId)) {
        throw authError('Upstream company relationship mismatch', 403);
      }
    }
  }
}

function assertRecordId(record, expectedId, label) {
  if (!record || String(record.id ?? '') !== expectedId) throw authError(`Upstream ${label} identifier mismatch`, 403);
}

function relationshipId(record, name, expectedType, allowNull = false) {
  const relationship = record?.relationships?.[name];
  if (!relationship || !Object.hasOwn(relationship, 'data')) throw authError(`Upstream ${name} relationship missing`, 403);
  if (relationship.data === null && allowNull) return null;
  if (!relationship.data || Array.isArray(relationship.data) || typeof relationship.data !== 'object') {
    throw authError(`Upstream ${name} relationship ambiguous`, 403);
  }
  const { id, type } = relationship.data;
  if (type !== expectedType) throw authError(`Upstream ${name} relationship type mismatch`, 403);
  if (typeof id !== 'string' || id === '') throw authError(`Upstream ${name} relationship identifier missing`, 403);
  return id;
}

function assertInspectionScope(records, companyId, connectionId) {
  for (const record of records) {
    if (Object.hasOwn(record?.attributes || {}, 'company_id') && String(record.attributes.company_id ?? '') !== String(companyId)) {
      throw authError('Upstream inspection company attribute mismatch', 403);
    }
    if (String(relationshipId(record, 'company', 'company') ?? '') !== String(companyId)) throw authError('Upstream inspection company scope mismatch', 403);
    const buyingAgentId = relationshipId(record, 'buying_agent', 'connection', true);
    const sellingAgentId = relationshipId(record, 'selling_agent', 'connection', true);
    if (buyingAgentId !== connectionId && sellingAgentId !== connectionId) {
      throw authError('Upstream inspection connection scope mismatch', 403);
    }
  }
}

function mapInspection(insp) {
  const attrs = insp.attributes || {};
  const parsedDate = attrs.datetime ? new Date(attrs.datetime) : null;
  const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : '';

  const fullAddress = [
    attrs.property_address,
    attrs.property_full_address,
    attrs.address
  ].find(value => typeof value === 'string' && value.trim());

  const street = [
    attrs.property_street,
    attrs.property_street_address,
    attrs.street_address,
    attrs.address_line_1
  ].find(value => typeof value === 'string' && value.trim());

  const city = attrs.property_city || attrs.city || '';
  const state = attrs.property_state || attrs.state || '';
  const zip = attrs.property_zip || attrs.property_zip_code || attrs.zip || '';

  const locality = [
    [city, state].filter(Boolean).join(', '),
    zip
  ].filter(Boolean).join(' ');

  const location = fullAddress
    ? fullAddress.trim()
    : [street, locality].filter(Boolean).join(', ') || 'Location unavailable';

  return {
    date,
    location,
    services: [attrs.service_names, attrs.service_add_on_names].filter(Boolean).join(' + '),
    inspector: attrs.inspector_name || '',
    status: attrs.canceled_at ? 'Canceled' : (attrs.published_at ? 'Report Published' : 'Scheduled'),
    published: Boolean(attrs.published_at)
  };
}

function readUpstreamJson(response, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let exceeded = false;
    response.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        exceeded = true;
        reject(new Error('Spectora API response exceeded size limit'));
        response.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    response.on('end', () => {
      if (exceeded) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Spectora API returned malformed JSON')); }
    });
    response.on('error', reject);
  });
}

function createHttpsUpstream(config, transport = https) {
  return endpoint => new Promise((resolve, reject) => {
    const url = new URL(endpoint, SPECTORA_ORIGIN);
    if (url.origin !== SPECTORA_ORIGIN) return reject(new Error('Unapproved upstream origin'));
    const request = transport.get(url, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      timeout: config.upstreamTimeoutMs
    }, response => {
      if (response.statusCode < 200 || response.statusCode > 299) {
        response.resume();
        reject(new UpstreamHttpError(response.statusCode));
        return;
      }
      readUpstreamJson(response, config.upstreamMaxBytes).then(resolve, reject);
    });
    request.on('timeout', () => request.destroy(new Error('Spectora API timeout')));
    request.on('error', reject);
  });
}

function query(pathname, filters) {
  const params = new URLSearchParams(filters);
  return `${pathname}?${params.toString().replace(/%5B/g, '[').replace(/%5D/g, ']')}`;
}
function fetchPublishedSpectoraReport(reportUrl, options = {}) {
  const maxBytes = options.maxBytes || 2_000_000;
  let url;
  try { url = new URL(reportUrl); }
  catch { return Promise.reject(authError('Invalid Spectora report URL', 400)); }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'reports.spectora.com' ||
    !/^\/v\/reports\/[0-9a-fA-F-]{36}$/.test(url.pathname)
  ) {
    return Promise.reject(authError('Only published reports.spectora.com report links are allowed', 400));
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Inspectology-Agent-Dashboard/1.0'
      },
      timeout: 15_000
    }, response => {
      const statusCode = Number(response.statusCode || 0);

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        let next;
        try { next = new URL(response.headers.location, url); }
        catch { reject(new Error('Published report returned an invalid redirect')); return; }

        if (next.protocol !== 'https:' || next.hostname !== 'reports.spectora.com') {
          reject(new Error('Published report redirected outside reports.spectora.com'));
          return;
        }
        fetchPublishedSpectoraReport(next.href, options).then(resolve, reject);
        return;
      }

      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          reject(new Error('Published report page exceeded size limit'));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode,
          contentType: String(response.headers['content-type'] || ''),
          body,
          finalUrl: url.href
        });
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Published report request timed out')));
    request.on('error', reject);
  });
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function reportUuidFromPublishedUrl(reportUrl) {
  let url;
  try { url = new URL(reportUrl); }
  catch { throw authError('Invalid Spectora report URL', 400); }

  if (url.protocol !== 'https:' || url.hostname !== 'reports.spectora.com') {
    throw authError('Only reports.spectora.com URLs are allowed', 400);
  }

  const match = url.pathname.match(/^\/v\/reports\/([0-9a-fA-F-]{36})$/);
  if (!match) throw authError('Spectora report URL does not contain a valid report UUID', 400);
  return match[1];
}

function fetchHermesPublicReport(reportUrl, options = {}) {
  const reportUuid = reportUuidFromPublishedUrl(reportUrl);
  const maxBytes = options.maxBytes || 8_000_000;
  const url = new URL(`https://changeset-api.hermes.prod.spectora.com/api/v1/public/reports/${encodeURIComponent(reportUuid)}`);

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        Origin: 'https://reports.spectora.com',
        Referer: reportUrl,
        'User-Agent': 'Inspectology-Agent-Dashboard/1.0'
      },
      timeout: 20_000
    }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          reject(new Error('Hermes public report response exceeded size limit'));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({
          reportUuid,
          statusCode: Number(response.statusCode || 0),
          contentType: String(response.headers['content-type'] || ''),
          body,
          json
        });
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Hermes public report request timed out')));
    request.on('error', reject);
  });
}

function summarizeJsonShape(value, maxKeys = 120) {
  const found = new Set();
  const stack = [{ value, path: '$', depth: 0 }];

  while (stack.length && found.size < maxKeys) {
    const current = stack.shift();
    const item = current.value;
    if (current.depth > 4 || item == null) continue;

    if (Array.isArray(item)) {
      found.add(`${current.path}[]`);
      for (const child of item.slice(0, 3)) {
        stack.push({ value: child, path: `${current.path}[]`, depth: current.depth + 1 });
      }
      continue;
    }

    if (typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        const childPath = `${current.path}.${key}`;
        found.add(childPath);
        stack.push({ value: child, path: childPath, depth: current.depth + 1 });
        if (found.size >= maxKeys) break;
      }
    }
  }

  return [...found];
}

function isAllowedSpectoraAssetHost(hostname) {
  return hostname === 'reports.spectora.com' || hostname.endsWith('.spectora.com');
}

function fetchSpectoraPublicAsset(assetUrl, options = {}) {
  const maxBytes = options.maxBytes || 12_000_000;
  let url;
  try { url = new URL(assetUrl); }
  catch { return Promise.reject(authError('Invalid Spectora asset URL', 400)); }

  if (url.protocol !== 'https:' || !isAllowedSpectoraAssetHost(url.hostname)) {
    return Promise.reject(authError('Only public Spectora assets are allowed', 400));
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'application/javascript,text/javascript,text/plain,*/*',
        'User-Agent': 'Inspectology-Agent-Dashboard/1.0'
      },
      timeout: 15_000
    }, response => {
      const statusCode = Number(response.statusCode || 0);

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        let next;
        try { next = new URL(response.headers.location, url); }
        catch { reject(new Error('Spectora asset returned an invalid redirect')); return; }
        if (next.protocol !== 'https:' || !isAllowedSpectoraAssetHost(next.hostname)) {
          reject(new Error('Spectora asset redirected outside approved Spectora hosts'));
          return;
        }
        fetchSpectoraPublicAsset(next.href, options).then(resolve, reject);
        return;
      }

      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          reject(new Error('Spectora asset exceeded size limit'));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          statusCode,
          contentType: String(response.headers['content-type'] || ''),
          body: Buffer.concat(chunks).toString('utf8'),
          finalUrl: url.href
        });
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Spectora asset request timed out')));
    request.on('error', reject);
  });
}

function extractScriptSources(html, baseUrl) {
  const urls = [];
  const seen = new Set();
  const regex = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(String(html || ''))) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl);
      if (!seen.has(resolved.href)) {
        seen.add(resolved.href);
        urls.push(resolved.href);
      }
    } catch {}
  }
  return urls;
}

function scanHermesUsage(source) {
  const text = String(source || '');
  const results = [];
  const seen = new Set();
  const needles = [
    'VITE_HERMES_API_URL',
    'changeset-api.hermes.prod.spectora.com',
    '/api/v2/',
    'sample_reports',
    'client_report',
    'user_report',
    'Authorization',
    'Bearer',
    'id_token',
    'access_token',
    'validate_access_token',
    'report_view_id',
    'report_views',
    'AUTH_MISSING'
  ];

  for (const needle of needles) {
    let from = 0;
    let hits = 0;
    while (hits < 12) {
      const index = text.indexOf(needle, from);
      if (index === -1) break;
      const start = Math.max(0, index - 1200);
      const end = Math.min(text.length, index + needle.length + 1800);
      const snippet = text.slice(start, end).replace(/\s+/g, ' ').slice(0, 3000);
      const key = snippet.slice(0, 220);
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ needle, snippet });
      }
      from = index + needle.length;
      hits += 1;
    }
  }

  return results.slice(0, 40);
}

function scanBundleEndpointCandidates(source) {
  const text = String(source || '');
  const endpointCandidates = new Set();
  const likelyApiPaths = new Set();
  const callContexts = [];
  const seenContext = new Set();

  const addContext = (label, index, radius = 700) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + radius);
    const snippet = text.slice(start, end).replace(/\s+/g, ' ').slice(0, 1800);
    const key = snippet.slice(0, 220);
    if (!seenContext.has(key)) {
      seenContext.add(key);
      callContexts.push({ label, snippet });
    }
  };

  for (const match of text.matchAll(/https:\/\/[^"'\s)]+/gi)) {
    const value = match[0].replace(/[\\,;]+$/, '');
    if (
      /changeset-api\.hermes\.prod\.spectora\.com/i.test(value) ||
      /reports?\.spectora\.com/i.test(value) ||
      /api[^/]*\.spectora\.com/i.test(value)
    ) {
      endpointCandidates.add(value.slice(0, 300));
      addContext('spectora-host', match.index || 0);
    }
  }

  const pathPatterns = [
    /["'`]((?:\/)?api\/v[0-9]+\/[^"'\`]{1,220})["'`]/gi,
    /["'`]((?:\/)?v[0-9]+\/(?:reports?|inspections?|changesets?|sections?|comments?|findings?|summaries?)[^"'\`]{0,220})["'`]/gi,
    /["'`]((?:\/)?(?:reports?|inspections?|changesets?|sections?|comments?|findings?|summaries?)[^"'\`]{0,220})["'`]/gi
  ];

  for (const regex of pathPatterns) {
    for (const match of text.matchAll(regex)) {
      const value = match[1];
      if (value && value.length < 280) {
        likelyApiPaths.add(value);
        addContext('api-path', match.index || 0, 520);
      }
      if (likelyApiPaths.size >= 160) break;
    }
  }

  const callRegexes = [
    /fetch\s*\(/gi,
    /axios\s*\./gi,
    /\.get\s*\(/gi,
    /\.post\s*\(/gi,
    /\.request\s*\(/gi
  ];

  for (const regex of callRegexes) {
    let hits = 0;
    for (const match of text.matchAll(regex)) {
      const index = match.index || 0;
      const nearby = text.slice(Math.max(0, index - 500), Math.min(text.length, index + 1200));
      if (/(VITE_HERMES_API_URL|changeset-api|api\/v[0-9]+|report|inspection|changeset)/i.test(nearby)) {
        addContext('network-call', index, 900);
        hits += 1;
      }
      if (hits >= 18) break;
    }
  }

  const configNeedles = [
    'VITE_HERMES_API_URL',
    'changeset-api.hermes.prod.spectora.com',
    'sample_reports',
    'client_report',
    'inspection.attributes.slug',
    '/api/v2/'
  ];

  for (const needle of configNeedles) {
    let from = 0;
    let hits = 0;
    while (hits < 8) {
      const index = text.indexOf(needle, from);
      if (index === -1) break;
      addContext(needle, index, 850);
      from = index + needle.length;
      hits += 1;
    }
  }

  return {
    candidates: [...endpointCandidates].slice(0, 80),
    likelyApiPaths: [...likelyApiPaths].slice(0, 160),
    contexts: callContexts.slice(0, 50)
  };
}

function createRateLimiter(config, nowMs) {
  const buckets = new Map();
  return key => {
    const now = nowMs();
    if (buckets.size > 10_000) {
      for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
      if (buckets.size > 10_000) buckets.delete(buckets.keys().next().value);
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + config.rateLimitWindowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    return bucket.count <= config.rateLimitMax;
  };
}

function loadStaticSnapshot(publicDir) {
  const rootStat = fs.lstatSync(publicDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Public root must be a real directory');
  const publicReal = fs.realpathSync(publicDir);
  const files = new Map();

  function visit(directory, relativeDirectory = '') {
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name);
      const relative = path.join(relativeDirectory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Public tree contains a symlink or non-regular entry: ${relative}`);
      const real = fs.realpathSync(absolute);
      const containment = path.relative(publicReal, real);
      if (containment.startsWith('..') || path.isAbsolute(containment)) throw new Error(`Public tree entry escapes its root: ${relative}`);
      if (stat.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Public tree contains a symlink or non-regular entry: ${relative}`);
      const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
          throw new Error(`Public tree entry changed during startup: ${relative}`);
        }
        const key = `/${relative.split(path.sep).join('/')}`;
        const ext = path.extname(relative);
        files.set(key, Object.freeze({
          body: fs.readFileSync(descriptor),
          contentType: MIME_TYPES[ext] || 'application/octet-stream',
          cacheControl: ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=86400'
        }));
      } finally {
        fs.closeSync(descriptor);
      }
    }
  }

  visit(publicDir);
  return files;
}

function createPortal(options = {}) {
  const config = createConfig(options.env || process.env);
  const staticFiles = loadStaticSnapshot(options.publicDir || PUBLIC_DIR);
  const nowSeconds = options.now || (() => Math.floor(Date.now() / 1000));
  const nowMs = options.nowMs || Date.now;
  const upstreamGet = options.upstreamGet || createHttpsUpstream(config);
  const log = options.log || (entry => process.stdout.write(`${JSON.stringify(entry)}\n`));
  const allowRequest = createRateLimiter(config, nowMs);

  async function fetchUpstream(stage, endpoint) {
    try {
      return await upstreamGet(endpoint);
    } catch (error) {
      error.safeDetail = error instanceof UpstreamHttpError
        ? `${stage} returned HTTP ${error.upstreamStatus}`
        : `${stage} failed: ${error.message}`;
      throw error;
    }
  }

  async function getAgentPayload(connectionId) {
    const sample = applyCustomization(readSampleAgent(), config.branding, config.demoAgent, config.demoTier);
    if (config.mode === 'demo') return { ...sample, meta: { mode: 'demo' } };
    const scope = config.companyId;

    let connections;
    try {
      connections = await fetchUpstream('Connection lookup', `/v2/connections/${encodeURIComponent(connectionId)}`);
    } catch (error) {
      if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) return null;
      throw error;
    }
    const connection = connections.data;
    assertRecordId(connection, connectionId, 'connection');
    assertCompanyScope([connection], scope);
    const stats = await fetchUpstream('Connection stats lookup', query('/v2/connection_stats', {
      'filter[id]': connectionId, 'page[size]': '1'
    }));
    if (!Array.isArray(stats.data) || stats.data.length !== 1) throw authError('Upstream stats record missing or ambiguous', 403);
    assertRecordId(stats.data[0], connectionId, 'stats');
    assertCompanyScope(stats.data, scope);
    const inspections = await fetchUpstream('Inspection history lookup', query('/v2/inspections', {
      'filter[connection_id]': connectionId, include: 'buying_agent,selling_agent,company', sort: '-datetime', 'page[size]': '50'
    }));
    if (!Array.isArray(inspections.data)) throw authError('Upstream inspections data missing', 403);
    assertInspectionScope(inspections.data, scope, connectionId);
    const attrs = connection.attributes || {};
    const statAttrs = stats.data?.[0]?.attributes || {};
    return {
      meta: { mode: 'live' },
      company: sample.company,
      agent: {
        firstName: attrs.first_name || '',
        lastName: attrs.last_name || '',
        email: attrs.email || '',
        phone: attrs.phone || attrs.phone_number || '',
        agency: attrs.agency_name || '',
        city: attrs.city || '',
        state: attrs.state || '',
        photoUrl: sample.agent.photoUrl
      },
      stats: {
        totalInspections: Number(statAttrs.total_inspections_count || attrs.total_inspections_count || 0),
        buyingInspections: Number(statAttrs.buying_inspections_count || 0),
        sellingInspections: Number(statAttrs.selling_inspections_count || 0),
        firstInspection: statAttrs.first_inspection_date || null,
        lastInspection: statAttrs.last_inspection_date || null,
        overallCount: Number(statAttrs.overall_inspections_count || 0)
      },
      tier: sample.tier,
      inspections: (inspections.data || []).map(mapInspection)
    };
  }

  function sendStatic(res, pathname) {
    const requested = pathname === '/admin' || pathname.startsWith('/admin/')
      ? '/admin.html'
      : (pathname === '/' || pathname.startsWith('/agent/') ? '/index.html' : pathname);
    let decoded;
    try { decoded = decodeURIComponent(requested); } catch { sendJson(res, 400, { error: 'Malformed URL' }); return; }
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) { sendJson(res, 403, { error: 'Forbidden' }); return; }
    const file = staticFiles.get(path.posix.normalize(decoded));
    if (!file) { sendJson(res, 404, { error: 'Not found' }); return; }
    res.writeHead(200, headers({
      'Content-Type': file.contentType,
      'Cache-Control': file.cacheControl
    }));
    res.end(file.body);
  }

  async function handleRequest(req, res) {
    const startedAt = nowMs();
    let pathname = '<malformed>';
    let status = 500;
    try {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { sendJson(res, 400, { error: 'Malformed URL' }); status = 400; return; }
      pathname = url.pathname;
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { status: 'ok', service: 'spectora-agent-portal', mode: config.mode }); status = 200; return;
      }
      if (pathname.startsWith('/api/admin/')) {
        if (!config.adminAccessKey) {
          sendJson(res, 503, { error: 'Admin access is not configured' }); status = 503; return;
        }
        if (!adminAuthorized(req, config)) {
          sendJson(res, 401, { error: 'Invalid admin access key' }); status = 401; return;
        }
        if (req.method === 'GET' && pathname === '/api/admin/session') {
          sendJson(res, 200, { status: 'ok' }); status = 200; return;
        }
        if (req.method === 'GET' && pathname === '/api/admin/agents') {
          const search = String(url.searchParams.get('q') || '').trim();
          if (search.length < 2 || search.length > 120) {
            sendJson(res, 400, { error: 'Search must be between 2 and 120 characters' }); status = 400; return;
          }
          const matches = await fetchUpstream('Agent search', query('/v2/connections', {
            'filter[fulltext]': search, 'page[size]': '20'
          }));
          if (!Array.isArray(matches.data)) throw authError('Upstream agent search data missing', 502);
          assertCompanyScope(matches.data, config.companyId);
          const agents = matches.data.map(record => {
            const attrs = record.attributes || {};
            return {
              connectionId: String(record.id || ''),
              firstName: attrs.first_name || '',
              lastName: attrs.last_name || '',
              agency: attrs.agency_name || '',
              email: attrs.email || '',
              phone: attrs.phone || attrs.phone_number || ''
            };
          }).filter(agent => /^[1-9][0-9]*$/.test(agent.connectionId));
          sendJson(res, 200, { agents }); status = 200; return;
        }
        if (req.method === 'GET' && pathname === '/api/admin/drive-backup-test') {
          const address = String(url.searchParams.get('address') || '').trim();
          const date = String(url.searchParams.get('date') || '').trim();
          if (!address || address.length > 200) {
            sendJson(res, 400, { error: 'A property address is required' }); status = 400; return;
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            sendJson(res, 400, { error: 'Inspection date must use YYYY-MM-DD format' }); status = 400; return;
          }

          const token = await googleDriveAccessToken(config);
          const rootFiles = await googleDriveListChildren(token, config.googleDrive.backupFolderId);
          const street = address.split(',')[0].trim().toLowerCase();
          const dateLabel = dateToBackupLabel(date);

          const matchingFolders = rootFiles.filter(file =>
            file.mimeType === 'application/vnd.google-apps.folder' &&
            String(file.name || '').toLowerCase().includes(street) &&
            String(file.name || '').includes(dateLabel)
          );

          if (!matchingFolders.length) {
            sendJson(res, 404, { error: 'No matching Spectora backup folder found' }); status = 404; return;
          }

          const folder = matchingFolders[0];
          const files = await googleDriveListChildren(token, folder.id);
          const pdfs = files.filter(file => file.mimeType === 'application/pdf');
          const fullReport = pdfs.find(file =>
            /inspectology home inspection report/i.test(file.name || '') &&
            !/-summary\.pdf$/i.test(file.name || '')
          ) || null;
          const summaryReport = pdfs.find(file => /-summary\.pdf$/i.test(file.name || '')) || null;

          sendJson(res, 200, {
            folder: { id: folder.id, name: folder.name, webViewLink: folder.webViewLink || '' },
            fullReport,
            summaryReport,
            pdfCount: pdfs.length,
            files: pdfs
          });
          status = 200;
          return;
        }
        if (req.method === 'GET' && pathname === '/api/admin/report-test') {
          const connectionId = validatedPositiveDecimalId(url.searchParams.get('connectionId'), 'Spectora connection ID');
          const address = String(url.searchParams.get('address') || '').trim();
          const date = String(url.searchParams.get('date') || '').trim();

          if (!address || address.length > 200) {
            sendJson(res, 400, { error: 'A property address is required' }); status = 400; return;
          }
          if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            sendJson(res, 400, { error: 'Date must use YYYY-MM-DD format' }); status = 400; return;
          }

          const streetAddress = address.split(',')[0].trim();
          const inspections = await fetchUpstream('Inspection lookup', query('/v2/inspections', {
            'filter[connection_id]': connectionId,
            'filter[address]': streetAddress,
            include: 'company,buying_agent,selling_agent,inspection_attachments',
            sort: '-datetime',
            'page[size]': '50'
          }));

          if (!Array.isArray(inspections.data)) throw authError('Upstream inspection lookup data missing', 502);
          assertInspectionScope(inspections.data, config.companyId, connectionId);

          const candidates = inspections.data.map(record => {
            const attrs = record.attributes || {};
            return {
              id: String(record.id || ''),
              datetime: attrs.datetime || '',
              fullAddress: attrs.full_address || [
                attrs.property_address,
                attrs.property_address_2,
                [attrs.property_city, attrs.property_state, attrs.property_zip].filter(Boolean).join(' ')
              ].filter(Boolean).join(', '),
              publishedAt: attrs.published_at || null,
              slug: attrs.slug || ''
            };
          });

          const selected = candidates.find(item => !date || String(item.datetime).slice(0, 10) === date) || null;
          if (!selected) {
            sendJson(res, 404, {
              error: 'Matching inspection not found',
              candidates
            });
            status = 404;
            return;
          }

          const attachmentResponse = await fetchUpstream('Inspection attachment lookup', query('/v2/inspection_attachments', {
            'filter[inspection_id]': selected.id,
            sort: '-created_at',
            'page[size]': '200'
          }));

          if (!Array.isArray(attachmentResponse.data)) throw authError('Upstream attachment data missing', 502);

          const attachments = attachmentResponse.data.map(record => {
            const attrs = record.attributes || {};
            return {
              id: String(record.id || ''),
              name: attrs.name || '',
              fileName: attrs.file_file_name || '',
              description: attrs.description || '',
              report: Boolean(attrs.report),
              internalOnly: Boolean(attrs.internal_only),
              fileUrl: attrs.file_url || '',
              attachmentType: attrs.attachment_type || '',
              createdAt: attrs.created_at || ''
            };
          });

          sendJson(res, 200, {
            inspection: selected,
            attachments,
            pdfAttachments: attachments.filter(item =>
              /\.pdf(?:$|\?)/i.test(item.fileName) ||
              /\.pdf(?:$|\?)/i.test(item.fileUrl)
            )
          });
          status = 200;
          return;
        }
        if (req.method === 'POST' && pathname === '/api/admin/report-link-test') {
          const body = await readJsonBody(req);
          const reportUrl = String(body.url || '').trim();
          const result = await fetchPublishedSpectoraReport(reportUrl);

          const plainText = htmlToPlainText(result.body);
          const titleMatch = result.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title = titleMatch ? htmlToPlainText(titleMatch[1]) : '';

          sendJson(res, 200, {
            statusCode: result.statusCode,
            contentType: result.contentType,
            title,
            htmlBytes: Buffer.byteLength(result.body, 'utf8'),
            textCharacters: plainText.length,
            containsAddress: /948\s+Glenangus\s+Dr/i.test(plainText),
            containsInspectionTerms: /(roof|electrical|plumbing|foundation|inspection|summary|defect)/i.test(plainText),
            textPreview: plainText.slice(0, 1200)
          });
          status = 200;
          return;
        }
        if (req.method === 'POST' && pathname === '/api/admin/report-api-test') {
          const body = await readJsonBody(req);
          const reportUrl = String(body.url || '').trim();
          const result = await fetchHermesPublicReport(reportUrl);

          const jsonShape = result.json ? summarizeJsonShape(result.json) : [];
          const serialized = result.json ? JSON.stringify(result.json) : result.body;
          const textPreview = serialized.slice(0, 5000);

          sendJson(res, 200, {
            reportUuid: result.reportUuid,
            statusCode: result.statusCode,
            contentType: result.contentType,
            responseBytes: Buffer.byteLength(result.body, 'utf8'),
            json: Boolean(result.json),
            topLevelKeys: result.json && typeof result.json === 'object' && !Array.isArray(result.json)
              ? Object.keys(result.json).slice(0, 80)
              : [],
            jsonShape,
            containsAddress: /948\s+Glenangus\s+Dr/i.test(serialized),
            containsReportContent: /(section|comment|defect|finding|observation|summary|roof|electrical|plumbing)/i.test(serialized),
            preview: textPreview
          });
          status = 200;
          return;
        }
        if (req.method === 'POST' && pathname === '/api/admin/report-network-test') {
          const body = await readJsonBody(req);
          const reportUrl = String(body.url || '').trim();
          const page = await fetchPublishedSpectoraReport(reportUrl);

          const scriptSources = extractScriptSources(page.body, page.finalUrl);
          const scannedScripts = [];
          const endpointCandidates = new Set();
          const likelyApiPaths = new Set();
          const bundleContexts = [];
          const hermesContexts = [];

          for (const scriptUrl of scriptSources.slice(0, 6)) {
            let parsed;
            try { parsed = new URL(scriptUrl); }
            catch { continue; }

            if (parsed.protocol !== 'https:' || !isAllowedSpectoraAssetHost(parsed.hostname)) {
              scannedScripts.push({
                url: scriptUrl,
                scanned: false,
                reason: 'External non-Spectora script'
              });
              continue;
            }

            try {
              const asset = await fetchSpectoraPublicAsset(scriptUrl);
              const scan = scanBundleEndpointCandidates(asset.body);
              for (const candidate of scan.candidates) endpointCandidates.add(candidate);
              for (const value of scan.likelyApiPaths || []) likelyApiPaths.add(value);
              for (const item of scan.contexts) bundleContexts.push(item);
              for (const item of scanHermesUsage(asset.body)) hermesContexts.push(item);
              scannedScripts.push({
                url: scriptUrl,
                scanned: true,
                statusCode: asset.statusCode,
                contentType: asset.contentType,
                bytes: Buffer.byteLength(asset.body, 'utf8'),
                candidateCount: scan.candidates.length,
                likelyApiPathCount: (scan.likelyApiPaths || []).length,
                contextCount: scan.contexts.length
              });
            } catch (error) {
              scannedScripts.push({
                url: scriptUrl,
                scanned: false,
                reason: error.message
              });
            }
          }

          sendJson(res, 200, {
            reportStatus: page.statusCode,
            scriptSources,
            scannedScripts,
            endpointCandidates: [...endpointCandidates].slice(0, 100),
            likelyApiPaths: [...likelyApiPaths].slice(0, 160),
            bundleContexts: bundleContexts.slice(0, 50),
            hermesContexts: hermesContexts.slice(0, 40)
          });
          status = 200;
          return;
        }
        if (req.method === 'POST' && pathname === '/api/admin/invite') {
          const body = await readJsonBody(req);
          const connectionId = validatedPositiveDecimalId(body.connectionId, 'Spectora connection ID');
          const connectionResponse = await fetchUpstream('Invite agent lookup', `/v2/connections/${encodeURIComponent(connectionId)}`);
          assertRecordId(connectionResponse.data, connectionId, 'connection');
          assertCompanyScope([connectionResponse.data], config.companyId);
          const ttlSeconds = 2_592_000;
          const grant = createGrant(connectionId, config.signingSecret, { ttlSeconds, now: nowSeconds() });
          const origin = resolvePortalOrigin(req, config);
          const inviteUrl = `${origin}/agent/${connectionId}#grant=${grant}`;
          sendJson(res, 200, { inviteUrl, expiresInDays: 30 }); status = 200; return;
        }
        sendJson(res, 405, { error: 'Admin operation not allowed' }); status = 405; return;
      }
      if (req.method === 'GET' && pathname.startsWith('/api/agent/')) {
        const connectionId = pathname.slice('/api/agent/'.length).split('/')[0];
        if (!connectionId) { sendJson(res, 400, { error: 'Missing connection ID' }); status = 400; return; }
        if (config.mode === 'live') {
          let grant;
          try {
            validatedPositiveDecimalId(connectionId, 'Spectora connection ID');
            grant = bearerToken(req);
            verifyGrant(grant, connectionId, config.signingSecret, { now: nowSeconds() });
          }
          catch (error) { status = error.statusCode || 401; sendJson(res, status, { error: error.message }); return; }
          const key = crypto.createHash('sha256').update(`${grant}:${connectionId}`).digest('hex');
          if (!allowRequest(key)) { sendJson(res, 429, { error: 'Rate limit exceeded' }); status = 429; return; }
        }
        const payload = await getAgentPayload(connectionId);
        if (!payload) { sendJson(res, 404, { error: 'Agent not found' }); status = 404; return; }
        sendJson(res, 200, payload); status = 200; return;
      }
      if (req.method === 'GET') { sendStatic(res, pathname); status = res.statusCode || res.status || 200; return; }
      sendJson(res, 405, { error: 'Method not allowed' }); status = 405;
    } catch (error) {
      status = Number(error.statusCode) || 502;
      if (!res.headersSent) {
        const payload = { error: status === 502 ? 'Upstream service unavailable' : error.message };
        if (status === 502 && error.safeDetail) payload.detail = error.safeDetail;
        sendJson(res, status, payload);
      } else res.destroy?.();
    } finally {
      const route = pathname === '/api/health'
        ? '/api/health'
        : (pathname.startsWith('/api/admin/')
            ? '/api/admin/:operation'
            : (pathname.startsWith('/api/agent/')
                ? '/api/agent/:id'
                : (pathname.startsWith('/agent/') ? '/agent/:id' : (pathname.startsWith('/admin') ? '/admin' : '/:static-or-not-found'))));
      log({ method: req.method, route, status, durationMs: Math.max(0, nowMs() - startedAt) });
    }
  }

  return { config, handleRequest, getAgentPayload };
}

function createServer(portal) {
  const server = http.createServer((req, res) => {
    Promise.resolve(portal.handleRequest(req, res)).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
      else res.destroy();
    });
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return server;
}

loadEnvFile();

let defaultPortal;

function getDefaultPortal() {
  if (!defaultPortal) defaultPortal = createPortal({ log: () => {} });
  return defaultPortal;
}

async function defaultHandler(req, res) {
  try {
    return await getDefaultPortal().handleRequest(req, res);
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: 'Portal configuration error',
        detail: error?.message || 'Unknown startup error'
      });
    } else {
      res.destroy?.();
    }
  }
}

if (require.main === module) {
  const portal = createPortal();
  const server = createServer(portal);
  server.listen(portal.config.port, () => console.log(`Agent Portal running at http://localhost:${portal.config.port} (${portal.config.mode} mode)`));
}

module.exports = defaultHandler;

Object.assign(module.exports, {
  SECURITY_HEADERS,
  SPECTORA_ORIGIN,
  UpstreamHttpError,
  createConfig,
  createGrant,
  verifyGrant,
  createHttpsUpstream,
  readUpstreamJson,
  createPortal,
  createServer,
  handleRequest: defaultHandler,
  readSampleAgent,
  mapInspection,
  loadEnvFile
});
