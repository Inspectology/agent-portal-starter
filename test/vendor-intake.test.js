'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyDocument,
  classifyVendor,
  createVendorIntakePlan,
  extractInvoiceData,
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

test('recognizes direct Young Septic report sender', () => {
  const result = classifyVendor({
    from: 'Anna Schneider <anna@youngseptic.com>',
    subject: 'Septic Inspection Report for 1349 Quaker Church Road, Street, MD, 21154',
    filenames: ['1349 Quaker Church Road.pdf']
  });
  assert.equal(result.vendor.key, 'septic');
});

test('recognizes Atlantic Blue lab water result pattern', () => {
  const result = classifyVendor({
    from: 'AB Lab <ablab@atlanticblue.net>',
    subject: 'AB - Water test results',
    body: 'Attached you will find the water test results for 17505 Pretty Boy Dam Road.',
    filenames: ['17505 PRETTYBOY DAM ROAD WATER TEST RESULTS - AB - FVAL.pdf']
  });
  assert.equal(result.vendor.key, 'well_water');
  assert.equal(classifyDocument({
    subject: 'AB - Water test results',
    filenames: ['17505 PRETTYBOY DAM ROAD WATER TEST RESULTS - AB - FVAL.pdf']
  }, result.vendor).type, 'report');
});

test('Lynn invoice is ledger-only and not an upload', () => {
  const message = {
    from: 'lynnpestmgmt@gmail.com',
    subject: 'Invoice 9-3792 from L&J Lynn LLC',
    body: 'Invoice Due: Tue, 09/22/2026 9-3792 Amount Due: $100.00',
    attachmentText: 'Invoice #\\n9-3792\\nProject\\n948 Glenangus Dr 21015\\nBalance Due\\n$100.00',
    filenames: ['Inv_93792_from_LJ_Lynn_LLC_15676.pdf']
  };
  const vendor = classifyVendor(message).vendor;
  assert.equal(classifyDocument(message, vendor).type, 'invoice');

  const plan = createVendorIntakePlan({
    message,
    inspections: []
  });
  assert.equal(plan.action, 'ledger');
  assert.equal(plan.invoice.amount, 100);
  assert.equal(plan.invoice.project, '948 Glenangus Dr 21015');
});

test('Atlantic Blue booking disclaimer is ignored', () => {
  const message = {
    from: 'Kaitlyn <kaitlyn@atlanticblue.net>',
    subject: 'Booking Confirmation - 17505 Pretty Boy Dam Road',
    body: 'You have appointments with Atlantic Blue and Young Septic.',
    filenames: ['Well Yield Disclaimer.pdf']
  };
  const classified = classifyVendor(message);
  const document = classifyDocument(message, classified.vendor);
  assert.equal(document.type, 'ignore');

  const plan = createVendorIntakePlan({
    message,
    inspections: []
  });
  assert.equal(plan.action, 'ignore');
});

test('extracts invoice amount, project and invoice number from parsed PDF text', () => {
  const invoice = extractInvoiceData(
    'Invoice\\nDate\\n9/22/2026\\nInvoice #\\n9-3792\\nProject\\n948 Glenangus Dr 21015\\nBalance Due\\n$100.00'
  );
  assert.equal(invoice.amount, 100);
  assert.equal(invoice.project, '948 Glenangus Dr 21015');
  assert.equal(invoice.invoiceNumber, '9-3792');
});

