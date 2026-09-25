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
    ai: {
      apiKey: String(env.OPENAI_API_KEY || '').trim(),
      model: String(env.OPENAI_MODEL || 'gpt-5.6-luna').trim(),
      rateLimitMax: boundedInteger(env.AI_RATE_LIMIT_MAX, 10, 1, 100),
      rateLimitWindowMs: boundedInteger(env.AI_RATE_LIMIT_WINDOW_MS, 60_000, 1000, 3_600_000)
    },
    profileNotifications: {
      resendApiKey: String(env.RESEND_API_KEY || '').trim(),
      to: String(env.PROFILE_CHANGE_EMAIL_TO || '').trim(),
      from: String(env.PROFILE_CHANGE_EMAIL_FROM || '').trim()
    },
    googleDrive: {
      projectNumber: String(env.GOOGLE_CLOUD_PROJECT_NUMBER || '').trim(),
      poolId: String(env.GOOGLE_WORKLOAD_IDENTITY_POOL_ID || '').trim(),
      providerId: String(env.GOOGLE_WORKLOAD_IDENTITY_PROVIDER_ID || '').trim(),
      serviceAccountEmail: String(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL || '').trim(),
      backupFolderId: String(env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || '').trim()
    },
    deploymentEnvironment: String(env.VERCEL_TARGET_ENV || env.VERCEL_ENV || '').trim().toLowerCase(),
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
  const host = String(req.headers.host || '').trim();
  if (!/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(host)) throw authError('Portal public origin is not configured', 500);

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto === 'http' && /^localhost(?::|$)/.test(host) ? 'http' : 'https';
  const requestOrigin = `${protocol}://${host}`;

  if (config.deploymentEnvironment && config.deploymentEnvironment !== 'production') {
    return requestOrigin;
  }

  return config.publicOrigin || requestOrigin;
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

async function googleDriveAccessToken(config, runtimeOidcToken = '') {
  const drive = config.googleDrive || {};
  const oidcToken = String(runtimeOidcToken || process.env.VERCEL_OIDC_TOKEN || '').trim();

  const missingDriveConfig = [
    ['GOOGLE_CLOUD_PROJECT_NUMBER', drive.projectNumber],
    ['GOOGLE_WORKLOAD_IDENTITY_POOL_ID', drive.poolId],
    ['GOOGLE_WORKLOAD_IDENTITY_PROVIDER_ID', drive.providerId],
    ['GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL', drive.serviceAccountEmail],
    ['GOOGLE_DRIVE_BACKUP_FOLDER_ID', drive.backupFolderId]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missingDriveConfig.length) {
    throw authError(`Google Drive Workload Identity is missing: ${missingDriveConfig.join(', ')}`, 503);
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

function normalizeDriveMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateToBackupLabels(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return [];
  const [year, month, day] = String(value).split('-');
  const m = String(Number(month));
  const d = String(Number(day));
  return [
    `${month}/${day}/${year}`,
    `${m}/${d}/${year}`,
    `${year}-${month}-${day}`
  ];
}

async function findGoogleDriveBackup(config, runtimeOidcToken, address, date) {
  const token = await googleDriveAccessToken(config, runtimeOidcToken);
  const rootFiles = await googleDriveListChildren(token, config.googleDrive.backupFolderId);
  const street = String(address || '').split(',')[0].trim();
  const normalizedStreet = normalizeDriveMatchText(street);
  const dateLabels = dateToBackupLabels(date);

  const folders = rootFiles.filter(file =>
    file.mimeType === 'application/vnd.google-apps.folder'
  );

  const folder = folders.find(file => {
    const name = String(file.name || '');
    return normalizeDriveMatchText(name).includes(normalizedStreet) &&
      dateLabels.some(label => name.includes(label));
  }) || null;

  if (!folder) return { token, folder: null, files: [], pdfs: [], fullReport: null, summaryReport: null };

  const files = await googleDriveListChildren(token, folder.id);
  const pdfs = files.filter(file => file.mimeType === 'application/pdf');
  const fullReport = pdfs.find(file =>
    /inspectology home inspection report/i.test(file.name || '') &&
    !/-summary\.pdf$/i.test(file.name || '')
  ) || null;
  const summaryReport = pdfs.find(file => /-summary\.pdf$/i.test(file.name || '')) || null;

  return { token, folder, files, pdfs, fullReport, summaryReport };
}

function googleDriveDownloadFile(accessToken, fileId, maxBytes = 30_000_000) {
  const id = encodeURIComponent(String(fileId || ''));
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`);

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 30_000
    }, response => {
      if (response.statusCode < 200 || response.statusCode > 299) {
        const statusCode = Number(response.statusCode || 0);
        response.resume();
        reject(new Error(`Google Drive file download returned HTTP ${statusCode}`));
        return;
      }

      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          reject(new Error('Inspection report PDF exceeded the AI file size limit'));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Google Drive file download timed out')));
    request.on('error', reject);
  });
}

async function sendProfileChangeNotification(config, connectionId, agent, changes) {
  const email = config.profileNotifications || {};
  if (!email.resendApiKey || !email.to || !email.from) {
    return { sent: false, reason: 'not_configured' };
  }

  const labels = {
    firstName: 'First name',
    lastName: 'Last name',
    agency: 'Brokerage / agency',
    phone: 'Phone',
    email: 'Email',
    city: 'City',
    state: 'State'
  };

  const changedLines = changes.map(change =>
    `${labels[change.field] || change.field}: "${change.oldValue || '(blank)'}" → "${change.newValue || '(blank)'}"`
  );

  const agentName = [agent.firstName, agent.lastName].filter(Boolean).join(' ') || 'Agent';
  const message = [
    'An agent updated information in the Inspectology Agent Dashboard.',
    '',
    `Agent: ${agentName}`,
    `Spectora connection ID: ${connectionId}`,
    `Current Spectora email: ${agent.email || '(none)'}`,
    '',
    'Requested profile updates:',
    ...changedLines,
    '',
    'Please review and update the agent record in Spectora as appropriate.'
  ].join('\n');

  const requestBody = JSON.stringify({
    from: email.from,
    to: [email.to],
    subject: `Agent profile update requested: ${agentName}`,
    text: message
  });

  const response = await requestJson(
    'https://api.resend.com/emails',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${email.resendApiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 15_000
    },
    requestBody,
    300_000
  );

  if (response.statusCode < 200 || response.statusCode > 299) {
    return { sent: false, reason: 'provider_error' };
  }

  return { sent: true };
}

function openAiOutputText(payload) {
  const parts = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

async function askOpenAiAboutReport(config, pdfBuffer, filename, question, history, inspection) {
  if (!config.ai.apiKey) throw authError('Inspectology AI is not configured yet', 503);

  const recentHistory = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map(item => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      text: String(item?.text || '').slice(0, 2000)
    }))
    .filter(item => item.text);

  const context = recentHistory.length
    ? recentHistory.map(item => `${item.role === 'assistant' ? 'Previous answer' : 'Previous question'}: ${item.text}`).join('\n\n')
    : 'No previous conversation context.';

  const instructions = [
    'You are Inspectology AI, a report-grounded assistant for a real estate agent.',
    'Use only the attached Inspectology inspection report as the factual source for property-specific answers.',
    'If the report does not state something, say that it is not stated in the report. Never guess.',
    'Do not advise whether a buyer should purchase, cancel, renegotiate, or make a legal or contractual decision.',
    'Do not invent repair prices, urgency, code violations, diagnoses, contractor conclusions, or severity labels that are not supported by the report.',
    'Clearly distinguish the inspector\'s written observation or recommendation from your own plain-language explanation.',
    'Whenever possible, cite the exact report section number and heading, such as "12.2.1 Attic - Structure & Sheathing".',
    'For broad questions such as major concerns, key findings, biggest issues, or summary: group related findings into short categories that fit the actual report, such as Water / Moisture, Electrical / Safety, Roof / Exterior, Plumbing, HVAC, or Other Notable Findings. Only include categories that are relevant.',
    'Within those grouped summaries, place first the findings that the report itself describes with stronger safety, active leak, fire, shock, moisture, inoperable safety mechanism, missing safety device, or similar language. Do not independently label an item major or severe if the report does not support that characterization.',
    'Avoid repeating the same defect in multiple places unless the different locations materially matter.',
    'Keep grouped summaries concise. Prefer the most useful 6 to 10 findings, then mention that additional documented items are available in the full report if relevant.',
    'Use simple plain-text headings and bullet points. Do not use markdown bold markers, tables, or code formatting.',
    'Keep answers useful to an agent, concise, and easy to relay to a client.',
    'End broad summaries with a brief reminder that the listed items come from the inspector\'s report and that the complete report, photos, limitations, and recommendations should be reviewed for context.'
  ].join(' ');

  const requestBody = JSON.stringify({
    model: config.ai.model,
    store: false,
    max_output_tokens: 1100,
    instructions,
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_file',
          filename: String(filename || 'inspection-report.pdf').slice(0, 180),
          file_data: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`
        },
        {
          type: 'input_text',
          text: [
            `Inspection: ${inspection.location || 'Property'}`,
            `Inspection date: ${inspection.date || ''}`,
            context,
            `Current question: ${question}`
          ].join('\n\n')
        }
      ]
    }]
  });

  const response = await requestJson(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ai.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 45_000
    },
    requestBody,
    2_000_000
  );

  if (response.statusCode < 200 || response.statusCode > 299 || !response.json) {
    const message = response.json?.error?.message || `OpenAI returned HTTP ${response.statusCode}`;
    throw new Error(message);
  }

  const answer = openAiOutputText(response.json);
  if (!answer) throw new Error('Inspectology AI returned an empty answer');

  return {
    answer,
    model: response.json.model || config.ai.model,
    usage: response.json.usage || null
  };
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
    id: String(insp.id || ''),
    date,
    datetime: attrs.datetime || '',
    location,
    services: [attrs.service_names, attrs.service_add_on_names].filter(Boolean).join(' + '),
    inspector: attrs.inspector_name || '',
    status: attrs.canceled_at ? 'Canceled' : (attrs.published_at ? 'Report Published' : 'Scheduled'),
    published: Boolean(attrs.published_at),
    canceled: Boolean(attrs.canceled_at),
    spectoraUrl: attrs.slug
      ? `https://portal.spectora.com/inspection/${encodeURIComponent(String(attrs.slug))}`
      : ''
  };
}

function validEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function collectStringFields(value, prefix = '', depth = 0, output = []) {
  if (depth > 4 || value == null) return output;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.push({ path: prefix, value: String(value) });
    return output;
  }

  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item, index) =>
      collectStringFields(item, `${prefix}[${index}]`, depth + 1, output)
    );
    return output;
  }

  if (typeof value === 'object') {
    Object.entries(value).slice(0, 80).forEach(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      collectStringFields(child, path, depth + 1, output);
    });
  }

  return output;
}

function resourceDisplayName(resource, fallback = '') {
  const attrs = resource?.attributes || {};
  const direct = [
    attrs.inspector_name,
    attrs.full_name,
    attrs.name,
    [attrs.first_name, attrs.last_name].filter(Boolean).join(' ')
  ].find(value => typeof value === 'string' && value.trim());

  return String(direct || fallback || '').trim();
}

const INSPECTOR_EMAIL_DIRECTORY = Object.freeze({
  'tiffany mercer': { name: 'Tiffany Mercer', email: 'tmercer@inspect-ology.com' },
  'joe heyne': { name: 'Joe Heyne', email: 'jheyne@inspect-ology.com' },
  'gregg rhodes': { name: 'Gregg Rhodes', email: 'grhodes@inspect-ology.com' },
  'mark kahan': { name: 'Mark Kahan', email: 'mkahan@inspect-ology.com' },
  'nick dinsmore': { name: 'Nick Dinsmore', email: 'ndinsmore@inspect-ology.com' },
  'jordan bird': { name: 'Jordan Bird', email: 'jordanbird@inspect-ology.com' }
});

function fallbackInspectorContacts(detail) {
  const inspectorName = String(detail?.data?.attributes?.inspector_name || '').trim().toLowerCase();
  if (!inspectorName) return [];

  return Object.entries(INSPECTOR_EMAIL_DIRECTORY)
    .filter(([name]) => inspectorName.includes(name))
    .map(([, contact]) => ({ ...contact }));
}

function mergeInspectorContacts(primary, fallback) {
  const merged = [];
  const seen = new Set();

  for (const contact of [...(primary || []), ...(fallback || [])]) {
    const email = validEmail(contact?.email);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      name: String(contact?.name || '').trim(),
      email
    });
  }

  return merged.slice(0, 8);
}

function inspectorContactsFromDetail(detail) {
  const inspection = detail?.data || {};
  const fallbackName = String(inspection.attributes?.inspector_name || '').trim();
  const contacts = [];
  const seenEmails = new Set();

  const addFromFields = (fields, name, requireInspectorPath = false) => {
    for (const field of fields) {
      if (!/email/i.test(field.path)) continue;
      if (requireInspectorPath && !/inspector/i.test(field.path)) continue;
      const email = validEmail(field.value);
      if (!email || seenEmails.has(email.toLowerCase())) continue;
      seenEmails.add(email.toLowerCase());
      contacts.push({ name: name || fallbackName, email });
    }
  };

  addFromFields(
    collectStringFields(inspection.attributes || {}),
    fallbackName,
    true
  );

  const assignmentRefs = Array.isArray(inspection.relationships?.assignments?.data)
    ? inspection.relationships.assignments.data
    : [];
  const assignmentKeys = new Set(
    assignmentRefs.map(ref => `${String(ref?.type || '')}:${String(ref?.id || '')}`)
  );
  const included = Array.isArray(detail?.included) ? detail.included : [];
  const byKey = new Map(included.map(resource => [
    `${String(resource?.type || '')}:${String(resource?.id || '')}`,
    resource
  ]));

  const assignments = included.filter(resource =>
    resource?.type === 'assignment' &&
    assignmentKeys.has(`assignment:${String(resource.id || '')}`)
  );

  for (const assignment of assignments) {
    const assignmentName = resourceDisplayName(assignment, fallbackName);
    addFromFields(
      collectStringFields(assignment.attributes || {}),
      assignmentName,
      false
    );

    for (const relationship of Object.values(assignment.relationships || {})) {
      const data = relationship?.data;
      const refs = Array.isArray(data) ? data : (data ? [data] : []);

      for (const ref of refs) {
        const type = String(ref?.type || '');
        if (!/(inspector|user|profile|employee|staff)/i.test(type)) continue;
        const related = byKey.get(`${type}:${String(ref?.id || '')}`);
        if (!related) continue;
        addFromFields(
          collectStringFields(related.attributes || {}),
          resourceDisplayName(related, assignmentName),
          false
        );
      }
    }
  }

  return contacts.slice(0, 8);
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
  const allowAiRequest = createRateLimiter({
    ...config,
    rateLimitMax: config.ai.rateLimitMax,
    rateLimitWindowMs: config.ai.rateLimitWindowMs
  }, nowMs);

  function authorizeAgentRequest(req, connectionId, options = {}) {
    if (config.mode !== 'live') return { grant: 'demo' };

    validatedPositiveDecimalId(connectionId, 'Spectora connection ID');
    const grant = bearerToken(req);
    verifyGrant(grant, connectionId, config.signingSecret, { now: nowSeconds() });

    const key = crypto.createHash('sha256').update(`${grant}:${connectionId}`).digest('hex');
    const allowed = options.ai ? allowAiRequest(key) : allowRequest(key);
    if (!allowed) throw authError(options.ai ? 'AI request rate limit exceeded' : 'Rate limit exceeded', 429);
    return { grant };
  }

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
      : (pathname === '/' || pathname === '/design-preview' || pathname.startsWith('/agent/') ? '/index.html' : pathname);
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
      if (req.method === 'GET' && pathname === '/api/design-preview') {
        const targetEnv = String(process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV || '').toLowerCase();
        if (targetEnv === 'production') {
          sendJson(res, 404, { error: 'Not found' }); status = 404; return;
        }
        const sample = applyCustomization(readSampleAgent(), config.branding, config.demoAgent, config.demoTier);
        const previewUpcoming = {
          id: 'demo-upcoming-1009',
          date: '2026-09-28',
          datetime: '2026-09-28T09:00:00-04:00',
          address: '123 Main Street, Westminster, MD 21157',
          location: '123 Main Street, Westminster, MD 21157',
          services: 'Home Inspection + Radon Testing',
          inspector: 'Inspectology Team',
          status: 'Scheduled',
          published: false,
          canceled: false,
          spectoraUrl: 'https://portal.spectora.com/inspection/design-preview'
        };
        sendJson(res, 200, {
          ...sample,
          inspections: [previewUpcoming, ...(sample.inspections || [])],
          meta: { mode: 'design-preview' }
        }); status = 200; return;
      }
      if (pathname.startsWith('/api/admin/')) {
        if (!config.adminAccessKey) {
          sendJson(res, 503, { error: 'Admin access is not configured' }); status = 503; return;
        }
        if (!adminAuthorized(req, config)) {
          sendJson(res, 401, { error: 'Invalid admin access key' }); status = 401; return;
        }
        if (req.method === 'GET' && pathname === '/api/admin/session') {
          const drive = config.googleDrive || {};
          const profileEmail = config.profileNotifications || {};
          sendJson(res, 200, {
            status: 'ok',
            readiness: {
              environment: config.deploymentEnvironment || config.mode || 'unknown',
              spectora: Boolean(
                config.mode === 'live' &&
                config.apiKey &&
                config.companyId &&
                config.signingSecret
              ),
              googleDrive: Boolean(
                drive.projectNumber &&
                drive.poolId &&
                drive.providerId &&
                drive.serviceAccountEmail &&
                drive.backupFolderId
              ),
              openAi: Boolean(config.ai?.apiKey),
              profileEmail: Boolean(
                profileEmail.resendApiKey &&
                profileEmail.to &&
                profileEmail.from
              ),
              adminAccess: Boolean(config.adminAccessKey)
            }
          });
          status = 200;
          return;
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

          const token = await googleDriveAccessToken(
            config,
            String(req.headers['x-vercel-oidc-token'] || '')
          );
          const rootFiles = await googleDriveListChildren(token, config.googleDrive.backupFolderId);
          const street = address.split(',')[0].trim();
          const normalizedStreet = normalizeDriveMatchText(street);
          const dateLabels = dateToBackupLabels(date);

          const folders = rootFiles.filter(file =>
            file.mimeType === 'application/vnd.google-apps.folder'
          );

          const matchingFolders = folders.filter(file => {
            const name = String(file.name || '');
            const normalizedName = normalizeDriveMatchText(name);
            const streetMatches = normalizedName.includes(normalizedStreet);
            const dateMatches = dateLabels.some(label => name.includes(label));
            return streetMatches && dateMatches;
          });

          if (!matchingFolders.length) {
            sendJson(res, 404, {
              error: 'No matching Spectora backup folder found',
              expectedStreet: street,
              expectedDateFormats: dateLabels,
              folderCount: folders.length,
              sampleFolders: folders.slice(0, 20).map(file => file.name)
            });
            status = 404;
            return;
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
      if (pathname.startsWith('/api/agent/')) {
        const parts = pathname.slice('/api/agent/'.length).split('/').filter(Boolean);
        const connectionId = parts[0] || '';
        const operation = parts[1] || '';
        if (!connectionId) { sendJson(res, 400, { error: 'Missing connection ID' }); status = 400; return; }

        try {
          authorizeAgentRequest(req, connectionId, { ai: operation === 'ask-report' });
        } catch (error) {
          status = error.statusCode || 401;
          sendJson(res, status, { error: error.message });
          return;
        }

        if (req.method === 'GET' && operation === '') {
          const payload = await getAgentPayload(connectionId);
          if (!payload) { sendJson(res, 404, { error: 'Agent not found' }); status = 404; return; }
          sendJson(res, 200, payload); status = 200; return;
        }

        if (req.method === 'GET' && operation === 'inspections-search') {
          const search = String(url.searchParams.get('q') || '').trim();
          if (search.length < 2 || search.length > 120) {
            sendJson(res, 400, { error: 'Search must be between 2 and 120 characters' }); status = 400; return;
          }

          if (config.mode === 'demo') {
            const sample = applyCustomization(readSampleAgent(), config.branding, config.demoAgent, config.demoTier);
            const normalized = search.toLowerCase();
            const matches = (sample.inspections || []).filter(item =>
              [item.address, item.location, item.city, item.state, item.date, item.inspector, item.services]
                .filter(Boolean)
                .some(value => String(value).toLowerCase().includes(normalized))
            );
            sendJson(res, 200, { inspections: matches.slice(0, 50) }); status = 200; return;
          }

          const inspections = await fetchUpstream('Inspection search', query('/v2/inspections', {
            'filter[connection_id]': connectionId,
            'filter[address]': search,
            include: 'buying_agent,selling_agent,company',
            sort: '-datetime',
            'page[size]': '50'
          }));

          if (!Array.isArray(inspections.data)) throw authError('Upstream inspection search data missing', 502);
          assertInspectionScope(inspections.data, config.companyId, connectionId);

          sendJson(res, 200, {
            inspections: inspections.data.map(mapInspection)
          });
          status = 200;
          return;
        }

        if (req.method === 'GET' && operation === 'inspector-contact') {
          const inspectionId = String(url.searchParams.get('inspectionId') || '').trim();
          if (!inspectionId) {
            sendJson(res, 400, { error: 'Inspection ID is required' }); status = 400; return;
          }

          if (config.mode === 'demo') {
            sendJson(res, 404, { error: 'Inspector contact is unavailable in demo mode' }); status = 404; return;
          }

          const detail = await fetchUpstream(
            'Inspection inspector lookup',
            `/v2/inspections/${encodeURIComponent(inspectionId)}?include=assignments,buying_agent,selling_agent,company`
          );

          assertRecordId(detail.data, inspectionId, 'inspection');
          assertInspectionScope([detail.data], config.companyId, connectionId);

          const contacts = mergeInspectorContacts(
            inspectorContactsFromDetail(detail),
            fallbackInspectorContacts(detail)
          );
          if (!contacts.length) {
            sendJson(res, 404, {
              error: 'Inspector email is not available for this inspection',
              inspectorName: String(detail.data?.attributes?.inspector_name || '')
            });
            status = 404;
            return;
          }

          sendJson(res, 200, {
            contacts,
            inspectorName: String(detail.data?.attributes?.inspector_name || '')
          });
          status = 200;
          return;
        }

        if (req.method === 'GET' && operation === 'report-status') {
          const inspectionId = String(url.searchParams.get('inspectionId') || '').trim();
          const payload = await getAgentPayload(connectionId);
          if (!payload) { sendJson(res, 404, { error: 'Agent not found' }); status = 404; return; }

          const inspection = (payload.inspections || []).find(item => String(item.id || '') === inspectionId);
          if (!inspection || !inspection.published) {
            sendJson(res, 404, { error: 'Published inspection not found for this agent' }); status = 404; return;
          }

          if (config.mode === 'demo') {
            sendJson(res, 200, { available: true, demo: true, inspection }); status = 200; return;
          }

          const backup = await findGoogleDriveBackup(
            config,
            String(req.headers['x-vercel-oidc-token'] || ''),
            inspection.location,
            inspection.date
          );

          sendJson(res, 200, {
            available: Boolean(backup.fullReport),
            folderFound: Boolean(backup.folder),
            reportName: backup.fullReport?.name || '',
            inspection
          });
          status = 200;
          return;
        }


        if (req.method === 'POST' && operation === 'profile-change') {
          const body = await readJsonBody(req, 16_000);
          const incoming = body.profile && typeof body.profile === 'object' ? body.profile : {};
          const previous = body.previousProfile && typeof body.previousProfile === 'object'
            ? body.previousProfile
            : {};
          const payload = await getAgentPayload(connectionId);
          if (!payload) { sendJson(res, 404, { error: 'Agent not found' }); status = 404; return; }

          const allowedFields = ['firstName', 'lastName', 'agency', 'phone', 'email', 'city', 'state'];
          const changes = [];

          for (const field of allowedFields) {
            if (!Object.hasOwn(incoming, field)) continue;
            const sourceValue = Object.hasOwn(previous, field)
              ? previous[field]
              : payload.agent?.[field];
            const oldValue = String(sourceValue || '').trim().slice(0, 240);
            const newValue = String(incoming[field] || '').trim().slice(0, 240);
            if (oldValue !== newValue) changes.push({ field, oldValue, newValue });
          }

          if (!changes.length) {
            sendJson(res, 200, { notificationSent: false, noChanges: true, changedFields: [] });
            status = 200;
            return;
          }

          if (config.mode === 'demo') {
            sendJson(res, 200, {
              notificationSent: true,
              demo: true,
              changedFields: changes.map(change => change.field)
            });
            status = 200;
            return;
          }

          const notification = await sendProfileChangeNotification(
            config,
            connectionId,
            payload.agent,
            changes
          );

          sendJson(res, 200, {
            notificationSent: notification.sent,
            notificationStatus: notification.reason || 'sent',
            changedFields: changes.map(change => change.field)
          });
          status = 200;
          return;
        }

        if (req.method === 'POST' && operation === 'ask-report') {
          const body = await readJsonBody(req, 24_000);
          const inspectionId = String(body.inspectionId || '').trim();
          const question = String(body.question || '').trim();
          const history = Array.isArray(body.history) ? body.history : [];

          if (!question || question.length > 1200) {
            sendJson(res, 400, { error: 'Question must be between 1 and 1200 characters' }); status = 400; return;
          }

          const payload = await getAgentPayload(connectionId);
          if (!payload) { sendJson(res, 404, { error: 'Agent not found' }); status = 404; return; }
          const inspection = (payload.inspections || []).find(item => String(item.id || '') === inspectionId);
          if (!inspection || !inspection.published) {
            sendJson(res, 404, { error: 'Published inspection not found for this agent' }); status = 404; return;
          }

          if (config.mode === 'demo') {
            sendJson(res, 200, {
              answer: 'Demo mode confirms the Ask Inspectology AI interface is working. Live answers will be grounded only in the selected inspection report and will cite report sections when available.',
              demo: true
            });
            status = 200;
            return;
          }

          const backup = await findGoogleDriveBackup(
            config,
            String(req.headers['x-vercel-oidc-token'] || ''),
            inspection.location,
            inspection.date
          );

          if (!backup.folder) {
            sendJson(res, 404, { error: 'Spectora backup folder is not available for this inspection yet' }); status = 404; return;
          }
          if (!backup.fullReport) {
            sendJson(res, 404, { error: 'Full inspection report PDF is not available to Inspectology AI yet' }); status = 404; return;
          }

          let pdf;
          try {
            pdf = await googleDriveDownloadFile(backup.token, backup.fullReport.id);
          } catch (error) {
            error.safeDetail = `Report download failed: ${error.message}`;
            throw error;
          }

          let result;
          try {
            result = await askOpenAiAboutReport(
              config,
              pdf,
              backup.fullReport.name,
              question,
              history,
              inspection
            );
          } catch (error) {
            error.safeDetail = `OpenAI request failed: ${error.message}`;
            throw error;
          }

          sendJson(res, 200, {
            answer: result.answer,
            model: result.model,
            usage: result.usage,
            reportName: backup.fullReport.name
          });
          status = 200;
          return;
        }

        sendJson(res, 405, { error: 'Agent operation not allowed' }); status = 405; return;
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
