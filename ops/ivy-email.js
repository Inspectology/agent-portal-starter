'use strict';

const IVY_IDENTITY = Object.freeze({
  displayName: 'IVY',
  title: 'Inspectology Virtual Operations Assistant',
  company: 'Inspectology',
  email: 'ivy@inspect-ology.com',
  replyTo: 'info@inspect-ology.com',
  phone: '410-693-5539',
  website: 'https://www.inspect-ology.com',
  websiteLabel: 'www.inspect-ology.com',
  address: '4208 Sequoia Dr, Westminster, MD 21157',
  logoUrl: 'https://static.wixstatic.com/media/4b52f0_0a206cfa3f764d989adbe9a349b1d320~mv2.png'
});

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ivySignatureText() {
  return [
    'IVY',
    'Inspectology Virtual Operations Assistant',
    'Inspectology',
    '',
    '410-693-5539',
    'ivy@inspect-ology.com',
    'www.inspect-ology.com',
    '4208 Sequoia Dr, Westminster, MD 21157'
  ].join('\n');
}

function ivySignatureHtml() {
  const i = IVY_IDENTITY;
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#171717;max-width:640px;">',
    '<tr>',
    '<td style="vertical-align:top;padding:4px 28px 0 0;width:210px;">',
    '<img src="' + escapeHtml(i.logoUrl) + '" alt="Inspectology" width="175" style="display:block;max-width:175px;height:auto;border:0;">',
    '</td>',
    '<td style="vertical-align:top;">',
    '<div style="font-size:28px;line-height:1.15;font-weight:700;">' + escapeHtml(i.displayName) + '</div>',
    '<div style="font-size:18px;line-height:1.45;margin-top:8px;">' + escapeHtml(i.title) + '</div>',
    '<div style="font-size:18px;line-height:1.45;">' + escapeHtml(i.company) + '</div>',
    '<div style="height:1px;background:#c92045;margin:26px 0 22px;"></div>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:16px;line-height:1.75;">',
    '<tr><td style="padding-right:14px;color:#c92045;">☎</td><td><a href="tel:4106935539" style="color:#171717;">' + escapeHtml(i.phone) + '</a></td></tr>',
    '<tr><td style="padding-right:14px;color:#c92045;">✉</td><td><a href="mailto:' + escapeHtml(i.email) + '" style="color:#171717;">' + escapeHtml(i.email) + '</a></td></tr>',
    '<tr><td style="padding-right:14px;color:#c92045;">↗</td><td><a href="' + escapeHtml(i.website) + '" style="color:#171717;">' + escapeHtml(i.websiteLabel) + '</a></td></tr>',
    '<tr><td style="padding-right:14px;color:#c92045;">●</td><td>' + escapeHtml(i.address) + '</td></tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>'
  ].join('');
}

function plainTextToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function withIvySignature(options = {}) {
  const cleanText = String(options.text || '').trimEnd();
  const cleanHtml = String(options.html || '').trim();

  return {
    text: cleanText + (cleanText ? '\n\n' : '') + ivySignatureText(),
    html: (cleanHtml || plainTextToHtml(cleanText)) +
      ((cleanText || cleanHtml) ? '<br><br>' : '') +
      ivySignatureHtml()
  };
}

async function sendIvyEmail(config, options = {}) {
  const apiKey = String(config && config.resendApiKey || '').trim();
  if (!apiKey) throw new Error('Ivy email is not configured: missing Resend API key');
  if (!options.to) throw new Error('Ivy email recipient is required');
  if (!options.subject) throw new Error('Ivy email subject is required');

  const signed = withIvySignature({
    text: options.text || '',
    html: options.html || ''
  });

  const requestBody = JSON.stringify({
    from: 'IVY | Inspectology <' + IVY_IDENTITY.email + '>',
    to: Array.isArray(options.to) ? options.to : [options.to],
    cc: Array.isArray(options.cc) ? options.cc : (options.cc ? [options.cc] : []),
    bcc: Array.isArray(options.bcc) ? options.bcc : (options.bcc ? [options.bcc] : []),
    reply_to: IVY_IDENTITY.replyTo,
    subject: options.subject,
    text: signed.text,
    html: signed.html
  });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: requestBody
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Ivy email provider returned HTTP ' + response.status);
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

module.exports = {
  IVY_IDENTITY,
  ivySignatureHtml,
  ivySignatureText,
  sendIvyEmail,
  withIvySignature
};
