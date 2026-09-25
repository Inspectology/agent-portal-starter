'use strict';

const DEFAULT_SPREADSHEET_ID = '15zah4PYh510csoKw2BkH5p88eZmhh7qFsG1AxxdimVQ';

function sheetId(config = {}) {
  return String(config.spreadsheetId || DEFAULT_SPREADSHEET_ID).trim();
}

async function sheetsJson(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Google Sheets API returned HTTP ${response.status}`);
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function appendRow(accessToken, spreadsheetId, range, values) {
  const id = encodeURIComponent(String(spreadsheetId || DEFAULT_SPREADSHEET_ID));
  const encodedRange = encodeURIComponent(range);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodedRange}:append` +
    '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';

  return sheetsJson(accessToken, url, {
    method: 'POST',
    body: JSON.stringify({
      majorDimension: 'ROWS',
      values: [values]
    })
  });
}

async function readRows(accessToken, spreadsheetId, range) {
  const id = encodeURIComponent(String(spreadsheetId || DEFAULT_SPREADSHEET_ID));
  const encodedRange = encodeURIComponent(range);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodedRange}` +
    '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';

  const body = await sheetsJson(accessToken, url);
  return Array.isArray(body.values) ? body.values : [];
}

function vendorActivityRow(activity = {}) {
  return [
    activity.receivedAt || '',
    activity.vendor || '',
    activity.service || '',
    activity.propertyAddress || '',
    activity.spectoraInspectionId || '',
    activity.inspectionDate || '',
    activity.sourceEmailId || '',
    activity.attachmentFilename || '',
    activity.vendorCost ?? '',
    activity.status || '',
    activity.spectoraAttachmentId || '',
    activity.uploadedAt || '',
    activity.notes || ''
  ];
}

function exceptionRow(item = {}) {
  return [
    item.createdAt || '',
    item.vendor || '',
    item.propertyAddress || '',
    item.reason || '',
    item.sourceEmailId || '',
    item.attachmentFilename || '',
    item.candidateInspections || '',
    item.status || 'Open',
    item.resolvedAt || '',
    item.resolutionNotes || ''
  ];
}

async function appendVendorActivity(accessToken, config, activity) {
  return appendRow(
    accessToken,
    sheetId(config),
    "'Vendor Activity'!A:M",
    vendorActivityRow(activity)
  );
}

async function appendException(accessToken, config, item) {
  return appendRow(
    accessToken,
    sheetId(config),
    "'Exceptions'!A:J",
    exceptionRow(item)
  );
}

function parseVendorActivityRows(rows = []) {
  return rows.map(row => ({
    receivedAt: row[0] || '',
    vendor: row[1] || '',
    service: row[2] || '',
    propertyAddress: row[3] || '',
    spectoraInspectionId: row[4] || '',
    inspectionDate: row[5] || '',
    sourceEmailId: row[6] || '',
    attachmentFilename: row[7] || '',
    vendorCost: row[8] === '' || row[8] == null ? null : Number(row[8]),
    status: row[9] || '',
    spectoraAttachmentId: row[10] || '',
    uploadedAt: row[11] || '',
    notes: row[12] || ''
  }));
}

function inDateRange(value, start, end) {
  const time = Date.parse(value || '');
  const startTime = Date.parse(start || '');
  const endTime = Date.parse(end || '');
  return Number.isFinite(time) &&
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    time >= startTime &&
    time <= endTime;
}

function summarizeVendorActivity(activities = [], { start, end } = {}) {
  const groups = new Map();

  for (const activity of activities) {
    if (start && end && !inDateRange(activity.receivedAt || activity.inspectionDate, start, end)) continue;
    const key = `${activity.vendor || 'Unknown'}|${activity.service || 'Unknown'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        vendor: activity.vendor || 'Unknown',
        service: activity.service || 'Unknown',
        inspectionCount: 0,
        totalVendorCost: 0,
        missingReports: 0,
        needsReview: 0
      });
    }

    const group = groups.get(key);
    const status = String(activity.status || '').toLowerCase();

    if (['uploaded', 'matched', 'received', 'duplicate'].includes(status)) {
      group.inspectionCount += 1;
    }
    if (Number.isFinite(Number(activity.vendorCost))) {
      group.totalVendorCost += Number(activity.vendorCost);
    }
    if (status === 'needs review') group.needsReview += 1;
    if (status === 'received' || status === 'matched') group.missingReports += 1;
  }

  return [...groups.values()].sort((a, b) =>
    a.vendor.localeCompare(b.vendor) || a.service.localeCompare(b.service)
  );
}

async function getVendorActivity(accessToken, config) {
  const rows = await readRows(
    accessToken,
    sheetId(config),
    "'Vendor Activity'!A2:M"
  );
  return parseVendorActivityRows(rows);
}

async function appendWeeklySummary(accessToken, config, weekEnding, summary = []) {
  for (const item of summary) {
    await appendRow(
      accessToken,
      sheetId(config),
      "'Weekly Summary'!A:H",
      [
        weekEnding || '',
        item.vendor || '',
        item.service || '',
        item.inspectionCount || 0,
        item.totalVendorCost || 0,
        item.missingReports || 0,
        item.needsReview || 0,
        item.notes || ''
      ]
    );
  }
}

module.exports = {
  DEFAULT_SPREADSHEET_ID,
  appendException,
  appendRow,
  appendVendorActivity,
  appendWeeklySummary,
  exceptionRow,
  getVendorActivity,
  parseVendorActivityRows,
  readRows,
  sheetId,
  summarizeVendorActivity,
  vendorActivityRow
};
