'use strict';

const crypto = require('node:crypto');

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyResendWebhook({ rawBody, headers, secret, nowMs = Date.now(), toleranceSeconds = 300 }) {
  const id = String(headers['svix-id'] || headers['Svix-Id'] || '').trim();
  const timestamp = String(headers['svix-timestamp'] || headers['Svix-Timestamp'] || '').trim();
  const signatureHeader = String(headers['svix-signature'] || headers['Svix-Signature'] || '').trim();
  const webhookSecret = String(secret || '').trim();

  if (!id || !timestamp || !signatureHeader || !webhookSecret) {
    throw new Error('Missing Resend webhook signature information');
  }
  if (!webhookSecret.startsWith('whsec_')) {
    throw new Error('Invalid Resend webhook secret');
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) throw new Error('Invalid webhook timestamp');
  const ageSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) throw new Error('Webhook timestamp is outside the allowed window');

  let key;
  try {
    key = Buffer.from(webhookSecret.slice('whsec_'.length), 'base64');
  } catch {
    throw new Error('Invalid Resend webhook secret encoding');
  }
  if (!key.length) throw new Error('Invalid Resend webhook secret encoding');

  const signedContent = id + '.' + timestamp + '.' + String(rawBody || '');
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');

  const signatures = signatureHeader
    .split(/\s+/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.startsWith('v1,') ? value.slice(3) : '')
    .filter(Boolean);

  if (!signatures.some(signature => timingSafeTextEqual(signature, expected))) {
    throw new Error('Invalid Resend webhook signature');
  }
  return true;
}

async function resendJson(apiKey, path) {
  const response = await fetch('https://api.resend.com' + path, {
    headers: {
      Authorization: 'Bearer ' + apiKey,
      Accept: 'application/json'
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = String(
      body?.message ||
      body?.error?.message ||
      body?.name ||
      body?.error ||
      ''
    ).trim();
    const error = new Error(
      'Resend API returned HTTP ' + response.status +
      (providerMessage ? ': ' + providerMessage : '')
    );
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function retrieveReceivedEmail(apiKey, emailId) {
  return resendJson(apiKey, '/emails/receiving/' + encodeURIComponent(emailId));
}

async function listReceivedAttachments(apiKey, emailId) {
  const body = await resendJson(
    apiKey,
    '/emails/receiving/' + encodeURIComponent(emailId) + '/attachments'
  );
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.attachments)) return body.attachments;
  if (Array.isArray(body)) return body;
  return [];
}

async function retrieveReceivedAttachment(apiKey, emailId, attachmentId) {
  return resendJson(
    apiKey,
    '/emails/receiving/' + encodeURIComponent(emailId) +
      '/attachments/' + encodeURIComponent(attachmentId)
  );
}

function attachmentMeta(item = {}) {
  return {
    id: String(item.id || item.attachment_id || ''),
    filename: String(item.filename || item.name || ''),
    contentType: String(item.content_type || item.contentType || 'application/octet-stream'),
    downloadUrl: String(item.download_url || item.downloadUrl || ''),
    size: Number(item.size || item.size_bytes || 0) || 0
  };
}

async function downloadAttachment(url, maxBytes = 30_000_000) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('Attachment download URL must use HTTPS');

  const response = await fetch(target, { redirect: 'follow' });
  if (!response.ok) throw new Error('Attachment download returned HTTP ' + response.status);

  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > maxBytes) throw new Error('Attachment exceeds maximum allowed size');

  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxBytes) throw new Error('Attachment exceeds maximum allowed size');
  return data;
}

function receivedEmailToMessage(event, email, attachments) {
  const data = event?.data || {};
  const body = email?.text || email?.text_body || email?.plain_text || '';
  const html = email?.html || email?.html_body || '';
  const metas = (attachments || []).map(attachmentMeta);

  return {
    sourceEmailId: String(data.email_id || email?.id || ''),
    messageId: String(data.message_id || email?.message_id || ''),
    receivedAt: String(data.created_at || event?.created_at || email?.created_at || ''),
    from: String(email?.from || data.from || ''),
    replyTo: String(email?.reply_to || email?.replyTo || ''),
    to: Array.isArray(email?.to) ? email.to : (Array.isArray(data.to) ? data.to : []),
    cc: Array.isArray(email?.cc) ? email.cc : (Array.isArray(data.cc) ? data.cc : []),
    subject: String(email?.subject || data.subject || ''),
    body: String(body || ''),
    html: String(html || ''),
    filenames: metas.map(item => item.filename).filter(Boolean),
    attachments: metas
  };
}

module.exports = {
  attachmentMeta,
  downloadAttachment,
  listReceivedAttachments,
  receivedEmailToMessage,
  resendJson,
  retrieveReceivedAttachment,
  retrieveReceivedEmail,
  timingSafeTextEqual,
  verifyResendWebhook
};
