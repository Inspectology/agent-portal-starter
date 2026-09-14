const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const samplePath = path.join(repoRoot, 'data', 'sample-agent.json');

test('sample agent data is complete and public-safe', () => {
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  assert.equal(sample.agent.uuid, 'demo-platinum-partner');
  assert.ok(sample.agent.firstName);
  assert.ok(sample.agent.lastName);
  assert.ok(sample.agent.photoUrl);
  assert.ok(sample.company.name);
  assert.equal(new URL(sample.company.website).origin, 'https://example.com');
  assert.equal(new URL(sample.company.bookingUrl).origin, 'https://example.com');
  assert.equal(new URL(sample.company.whatsappUrl).origin, 'https://example.com');
  assert.ok(sample.stats.totalInspections > 0);
  assert.ok(Array.isArray(sample.inspections));
  assert.ok(sample.inspections.length >= 10);
});

test('sample data does not contain private organization or real partner identifiers', () => {
  const serialized = fs.readFileSync(samplePath, 'utf8');
  const blocked = [
    ['private', 'brand', 'placeholder'].join('-'),
    ['private', 'contact', 'placeholder'].join('-'),
    ['real', 'partner', 'placeholder'].join('-'),
    ['internal', 'system', 'placeholder'].join('-'),
    'spectora-api.env',
    'SPECTORA_API_KEY'
  ];

  for (const term of blocked) {
    assert.equal(serialized.includes(term), false, `blocked term leaked: ${term}`);
  }
});

test('sample inspections use fictional addresses and clients', () => {
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  for (const inspection of sample.inspections) {
    assert.match(inspection.id, /^demo-insp-/);
    assert.match(inspection.address, /(Withheld|Example|Sample|Fictional|Demo|Mock)/);
    assert.match(inspection.client, /(Sample|Demo|Mock|Example)/);
    assert.equal(Object.hasOwn(inspection, 'reportUrl'), false);
    assert.equal(Object.hasOwn(inspection, 'slug'), false);
    assert.equal(Object.hasOwn(inspection, 'quote'), false);
  }
});

function relativeLuminance(hex) {
  return [1, 3, 5]
    .map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('default muted text exceeds 4.5 to 1 against surface and background', () => {
  const { brand } = JSON.parse(fs.readFileSync(samplePath, 'utf8')).company;
  assert.ok(contrastRatio(brand.muted, brand.surface) > 4.5);
  assert.ok(contrastRatio(brand.muted, brand.background) > 4.5);
});
