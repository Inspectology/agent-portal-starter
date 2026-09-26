'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  receivedEmailToMessage,
  verifyResendWebhook
} = require('../ops/resend-inbound');

function signedHeaders(raw, secret, timestamp = 1_800_000_000, id = 'msg_test') {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signature = crypto
    .createHmac('sha256', key)
    .update(id + '.' + timestamp + '.' + raw)
    .digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': 'v1,' + signature
  };
}

test('verifies a valid Resend/Svix webhook signature', () => {
  const raw = '{"type":"email.received"}';
  const secret = 'whsec_' + Buffer.from('a sufficiently long webhook signing key').toString('base64');
  const timestamp = 1_800_000_000;
  assert.equal(
    verifyResendWebhook({
      rawBody: raw,
      headers: signedHeaders(raw, secret, timestamp),
      secret,
      nowMs: timestamp * 1000
    }),
    true
  );
});

test('rejects a modified webhook body', () => {
  const raw = '{"type":"email.received"}';
  const secret = 'whsec_' + Buffer.from('a sufficiently long webhook signing key').toString('base64');
  const timestamp = 1_800_000_000;
  assert.throws(() => verifyResendWebhook({
    rawBody: raw + ' ',
    headers: signedHeaders(raw, secret, timestamp),
    secret,
    nowMs: timestamp * 1000
  }));
});

test('converts received email metadata into Ivy intake shape', () => {
  const message = receivedEmailToMessage(
    {
      type: 'email.received',
      created_at: '2026-09-25T12:00:00Z',
      data: {
        email_id: 'email-1',
        from: 'AB Lab <ablab@atlanticblue.net>',
        to: ['ivy@example.resend.app'],
        subject: 'AB - Water test results'
      }
    },
    {
      text: 'Attached you will find the water test results for 123 Main St.'
    },
    [
      { id: 'att-1', filename: '123 MAIN ST WATER TEST RESULTS.pdf', content_type: 'application/pdf' }
    ]
  );

  assert.equal(message.sourceEmailId, 'email-1');
  assert.equal(message.subject, 'AB - Water test results');
  assert.deepEqual(message.filenames, ['123 MAIN ST WATER TEST RESULTS.pdf']);
});
