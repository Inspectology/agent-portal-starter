'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const portal = require('../server');
const secret = ['synthetic-signing', 'secret-with-at-least-32-bytes'].join('-');
const liveEnv = {
  PORTAL_MODE: 'live',
  SPECTORA_API_KEY: 'synthetic-api-key',
  SPECTORA_COMPANY_ID: '42',
  PORTAL_SIGNING_SECRET: secret
};

function invoke(handler, pathname, headers = {}, remoteAddress = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = pathname;
    req.headers = headers;
    req.socket = { remoteAddress };
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

function validUpstream(overrides = {}) {
  const connection = overrides.connection || { data: { id: '17', attributes: { company_id: '42', first_name: 'Avery' } } };
  const stats = overrides.stats || { data: [{ id: '17', attributes: { company_id: '42', total_inspections_count: 2 } }] };
  const inspections = overrides.inspections || { data: [{
    id: '81',
    attributes: { property_city: 'Example', property_state: 'OR' },
    relationships: {
      company: { data: { id: '42', type: 'company' } },
      buying_agent: { data: { id: '17', type: 'connection' } },
      selling_agent: { data: null }
    }
  }] };
  const paths = [];
  return {
    paths,
    get: async pathname => {
      paths.push(pathname);
      if (pathname === '/v2/connections/17') return connection;
      if (pathname.startsWith('/v2/connection_stats?')) return stats;
      if (pathname.startsWith('/v2/inspections?')) return inspections;
      throw new Error(`Unexpected upstream path: ${pathname}`);
    }
  };
}

function liveHandler(upstream, extraEnv = {}) {
  return portal.createPortal({
    env: { ...liveEnv, ...extraEnv },
    upstreamGet: upstream.get,
    now: () => 1_800_000_000,
    nowMs: () => 1_800_000_000_000,
    log: () => {}
  }).handleRequest;
}

function bearer(connectionId = '17') {
  return { authorization: `Bearer ${portal.createGrant(connectionId, secret, { now: 1_800_000_000 })}` };
}

test('live identifiers must be documented positive decimal IDs', () => {
  for (const value of ['0', '-1', '1.5', '01', 'company-42', '550e8400-e29b-41d4-a716-446655440000']) {
    assert.throws(() => portal.createConfig({ ...liveEnv, SPECTORA_COMPANY_ID: value }), /positive decimal/);
    assert.throws(() => portal.createGrant(value, secret), /positive decimal/);
  }
  assert.throws(() => portal.createConfig({ ...liveEnv, SPECTORA_COMPANY_ID: '' }), /requires SPECTORA_API_KEY/);
  assert.throws(() => portal.createGrant('', secret), /positive decimal/);
  assert.equal(portal.createConfig(liveEnv).companyId, '42');
  const grant = portal.createGrant('17', secret);
  assert.throws(() => portal.verifyGrant(grant, 'agent-17', secret), /positive decimal/);
});

test('live lookup uses the exact connection route and documented filters', async () => {
  const upstream = validUpstream();
  const response = await invoke(liveHandler(upstream), '/api/agent/17', bearer());
  assert.equal(response.status, 200, response.body);
  assert.deepEqual(upstream.paths, [
    '/v2/connections/17',
    '/v2/connection_stats?filter[id]=17&page[size]=1',
    '/v2/inspections?filter[connection_id]=17&include=buying_agent%2Cselling_agent%2Ccompany&sort=-datetime&page[size]=50'
  ]);
  assert.equal(Object.hasOwn(JSON.parse(response.body).agent, 'connectionId'), false);
});

for (const [recordKind, overrideKey, malformedCompany] of [
  ['connection', 'connection', { data: { id: '17', attributes: { company_id: '42' }, relationships: { company: { data: null } } } }],
  ['connection', 'connection', { data: { id: '17', attributes: { company_id: '42' }, relationships: { company: { data: [{ id: '42', type: 'company' }] } } } }],
  ['connection', 'connection', { data: { id: '17', attributes: { company_id: '42' }, relationships: { company: { data: { id: '42', type: 'connection' } } } } }],
  ['connection', 'connection', { data: { id: '17', attributes: { company_id: '42' }, relationships: { company: { data: { id: '99', type: 'company' } } } } }],
  ['stats', 'stats', { data: [{ id: '17', attributes: { company_id: '42' }, relationships: { company: { data: null } } }] }],
  ['stats', 'stats', { data: [{ id: '17', attributes: { company_id: '42' }, relationships: { company: { data: [{ id: '42', type: 'company' }] } } }] }],
  ['stats', 'stats', { data: [{ id: '17', attributes: { company_id: '42' }, relationships: { company: { data: { id: '42', type: 'connection' } } } }] }],
  ['stats', 'stats', { data: [{ id: '17', attributes: { company_id: '42' }, relationships: { company: { data: { id: '99', type: 'company' } } } }] }]
]) {
  test(`${recordKind} rejects a present malformed or conflicting company relationship`, async () => {
    const response = await invoke(liveHandler(validUpstream({ [overrideKey]: malformedCompany })), '/api/agent/17', bearer());
    assert.equal(response.status, 403, response.body);
  });
}

for (const [name, record] of [
  ['company resource with wrong type', { attributes: {}, relationships: {
    company: { data: { id: '42', type: 'connection' } }, buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
  } }],
  ['company resource with array data', { attributes: {}, relationships: {
    company: { data: [{ id: '42', type: 'company' }] }, buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
  } }],
  ['company resource with null data', { attributes: {}, relationships: {
    company: { data: null }, buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
  } }],
  ['buying agent resource with wrong type', { attributes: {}, relationships: {
    company: { data: { id: '42', type: 'company' } }, buying_agent: { data: { id: '17', type: 'company' } }, selling_agent: { data: null }
  } }],
  ['selling agent resource with wrong type', { attributes: {}, relationships: {
    company: { data: { id: '42', type: 'company' } }, buying_agent: { data: null }, selling_agent: { data: { id: '17', type: 'company' } }
  } }],
  ['buying agent resource with array data', { attributes: {}, relationships: {
    company: { data: { id: '42', type: 'company' } }, buying_agent: { data: [{ id: '17', type: 'connection' }] }, selling_agent: { data: null }
  } }],
  ['selling agent resource with array data', { attributes: {}, relationships: {
    company: { data: { id: '42', type: 'company' } }, buying_agent: { data: null }, selling_agent: { data: [{ id: '17', type: 'connection' }] }
  } }],
  ['missing buying agent despite matching seller', { attributes: {}, relationships: {
    company: { data: { id: '42', type: 'company' } }, selling_agent: { data: { id: '17', type: 'connection' } }
  } }],
  ['missing selling agent despite matching buyer', { attributes: {}, relationships: {
    company: { data: { id: '42', type: 'company' } }, buying_agent: { data: { id: '17', type: 'connection' } }
  } }],
  ['conflicting company attribute', { attributes: { company_id: '99' }, relationships: {
    company: { data: { id: '42', type: 'company' } }, buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
  } }]
]) {
  test(`inspection rejects ${name}`, async () => {
    const inspections = { data: [{ id: '81', ...record }] };
    const response = await invoke(liveHandler(validUpstream({ inspections })), '/api/agent/17', bearer());
    assert.equal(response.status, 403, response.body);
  });
}

test('live lookup rejects a same-company inspection linked only to another connection', async () => {
  const inspections = { data: [{
    id: '81',
    attributes: { property_city: 'Example', property_state: 'OR' },
    relationships: {
      company: { data: { id: '42', type: 'company' } },
      buying_agent: { data: { id: '18', type: 'connection' } },
      selling_agent: { data: null }
    }
  }] };
  const response = await invoke(liveHandler(validUpstream({ inspections })), '/api/agent/17', bearer());
  assert.equal(response.status, 403, response.body);
});

test('exact connection GET upstream 404 maps to portal 404', async () => {
  const upstream = validUpstream();
  upstream.get = async pathname => {
    upstream.paths.push(pathname);
    throw new portal.UpstreamHttpError(404);
  };
  const response = await invoke(liveHandler(upstream), '/api/agent/17', bearer());
  assert.equal(response.status, 404, response.body);
  assert.deepEqual(JSON.parse(response.body), { error: 'Agent not found' });
  assert.deepEqual(upstream.paths, ['/v2/connections/17']);
});

for (const failedRoute of ['connection_stats', 'inspections']) {
  test(`${failedRoute} upstream 404 remains a generic portal 502`, async () => {
    const upstream = validUpstream();
    const originalGet = upstream.get;
    upstream.get = async pathname => {
      if (pathname.startsWith(`/v2/${failedRoute}?`)) throw new portal.UpstreamHttpError(404);
      return originalGet(pathname);
    };
    const response = await invoke(liveHandler(upstream), '/api/agent/17', bearer());
    assert.equal(response.status, 502, response.body);
    assert.deepEqual(JSON.parse(response.body), { error: 'Upstream service unavailable' });
  });
}

test('live lookup accepts official-shaped buyer and seller relationship matches', async () => {
  const inspections = { data: [
    {
      id: '81', attributes: { property_city: 'Buyer City' }, relationships: {
        company: { data: { id: '42', type: 'company' } },
        buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
      }
    },
    {
      id: '82', attributes: { property_city: 'Seller City' }, relationships: {
        company: { data: { id: '42', type: 'company' } },
        buying_agent: { data: { id: '18', type: 'connection' } },
        selling_agent: { data: { id: '17', type: 'connection' } }
      }
    }
  ] };
  const response = await invoke(liveHandler(validUpstream({ inspections })), '/api/agent/17', bearer());
  assert.equal(response.status, 200, response.body);
  assert.deepEqual(JSON.parse(response.body).inspections.map(item => item.location), ['Buyer City', 'Seller City']);
});

test('connection and stats require company_id in attributes even when a relationship supplies it', async () => {
  const connection = {
    data: {
      id: '17',
      attributes: {},
      relationships: { company: { data: { id: '42', type: 'company' } } }
    }
  };
  const response = await invoke(liveHandler(validUpstream({ connection })), '/api/agent/17', bearer());
  assert.equal(response.status, 403, response.body);
});

for (const [name, overrides] of [
  ['connection record missing from a successful response', { connection: { data: null } }],
  ['connection identifier mismatch', { connection: { data: { id: '18', attributes: { company_id: '42' } } } }],
  ['connection company missing', { connection: { data: { id: '17', attributes: {} } } }],
  ['connection company mismatch', { connection: { data: { id: '17', attributes: { company_id: '99' } } } }],
  ['stats list missing', { stats: {} }],
  ['stats list empty', { stats: { data: [] } }],
  ['stats list ambiguous', { stats: { data: [
    { id: '17', attributes: { company_id: '42' } },
    { id: '17', attributes: { company_id: '42' } }
  ] } }],
  ['stats identifier missing', { stats: { data: [{ attributes: { company_id: '42' } }] } }],
  ['stats identifier mismatch', { stats: { data: [{ id: '18', attributes: { company_id: '42' } }] } }],
  ['stats company mismatch', { stats: { data: [{ id: '17', attributes: { company_id: '99' } }] } }],
  ['inspection company relationship missing', { inspections: { data: [{
    id: '81', attributes: {}, relationships: {
      buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
    }
  }] } }],
  ['inspection agent relationships missing', { inspections: { data: [{
    id: '81', attributes: {}, relationships: { company: { data: { id: '42', type: 'company' } } }
  }] } }],
  ['inspection buying relationship missing despite a valid seller', { inspections: { data: [{
    id: '81', attributes: {}, relationships: {
      company: { data: { id: '42', type: 'company' } },
      selling_agent: { data: { id: '17', type: 'connection' } }
    }
  }] } }],
  ['inspection agent relationship ambiguous', { inspections: { data: [{
    id: '81', attributes: {}, relationships: {
      company: { data: { id: '42', type: 'company' } },
      buying_agent: { data: [{ id: '17', type: 'connection' }] }, selling_agent: { data: null }
    }
  }] } }],
  ['inspection company relationship ambiguous', { inspections: { data: [{
    id: '81', attributes: {}, relationships: {
      company: { data: [{ id: '42', type: 'company' }] },
      buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
    }
  }] } }],
  ['one inspection in a mixed list crosses connection scope', { inspections: { data: [
    {
      id: '81', attributes: {}, relationships: {
        company: { data: { id: '42', type: 'company' } },
        buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
      }
    },
    {
      id: '82', attributes: {}, relationships: {
        company: { data: { id: '42', type: 'company' } },
        buying_agent: { data: null }, selling_agent: { data: { id: '18', type: 'connection' } }
      }
    }
  ] } }],
  ['one inspection in a mixed list crosses company scope', { inspections: { data: [
    {
      id: '81', attributes: {}, relationships: {
        company: { data: { id: '42', type: 'company' } },
        buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
      }
    },
    {
      id: '82', attributes: {}, relationships: {
        company: { data: { id: '99', type: 'company' } },
        buying_agent: { data: { id: '17', type: 'connection' } }, selling_agent: { data: null }
      }
    }
  ] } }]
]) {
  test(`live lookup fails closed on ${name}`, async () => {
    const response = await invoke(liveHandler(validUpstream(overrides)), '/api/agent/17', bearer());
    assert.equal(response.status, 403, response.body);
  });
}

test('invalid grants do not consume rate limit and valid grants share a token-bound bucket across socket addresses', async () => {
  const upstream = validUpstream();
  const handler = liveHandler(upstream, { RATE_LIMIT_MAX: '1' });
  assert.equal((await invoke(handler, '/api/agent/17', {}, '192.0.2.1')).status, 401);
  assert.equal((await invoke(handler, '/api/agent/17', { authorization: 'Bearer invalid.invalid' }, '192.0.2.2')).status, 401);
  assert.equal((await invoke(handler, '/api/agent/17', bearer(), '192.0.2.3')).status, 200);
  assert.equal((await invoke(handler, '/api/agent/17', bearer(), '192.0.2.4')).status, 429);
});

test('removed PWA endpoints and assets are not served', async () => {
  const instance = portal.createPortal({ env: {}, log: () => {} });
  assert.equal((await invoke(instance.handleRequest, '/manifest.webmanifest')).status, 404);
  assert.equal((await invoke(instance.handleRequest, '/sw.js')).status, 404);
});

test('portal creation rejects a symlink anywhere in the public tree', t => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-public-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-outside-'));
  t.after(() => {
    fs.rmSync(publicDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const outsideFile = path.join(outside, 'private.txt');
  const link = path.join(publicDir, 'nested', 'link.txt');
  fs.mkdirSync(path.dirname(link));
  fs.writeFileSync(outsideFile, 'outside fixture');
  fs.symlinkSync(outsideFile, link);
  assert.throws(() => portal.createPortal({ env: {}, publicDir, log: () => {} }), /non-regular|symlink/i);
});

test('static snapshot keeps original bytes after a validated file is swapped to an outside symlink', async t => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-public-race-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-outside-race-'));
  t.after(() => {
    fs.rmSync(publicDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const servedFile = path.join(publicDir, 'asset.txt');
  const outsideFile = path.join(outside, 'private.txt');
  fs.writeFileSync(servedFile, 'original public bytes');
  fs.writeFileSync(outsideFile, 'outside private bytes');
  const instance = portal.createPortal({ env: {}, publicDir, log: () => {} });
  fs.rmSync(servedFile);
  fs.symlinkSync(outsideFile, servedFile);

  const response = await invoke(instance.handleRequest, '/asset.txt');
  assert.equal(response.status, 200);
  assert.equal(response.body, 'original public bytes');
  assert.equal(response.body.includes('outside private bytes'), false);
});

test('upstream client fixes credential destination to the approved HTTPS origin', async () => {
  let captured;
  const transport = {
    get(url, options, callback) {
      captured = { url, options };
      const request = new EventEmitter();
      request.destroy = error => request.emit('error', error);
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = 200;
        callback(response);
        response.end('{}');
      });
      return request;
    }
  };
  const get = portal.createHttpsUpstream({ apiKey: 'destination-test-key', upstreamTimeoutMs: 250, upstreamMaxBytes: 1024 }, transport);
  await get('/v2/connections/17');
  assert.equal(captured.url.origin, portal.SPECTORA_ORIGIN);
  assert.equal(captured.url.href, `${portal.SPECTORA_ORIGIN}/v2/connections/17`);
  assert.equal(captured.options.headers.Authorization, 'Bearer destination-test-key');
  await assert.rejects(get('https://credentials.example.invalid/collect'), /Unapproved upstream origin/);
});

test('upstream client preserves HTTP status in a typed safe error', async () => {
  const transport = {
    get(_url, _options, callback) {
      const request = new EventEmitter();
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = 404;
        callback(response);
        response.end('sensitive upstream body');
      });
      return request;
    }
  };
  const get = portal.createHttpsUpstream({ apiKey: 'status-test-key', upstreamTimeoutMs: 250, upstreamMaxBytes: 1024 }, transport);
  await assert.rejects(get('/v2/connections/17'), error => {
    assert.equal(error instanceof portal.UpstreamHttpError, true);
    assert.equal(error.upstreamStatus, 404);
    assert.equal(error.message, 'Spectora API returned 404');
    assert.equal(error.message.includes('sensitive upstream body'), false);
    return true;
  });
});

test('upstream client destroys timed-out requests and rejects', async () => {
  const transport = {
    get(_url, options) {
      assert.equal(options.timeout, 100);
      const request = new EventEmitter();
      request.destroy = error => request.emit('error', error);
      queueMicrotask(() => request.emit('timeout'));
      return request;
    }
  };
  const get = portal.createHttpsUpstream({ apiKey: 'timeout-test-key', upstreamTimeoutMs: 100, upstreamMaxBytes: 1024 }, transport);
  await assert.rejects(get('/v2/connections/17'), /timeout/);
});

test('release automation pins external inputs and exercises the container', () => {
  const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.doesNotMatch(ci, /uses:\s+[^\s]+@v\d/);
  assert.match(ci, /actions\/checkout@[0-9a-f]{40}\s+# v4\.2\.2/);
  assert.match(ci, /actions\/setup-node@[0-9a-f]{40}\s+# v4\.4\.0/);
  assert.match(ci, /gitleaks\/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e\s+# v3\.0\.0/);
  assert.match(ci, /fetch-depth:\s*0/);
  assert.match(ci, /GITLEAKS_VERSION:\s*8\.24\.3/);
  assert.match(ci, /GITLEAKS_ENABLE_COMMENTS:\s*['"]false['"]/);
  assert.match(ci, /GITLEAKS_ENABLE_UPLOAD_ARTIFACT:\s*['"]false['"]/);
  assert.match(ci, /redact/i);
  assert.match(ci, /docker run/);
  assert.match(ci, /--entrypoint id[^\n]+ -u/);
  assert.match(ci, /api\/health/);
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^FROM node:20-alpine@sha256:[0-9a-f]{64}/m);
});
