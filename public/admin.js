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
        status.replaceChildren(
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
        );
      } catch (error) {
        status.textContent = error.message;
      } finally {
        inviteButton.disabled = false;
      }
    }
  });

  const emailButton = agent.email
    ? el('a', {
        class: 'secondary-button admin-email-button',
        href: `mailto:${encodeURIComponent(agent.email)}?subject=${encodeURIComponent('Your Inspectology Agent App')}`,
        text: 'Email'
      })
    : null;

  const actions = [inviteButton];
  if (emailButton) actions.push(emailButton);

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
