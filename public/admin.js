const loginCard = document.getElementById('loginCard');
const searchCard = document.getElementById('searchCard');
const emailLoginForm = document.getElementById('emailLoginForm');
const fallbackLoginForm = document.getElementById('fallbackLoginForm');
const codeForm = document.getElementById('codeForm');
const adminEmailInput = document.getElementById('adminEmail');
const adminCodeInput = document.getElementById('adminCode');
const codeSentTo = document.getElementById('codeSentTo');
const changeEmailButton = document.getElementById('changeEmail');
const adminKeyInput = document.getElementById('adminKey');
const loginMessage = document.getElementById('loginMessage');
const signedInAs = document.getElementById('signedInAs');
const searchForm = document.getElementById('searchForm');
const agentSearch = document.getElementById('agentSearch');
const searchMessage = document.getElementById('searchMessage');
const results = document.getElementById('results');
const signOut = document.getElementById('signOut');
const driveBackupForm = document.getElementById('driveBackupForm');
const driveBackupAddress = document.getElementById('driveBackupAddress');
const driveBackupDate = document.getElementById('driveBackupDate');
const driveBackupMessage = document.getElementById('driveBackupMessage');
const driveBackupResults = document.getElementById('driveBackupResults');
const launchReadinessResults = document.getElementById('launchReadinessResults');
const payrollStart = document.getElementById('payrollStart');
const payrollEnd = document.getElementById('payrollEnd');
const payrollPreview = document.getElementById('payrollPreview');
const payrollSend = document.getElementById('payrollSend');
const payrollMessage = document.getElementById('payrollMessage');
const payrollResults = document.getElementById('payrollResults');
const payrollRecipient = document.getElementById('payrollRecipient');
const payrollDeliveryStatus = document.getElementById('payrollDeliveryStatus');
const payrollCheckDelivery = document.getElementById('payrollCheckDelivery');

let adminKey = sessionStorage.getItem('inspectologyAdminKey') || '';
let pendingChallenge = sessionStorage.getItem('inspectologyAdminChallenge') || '';
let pendingEmail = sessionStorage.getItem('inspectologyAdminEmail') || '';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value == null ? '' : String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

async function request(path, options = {}, includeEmergencyKey = false) {
  const headers = { ...(options.headers || {}) };
  if (includeEmergencyKey && adminKey) headers['X-Admin-Key'] = adminKey;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    ...options,
    headers,
    cache: 'no-store',
    credentials: 'same-origin'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || body.error || `Request failed: ${response.status}`);
  return body;
}

async function api(path, options = {}) {
  return request(path, options, true);
}

async function publicApi(path, options = {}) {
  return request(path, options, false);
}

function showSearch(session = {}) {
  loginCard.hidden = true;
  searchCard.hidden = false;
  const email = session.admin?.email || '';
  const method = session.admin?.method || '';
  if (signedInAs) {
    signedInAs.textContent = email
      ? `Signed in as ${email}`
      : (method === 'emergency-key' ? 'Emergency key session' : '');
  }
  agentSearch.focus();
}

function showLogin() {
  searchCard.hidden = true;
  loginCard.hidden = false;
  if (pendingChallenge && pendingEmail) {
    emailLoginForm.hidden = true;
    codeForm.hidden = false;
    codeSentTo.textContent = pendingEmail;
    adminCodeInput.focus();
  } else {
    emailLoginForm.hidden = false;
    codeForm.hidden = true;
    adminEmailInput.focus();
  }
}

function renderLaunchReadiness(readiness = {}) {
  if (!launchReadinessResults) return;
  launchReadinessResults.replaceChildren();

  const items = [
    ['Deployment', readiness.environment || 'unknown', Boolean(readiness.environment)],
    [
      'Live Spectora',
      readiness.spectora
        ? 'Configured'
        : `Missing: ${(readiness.spectoraMissing || []).join(', ') || 'configuration'}`,
      Boolean(readiness.spectora)
    ],
    ['Google Drive', readiness.googleDrive ? 'Configured' : 'Missing', Boolean(readiness.googleDrive)],
    ['Inspectology AI', readiness.openAi ? 'Configured' : 'Missing', Boolean(readiness.openAi)],
    ['Profile update email', readiness.profileEmail ? 'Configured' : 'Missing', Boolean(readiness.profileEmail)],
    ['Admin email login', readiness.adminEmailLogin ? 'Configured' : 'Missing', Boolean(readiness.adminEmailLogin)],
    ['Admin access', readiness.adminAccess ? 'Configured' : 'Missing', Boolean(readiness.adminAccess)]
  ];

  for (const [label, value, ready] of items) {
    launchReadinessResults.append(
      el('div', { class: `launch-readiness-item ${ready ? 'launch-ready' : 'launch-missing'}` }, [
        el('span', { text: label }),
        el('strong', { text: value })
      ])
    );
  }
}

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

function renderPayrollReport(report = {}) {
  if (!payrollResults) return;
  payrollResults.replaceChildren();

  const summary = el('div', { class: 'payroll-summary' }, [
    el('div', {}, [
      el('span', { text: 'Pay period' }),
      el('strong', { text: (report.start || '') + ' through ' + (report.end || '') })
    ]),
    el('div', {}, [
      el('span', { text: 'Vendor services' }),
      el('strong', { text: String(report.vendorServiceCount || 0) })
    ]),
    el('div', {}, [
      el('span', { text: 'Known payable total' }),
      el('strong', { text: money(report.payableTotal) })
    ])
  ]);
  payrollResults.append(summary);

  for (const group of report.groups || []) {
    const stats = [
      'Subtotal ' + money(group.payableTotal),
      'Missing reports ' + (group.missingReports || 0),
      'Missing invoices ' + (group.missingInvoices || 0),
      'Needs review ' + (group.needsReview || 0)
    ].join(' · ');

    const rows = el('div', { class: 'payroll-vendor-rows' });
    for (const row of group.rows || []) {
      rows.append(
        el('div', { class: 'payroll-row' }, [
          el('strong', { text: row.propertyAddress || 'Property' }),
          el('span', {
            text: [
              String(row.serviceDate || row.inspectionDate || '').slice(0, 10),
              row.amountDue == null ? 'Amount: Review' : 'Amount: ' + money(row.amountDue),
              row.status || ''
            ].filter(Boolean).join(' · ')
          })
        ])
      );
    }

    payrollResults.append(
      el('section', { class: 'payroll-vendor-card' }, [
        el('div', { class: 'payroll-vendor-heading' }, [
          el('strong', { text: group.vendor || 'Vendor' }),
          el('span', { text: stats })
        ]),
        rows
      ])
    );
  }
}

async function loadPayrollDefaults() {
  if (!payrollStart || !payrollEnd) return;
  try {
    const body = await api('/api/admin/ivy/payables/default-period');
    payrollStart.value = body.period?.start || '';
    payrollEnd.value = body.period?.end || '';
    payrollRecipient.textContent = body.recipient
      ? 'Recipient: ' + body.recipient
      : '';
  } catch (error) {
    payrollMessage.textContent = 'Could not load payroll defaults: ' + error.message;
  }
}

function payrollDeliveryText(delivery) {
  if (!delivery) return 'No payroll email found in Resend history.';
  const event = String(delivery.lastEvent || '').toLowerCase();
  const when = delivery.createdAt ? new Date(delivery.createdAt).toLocaleString() : '';
  const label = {
    delivered: 'Delivered',
    opened: 'Delivered / Opened',
    clicked: 'Delivered / Clicked',
    sent: 'Sent by provider',
    queued: 'Queued by provider',
    delivery_delayed: 'Delivery delayed',
    bounced: 'Bounced',
    complained: 'Complaint',
    failed: 'Failed'
  }[event] || (delivery.lastEvent || 'Unknown');

  return [
    label,
    delivery.subject || '',
    when ? 'Provider time: ' + when : '',
    delivery.id ? 'Resend ID: ' + delivery.id : ''
  ].filter(Boolean).join(' · ');
}

async function loadPayrollDeliveryStatus() {
  if (!payrollDeliveryStatus) return;
  payrollDeliveryStatus.textContent = 'Checking delivery history...';
  if (payrollCheckDelivery) payrollCheckDelivery.disabled = true;
  try {
    const body = await api('/api/admin/ivy/payables/email-status');
    payrollDeliveryStatus.textContent = payrollDeliveryText(body.delivery);
    const event = String(body.delivery?.lastEvent || '').toLowerCase();
    payrollDeliveryStatus.classList.toggle(
      'payroll-delivery-good',
      ['delivered', 'opened', 'clicked'].includes(event)
    );
    payrollDeliveryStatus.classList.toggle(
      'payroll-delivery-bad',
      ['bounced', 'complained', 'failed'].includes(event)
    );
  } catch (error) {
    payrollDeliveryStatus.textContent = 'Could not check Resend delivery: ' + error.message;
    payrollDeliveryStatus.classList.remove('payroll-delivery-good', 'payroll-delivery-bad');
  } finally {
    if (payrollCheckDelivery) payrollCheckDelivery.disabled = false;
  }
}

async function previewPayrollReport() {
  const start = payrollStart.value;
  const end = payrollEnd.value;
  if (!start || !end) {
    payrollMessage.textContent = 'Choose a pay period start and end date.';
    return null;
  }

  payrollPreview.disabled = true;
  payrollSend.disabled = true;
  payrollMessage.textContent = 'Building payroll report...';
  payrollResults.replaceChildren();

  try {
    const params = new URLSearchParams({ start, end });
    const body = await api('/api/admin/ivy/payables?' + params.toString());
    renderPayrollReport(body.report || {});
    payrollMessage.textContent = 'Preview ready. Nothing has been emailed.';
    return body.report || null;
  } catch (error) {
    payrollMessage.textContent = error.message;
    return null;
  } finally {
    payrollPreview.disabled = false;
    payrollSend.disabled = false;
  }
}

async function sendPayrollReport() {
  const start = payrollStart.value;
  const end = payrollEnd.value;
  if (!start || !end) {
    payrollMessage.textContent = 'Choose a pay period start and end date.';
    return;
  }

  const confirmed = window.confirm(
    'Send the full third-party vendor payroll report for ' +
    start + ' through ' + end + ' to ' +
    (payrollRecipient.textContent.replace(/^Recipient:\s*/, '') || 'the configured payroll recipient') +
    '?'
  );
  if (!confirmed) return;

  payrollPreview.disabled = true;
  payrollSend.disabled = true;
  payrollMessage.textContent = 'Building and sending payroll report...';

  try {
    const body = await api('/api/admin/ivy/payables/email', {
      method: 'POST',
      body: JSON.stringify({ start, end })
    });
    renderPayrollReport(body.report || {});
    const providerState = body.delivery?.lastEvent
      ? ' Provider status: ' + body.delivery.lastEvent + '.'
      : (body.providerId ? ' Resend accepted the message as ' + body.providerId + '.' : '');
    payrollMessage.textContent =
      'Send accepted for ' + (body.sentTo || 'the configured payroll recipient') + '.' + providerState;
    await loadPayrollDeliveryStatus();
  } catch (error) {
    payrollMessage.textContent = error.message;
  } finally {
    payrollPreview.disabled = false;
    payrollSend.disabled = false;
  }
}

async function verifyAdmin() {
  const body = await api('/api/admin/session');
  if (adminKey) sessionStorage.setItem('inspectologyAdminKey', adminKey);
  renderLaunchReadiness(body.readiness || {});
  showSearch(body);
  await loadPayrollDefaults();
  await loadPayrollDeliveryStatus();
  return body;
}

emailLoginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = 'Sending sign-in code...';
  const email = adminEmailInput.value.trim().toLowerCase();

  try {
    const body = await publicApi('/api/admin/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ email })
    });

    pendingChallenge = body.challenge || '';
    pendingEmail = email;
    sessionStorage.setItem('inspectologyAdminChallenge', pendingChallenge);
    sessionStorage.setItem('inspectologyAdminEmail', pendingEmail);

    emailLoginForm.hidden = true;
    codeForm.hidden = false;
    codeSentTo.textContent = email;
    adminCodeInput.value = '';
    loginMessage.textContent = body.message || 'Check your email for the sign-in code.';
    adminCodeInput.focus();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

codeForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = 'Signing in...';

  try {
    await publicApi('/api/admin/auth/verify', {
      method: 'POST',
      body: JSON.stringify({
        email: pendingEmail,
        code: adminCodeInput.value.trim(),
        challenge: pendingChallenge
      })
    });

    adminKey = '';
    pendingChallenge = '';
    pendingEmail = '';
    sessionStorage.removeItem('inspectologyAdminKey');
    sessionStorage.removeItem('inspectologyAdminChallenge');
    sessionStorage.removeItem('inspectologyAdminEmail');
    adminCodeInput.value = '';

    await verifyAdmin();
    loginMessage.textContent = '';
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

changeEmailButton.addEventListener('click', () => {
  pendingChallenge = '';
  pendingEmail = '';
  sessionStorage.removeItem('inspectologyAdminChallenge');
  sessionStorage.removeItem('inspectologyAdminEmail');
  codeForm.hidden = true;
  emailLoginForm.hidden = false;
  loginMessage.textContent = '';
  adminCodeInput.value = '';
  adminEmailInput.focus();
});

fallbackLoginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = 'Checking emergency access...';
  adminKey = adminKeyInput.value;

  try {
    await verifyAdmin();
    loginMessage.textContent = '';
  } catch (error) {
    adminKey = '';
    sessionStorage.removeItem('inspectologyAdminKey');
    loginMessage.textContent = error.message;
  }
});

if (payrollPreview) {
  payrollPreview.addEventListener('click', previewPayrollReport);
}

if (payrollSend) {
  payrollSend.addEventListener('click', sendPayrollReport);
}

if (payrollCheckDelivery) {
  payrollCheckDelivery.addEventListener('click', loadPayrollDeliveryStatus);
}

searchForm.addEventListener('submit', async event => {
  event.preventDefault();
  results.replaceChildren();
  searchMessage.textContent = 'Searching Spectora...';
  try {
    const body = await api(`/api/admin/agents?q=${encodeURIComponent(agentSearch.value.trim())}`);
    searchMessage.textContent = body.agents.length ? '' : 'No matching agents found.';
    for (const agent of body.agents) results.append(renderAgent(agent));
  } catch (error) {
    searchMessage.textContent = error.message;
  }
});

function renderAgent(agent) {
  const status = el('p', { class: 'admin-message' });
  const inviteButton = el('button', {
    class: 'primary-button',
    type: 'button',
    text: 'Generate Invite',
    onclick: async () => {
      inviteButton.disabled = true;
      status.textContent = 'Generating secure link...';
      try {
        const body = await api('/api/admin/invite', {
          method: 'POST',
          body: JSON.stringify({ connectionId: agent.connectionId })
        });
        const inviteActions = [
          el('span', { text: 'Invite ready. ' }),
          el('button', {
            class: 'link-button',
            type: 'button',
            text: 'Copy link',
            onclick: async () => {
              await navigator.clipboard.writeText(body.inviteUrl);
              status.textContent = 'Invite copied to clipboard.';
            }
          }),
          document.createTextNode(' '),
          el('a', {
            class: 'link-button',
            href: body.inviteUrl,
            target: '_blank',
            rel: 'noopener',
            text: 'Open dashboard'
          })
        ];
        if (agent.email) {
          inviteActions.push(
            document.createTextNode(' '),
            el('a', {
              class: 'link-button',
              href: `mailto:${encodeURIComponent(agent.email)}?subject=${encodeURIComponent('Your Inspectology Agent Dashboard')}&body=${encodeURIComponent(`Here is your secure Inspectology Agent Dashboard link:\n\n${body.inviteUrl}\n\nThis link is valid for 30 days.`)}`,
              text: 'Email invite'
            })
          );
        }
        status.replaceChildren(...inviteActions);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        inviteButton.disabled = false;
      }
    }
  });

  const actions = [inviteButton];

  return el('article', { class: 'admin-agent-card' }, [
    el('div', { class: 'admin-agent-main' }, [
      el('strong', { text: `${agent.firstName} ${agent.lastName}`.trim() || 'Unnamed agent' }),
      el('span', { text: agent.agency || 'No brokerage listed' }),
      el('span', { text: agent.email || 'No email listed' }),
      el('span', { class: 'admin-id', text: `Spectora connection ${agent.connectionId}` })
    ]),
    el('div', { class: 'admin-agent-actions' }, actions),
    status
  ]);
}

driveBackupForm.addEventListener('submit', async event => {
  event.preventDefault();
  driveBackupResults.replaceChildren();
  driveBackupMessage.textContent = 'Checking Inspectology Google Drive backup...';

  const params = new URLSearchParams({
    address: driveBackupAddress.value.trim(),
    date: driveBackupDate.value
  });

  try {
    const body = await api(`/api/admin/drive-backup-test?${params.toString()}`);
    driveBackupMessage.textContent = body.fullReport
      ? 'Success. Vercel found the inspection folder and full home inspection PDF.'
      : `Found the backup folder and ${body.pdfCount || 0} PDFs, but no full home inspection report was identified.`;

    driveBackupResults.append(
      el('div', { class: 'report-test-summary' }, [
        el('strong', { text: body.folder?.name || 'Spectora backup folder' }),
        el('span', { text: `PDF files: ${body.pdfCount || 0}` }),
        el('span', { text: body.fullReport ? `Full report: ${body.fullReport.name}` : 'Full report: Not found' }),
        el('span', { text: body.summaryReport ? `Summary: ${body.summaryReport.name}` : 'Summary: Not found' })
      ])
    );

    for (const file of body.files || []) {
      const children = [
        el('strong', { text: file.name || 'PDF' }),
        el('span', { text: file.size ? `${Math.round(Number(file.size) / 1024 / 1024 * 10) / 10} MB` : '' })
      ];
      if (file.webViewLink) {
        children.push(el('a', {
          class: 'link-button',
          href: file.webViewLink,
          target: '_blank',
          rel: 'noopener',
          text: 'Open in Drive'
        }));
      }
      driveBackupResults.append(el('article', { class: 'report-file-card' }, children));
    }
  } catch (error) {
    driveBackupMessage.textContent = error.message;
  }
});

signOut.addEventListener('click', async () => {
  try {
    await publicApi('/api/admin/auth/logout', { method: 'POST' });
  } catch {}

  sessionStorage.removeItem('inspectologyAdminKey');
  sessionStorage.removeItem('inspectologyAdminChallenge');
  sessionStorage.removeItem('inspectologyAdminEmail');
  adminKey = '';
  pendingChallenge = '';
  pendingEmail = '';
  adminKeyInput.value = '';
  adminCodeInput.value = '';
  loginMessage.textContent = '';
  showLogin();
});

verifyAdmin().catch(() => {
  sessionStorage.removeItem('inspectologyAdminKey');
  adminKey = '';
  showLogin();
});
