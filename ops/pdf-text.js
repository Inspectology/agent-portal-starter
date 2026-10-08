'use strict';

const pdfParse = require('pdf-parse');

async function extractPdfText(buffer, options = {}) {
  const maxBytes = Number(options.maxBytes || 15_000_000);
  const maxChars = Number(options.maxChars || 120_000);
  const maxPages = Number(options.maxPages || 8);

  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('PDF input must be a Buffer');
  }
  if (!buffer.length) return '';
  if (buffer.length > maxBytes) {
    throw new Error('PDF exceeds text-extraction size limit');
  }

  const parsed = await pdfParse(buffer, { max: maxPages });
  return String(parsed?.text || '').slice(0, maxChars);
}

module.exports = {
  extractPdfText
};
