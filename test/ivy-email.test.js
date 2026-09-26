'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IVY_IDENTITY,
  ivySignatureHtml,
  ivySignatureText,
  withIvySignature
} = require('../ops/ivy-email');

test('Ivy identity uses approved alias and title', () => {
  assert.equal(IVY_IDENTITY.email, 'ivy@inspect-ology.com');
  assert.equal(IVY_IDENTITY.title, 'Inspectology Virtual Operations Assistant');
});

test('Ivy signature contains core contact information', () => {
  const text = ivySignatureText();
  const html = ivySignatureHtml();
  const values = [
    'IVY',
    'Inspectology Virtual Operations Assistant',
    '410-693-5539',
    'ivy@inspect-ology.com',
    'www.inspect-ology.com',
    '4208 Sequoia Dr'
  ];

  for (const value of values) {
    assert.ok(text.includes(value));
    assert.ok(html.includes(value));
  }
});

test('every Ivy message gets the signature appended', () => {
  const result = withIvySignature({
    text: 'Hello, we received your report.',
    html: '<p>Hello, we received your report.</p>'
  });

  assert.ok(result.text.includes('Inspectology Virtual Operations Assistant'));
  assert.ok(result.html.includes('ivy@inspect-ology.com'));
  assert.ok(result.html.includes('Hello, we received your report.'));
});
