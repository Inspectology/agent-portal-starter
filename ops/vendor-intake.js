'use strict';

const STREET_SUFFIXES = [
  'alley','aly','avenue','ave','boulevard','blvd','circle','cir','court','ct',
  'drive','dr','highway','hwy','lane','ln','parkway','pkwy','place','pl',
  'road','rd','run','street','st','terrace','ter','trail','trl','way'
];

const VENDORS = Object.freeze([
  {
    key: 'termite',
    service: 'Termite / WDO',
    company: 'Lynn Pest Management',
    emails: ['lynnpestmgmt@gmail.com'],
    domains: ['lynnpestmgmt.com'],
    servicePatterns: [/termite/i, /\bwdo\b/i, /wood[- ]destroy/i],
    messagePatterns: [
      /lynn pest/i,
      /l\s*&?\s*j\s+lynn\s+llc/i,
      /lj[_ -]?lynn[_ -]?llc/i,
      /termite inspection/i,
      /\bwdo\b/i
    ],
    attachmentTypeEnv: 'OPS_ATTACHMENT_TYPE_TERMITE',
    documentedDefaultAttachmentType: 'pest_termite'
  },
  {
    key: 'chimney',
    service: 'Chimney',
    company: 'Cambro Services',
    emails: ['mattglick@cambro.services'],
    domains: ['cambro.services'],
    servicePatterns: [/chimney/i],
    messagePatterns: [/chimney inspection/i, /chim insp/i, /cambro services/i],
    attachmentTypeEnv: 'OPS_ATTACHMENT_TYPE_CHIMNEY',
    documentedDefaultAttachmentType: 'other'
  },
  {
    key: 'well_water',
    service: 'Well / Water Testing',
    company: 'Atlantic Blue',
    emails: [
      'kaitlyn@atlanticblue.net',
      'ablab@atlanticblue.net'
    ],
    domains: ['atlanticblue.net'],
    servicePatterns: [/\bwell\b/i, /water test/i, /water quality/i, /potability/i],
    messagePatterns: [
      /water test results/i,
      /failing bacteria/i,
      /failing bac/i,
      /lead results/i,
      /atlantic blue/i
    ],
    attachmentTypeEnv: 'OPS_ATTACHMENT_TYPE_WELL_WATER',
    documentedDefaultAttachmentType: 'water'
  },
  {
    key: 'septic',
    service: 'Septic',
    company: 'Young Septic',
    emails: [
      'anna@youngseptic.com',
      'info@youngseptic.com',
      'kaitlyn@atlanticblue.net'
    ],
    domains: ['youngseptic.com'],
    servicePatterns: [/septic/i],
    messagePatterns: [
      /septic inspection report/i,
      /septic inspection video/i,
      /young septic/i
    ],
    attachmentTypeEnv: 'OPS_ATTACHMENT_TYPE_SEPTIC',
    documentedDefaultAttachmentType: 'septic'
  }
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[#.,;:()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStreet(value) {
  let normalized = normalizeText(value)
    .replace(/\b(north|south|east|west)\b/g, match => ({
      north: 'n', south: 's', east: 'e', west: 'w'
    })[match])
    .replace(/\b(avenue)\b/g, 'ave')
    .replace(/\b(boulevard)\b/g, 'blvd')
    .replace(/\b(circle)\b/g, 'cir')
    .replace(/\b(court)\b/g, 'ct')
    .replace(/\b(drive)\b/g, 'dr')
    .replace(/\b(highway)\b/g, 'hwy')
    .replace(/\b(lane)\b/g, 'ln')
    .replace(/\b(parkway)\b/g, 'pkwy')
    .replace(/\b(place)\b/g, 'pl')
    .replace(/\b(road)\b/g, 'rd')
    .replace(/\b(street)\b/g, 'st')
    .replace(/\b(terrace)\b/g, 'ter')
    .replace(/\b(trail)\b/g, 'trl')
    .replace(/\s+/g, ' ')
    .trim();

  // Vendors sometimes place the directional after the suffix, e.g. "240 Main St E".
  // Spectora commonly stores the same address as "240 E Main St".
  const trailingDirection = normalized.match(
    /^(\d{1,6})\s+(.+?)\s+(aly|ave|blvd|cir|ct|dr|hwy|ln|pkwy|pl|rd|run|st|ter|trl|way)\s+([nsew])$/
  );
  if (trailingDirection) {
    normalized = [
      trailingDirection[1],
      trailingDirection[4],
      trailingDirection[2],
      trailingDirection[3]
    ].join(' ');
  }

  return normalized;
}

function compactStreet(value) {
  return normalizeStreet(value).replace(/\s+/g, '');
}

function sourceText(message = {}) {
  return [
    message.from,
    message.replyTo,
    message.subject,
    message.body,
    ...(message.filenames || [])
  ].filter(Boolean).join('\n');
}

function classifyVendor(message = {}) {
  const from = normalizeText(message.from);
  const subject = String(message.subject || '');
  const allText = sourceText(message);
  const matches = [];

  for (const vendor of VENDORS) {
    let score = 0;
    if (vendor.emails.some(email => from.includes(email.toLowerCase()))) score += 65;
    if (vendor.domains?.some(domain => from.includes(domain.toLowerCase()))) score += 45;
    if (vendor.servicePatterns.some(pattern => pattern.test(allText))) score += 35;
    if (vendor.messagePatterns?.some(pattern => pattern.test(subject))) score += 110;
    else if (vendor.messagePatterns?.some(pattern => pattern.test(allText))) score += 55;
    if (normalizeText(allText).includes(normalizeText(vendor.company))) score += 25;
    if (score > 0) matches.push({ vendor, score });
  }

  matches.sort((a, b) => b.score - a.score);
  if (!matches.length) return { vendor: null, confidence: 0, ambiguous: false };

  const top = matches[0];
  const second = matches[1];
  const ambiguous = Boolean(second && top.score - second.score < 30);
  return {
    vendor: ambiguous ? null : top.vendor,
    confidence: Math.min(1, top.score / 140),
    ambiguous,
    candidates: matches.map(item => ({ key: item.vendor.key, score: item.score }))
  };
}

function classifyDocument(message = {}, vendor = null) {
  const subject = String(message.subject || '');
  const body = String(message.body || '');
  const filenames = (message.filenames || []).map(String);
  const combined = [subject, body, ...filenames].join('\n');

  if (
    /^invoice\b/i.test(subject) ||
    (/\binvoices?\b/i.test(subject) && filenames.some(name => /\.pdf$/i.test(name))) ||
    filenames.some(name => /^inv[_ -]/i.test(name)) ||
    /\binvoice\s*#/i.test(combined) ||
    /\bamount due\s*:/i.test(combined)
  ) {
    return { type: 'invoice', reason: 'Vendor invoice' };
  }

  if (
    filenames.some(name => /^well yield disclaimer\.pdf$/i.test(name)) ||
    /^booking confirmation\b/i.test(subject) ||
    /^re:\s*booking confirmation\b/i.test(subject)
  ) {
    return { type: 'ignore', reason: 'Booking confirmation or standard disclaimer' };
  }

  if (filenames.some(name => /\.(mp4|mov|m4v)$/i.test(name))) {
    return { type: 'review', reason: 'Video attachment requires separate handling' };
  }

  const hasPdf = filenames.some(name => /\.pdf$/i.test(name));
  if (!hasPdf) {
    return {
      type: 'ignore',
      reason: filenames.length
        ? 'Vendor email contains no PDF report attachment'
        : 'Vendor email contains no report attachment'
    };
  }

  if (vendor?.key === 'termite' && filenames.some(name => /\.pdf$/i.test(name))) {
    return { type: 'report', reason: 'Lynn Pest termite report PDF', displayName: 'Termite Report' };
  }

  if (
    vendor?.key === 'chimney' &&
    (/chimney inspection/i.test(combined) || /chim insp/i.test(combined)) &&
    filenames.some(name => /\.pdf$/i.test(name))
  ) {
    return { type: 'report', reason: 'Cambro chimney report PDF', displayName: 'Chimney Report' };
  }

  if (
    vendor?.key === 'septic' &&
    /septic inspection report/i.test(combined) &&
    filenames.some(name => /\.pdf$/i.test(name))
  ) {
    return { type: 'report', reason: 'Young Septic report PDF' };
  }

  if (
    vendor?.key === 'well_water' &&
    /well yield/i.test(combined) &&
    filenames.some(name => /\.pdf$/i.test(name) && !/^well yield disclaimer\.pdf$/i.test(name))
  ) {
    return { type: 'report', reason: 'Atlantic Blue well yield report PDF', displayName: 'Well Yield Report' };
  }

  if (
    vendor?.key === 'well_water' &&
    (
      /water test results/i.test(combined) ||
      /water testing report/i.test(combined) ||
      /water quality/i.test(combined) ||
      /failing bacteria/i.test(combined) ||
      /failing bac/i.test(combined) ||
      /lead results/i.test(combined)
    ) &&
    filenames.some(name => /\.pdf$/i.test(name))
  ) {
    return { type: 'report', reason: 'Atlantic Blue water results PDF', displayName: 'Water Quality Report' };
  }

  return { type: 'review', reason: 'Attachment type is not confidently classified' };
}

function extractInvoiceData(text = '') {
  const source = String(text || '');
  const amountMatch =
    source.match(/Amount Due\s*:\s*\$?([0-9,]+(?:\.\d{2})?)/i) ||
    source.match(/Balance Due[\s\S]{0,120}?\$([0-9,]+(?:\.\d{2})?)/i);
  const projectMatch =
    source.match(/Project\s*[\r\n]+([^\r\n]+)/i) ||
    source.match(/(?:property|address)\s*:?\s*([0-9]{1,6}\s+[^\r\n,]+(?:,\s*[^\r\n]+)?)/i);
  const invoiceMatch =
    source.match(/Invoice\s*#?\s*[\r\n: ]+([A-Za-z0-9-]+)/i) ||
    source.match(/\bInvoice\s+([0-9]+-[0-9]+)\b/i);

  return {
    amount: amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null,
    project: projectMatch?.[1]?.trim() || '',
    invoiceNumber: invoiceMatch?.[1]?.trim() || ''
  };
}

function extractStreetCandidates(message = {}) {
  const texts = [message.subject, message.body, ...(message.filenames || [])]
    .filter(Boolean)
    .map(String);

  const suffix = STREET_SUFFIXES.join('|');
  const pattern = new RegExp(
    `\\b(\\d{1,6}\\s+(?:[A-Za-z0-9.'-]+\\s+){0,7}(?:${suffix})\\b(?:\\s+(?:n|s|e|w|north|south|east|west))?(?:\\s+(?:apt|unit|#)\\s*[A-Za-z0-9-]+)?)`,
    'gi'
  );

  const found = [];
  const seen = new Set();

  for (const text of texts) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1].trim();
      const normalized = normalizeStreet(raw);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        found.push({ raw, normalized });
      }
    }
  }

  return found;
}

function serviceMatchesVendor(inspection, vendor) {
  if (!vendor) return false;
  const text = [
    inspection?.attributes?.service_names,
    inspection?.attributes?.service_add_on_names,
    inspection?.attributes?.description
  ].filter(Boolean).join(' ');
  return vendor.servicePatterns.some(pattern => pattern.test(text));
}

function inspectionStreet(inspection) {
  const attrs = inspection?.attributes || inspection || {};
  return normalizeStreet(attrs.property_address || attrs.full_address || '');
}

function inspectionZip(inspection) {
  const attrs = inspection?.attributes || inspection || {};
  const match = String(attrs.full_address || '').match(/\b\d{5}(?:-\d{4})?\b/);
  return match?.[0] || '';
}

function dateDistanceDays(left, right) {
  const a = Date.parse(left || '');
  const b = Date.parse(right || '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / 86_400_000;
}

function scoreInspection({ inspection, streetCandidates, vendor, receivedAt, zip }) {
  const attrs = inspection?.attributes || inspection || {};
  const street = inspectionStreet(inspection);
  let score = 0;
  const reasons = [];

  const compactInspectionStreet = compactStreet(street);
  const exactStreet = streetCandidates.some(candidate =>
    candidate.normalized === street ||
    compactStreet(candidate.normalized) === compactInspectionStreet
  );
  const containedStreet = streetCandidates.some(candidate =>
    candidate.normalized && street &&
    (
      candidate.normalized.includes(street) ||
      street.includes(candidate.normalized) ||
      compactStreet(candidate.normalized).includes(compactInspectionStreet) ||
      compactInspectionStreet.includes(compactStreet(candidate.normalized))
    )
  );

  if (exactStreet) {
    score += 75;
    reasons.push('exact street address');
  } else if (containedStreet) {
    score += 55;
    reasons.push('partial street address');
  }

  if (zip && inspectionZip(inspection) === zip) {
    score += 15;
    reasons.push('ZIP match');
  }

  if (serviceMatchesVendor(inspection, vendor)) {
    score += 15;
    reasons.push('vendor service present');
  }

  const days = dateDistanceDays(receivedAt, attrs.datetime);
  if (days !== null && days <= 45) {
    score += days <= 14 ? 15 : 8;
    reasons.push(`inspection within ${Math.round(days)} days`);
  }

  if (attrs.canceled_at || attrs.cancel_reason) {
    score -= 40;
    reasons.push('inspection appears canceled');
  }

  return { inspection, score, reasons, exactStreet };
}

function selectInspectionMatch({ inspections = [], message = {}, vendor = null }) {
  const streetCandidates = extractStreetCandidates(message);
  if (!streetCandidates.length) {
    return { matched: false, reason: 'No street address found in the email or attachment names', candidates: [] };
  }

  const zipMatch = sourceText(message).match(/\b\d{5}(?:-\d{4})?\b/);
  const zip = zipMatch?.[0] || '';
  const scored = inspections
    .map(inspection => scoreInspection({
      inspection,
      streetCandidates,
      vendor,
      receivedAt: message.receivedAt,
      zip
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { matched: false, reason: 'No Spectora inspection matched the extracted address', candidates: [] };
  }

  const top = scored[0];
  const second = scored[1];
  const margin = second ? top.score - second.score : top.score;

  const safe = top.exactStreet && top.score >= 75 && (!second || margin >= 20);
  if (!safe) {
    return {
      matched: false,
      reason: 'Inspection match is ambiguous and needs review',
      candidates: scored.slice(0, 5)
    };
  }

  return {
    matched: true,
    inspection: top.inspection,
    score: top.score,
    reasons: top.reasons,
    candidates: scored.slice(0, 5)
  };
}

function duplicateAttachment(existing = [], filename = '') {
  const normalized = normalizeText(filename);
  if (!normalized) return null;

  return existing.find(item => {
    const attrs = item?.attributes || item || {};
    return normalizeText(attrs.file_file_name || attrs.name) === normalized;
  }) || null;
}

function resolveAttachmentType(vendor, env = process.env) {
  if (!vendor) return '';
  const configured = String(env[vendor.attachmentTypeEnv] || '').trim();
  if (configured) return configured;
  return vendor.documentedDefaultAttachmentType || '';
}

function createVendorIntakePlan({
  message,
  inspections,
  existingAttachments = [],
  env = process.env
}) {
  const classified = classifyVendor(message);
  if (!classified.vendor) {
    return {
      action: 'review',
      reason: classified.ambiguous ? 'Vendor classification is ambiguous' : 'Vendor is not recognized',
      vendorCandidates: classified.candidates || []
    };
  }

  const document = classifyDocument(message, classified.vendor);

  if (document.type === 'ignore') {
    return {
      action: 'ignore',
      reason: document.reason,
      vendor: classified.vendor
    };
  }

  if (document.type === 'invoice') {
    return {
      action: 'ledger',
      reason: document.reason,
      vendor: classified.vendor,
      invoice: extractInvoiceData(message.attachmentText || message.body || '')
    };
  }

  if (document.type !== 'report') {
    return {
      action: 'review',
      reason: document.reason,
      vendor: classified.vendor
    };
  }

  const match = selectInspectionMatch({
    inspections,
    message,
    vendor: classified.vendor
  });

  if (!match.matched) {
    return {
      action: 'review',
      reason: match.reason,
      vendor: classified.vendor,
      inspectionCandidates: match.candidates || []
    };
  }

  const filename = message.filenames?.[0] || '';
  const duplicate = duplicateAttachment(existingAttachments, filename);
  if (duplicate) {
    return {
      action: 'skip',
      reason: 'An attachment with the same filename already exists on this inspection',
      vendor: classified.vendor,
      inspection: match.inspection,
      duplicate
    };
  }

  const attachmentType = resolveAttachmentType(classified.vendor, env);
  if (!attachmentType) {
    return {
      action: 'review',
      reason: `Attachment type is not configured for ${classified.vendor.company}`,
      vendor: classified.vendor,
      inspection: match.inspection
    };
  }

  return {
    action: 'upload',
    vendor: classified.vendor,
    inspection: match.inspection,
    attachmentType,
    report: true,
    internalOnly: false,
    displayName: document.displayName || `${classified.vendor.company} Report`,
    description: `${classified.vendor.company} third-party report received by Inspectology`,
    matchScore: match.score,
    matchReasons: match.reasons
  };
}

async function spectoraJson(apiKey, path) {
  const response = await fetch(`https://connect.spectora.com${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Spectora API returned HTTP ${response.status}`);
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function searchSpectoraInspections(apiKey, address) {
  const query = async fulltext => {
    const params = new URLSearchParams({
      'filter[fulltext]': fulltext,
      'page[size]': '50',
      sort: '-datetime'
    });
    return spectoraJson(apiKey, `/v2/inspections?${params.toString()}`);
  };

  const exact = await query(address);
  if (Array.isArray(exact?.data) && exact.data.length) return exact;

  const houseNumber = String(address || '').match(/^\s*(\d{1,6})\b/)?.[1] || '';
  if (!houseNumber || houseNumber === String(address || '').trim()) return exact;

  const fallback = await query(houseNumber);
  return Array.isArray(fallback?.data) ? fallback : exact;
}

async function listSpectoraAttachments(apiKey, inspectionId) {
  const params = new URLSearchParams({
    'filter[inspection_id]': String(inspectionId),
    'page[size]': '200',
    sort: '-created_at'
  });
  return spectoraJson(apiKey, `/v2/inspection_attachments?${params.toString()}`);
}

async function listSpectoraAttachmentPage(apiKey, page = 1, pageSize = 200) {
  const params = new URLSearchParams({
    'page[number]': String(page),
    'page[size]': String(pageSize),
    sort: '-created_at'
  });
  return spectoraJson(apiKey, `/v2/inspection_attachments?${params.toString()}`);
}

async function uploadSpectoraAttachment(apiKey, {
  inspectionId,
  file,
  filename,
  mimeType = 'application/pdf',
  name,
  description,
  attachmentType,
  report = true,
  internalOnly = false
}) {
  if (!attachmentType) throw new Error('attachmentType is required');
  if (!inspectionId) throw new Error('inspectionId is required');

  const form = new FormData();
  form.set('data[attributes][inspection_id]', String(inspectionId));
  form.set('data[attributes][name]', name || filename || 'Vendor Report');
  form.set('data[attributes][description]', description || '');
  form.set('data[attributes][report]', String(Boolean(report)));
  form.set('data[attributes][internal_only]', String(Boolean(internalOnly)));
  form.set('data[attributes][attachment_type]', attachmentType);
  form.set(
    'data[attributes][file]',
    file instanceof Blob ? file : new Blob([file], { type: mimeType }),
    filename || 'vendor-report.pdf'
  );

  const response = await fetch('https://connect.spectora.com/v2/inspection_attachments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Spectora attachment upload returned HTTP ${response.status}`);
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

module.exports = {
  VENDORS,
  classifyDocument,
  classifyVendor,
  compactStreet,
  createVendorIntakePlan,
  extractInvoiceData,
  duplicateAttachment,
  extractStreetCandidates,
  listSpectoraAttachmentPage,
  listSpectoraAttachments,
  normalizeStreet,
  normalizeText,
  resolveAttachmentType,
  searchSpectoraInspections,
  selectInspectionMatch,
  uploadSpectoraAttachment
};
