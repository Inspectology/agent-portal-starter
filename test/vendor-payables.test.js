'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildVendorPayablesReport,
  expectedPrice
} = require('../ops/vendor-payables');

function inspection(address, date = '2026-10-01T09:00:00-04:00') {
  return {
    id: '11800001',
    attributes: {
      full_address: address,
      datetime: date,
      service_names:
        'Single-Family Home Inspection | Potability Water Sampling (Atlantic Blue), ' +
        '3-6 Hour Well Yield BALTIMORE County (Atlantic Blue)'
    }
  };
}

test('Atlantic Blue recognizes Baltimore County yield when yield appears before county', () => {
  const pricing = expectedPrice(
    { key: 'well_water' },
    inspection('14210 Greencroft Ln, Cockeysville, MD 21030')
  );

  assert.equal(pricing.amount, 595);
  assert.equal(pricing.confidence, 'high');
});

test('Atlantic Blue payroll keeps contracted rate when a partial invoice differs', () => {
  const item = inspection('1202 Western Run Rd, Cockeysville, MD 21030', '2026-10-10T09:00:00-04:00');
  const report = buildVendorPayablesReport({
    inspections: [item],
    activities: [
      {
        receivedAt: '2026-10-07T20:16:48.604Z',
        entryType: 'Report',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: item.attributes.full_address,
        spectoraInspectionId: item.id,
        status: 'Matched'
      },
      {
        receivedAt: '2026-10-07T20:14:33.940Z',
        entryType: 'Invoice',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '1202 Western Run Road, Cockeysville, MD 21030 USA',
        vendorCost: 442.85,
        invoiceNumber: '443753336',
        status: 'Received'
      }
    ],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  const atlanticBlue = report.rows.find(row => row.vendor === 'Atlantic Blue');
  assert.ok(atlanticBlue);
  assert.equal(atlanticBlue.amountDue, 595);
  assert.equal(atlanticBlue.status, 'Needs Review');
  assert.match(atlanticBlue.notes, /442\.85/);
  assert.match(atlanticBlue.notes, /595\.00/);
});
