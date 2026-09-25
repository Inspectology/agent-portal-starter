'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseVendorActivityRows,
  summarizeVendorActivity,
  vendorActivityRow
} = require('../ops/google-sheets-ledger');

test('vendor activity row preserves cost and status', () => {
  const row = vendorActivityRow({
    receivedAt: '2026-09-23T12:12:43-04:00',
    vendor: 'Lynn Pest Management',
    service: 'Termite / WDO',
    propertyAddress: '948 Glenangus Dr, Bel Air, MD 21015',
    spectoraInspectionId: '11801825',
    attachmentFilename: '948 Glenangus Dr 21015_0001.pdf',
    vendorCost: 100,
    status: 'Uploaded'
  });

  assert.equal(row[1], 'Lynn Pest Management');
  assert.equal(row[8], 100);
  assert.equal(row[9], 'Uploaded');
});

test('weekly summary groups vendor activity and totals cost', () => {
  const activities = parseVendorActivityRows([
    ['2026-09-22T12:00:00-04:00','Lynn Pest Management','Termite / WDO','1 Main St','1','','a','report.pdf',100,'Uploaded','','',''],
    ['2026-09-23T12:00:00-04:00','Lynn Pest Management','Termite / WDO','2 Main St','2','','b','report2.pdf',75,'Uploaded','','',''],
    ['2026-09-24T12:00:00-04:00','Young Septic','Septic','3 Main St','3','','c','septic.pdf',250,'Needs Review','','','']
  ]);

  const summary = summarizeVendorActivity(activities, {
    start: '2026-09-21T00:00:00-04:00',
    end: '2026-09-27T23:59:59-04:00'
  });

  const termite = summary.find(item => item.vendor === 'Lynn Pest Management');
  assert.equal(termite.inspectionCount, 2);
  assert.equal(termite.totalVendorCost, 175);

  const septic = summary.find(item => item.vendor === 'Young Septic');
  assert.equal(septic.needsReview, 1);
});
