'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyVendor,
  createVendorIntakePlan,
  extractStreetCandidates,
  normalizeStreet,
  selectInspectionMatch
} = require('../ops/vendor-intake');

function inspection(id, address, services, datetime = '2026-09-24T13:00:00Z') {
  return {
    id: String(id),
    attributes: {
      full_address: address,
      property_address: address.split(',')[0],
      service_names: services,
      datetime,
      canceled_at: null,
      cancel_reason: null
    }
  };
}

test('classifies Lynn Pest termite email', () => {
  const result = classifyVendor({
    from: 'Lynn Pest Management <lynnpestmgmt@gmail.com>',
    subject: 'WDO report - 123 Main Street'
  });
  assert.equal(result.vendor.key, 'termite');
  assert.equal(result.ambiguous, false);
});

test('distinguishes septic from Atlantic Blue email address using service language', () => {
  const result = classifyVendor({
    from: 'Kaitlyn <kaitlyn@atlanticblue.net>',
    subject: 'Septic inspection report for 5 Oak Lane'
  });
  assert.equal(result.vendor.key, 'septic');
});

test('extracts a street address from attachment filename', () => {
  const result = extractStreetCandidates({
    filenames: ['Termite Report - 948 Glenangus Dr.pdf']
  });
  assert.equal(result[0].normalized, normalizeStreet('948 Glenangus Dr'));
});

test('selects one exact address match and refuses ambiguity', () => {
  const message = {
    subject: 'Report - 123 Oak Meadow Ln',
    receivedAt: '2026-09-25T12:00:00Z'
  };

  const exact = selectInspectionMatch({
    message,
    vendor: classifyVendor({
      from: 'lynnpestmgmt@gmail.com',
      subject: 'Termite Report - 123 Oak Meadow Ln'
    }).vendor,
    inspections: [
      inspection(1, '123 Oak Meadow Ln, Westminster, MD 21157', 'Home Inspection, Termite / WDO'),
      inspection(2, '999 Other Rd, Westminster, MD 21157', 'Home Inspection')
    ]
  });

  assert.equal(exact.matched, true);
  assert.equal(exact.inspection.id, '1');

  const ambiguous = selectInspectionMatch({
    message,
    vendor: exact.inspection && classifyVendor({
      from: 'lynnpestmgmt@gmail.com',
      subject: 'Termite Report - 123 Oak Meadow Ln'
    }).vendor,
    inspections: [
      inspection(1, '123 Oak Meadow Ln, Westminster, MD 21157', 'Home Inspection, Termite / WDO'),
      inspection(3, '123 Oak Meadow Ln, Westminster, MD 21157', 'Home Inspection, Termite / WDO')
    ]
  });

  assert.equal(ambiguous.matched, false);
});

test('creates upload plan only when address, vendor, type and duplicate checks pass', () => {
  const plan = createVendorIntakePlan({
    message: {
      from: 'Kaitlyn <kaitlyn@atlanticblue.net>',
      subject: 'Water Testing Report - 45 Pine View Ct',
      filenames: ['45 Pine View Ct Water Report.pdf'],
      receivedAt: '2026-09-25T12:00:00Z'
    },
    inspections: [
      inspection(9, '45 Pine View Ct, Westminster, MD 21157', 'Home Inspection, Well & Water Testing')
    ],
    existingAttachments: []
  });

  assert.equal(plan.action, 'upload');
  assert.equal(plan.vendor.key, 'well_water');
  assert.equal(plan.attachmentType, 'water');
  assert.equal(plan.inspection.id, '9');
});
