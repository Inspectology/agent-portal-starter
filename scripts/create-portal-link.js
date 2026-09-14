#!/usr/bin/env node
'use strict';

const { createGrant } = require('../server');

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

try {
  const connectionId = valueAfter('--connection-id');
  const originText = valueAfter('--origin');
  const ttlSeconds = Number(valueAfter('--ttl') || 3600);
  if (!connectionId || !originText) throw new Error('Usage: create-portal-link --connection-id ID --origin https://portal.example [--ttl 3600]');
  if (!/^[1-9][0-9]*$/.test(connectionId)) throw new Error('Spectora connection ID must be a positive decimal identifier');
  const origin = new URL(originText);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Origin must be a bare HTTPS origin');
  }
  const grant = createGrant(connectionId, process.env.PORTAL_SIGNING_SECRET, { ttlSeconds });
  process.stdout.write(`${origin.origin}/agent/${connectionId}#grant=${grant}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
