'use strict';

const { VENDORS, normalizeStreet } = require('./vendor-intake');

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function inspectionAddress(inspection) {
  const attrs = inspection?.attributes || inspection || {};
  return String(attrs.full_address || attrs.property_address || '').trim();
}

function inspectionDate(inspection) {
  const attrs = inspection?.attributes || inspection || {};
  return String(attrs.datetime || '').trim();
}

function inspectionServiceText(inspection) {
  const attrs = inspection?.attributes || inspection || {};
  return [
    attrs.service_names,
    attrs.service_add_on_names,
    attrs.description
  ].filter(Boolean).join(' | ');
}

function expectedVendorsForInspection(inspection) {
  const text = inspectionServiceText(inspection);
  return VENDORS.filter(vendor =>
    vendor.servicePatterns.some(pattern => pattern.test(text))
  );
}

function sameVendor(left, right) {
  return normalize(left) === normalize(right);
}

function sameAddress(left, right) {
  const a = normalizeStreet(left);
  const b = normalizeStreet(right);
  return Boolean(a && b && (
    a === b ||
    a.includes(b) ||
    b.includes(a)
  ));
}

function attachmentMatchesVendor(attachment, vendor) {
  const attrs = attachment?.attributes || attachment || {};
  const text = [
    attrs.name,
    attrs.file_file_name,
    attrs.description,
    attrs.attachment_type
  ].filter(Boolean).join(' ');

  if (vendor.key === 'termite') {
    return attrs.attachment_type === 'pest_termite' || /termite|wdo|wood[- ]destroy|pest/i.test(text);
  }
  if (vendor.key === 'chimney') {
    return /chimney|chim\s*insp|cambro/i.test(text);
  }
  if (vendor.key === 'well_water') {
    return attrs.attachment_type === 'water' || /well\s*yield|water\s*(?:quality|test|testing|sample)|potability|atlantic\s*blue/i.test(text);
  }
  if (vendor.key === 'septic') {
    return attrs.attachment_type === 'septic' || /septic|young\s*septic/i.test(text);
  }
  return false;
}

function reportFor(activities, inspection, vendor, attachmentsByInspection = {}) {
  const inspectionId = String(inspection?.id || '');
  const address = inspectionAddress(inspection);

  const reports = activities.filter(item =>
    normalize(item.entryType) === 'report' &&
    sameVendor(item.vendor, vendor.company)
  );

  const ledgerReport = reports.find(item =>
    inspectionId && String(item.spectoraInspectionId || '') === inspectionId
  ) || reports.find(item => sameAddress(item.propertyAddress, address));

  if (ledgerReport) return ledgerReport;

  const attachments = attachmentsByInspection[inspectionId] || [];
  const attachment = attachments.find(item => attachmentMatchesVendor(item, vendor));
  if (!attachment) return null;

  const attrs = attachment?.attributes || {};
  return {
    entryType: 'Report',
    vendor: vendor.company,
    propertyAddress: address,
    spectoraInspectionId: inspectionId,
    attachmentFilename: attrs.file_file_name || attrs.name || '',
    status: 'Attached in Spectora',
    receivedAt: attrs.created_at || ''
  };
}

function invoiceKey(item) {
  return [
    String(item?.sourceEmailId || ''),
    String(item?.invoiceNumber || ''),
    String(item?.attachmentFilename || '')
  ].join('|');
}

function directInvoicesFor(activities, inspection, vendor, usedInvoiceKeys) {
  const address = inspectionAddress(inspection);
  const matches = [];
  for (const item of activities) {
    if (normalize(item.entryType) !== 'invoice') continue;
    if (!sameVendor(item.vendor, vendor.company)) continue;
    const key = invoiceKey(item);
    if (usedInvoiceKeys.has(key)) continue;
    if (!sameAddress(item.propertyAddress || item.notes, address)) continue;
    usedInvoiceKeys.add(key);
    matches.push(item);
  }
  return matches;
}

function activityTime(item) {
  const time = Date.parse(item?.receivedAt || '');
  return Number.isFinite(time) ? time : null;
}

function nearbyLynnInvoice(activities, report, usedInvoiceKeys) {
  const reportTime = activityTime(report);
  if (reportTime == null) return null;

  let best = null;
  for (const item of activities) {
    if (normalize(item.entryType) !== 'invoice') continue;
    if (!sameVendor(item.vendor, 'Lynn Pest Management')) continue;
    const key = invoiceKey(item);
    if (usedInvoiceKeys.has(key)) continue;

    const invoiceTime = activityTime(item);
    if (invoiceTime == null) continue;
    const delta = Math.abs(invoiceTime - reportTime);
    if (delta > 5 * 60 * 1000) continue;
    if (!best || delta < best.delta) best = { item, delta, key };
  }

  if (!best) return null;
  usedInvoiceKeys.add(best.key);
  return best.item;
}

function priceAtlanticBlue(serviceText) {
  const text = String(serviceText || '');
  const lower = text.toLowerCase();
  const items = [];

  const add = (label, amount) => items.push({ label, amount });

  if (/baltimore\s*county[^|,;]*yield|\bbc\s*yield\b/i.test(text)) {
    add('Baltimore County Yield', 435);
  } else if (/3\s*(?:hr|hour)[^|,;]*yield|yield[^|,;]*3\s*(?:hr|hour)/i.test(text)) {
    add('3 Hr Yield', 345);
  } else if (/1\s*(?:hr|hour)[^|,;]*yield|yield[^|,;]*1\s*(?:hr|hour)/i.test(text)) {
    add('1 Hr Yield', 195);
  }

  if (/\b(?:fha|sha)[^|,;]*water|water[^|,;]*\b(?:fha|sha)\b/i.test(text)) {
    add('FHA/SHA Water', 245);
  } else if (
    /water\s*(?:quality|test|testing|sample)|potability/i.test(text) &&
    !/lead|fluoride|rush|additional|arsenic|radium|nitrate|nitrite/i.test(lower)
  ) {
    add('Standard Water', 160);
  }

  const special = /rush|additional|lead|fluoride|arsenic|radium|nitrate|nitrite/i.test(text);
  if (!items.length || special) {
    return {
      amount: items.reduce((sum, item) => sum + item.amount, 0) || null,
      confidence: special ? 'review' : 'unknown',
      breakdown: items,
      note: special
        ? 'Special/rush/additional Atlantic Blue testing requires review.'
        : 'Atlantic Blue service did not match a known pricing rule.'
    };
  }

  return {
    amount: items.reduce((sum, item) => sum + item.amount, 0),
    confidence: 'high',
    breakdown: items,
    note: ''
  };
}

function priceYoungSeptic(serviceText) {
  const text = String(serviceText || '');
  const special = /pump|holding\s*tank|multiple\s*camera|2\s*camera|two\s*camera|additional/i.test(text);

  if (special) {
    return {
      amount: null,
      confidence: 'review',
      breakdown: [],
      note: 'Young Septic special service/add-on requires review.'
    };
  }

  if (/septic/i.test(text) && /camera/i.test(text)) {
    return {
      amount: 495,
      confidence: 'high',
      breakdown: [{ label: 'Septic with Camera', amount: 495 }],
      note: ''
    };
  }

  if (/septic/i.test(text)) {
    return {
      amount: 325,
      confidence: 'high',
      breakdown: [{ label: 'Septic Standard', amount: 325 }],
      note: ''
    };
  }

  return {
    amount: null,
    confidence: 'unknown',
    breakdown: [],
    note: 'Young Septic service did not match a known pricing rule.'
  };
}

function expectedPrice(vendor, inspection) {
  const serviceText = inspectionServiceText(inspection);

  if (vendor.key === 'well_water') return priceAtlanticBlue(serviceText);
  if (vendor.key === 'septic') return priceYoungSeptic(serviceText);

  if (vendor.key === 'chimney') {
    return {
      amount: null,
      confidence: 'review',
      breakdown: [],
      note: 'Cambro pricing varies by property/location. Confirm invoice or approved quote.'
    };
  }

  if (vendor.key === 'termite') {
    return {
      amount: null,
      confidence: 'invoice',
      breakdown: [],
      note: 'Use the Lynn Pest invoice amount.'
    };
  }

  return {
    amount: null,
    confidence: 'unknown',
    breakdown: [],
    note: 'No pricing rule is configured.'
  };
}

function rowStatus({ reportReceived, invoiceReceived, amount, priceConfidence }) {
  if (!reportReceived) return 'Missing Report';
  if (priceConfidence === 'review' || priceConfidence === 'unknown' || amount == null) {
    return 'Needs Review';
  }
  if (!invoiceReceived) return 'Missing Invoice';
  return 'Ready to Pay';
}

function buildVendorPayablesReport({
  inspections = [],
  activities = [],
  attachmentsByInspection = {},
  start,
  end
} = {}) {
  const usedInvoiceKeys = new Set();
  const rows = [];

  for (const inspection of inspections) {
    const vendors = expectedVendorsForInspection(inspection);
    for (const vendor of vendors) {
      const report = reportFor(activities, inspection, vendor, attachmentsByInspection);
      let invoices = directInvoicesFor(activities, inspection, vendor, usedInvoiceKeys);

      if (!invoices.length && vendor.key === 'termite') {
        const nearby = nearbyLynnInvoice(activities, report, usedInvoiceKeys);
        if (nearby) invoices = [nearby];
      }

      const pricing = expectedPrice(vendor, inspection);
      const invoiceAmounts = invoices
        .map(item => Number(item.vendorCost))
        .filter(Number.isFinite);
      const invoiceAmount = invoiceAmounts.length
        ? invoiceAmounts.reduce((sum, value) => sum + value, 0)
        : null;

      let amount = invoiceAmount != null ? invoiceAmount : pricing.amount;
      let priceConfidence = invoiceAmount != null ? 'invoice' : pricing.confidence;
      const notes = [pricing.note || ''];

      if (
        invoiceAmount != null &&
        pricing.confidence === 'high' &&
        pricing.amount != null &&
        Math.abs(invoiceAmount - pricing.amount) > 0.01
      ) {
        priceConfidence = 'review';
        notes.push(
          'Invoice total ' + invoiceAmount.toFixed(2) +
          ' does not match known service-rate total ' + Number(pricing.amount).toFixed(2) + '.'
        );
      }

      rows.push({
        inspectionId: String(inspection?.id || ''),
        inspectionDate: inspectionDate(inspection),
        propertyAddress: inspectionAddress(inspection),
        vendorKey: vendor.key,
        vendor: vendor.company,
        service: vendor.service,
        spectoraServices: inspectionServiceText(inspection),
        reportReceived: Boolean(report),
        reportFilename: report?.attachmentFilename || '',
        invoiceReceived: invoices.length > 0,
        invoiceCount: invoices.length,
        invoiceNumber: invoices.map(item => item.invoiceNumber || '').filter(Boolean).join(', '),
        invoiceFilename: invoices.map(item => item.attachmentFilename || '').filter(Boolean).join(', '),
        amountDue: amount,
        pricingSource: invoiceAmount != null ? 'Invoice' : (
          pricing.confidence === 'high' ? 'Known vendor rate' : 'Needs review'
        ),
        pricingBreakdown: pricing.breakdown || [],
        status: rowStatus({
          reportReceived: Boolean(report),
          invoiceReceived: invoices.length > 0,
          amount,
          priceConfidence
        }),
        notes: notes.filter(Boolean).join(' ')
      });
    }
  }

  rows.sort((a, b) =>
    a.vendor.localeCompare(b.vendor) ||
    String(a.inspectionDate).localeCompare(String(b.inspectionDate)) ||
    a.propertyAddress.localeCompare(b.propertyAddress)
  );

  const groups = [];
  for (const vendorName of [...new Set(rows.map(row => row.vendor))]) {
    const vendorRows = rows.filter(row => row.vendor === vendorName);
    const knownAmounts = vendorRows.filter(row => Number.isFinite(Number(row.amountDue)));
    groups.push({
      vendor: vendorName,
      rows: vendorRows,
      payableTotal: knownAmounts.reduce((sum, row) => sum + Number(row.amountDue), 0),
      readyCount: vendorRows.filter(row => row.status === 'Ready to Pay').length,
      missingReports: vendorRows.filter(row => row.status === 'Missing Report').length,
      missingInvoices: vendorRows.filter(row => row.status === 'Missing Invoice').length,
      needsReview: vendorRows.filter(row => row.status === 'Needs Review').length
    });
  }

  return {
    start: String(start || ''),
    end: String(end || ''),
    generatedAt: new Date().toISOString(),
    inspectionCount: inspections.length,
    vendorServiceCount: rows.length,
    payableTotal: groups.reduce((sum, group) => sum + group.payableTotal, 0),
    groups,
    rows
  };
}

module.exports = {
  attachmentMatchesVendor,
  buildVendorPayablesReport,
  expectedPrice,
  expectedVendorsForInspection,
  inspectionAddress,
  inspectionDate,
  inspectionServiceText,
  priceAtlanticBlue,
  priceYoungSeptic
};
