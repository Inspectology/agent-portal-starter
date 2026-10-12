'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildVendorPayablesReport,
  expectedPrice,
  sameAddress
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


test('Atlantic Blue preserves materially higher invoice totals for extra work', () => {
  const item = {
    id: '11855371',
    attributes: {
      full_address: '222 S River Clubhouse Rd, Edgewater, MD 21037',
      datetime: '2026-10-05T09:30:00-04:00',
      service_names:
        'Single-Family Home Inspection | 1 Hour Modified Well Yield (Atlantic Blue), ' +
        'Potability Water Sampling (Atlantic Blue)'
    }
  };

  const report = buildVendorPayablesReport({
    inspections: [item],
    activities: [
      {
        receivedAt: '2026-10-06T15:40:27.559Z',
        entryType: 'Invoice',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '222 South River Clubhouse Road, Edgewater, MD 21037 USA',
        vendorCost: 320,
        invoiceNumber: '443319515',
        status: 'Received'
      },
      {
        receivedAt: '2026-10-06T17:15:12.196Z',
        entryType: 'Invoice',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '222 South River Clubhouse Road, Edgewater, MD 21037 USA',
        vendorCost: 390,
        invoiceNumber: '443212000',
        status: 'Received'
      }
    ],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  const atlanticBlue = report.rows.find(row => row.vendor === 'Atlantic Blue');
  assert.ok(atlanticBlue);
  assert.equal(atlanticBlue.amountDue, 710);
  assert.equal(atlanticBlue.status, 'Missing Report');
});


test('Lynn invoice addresses match by street even when one side includes city and ZIP', () => {
  assert.equal(
    sameAddress(
      '4539 Amos Rd 21161',
      '4539 Amos Rd, White Hall, MD 21161'
    ),
    true
  );
  assert.equal(
    sameAddress(
      '9406 Dartmouth Rd 21045',
      '9406 Dartmouth Rd, Columbia, MD 21045'
    ),
    true
  );
});

test('vendor schedule outside pay period excludes the vendor row', () => {
  const item = {
    id: '11800002',
    attributes: {
      full_address: '1027 Trickling Brook Rd, Cockeysville, MD 21030',
      datetime: '2026-10-11T10:00:00-04:00',
      service_names: 'Single-Family Home Inspection | Termite Inspection'
    }
  };

  const report = buildVendorPayablesReport({
    inspections: [item],
    activities: [
      {
        receivedAt: '2026-10-07T15:27:33Z',
        entryType: 'Scheduled',
        vendor: 'Lynn Pest Management',
        service: 'Termite / WDO',
        propertyAddress: item.attributes.full_address,
        inspectionDate: '2026-10-12',
        status: 'Scheduled'
      }
    ],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  assert.equal(
    report.rows.some(row => row.vendor === 'Lynn Pest Management'),
    false
  );
});

test('vendor schedule inside pay period keeps a missing-report row', () => {
  const item = {
    id: '11800003',
    attributes: {
      full_address: '3010 N Branch Ln, Parkville, MD 21234',
      datetime: '2026-10-09T13:30:00-04:00',
      service_names: 'Row Home / Town Home Inspection | Termite Inspection'
    }
  };

  const report = buildVendorPayablesReport({
    inspections: [item],
    activities: [
      {
        receivedAt: '2026-10-08T20:22:17Z',
        entryType: 'Scheduled',
        vendor: 'Lynn Pest Management',
        service: 'Termite / WDO',
        propertyAddress: item.attributes.full_address,
        inspectionDate: '2026-10-10',
        status: 'Scheduled'
      }
    ],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  const row = report.rows.find(entry => entry.vendor === 'Lynn Pest Management');
  assert.ok(row);
  assert.equal(row.serviceDate, '2026-10-10');
  assert.equal(row.status, 'Missing Report');
});

test('canceled Spectora inspection only includes vendors with completion evidence', () => {
  const item = {
    id: '11773177',
    attributes: {
      full_address: '11315 John Carroll Rd, Owings Mills, MD 21117',
      datetime: '2026-09-29T09:00:00-04:00',
      canceled_at: '2026-09-28T12:00:00-04:00',
      service_names:
        'Single-Family Home Inspection | Termite Inspection, Chimney Inspection, Septic Inspection (Young Septic)'
    }
  };

  const report = buildVendorPayablesReport({
    inspections: [item],
    activities: [
      {
        receivedAt: '2026-09-30T12:21:44Z',
        entryType: 'Report',
        vendor: 'Young Septic',
        service: 'Septic',
        propertyAddress: item.attributes.full_address,
        spectoraInspectionId: item.id,
        inspectionDate: item.attributes.datetime,
        status: 'Matched'
      }
    ],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  assert.equal(report.rows.some(row => row.vendor === 'Young Septic'), true);
  assert.equal(report.rows.some(row => row.vendor === 'Lynn Pest Management'), false);
  assert.equal(report.rows.some(row => row.vendor === 'Cambro Services'), false);
});


test('septic rollover does not pull Atlantic Blue activity from the same old inspection', () => {
  const report = buildVendorPayablesReport({
    inspections: [],
    activities: [
      {
        receivedAt: '2026-09-24T12:41:00Z',
        entryType: 'Scheduled',
        vendor: 'Young Septic',
        service: 'Septic Inspection',
        propertyAddress: '1530 Providence Rd, Towson, MD 21286',
        spectoraInspectionId: '11821353',
        inspectionDate: '2026-09-28',
        status: 'Scheduled'
      },
      {
        receivedAt: '2026-09-28T16:57:02Z',
        entryType: 'Report',
        vendor: 'Young Septic',
        service: 'Septic',
        propertyAddress: '1530 Providence Rd, Towson, MD 21286',
        spectoraInspectionId: '11821353',
        inspectionDate: '2026-09-24T09:00:00-04:00',
        status: 'Matched'
      },
      {
        receivedAt: '2026-09-25T14:33:45Z',
        entryType: 'Invoice',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '1530 Providence Road, Towson, MD 21286',
        vendorCost: 160,
        invoiceNumber: '441902074',
        status: 'Received'
      }
    ],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  assert.equal(report.rows.some(row => row.vendor === 'Atlantic Blue'), false);
  const septic = report.rows.find(row => row.vendor === 'Young Septic');
  assert.ok(septic);
  assert.equal(septic.amountDue, 325);
  assert.equal(septic.serviceDate, '2026-09-28');
});

test('Pretty Boy rollover includes only the current Atlantic Blue add-on', () => {
  const report = buildVendorPayablesReport({
    inspections: [],
    activities: [
      {
        receivedAt: '2026-09-30T12:41:09Z',
        entryType: 'Scheduled',
        vendor: 'Atlantic Blue',
        service: 'Radon in Water Add-on',
        propertyAddress: '17505 Pretty Boy Dam Rd, Parkton, MD 21120',
        spectoraInspectionId: '11824241',
        inspectionDate: '2026-10-01',
        status: 'Scheduled'
      },
      {
        receivedAt: '2026-09-23T16:47:32Z',
        entryType: 'Invoice',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '17505 Pretty Boy Dam Road, Parkton, MD 21120',
        vendorCost: 435,
        invoiceNumber: '441932681',
        status: 'Received'
      },
      {
        receivedAt: '2026-09-23T20:07:39Z',
        entryType: 'Invoice',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '17505 Pretty Boy Dam Road, Parkton, MD 21120',
        vendorCost: 245,
        invoiceNumber: '441935385',
        status: 'Received'
      },
      {
        receivedAt: '2026-10-01T15:50:51Z',
        entryType: 'Invoice',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '17505 Pretty Boy Dam Road, Parkton, MD 21120',
        vendorCost: 150,
        invoiceNumber: '443300193',
        status: 'Received'
      },
      {
        receivedAt: '2026-10-07T20:31:54Z',
        entryType: 'Report',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '17505 Pretty Boy Dam Rd, Parkton, MD 21120',
        spectoraInspectionId: '11824241',
        inspectionDate: '2026-09-25T09:00:00-04:00',
        attachmentFilename: '17505 PRETTY BOY DAM ROAD RADON RESULTS.pdf',
        status: 'Matched'
      }
    ],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  const atlanticBlue = report.rows.find(row => row.vendor === 'Atlantic Blue');
  assert.ok(atlanticBlue);
  assert.equal(atlanticBlue.serviceDate, '2026-10-01');
  assert.equal(atlanticBlue.amountDue, 150);
});

test('duplicate Atlantic Blue invoice number is counted once and contracted rate wins', () => {
  const item = {
    id: '11886820',
    attributes: {
      full_address: '1202 Western Run Rd, Cockeysville, MD 21030',
      datetime: '2026-10-10T09:00:00-04:00',
      service_names:
        'Single-Family Home Inspection | 3-6 Hour Well Yield BALTIMORE County (Atlantic Blue), Potability Water Sampling (Atlantic Blue)'
    }
  };

  const report = buildVendorPayablesReport({
    inspections: [item],
    activities: [
      {
        receivedAt: '2026-10-07T20:14:33Z',
        entryType: 'Invoice',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '1202 Western Run Road, Cockeysville, MD 21030 USA',
        vendorCost: 442.85,
        invoiceNumber: '443753336',
        status: 'Received'
      },
      {
        receivedAt: '2026-10-12T16:10:46Z',
        entryType: 'Invoice',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: '1202 Western Run Road, Cockeysville, MD 21030 USA',
        vendorCost: 435,
        invoiceNumber: '443753336',
        status: 'Received'
      },
      {
        receivedAt: '2026-10-08T15:58:26Z',
        entryType: 'Report',
        vendor: 'Atlantic Blue',
        service: 'Well / Water Testing',
        propertyAddress: item.attributes.full_address,
        spectoraInspectionId: item.id,
        inspectionDate: item.attributes.datetime,
        status: 'Matched'
      }
    ],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  const row = report.rows.find(entry => entry.vendor === 'Atlantic Blue');
  assert.ok(row);
  assert.equal(row.invoiceCount, 1);
  assert.equal(row.amountDue, 595);
});

test('canceled Spectora inspection excludes vendor without completion evidence', () => {
  const item = {
    id: '11999999',
    attributes: {
      full_address: '3010 N Branch Ln, Parkville, MD 21234',
      datetime: '2026-10-09T13:30:00-04:00',
      canceled_at: '2026-10-09T08:00:00-04:00',
      service_names: 'Row Home / Town Home Inspection | Termite Inspection'
    }
  };

  const report = buildVendorPayablesReport({
    inspections: [item],
    activities: [],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  assert.equal(report.rows.some(row => row.vendor === 'Lynn Pest Management'), false);
});

test('latest canceled vendor schedule excludes 3010 N Branch', () => {
  const item = {
    id: '11999998',
    attributes: {
      full_address: '3010 N Branch Ln, Parkville, MD 21234',
      datetime: '2026-10-09T13:30:00-04:00',
      service_names: 'Row Home / Town Home Inspection | Termite Inspection'
    }
  };

  const report = buildVendorPayablesReport({
    inspections: [item],
    activities: [
      {
        receivedAt: '2026-10-08T20:22:17Z',
        entryType: 'Scheduled',
        vendor: 'Lynn Pest Management',
        service: 'Termite / WDO',
        propertyAddress: item.attributes.full_address,
        inspectionDate: '2026-10-10',
        status: 'Scheduled'
      },
      {
        receivedAt: '2026-10-12T18:12:44Z',
        entryType: 'Scheduled',
        vendor: 'Lynn Pest Management',
        service: 'Termite / WDO',
        propertyAddress: item.attributes.full_address,
        inspectionDate: '2026-10-10',
        status: 'Canceled'
      }
    ],
    start: '2026-09-28',
    end: '2026-10-11'
  });

  assert.equal(report.rows.some(row => row.vendor === 'Lynn Pest Management'), false);
});
