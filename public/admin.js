const loginCard = document.getElementById('loginCard');
const searchCard = document.getElementById('searchCard');
const loginForm = document.getElementById('loginForm');
const adminKeyInput = document.getElementById('adminKey');
const loginMessage = document.getElementById('loginMessage');
const searchForm = document.getElementById('searchForm');
const agentSearch = document.getElementById('agentSearch');
const searchMessage = document.getElementById('searchMessage');
const results = document.getElementById('results');
const signOut = document.getElementById('signOut');
const reportTestForm = document.getElementById('reportTestForm');
const reportConnectionId = document.getElementById('reportConnectionId');
const reportAddress = document.getElementById('reportAddress');
const reportDate = document.getElementById('reportDate');
const reportTestMessage = document.getElementById('reportTestMessage');
const reportTestResults = document.getElementById('reportTestResults');
const reportLinkTestForm = document.getElementById('reportLinkTestForm');
const reportLinkUrl = document.getElementById('reportLinkUrl');
const reportLinkTestMessage = document.getElementById('reportLinkTestMessage');
const reportLinkTestResults = document.getElementById('reportLinkTestResults');
const networkTestForm = document.getElementById('networkTestForm');
const networkTestUrl = document.getElementById('networkTestUrl');
const networkTestMessage = document.getElementById('networkTestMessage');
const networkTestResults = document.getElementById('networkTestResults');

let adminKey = sessionStorage.getItem('inspectologyAdminKey') || '';

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

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}), 'X-Admin-Key': adminKey };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || body.error || `Request failed: ${response.status}`);
  return body;
}

function showSearch() {
  loginCard.hidden = true;
  searchCard.hidden = false;
  agentSearch.focus();
}

async function verifyAdmin() {
  await api('/api/admin/session');
  sessionStorage.setItem('inspectologyAdminKey', adminKey);
  showSearch();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = 'Checking access...';
  adminKey = adminKeyInput.value;
  try {
    await verifyAdmin();
    loginMessage.textContent = '';
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

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

reportLinkTestForm.addEventListener('submit', async event => {
  event.preventDefault();
  reportLinkTestResults.replaceChildren();
  reportLinkTestMessage.textContent = 'Testing published Spectora report...';

  try {
    const body = await api('/api/admin/report-link-test', {
      method: 'POST',
      body: JSON.stringify({ url: reportLinkUrl.value.trim() })
    });

    const readable = body.statusCode >= 200 && body.statusCode < 300;
    const useful = body.textCharacters > 500 && (body.containsAddress || body.containsInspectionTerms);

    reportLinkTestMessage.textContent = readable
      ? (useful
          ? 'Success. The server can read useful report text from this published Spectora report.'
          : 'The page is reachable, but the HTML does not contain enough useful report text yet.')
      : `Spectora returned HTTP ${body.statusCode}.`;

    reportLinkTestResults.append(
      el('div', { class: 'report-test-summary' }, [
        el('strong', { text: body.title || 'Published Spectora report' }),
        el('span', { text: `HTTP ${body.statusCode} | ${body.contentType || 'Unknown content type'}` }),
        el('span', { text: `HTML bytes: ${body.htmlBytes} | Readable text: ${body.textCharacters} characters` }),
        el('span', { text: `Address found: ${body.containsAddress ? 'Yes' : 'No'} | Inspection language found: ${body.containsInspectionTerms ? 'Yes' : 'No'}` }),
        el('p', { class: 'report-text-preview', text: body.textPreview || 'No readable text returned.' })
      ])
    );
  } catch (error) {
    reportLinkTestMessage.textContent = error.message;
  }
});

networkTestForm.addEventListener('submit', async event => {
  event.preventDefault();
  networkTestResults.replaceChildren();
  networkTestMessage.textContent = 'Scanning Spectora Report Viewer scripts...';

  try {
    const body = await api('/api/admin/report-network-test', {
      method: 'POST',
      body: JSON.stringify({ url: networkTestUrl.value.trim() })
    });

    const candidates = body.endpointCandidates || [];
    const strings = body.interestingStrings || [];
    const contexts = body.bundleContexts || [];
    const hermesContexts = body.hermesContexts || [];
    const scripts = body.scannedScripts || [];

    networkTestMessage.textContent = candidates.length || strings.length || contexts.length || hermesContexts.length
      ? `Found ${candidates.length} endpoint candidates and ${hermesContexts.length} Hermes API context snippets.`
      : `Scanned ${scripts.length} script file${scripts.length === 1 ? '' : 's'}, but no useful report-loading clues were found.`;

    const scriptSummary = el('div', { class: 'report-test-summary' }, [
      el('strong', { text: 'Spectora Report Viewer deep scan' }),
      el('span', { text: `Report HTTP ${body.reportStatus || ''}` }),
      el('span', { text: `Scripts found: ${(body.scriptSources || []).length} | Scripts scanned: ${scripts.filter(item => item.scanned).length}` }),
      el('span', { text: `Relevant strings: ${strings.length} | Context snippets: ${contexts.length}` })
    ]);
    networkTestResults.append(scriptSummary);

    if (candidates.length) {
      networkTestResults.append(el('h3', { class: 'scan-subheading', text: 'Likely endpoints / hosts' }));
      for (const candidate of candidates) {
        networkTestResults.append(
          el('div', { class: 'endpoint-candidate' }, [
            el('code', { text: candidate })
          ])
        );
      }
    }

    if (strings.length) {
      networkTestResults.append(el('h3', { class: 'scan-subheading', text: 'Relevant strings' }));
      for (const value of strings.slice(0, 60)) {
        networkTestResults.append(
          el('div', { class: 'endpoint-candidate endpoint-string' }, [
            el('code', { text: value })
          ])
        );
      }
    }

    if (hermesContexts.length) {
      networkTestResults.append(el('h3', { class: 'scan-subheading', text: 'Hermes API context' }));
      for (const item of hermesContexts) {
        networkTestResults.append(
          el('article', { class: 'bundle-context-card hermes-context-card' }, [
            el('strong', { text: item.needle || 'Hermes' }),
            el('code', { text: item.snippet || '' })
          ])
        );
      }
    }

    if (contexts.length) {
      networkTestResults.append(el('h3', { class: 'scan-subheading', text: 'Bundle context' }));
      for (const item of contexts) {
        networkTestResults.append(
          el('article', { class: 'bundle-context-card' }, [
            el('strong', { text: item.needle || 'Context' }),
            el('code', { text: item.snippet || '' })
          ])
        );
      }
    }

    if (!candidates.length && !strings.length && !contexts.length && scripts.length) {
      for (const script of scripts) {
        networkTestResults.append(
          el('div', { class: 'report-file-card' }, [
            el('strong', { text: script.scanned ? 'Scanned script' : 'Skipped script' }),
            el('span', { text: script.url || '' }),
            el('span', { text: script.scanned ? `${script.bytes || 0} bytes | ${script.candidateCount || 0} candidates` : (script.reason || '') })
          ])
        );
      }
    }
  } catch (error) {
    networkTestMessage.textContent = error.message;
  }
});

reportTestForm.addEventListener('submit', async event => {
  event.preventDefault();
  reportTestResults.replaceChildren();
  reportTestMessage.textContent = 'Checking Spectora attachments...';

  const params = new URLSearchParams({
    connectionId: reportConnectionId.value.trim(),
    address: reportAddress.value.trim()
  });
  if (reportDate.value) params.set('date', reportDate.value);

  try {
    const body = await api(`/api/admin/report-test?${params.toString()}`);
    const inspection = body.inspection || {};
    const pdfs = body.pdfAttachments || [];
    const attachments = body.attachments || [];

    reportTestMessage.textContent = pdfs.length
      ? `Found ${pdfs.length} PDF attachment${pdfs.length === 1 ? '' : 's'} for this inspection.`
      : `Found the inspection, but no PDF attachment was returned. Total attachments: ${attachments.length}.`;

    const summary = el('div', { class: 'report-test-summary' }, [
      el('strong', { text: inspection.fullAddress || reportAddress.value }),
      el('span', { text: inspection.datetime ? new Date(inspection.datetime).toLocaleString() : '' }),
      el('span', { text: inspection.publishedAt ? 'Published' : 'Not published' }),
      el('span', { text: `Inspection ID ${inspection.id || ''}` })
    ]);
    reportTestResults.append(summary);

    const rows = pdfs.length ? pdfs : attachments;
    if (!rows.length) {
      reportTestResults.append(el('p', { class: 'admin-message', text: 'No attachments were returned by Spectora.' }));
      return;
    }

    for (const attachment of rows) {
      const children = [
        el('strong', { text: attachment.name || attachment.fileName || 'Attachment' }),
        el('span', { text: attachment.fileName || attachment.attachmentType || '' }),
        el('span', { text: attachment.report ? 'Report attachment' : 'Additional document' })
      ];
      if (attachment.fileUrl) {
        children.push(
          el('a', {
            class: 'link-button',
            href: attachment.fileUrl,
            target: '_blank',
            rel: 'noopener',
            text: 'Open file'
          })
        );
      }
      reportTestResults.append(el('article', { class: 'report-file-card' }, children));
    }
  } catch (error) {
    reportTestMessage.textContent = error.message;
  }
});

signOut.addEventListener('click', () => {
  sessionStorage.removeItem('inspectologyAdminKey');
  adminKey = '';
  searchCard.hidden = true;
  loginCard.hidden = false;
  adminKeyInput.value = '';
  loginMessage.textContent = '';
});

if (adminKey) {
  verifyAdmin().catch(() => {
    sessionStorage.removeItem('inspectologyAdminKey');
    adminKey = '';
  });
}
