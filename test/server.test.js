const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { handleRequest } = require('../server');

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = pathname;
    req.headers = { host: 'localhost:3005' };

    const res = {
      status: 200,
      headers: {},
      writeHead(status, headers = {}) {
        this.status = status;
        this.headers = Object.fromEntries(
          Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
        );
      },
      end(body = '') {
        resolve({
          status: this.status,
          headers: this.headers,
          body: Buffer.isBuffer(body) ? body.toString('utf8') : String(body)
        });
      }
    };

    Promise.resolve(handleRequest(req, res)).catch(reject);
  });
}

test('health endpoint reports demo mode by default', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.status, 'ok');
  assert.equal(body.mode, 'demo');
});

test('demo agent endpoint returns sample data with no report links or quotes', async () => {
  const response = await request('/api/agent/demo-platinum-partner');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const body = JSON.parse(response.body);
  assert.equal(body.agent.uuid, 'demo-platinum-partner');
  assert.equal(body.agent.connectionId, 'demo');
  assert.deepEqual(body.meta, { mode: 'demo' });
  assert.equal(body.inspections.some(item => Object.hasOwn(item, 'quote')), false);
  assert.equal(body.inspections.some(item => Object.hasOwn(item, 'reportUrl')), false);
});

test('app shell is served for agent routes', async () => {
  const response = await request('/agent/demo-platinum-partner');
  assert.equal(response.status, 200);
  assert.match(response.body, /Agent Portal/);
});
