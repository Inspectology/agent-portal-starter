const assert = require('node:assert/strict');
const test = require('node:test');

const portal = require('../server');

const strongSecret = 'test-only-signing-secret-with-at-least-32-bytes';

test('configuration defaults to demo and live mode fails closed', () => {
  assert.equal(portal.createConfig({}).mode, 'demo');
  assert.throws(
    () => portal.createConfig({ PORTAL_MODE: 'live' }),
    /SPECTORA_API_KEY, SPECTORA_COMPANY_ID, and PORTAL_SIGNING_SECRET/
  );
  assert.throws(
    () => portal.createConfig({
      PORTAL_MODE: 'live',
      SPECTORA_API_KEY: 'test-key',
      SPECTORA_COMPANY_ID: '42',
      PORTAL_SIGNING_SECRET: 'short'
    }),
    /at least 32 bytes/
  );
  assert.throws(() => portal.createConfig({ PORTAL_MODE: 'staging' }), /PORTAL_MODE/);
  assert.throws(() => portal.createConfig({ BOOKING_URL: 'javascript:alert(1)' }), /HTTPS URL/);
});

test('HMAC grants expire and remain bound to one connection', () => {
  const now = 1_800_000_000;
  const grant = portal.createGrant('17', strongSecret, { now, ttlSeconds: 60 });

  assert.equal(portal.verifyGrant(grant, '17', strongSecret, { now: now + 59 }).connectionId, '17');
  assert.throws(() => portal.verifyGrant(grant, '18', strongSecret, { now }), error => error.statusCode === 403);
  assert.throws(() => portal.verifyGrant(grant, '17', strongSecret, { now: now + 61 }), error => error.statusCode === 401);
  assert.throws(() => portal.verifyGrant(`${grant.slice(0, -1)}x`, '17', strongSecret, { now }), error => error.statusCode === 401);
});

function invoke(handler, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = new (require('node:events').EventEmitter)();
    req.method = 'GET';
    req.url = pathname;
    req.headers = headers;
    req.socket = { remoteAddress: '127.0.0.1' };
    const res = {
      status: 200,
      headers: {},
      writeHead(status, responseHeaders = {}) {
        this.status = status;
        this.headers = Object.fromEntries(Object.entries(responseHeaders).map(([key, value]) => [key.toLowerCase(), value]));
      },
      end(body = '') { resolve({ status: this.status, headers: this.headers, body: String(body) }); }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const liveEnv = {
  PORTAL_MODE: 'live',
  SPECTORA_API_KEY: 'synthetic-test-api-key',
  SPECTORA_COMPANY_ID: '42',
  PORTAL_SIGNING_SECRET: strongSecret,
  COMPANY_NAME: 'Configured Inspectors'
};

test('live API requires connection grant, enforces company scope, and returns a PII-minimized DTO', async () => {
  const upstreamPaths = [];
  const upstreamGet = async path => {
    upstreamPaths.push(path);
    if (path === '/v2/connections/17') return { data: { id: '17', attributes: {
      company_id: '42', first_name: 'Avery', last_name: 'Agent', email: 'private@example.test',
      phone: '555-0100', agency_name: 'Example Realty', city: 'Sample City', state: 'FL', image: 'https://tracker.invalid/photo.jpg'
    } } };
    if (path.startsWith('/v2/connection_stats')) return { data: [{ id: '17', attributes: { company_id: '42', total_inspections_count: 1 } }] };
    return { data: [{
      id: 'inspection-1',
      attributes: {
        datetime: '2026-01-01T12:00:00Z', full_address: '123 Private Street, Sample City, FL',
        property_city: 'Sample City', property_state: 'FL', buyer_name: 'Private Client', quote: '700', slug: 'private-report',
        service_names: 'Buyer Inspection', inspector_name: 'Inspector', published_at: '2026-01-02T12:00:00Z'
      },
      relationships: {
        company: { data: { id: '42', type: 'company' } },
        buying_agent: { data: { id: '17', type: 'connection' } },
        selling_agent: { data: null }
      }
    }] };
  };
  const handler = portal.createPortal({ env: liveEnv, upstreamGet, now: () => 1_800_000_000, log: () => {} }).handleRequest;

  assert.equal((await invoke(handler, '/api/agent/17')).status, 401);
  const wrongGrant = portal.createGrant('18', strongSecret, { now: 1_800_000_000 });
  assert.equal((await invoke(handler, '/api/agent/17', { authorization: `Bearer ${wrongGrant}` })).status, 403);
  const grant = portal.createGrant('17', strongSecret, { now: 1_800_000_000 });
  const response = await invoke(handler, '/api/agent/17', { authorization: `Bearer ${grant}` });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.meta, { mode: 'live' });
  assert.equal(body.company.name, 'Configured Inspectors');
  const serialized = JSON.stringify(body);
  for (const forbidden of ['private@example.test', '555-0100', 'Private Client', '700', 'private-report', '123 Private Street', 'tracker.invalid']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(Object.hasOwn(body.agent, 'connectionId'), false);
  assert.equal(body.inspections[0].location, 'Sample City, FL');
  assert.deepEqual(upstreamPaths, [
    '/v2/connections/17',
    '/v2/connection_stats?filter[id]=17&page[size]=1',
    '/v2/inspections?filter[connection_id]=17&include=buying_agent%2Cselling_agent%2Ccompany&sort=-datetime&page[size]=50'
  ]);
});

test('frontend consumes fragment grant and remains an ordinary non-PWA web app', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(source, /location\.hash/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /Authorization.*Bearer/s);
  assert.match(source, /portalModeCopy\.modeNotice\(data\.meta\?\.mode\)/);
  assert.doesNotMatch(source, /serviceWorker|manifest\.webmanifest/);
  assert.doesNotMatch(html, /rel=["']manifest["']|manifest\.webmanifest/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'sw.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'manifest.webmanifest')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'icon-192.png')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'icon-512.png')), false);
});

test('customer notice copy is truthful for demo, live, and unknown modes', () => {
  const { modeNotice } = require('../public/mode-copy');
  assert.equal(modeNotice('demo'), 'Demonstration only: these are fictional records with non-specific locations.');
  assert.equal(modeNotice('live'), 'Live data: inspection history is limited to this authorized connection and company; locations are city/state only.');
  assert.equal(modeNotice('unexpected'), 'Data mode unavailable. Do not rely on this inspection history.');
});

test('portal-link CLI emits a fragment URL without printing the signing secret', () => {
  const { spawnSync } = require('node:child_process');
  const script = require('node:path').join(__dirname, '..', 'scripts', 'create-portal-link.js');
  const result = spawnSync(process.execPath, [script, '--connection-id', '17', '--origin', 'https://portal.example', '--ttl', '300'], {
    encoding: 'utf8',
    env: { ...process.env, PORTAL_SIGNING_SECRET: strongSecret }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^https:\/\/portal\.example\/agent\/17#grant=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(result.stdout.includes(strongSecret), false);
});

function httpGet(port, requestPath, headers = {}) {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: requestPath, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

function rawRequest(port, payload) {
  const net = require('node:net');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => socket.end(payload));
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
    socket.on('error', reject);
  });
}

test('HTTP server contains malformed and missing static requests and remains healthy', async t => {
  const instance = portal.createPortal({ env: {}, log: () => {} });
  const server = portal.createServer(instance);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;

  assert.equal((await httpGet(port, '/assets')).status, 404);
  assert.equal((await httpGet(port, '/missing.js')).status, 404);
  assert.equal((await httpGet(port, '/%E0%A4%A')).status, 400);
  assert.equal((await httpGet(port, '/api/health', { Host: '[' })).status, 200);
  const healthy = await httpGet(port, '/api/health');
  assert.equal(healthy.status, 200);
  assert.match(healthy.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(healthy.headers['x-content-type-options'], 'nosniff');
  assert.match(await rawRequest(port, 'BROKEN REQUEST\r\n\r\n'), /^HTTP\/1\.1 400 Bad Request/);
  assert.equal((await httpGet(port, '/api/health')).status, 200);
});

test('live API rate limiting is bounded and access logs omit connection IDs and grants', async () => {
  const entries = [];
  const env = { ...liveEnv, RATE_LIMIT_MAX: '2' };
  const handler = portal.createPortal({ env, upstreamGet: async () => ({ data: [] }), log: entry => entries.push(entry), now: () => 1_800_000_000 }).handleRequest;
  const grant = portal.createGrant('17', strongSecret, { now: 1_800_000_000 });
  const headers = { authorization: `Bearer ${grant}` };
  assert.equal((await invoke(handler, '/api/agent/17', headers)).status, 403);
  assert.equal((await invoke(handler, '/api/agent/17', headers)).status, 403);
  assert.equal((await invoke(handler, '/api/agent/17', headers)).status, 429);
  const logged = JSON.stringify(entries);
  assert.equal(logged.includes('17'), false);
  assert.equal(logged.includes(grant), false);
});

test('frontend agent routes use a redacted access-log template', async () => {
  const entries = [];
  const handler = portal.createPortal({ env: {}, log: entry => entries.push(entry) }).handleRequest;
  const connectionId = '987654321';
  assert.equal((await invoke(handler, `/agent/${connectionId}`)).status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(entries.at(-1).route, '/agent/:id');
  assert.equal(JSON.stringify(entries).includes(connectionId), false);
});

test('static and not-found access logs use a constant route without raw or encoded path data', async () => {
  const entries = [];
  let clock = 100;
  const handler = portal.createPortal({
    env: {},
    log: entry => entries.push(entry),
    nowMs: () => { clock += 5; return clock; }
  }).handleRequest;

  assert.equal((await invoke(handler, '/assets/alice@example.test.png?session=private')).status, 404);
  assert.equal((await invoke(handler, '/%73ensitive%2Fprivate-value?email=alice@example.test')).status, 404);

  assert.deepEqual(entries, [
    { method: 'GET', route: '/:static-or-not-found', status: 404, durationMs: 5 },
    { method: 'GET', route: '/:static-or-not-found', status: 404, durationMs: 5 }
  ]);
  const logged = JSON.stringify(entries);
  for (const sensitive of ['alice@example.test', 'private-value', '%73ensitive', 'session']) {
    assert.equal(logged.includes(sensitive), false, sensitive);
  }
});

test('upstream JSON reader rejects responses over the byte limit', async () => {
  const { PassThrough } = require('node:stream');
  const response = new PassThrough();
  response.statusCode = 200;
  const result = portal.readUpstreamJson(response, 8);
  response.end('{"too":"large"}');
  await assert.rejects(result, /size limit/);
});

test('white-label tagline reaches visible UI while configuration has no short-name surface', async () => {
  const defaults = await portal.createPortal({ env: {}, log: () => {} }).getAgentPayload('anything');
  assert.equal(defaults.company.name, 'Example Home Inspections');
  assert.equal(defaults.company.appName, 'Agent Portal');
  assert.equal(Object.hasOwn(defaults.company, ['short', 'Name'].join('')), false);
  assert.equal(Object.hasOwn(portal.createConfig({}).branding, ['short', 'Name'].join('')), false);
  assert.equal(defaults.agent.firstName, 'Taylor');

  const env = {
    PORTAL_APP_NAME: 'Acme Partner Hub',
    COMPANY_NAME: 'Acme Inspections', COMPANY_TAGLINE: 'Inspect with confidence', COMPANY_LICENSE: 'License EX123',
    COMPANY_PHONE: '(555) 010-1234', COMPANY_WEBSITE: 'https://acme.example', BOOKING_URL: 'https://acme.example/book',
    WHATSAPP_URL: 'https://wa.me/15550101234', BRAND_PRIMARY_COLOR: '#123456', BRAND_INK_COLOR: '#111111',
    BRAND_MUTED_COLOR: '#555555', BRAND_SURFACE_COLOR: '#ffffff', BRAND_BACKGROUND_COLOR: '#f4f4f4',
    BRAND_BORDER_COLOR: '#dddddd', BRAND_SUCCESS_COLOR: '#006633', BRAND_FOCUS_COLOR: '#0044cc',
    DEMO_AGENT_FIRST_NAME: 'Casey', DEMO_AGENT_LAST_NAME: 'Example', DEMO_AGENT_AGENCY: 'Acme Realty',
    DEMO_AGENT_CITY: 'Example City', DEMO_AGENT_STATE: 'OR', DEMO_AGENT_PHOTO_PATH: '/assets/custom-agent.png',
    DEMO_TIER_LABEL: 'Preferred Partner'
  };
  const instance = portal.createPortal({ env, log: () => {} });
  const body = await instance.getAgentPayload('demo');
  assert.equal(body.company.name, 'Acme Inspections');
  assert.equal(body.company.appName, 'Acme Partner Hub');
  assert.equal(body.company.tagline, 'Inspect with confidence');
  assert.equal(body.company.brand.primary, '#123456');
  assert.equal(body.company.brand.border, '#dddddd');
  assert.equal(body.agent.firstName, 'Casey');
  assert.equal(body.agent.agency, 'Acme Realty');
  assert.equal(body.agent.photoUrl, '/assets/custom-agent.png');
  assert.equal(body.tier.label, 'Preferred Partner');
  const appSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(appSource, /company\.brand\.primary/);
  assert.match(appSource, /el\('p', \{ class: 'company-tagline', text: company\.tagline \}\)/);
});
