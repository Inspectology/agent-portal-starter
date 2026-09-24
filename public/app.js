const app = document.getElementById('app');

let deferredInstallPrompt = null;
let currentData = null;

function pathConnectionId() {
  return location.pathname.match(/\/agent\/([^/]+)/)?.[1] || '';
}

function connectionIdFromGrant(grant) {
  if (!grant || typeof grant !== 'string') return '';
  try {
    const payloadPart = grant.split('.')[0];
    if (!payloadPart) return '';
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(normalized + padding));
    return /^[1-9][0-9]*$/.test(String(payload.connectionId || '')) ? String(payload.connectionId) : '';
  } catch {
    return '';
  }
}

function consumeGrant() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const pathId = pathConnectionId();
  const fragmentGrant = fragment.get('grant') || '';
  const legacyGrant = sessionStorage.getItem('portalGrant') || '';
  const rememberedId = localStorage.getItem('lastConnectionId') || '';
  const inferredId = connectionIdFromGrant(fragmentGrant || legacyGrant);
  const connectionId = pathId || rememberedId || inferredId;
  const grant = fragmentGrant || legacyGrant || (connectionId ? localStorage.getItem(`portalGrant:${connectionId}`) : '') || '';

  if (connectionId) localStorage.setItem('lastConnectionId', connectionId);
  if (grant && connectionId) {
    localStorage.setItem(`portalGrant:${connectionId}`, grant);
    sessionStorage.removeItem('portalGrant');
  }
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);

  return { connectionId, grant };
}

const auth = consumeGrant();

function text(value) {
  return value == null ? '' : String(value);
}

function parseDate(value) {
  if (!value) return null;
  const input = String(value).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  const date = new Date(dateOnly ? `${input}T00:00:00` : input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function monthDay(value) {
  const date = parseDate(value);
  if (!date) return { month: '', day: '' };
  return {
    month: new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date),
    day: new Intl.DateTimeFormat('en-US', { day: '2-digit' }).format(date)
  };
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = text(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key.startsWith('aria-')) node.setAttribute(key, value);
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function getConnectionId() {
  return auth.connectionId || 'demo-platinum-partner';
}

async function portalApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (auth.grant) headers.Authorization = `Bearer ${auth.grant}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || body.error || `Request failed: ${response.status}`);
  }
  return body;
}

function profileKey() {
  return `agentProfile:${getConnectionId()}`;
}

function getProfileOverrides() {
  try {
    return JSON.parse(localStorage.getItem(profileKey()) || '{}');
  } catch {
    return {};
  }
}

function mergedAgent(agent) {
  return { ...agent, ...getProfileOverrides() };
}

function applyBrand() {
  const colors = {
    '--brand': '#a90533',
    '--brand-dark': '#7f0026',
    '--ink': '#171717',
    '--muted': '#626262',
    '--surface': '#ffffff',
    '--paper': '#f4f4f5',
    '--line': '#d9d9dc',
    '--success': '#2f7d4a',
    '--focus': '#a90533'
  };
  for (const [property, value] of Object.entries(colors)) document.documentElement.style.setProperty(property, value);
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', '#a90533');
}

function field(label, name, value, options = {}) {
  return el('label', { class: 'form-field' }, [
    el('span', { text: label }),
    el('input', {
      name,
      value: value || '',
      type: options.type || 'text',
      autocomplete: options.autocomplete || 'off',
      inputmode: options.inputmode || null
    })
  ]);
}

function isDashboardInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function renderInstallPromptCard() {
  if (isDashboardInstalled()) return null;

  return el('section', { class: 'top-install-card' }, [
    el('div', { class: 'top-install-copy' }, [
      el('strong', { text: 'Add Inspectology to your phone' }),
      el('span', { text: 'Open your Agent Dashboard with one tap.' })
    ]),
    el('button', {
      class: 'top-install-button',
      type: 'button',
      text: 'Install App',
      onclick: installApp
    })
  ]);
}

function installApp() {
  if (isDashboardInstalled()) return;

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => {
      deferredInstallPrompt = null;
      renderDashboard(currentData);
    });
    return;
  }

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIos) {
    alert('On iPhone or iPad, tap Share in Safari, then choose Add to Home Screen.');
  } else {
    alert('Open your browser menu and choose Install app or Add to Home screen.');
  }
}

function renderProfileSection(agent) {
  const saveMessage = el('p', { class: 'save-message', 'aria-live': 'polite' });
  const form = el('form', { class: 'profile-form' }, [
    el('div', { class: 'form-grid' }, [
      field('First name', 'firstName', agent.firstName, { autocomplete: 'given-name' }),
      field('Last name', 'lastName', agent.lastName, { autocomplete: 'family-name' }),
      field('Brokerage / agency', 'agency', agent.agency, { autocomplete: 'organization' }),
      field('Phone', 'phone', agent.phone, { type: 'tel', autocomplete: 'tel', inputmode: 'tel' }),
      field('Email', 'email', agent.email, { type: 'email', autocomplete: 'email', inputmode: 'email' }),
      field('City', 'city', agent.city, { autocomplete: 'address-level2' }),
      field('State', 'state', agent.state, { autocomplete: 'address-level1' })
    ]),
    el('p', {
      class: 'profile-note',
      text: 'Profile changes are saved in this Agent Dashboard. Spectora currently blocks agent email updates through its API.'
    }),
    el('button', { class: 'primary-button', type: 'submit', text: 'Save Profile' }),
    saveMessage
  ]);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    saveMessage.textContent = 'Saving profile…';

    let notificationSent = false;
    let notificationPending = false;

    try {
      if (currentData?.meta?.mode === 'design-preview') {
        notificationSent = true;
      } else {
        const body = await portalApi(
          `/api/agent/${encodeURIComponent(getConnectionId())}/profile-change`,
          {
            method: 'POST',
            body: JSON.stringify({ profile: values })
          }
        );
        notificationSent = Boolean(body.notificationSent);
        notificationPending = body.notificationStatus === 'not_configured';
      }
    } catch {
      notificationPending = true;
    }

    localStorage.setItem(profileKey(), JSON.stringify(values));
    currentData = { ...currentData, agent: { ...currentData.agent, ...values } };

    saveMessage.textContent = notificationSent
      ? 'Profile saved. Inspectology was notified of your changes.'
      : (notificationPending
          ? 'Profile saved. Inspectology notification is pending setup.'
          : 'Profile saved.');

    setTimeout(() => renderDashboard(currentData), 900);
  });

  return el('section', { class: 'section dashboard-section', id: 'profile' }, [
    el('div', { class: 'section-heading' }, [
      el('h2', { text: 'My Profile' }),
      el('span', { class: 'section-kicker', text: 'Editable' })
    ]),
    el('div', { class: 'profile-card' }, [form])
  ]);
}

function aiMessage(role, message) {
  return el('div', { class: `ai-message ai-message-${role}` }, [
    el('div', { class: 'ai-message-label', text: role === 'user' ? 'You' : 'Inspectology AI' }),
    el('div', { class: 'ai-message-text', text: message })
  ]);
}

function openInspectologyAi(inspection) {
  document.querySelector('.ai-overlay')?.remove();

  const history = [];
  const status = el('div', { class: 'ai-report-status ai-report-checking' }, [
    el('span', { class: 'ai-status-dot', 'aria-hidden': 'true' }),
    el('span', { text: 'Checking inspection report…' })
  ]);
  const messages = el('div', { class: 'ai-messages', 'aria-live': 'polite' });
  const input = el('input', {
    class: 'ai-question-input',
    type: 'text',
    placeholder: 'Ask about this inspection…',
    maxlength: '1200',
    autocomplete: 'off',
    disabled: true
  });
  const sendButton = el('button', {
    class: 'ai-send-button',
    type: 'submit',
    text: 'Ask',
    disabled: true
  });

  const form = el('form', { class: 'ai-question-form' }, [input, sendButton]);

  const closePanel = () => {
    overlay.classList.remove('ai-overlay-open');
    setTimeout(() => overlay.remove(), 160);
    document.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = event => {
    if (event.key === 'Escape') closePanel();
  };

  const quickPrompts = [
    'Summarize the major concerns',
    'What did the report say about the roof?',
    'Show me the electrical concerns',
    'Summarize HVAC ages and concerns',
    'What should I discuss with my buyer?'
  ];

  const quickPromptWrap = el('div', { class: 'ai-quick-prompts' });
  for (const prompt of quickPrompts) {
    quickPromptWrap.append(
      el('button', {
        class: 'ai-prompt-chip',
        type: 'button',
        text: prompt,
        onclick: () => {
          if (input.disabled) return;
          input.value = prompt;
          form.requestSubmit();
        }
      })
    );
  }

  const panel = el('section', {
    class: 'ai-sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Ask Inspectology AI'
  }, [
    el('div', { class: 'ai-sheet-header' }, [
      el('div', {}, [
        el('div', { class: 'ai-brand-row' }, [
          el('span', { class: 'ai-spark', text: '✦', 'aria-hidden': 'true' }),
          el('span', { class: 'ai-brand-name', text: 'Ask Inspectology AI' })
        ]),
        el('h2', { class: 'ai-property-title', text: inspection.location || inspection.address || 'Inspection report' }),
        el('p', { class: 'ai-property-meta', text: [fmtDate(inspection.date), inspection.inspector].filter(Boolean).join(' • ') })
      ]),
      el('button', {
        class: 'ai-close',
        type: 'button',
        text: '×',
        'aria-label': 'Close Inspectology AI',
        onclick: closePanel
      })
    ]),
    status,
    el('p', {
      class: 'ai-intro',
      text: 'Ask questions about this inspection. Answers are grounded in the selected Inspectology report and should be read alongside the full report.'
    }),
    quickPromptWrap,
    messages,
    el('div', { class: 'ai-composer' }, [
      form,
      el('p', {
        class: 'ai-disclaimer',
        text: 'Inspectology AI explains report content. It does not replace the inspector, the full report, or professional advice.'
      })
    ])
  ]);

  const overlay = el('div', {
    class: 'ai-overlay',
    onclick: event => {
      if (event.target === overlay) closePanel();
    }
  }, [panel]);

  document.body.append(overlay);
  document.addEventListener('keydown', onKeyDown);
  requestAnimationFrame(() => overlay.classList.add('ai-overlay-open'));

  messages.append(
    aiMessage(
      'assistant',
      'I can help you understand this inspection report. Try one of the questions above or ask me about a specific system, concern, or recommendation.'
    )
  );

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || input.disabled) return;

    const priorHistory = history.slice(-6);
    history.push({ role: 'user', text: question });
    messages.append(aiMessage('user', question));
    input.value = '';
    input.disabled = true;
    sendButton.disabled = true;

    const thinking = aiMessage('assistant', 'Reviewing the inspection report…');
    thinking.classList.add('ai-thinking');
    messages.append(thinking);
    messages.scrollTop = messages.scrollHeight;

    try {
      let answer;
      if (currentData?.meta?.mode === 'design-preview') {
        await new Promise(resolve => setTimeout(resolve, 550));
        answer = 'Design preview: the live version will answer from this inspection’s full Inspectology PDF and cite the exact report section when available. This preview is only showing the dashboard experience.';
      } else {
        const body = await portalApi(`/api/agent/${encodeURIComponent(getConnectionId())}/ask-report`, {
          method: 'POST',
          body: JSON.stringify({
            inspectionId: inspection.id,
            question,
            history: priorHistory
          })
        });
        answer = body.answer || 'No answer was returned.';
      }
      thinking.remove();
      history.push({ role: 'assistant', text: answer });
      messages.append(aiMessage('assistant', answer));
    } catch (error) {
      thinking.remove();
      messages.append(
        aiMessage('assistant', `I couldn't answer that yet. ${error.message}`)
      );
    } finally {
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
      messages.scrollTop = messages.scrollHeight;
    }
  });

  if (currentData?.meta?.mode === 'design-preview') {
    status.className = 'ai-report-status ai-report-ready';
    status.replaceChildren(
      el('span', { class: 'ai-status-dot', 'aria-hidden': 'true' }),
      el('span', { text: 'Full inspection report connected' })
    );
    input.disabled = false;
    sendButton.disabled = false;
  } else {
    portalApi(
      `/api/agent/${encodeURIComponent(getConnectionId())}/report-status?inspectionId=${encodeURIComponent(inspection.id || '')}`
    ).then(body => {
      status.className = `ai-report-status ${body.available ? 'ai-report-ready' : 'ai-report-waiting'}`;
      status.replaceChildren(
        el('span', { class: 'ai-status-dot', 'aria-hidden': 'true' }),
        el('span', {
          text: body.available
            ? 'Full inspection report connected'
            : 'Inspection report backup is not available yet'
        })
      );
      input.disabled = !body.available;
      sendButton.disabled = !body.available;
      if (body.available) input.focus();
    }).catch(error => {
      status.className = 'ai-report-status ai-report-waiting';
      status.replaceChildren(
        el('span', { class: 'ai-status-dot', 'aria-hidden': 'true' }),
        el('span', { text: error.message })
      );
    });
  }
}

function openSpectoraInspection(inspection) {
  if (currentData?.meta?.mode === 'design-preview') {
    alert('Design preview: in the live dashboard this opens the inspection in Spectora.');
    return;
  }
  if (!inspection.spectoraUrl) return;
  window.open(inspection.spectoraUrl, '_blank', 'noopener');
}

function renderInspectionCard(inspection) {
  const date = monthDay(inspection.date);
  const inspectionBody = el('div', { class: 'inspection-card-body' }, [
    el('p', { class: 'inspection-title', text: inspection.location || inspection.address }),
    el('p', {
      class: 'inspection-meta',
      text: [inspection.services, inspection.inspector, inspection.status].filter(Boolean).join(' | ')
    })
  ]);

  if (inspection.published && inspection.id) {
    const actions = el('div', { class: 'inspection-actions' });

    if (inspection.spectoraUrl || currentData?.meta?.mode === 'design-preview') {
      actions.append(
        el('button', {
          class: 'inspection-open-button',
          type: 'button',
          onclick: () => openSpectoraInspection(inspection)
        }, [
          el('span', { text: 'Open in Spectora' }),
          el('span', { class: 'inspection-action-arrow', text: '↗', 'aria-hidden': 'true' })
        ])
      );
    }

    actions.append(
      el('button', {
        class: 'inspection-ai-button',
        type: 'button',
        onclick: () => openInspectologyAi(inspection)
      }, [
        el('span', { class: 'inspection-ai-icon', text: '✦', 'aria-hidden': 'true' }),
        el('span', { text: 'Ask Inspectology AI' })
      ])
    );

    inspectionBody.append(actions);
  }

  return el('article', { class: 'timeline-item' }, [
    el('div', { class: 'date' }, [
      document.createTextNode(date.month),
      el('span', { text: date.day })
    ]),
    inspectionBody
  ]);
}

function renderInspectionHistory(inspections) {
  const timeline = el('div', { class: 'timeline' });
  const status = el('p', { class: 'inspection-search-status', 'aria-live': 'polite' });

  const showInspections = (items, label = '') => {
    timeline.replaceChildren();
    const rows = Array.isArray(items) ? items : [];
    for (const inspection of rows) timeline.append(renderInspectionCard(inspection));
    status.textContent = label || (rows.length
      ? 'Showing your 5 most recent inspections.'
      : 'No inspections found.');
  };

  showInspections((inspections || []).slice(0, 5));

  const searchInput = el('input', {
    class: 'inspection-search-input',
    type: 'search',
    placeholder: 'Search past inspections by address',
    autocomplete: 'off',
    minlength: '2'
  });

  const clearButton = el('button', {
    class: 'inspection-search-clear',
    type: 'button',
    text: 'Clear',
    hidden: true,
    onclick: () => {
      searchInput.value = '';
      clearButton.hidden = true;
      showInspections((inspections || []).slice(0, 5));
      searchInput.focus();
    }
  });

  const form = el('form', { class: 'inspection-search-form' }, [
    searchInput,
    el('button', { class: 'inspection-search-button', type: 'submit', text: 'Search' }),
    clearButton
  ]);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (query.length < 2) {
      status.textContent = 'Enter at least 2 characters to search.';
      return;
    }

    clearButton.hidden = false;
    status.textContent = 'Searching inspection history…';

    try {
      let matches;
      if (currentData?.meta?.mode === 'design-preview') {
        const normalized = query.toLowerCase();
        matches = (inspections || []).filter(item =>
          [item.location, item.address, item.city, item.state, item.date, item.inspector, item.services]
            .filter(Boolean)
            .some(value => String(value).toLowerCase().includes(normalized))
        );
      } else {
        const body = await portalApi(
          `/api/agent/${encodeURIComponent(getConnectionId())}/inspections-search?q=${encodeURIComponent(query)}`
        );
        matches = body.inspections || [];
      }

      showInspections(matches, matches.length
        ? `${matches.length} inspection${matches.length === 1 ? '' : 's'} found.`
        : 'No matching inspections found.');
    } catch (error) {
      timeline.replaceChildren();
      status.textContent = error.message;
    }
  });

  return el('section', { class: 'section dashboard-section', id: 'history' }, [
    el('div', { class: 'section-heading history-heading' }, [
      el('div', {}, [
        el('h2', { text: 'Inspection History' }),
        el('p', { class: 'section-description', text: 'Your five newest inspections are shown below. Search by address for older inspections.' })
      ])
    ]),
    form,
    status,
    timeline
  ]);
}

function renderDashboard(data) {
  currentData = data;
  const { company, stats, tier, inspections } = data;
  const agent = mergedAgent(data.agent);
  applyBrand();
  document.title = `${agent.firstName} ${agent.lastName} | Inspectology Agent Dashboard`;
  app.replaceChildren();

  app.append(
    el('div', { id: 'top' }),
    el('header', { class: 'topbar' }, [
      el('div', { class: 'brand-lockup' }, [
        el('img', {
          class: 'brand-logo',
          src: 'https://static.wixstatic.com/media/4b52f0_0a206cfa3f764d989adbe9a349b1d320~mv2.png',
          alt: 'Inspectology'
        })
      ]),
      el('div', { class: 'badge', text: 'Agent Dashboard' })
    ])
  );

  const avatar = el('img', {
    class: 'avatar',
    src: agent.photoUrl || '/assets/mock-agent.svg',
    alt: `${agent.firstName} ${agent.lastName}`
  });

  app.append(
    el('section', { class: 'hero' }, [
      avatar,
      el('h1', { class: 'agent-name', text: `${agent.firstName} ${agent.lastName}` }),
      el('p', { class: 'agency', text: agent.agency || 'Real estate partner' }),
      el('p', { class: 'agent-location', text: [agent.city, agent.state].filter(Boolean).join(', ') }),
      el('div', { class: 'tier' }, [
        el('span', { class: 'tier-dot', 'aria-hidden': 'true' }),
        document.createTextNode(tier.label || 'Partner')
      ])
    ])
  );

  const installPromptCard = renderInstallPromptCard();
  if (installPromptCard) app.append(installPromptCard);

  app.append(
    el('section', { class: 'section dashboard-section schedule-section' }, [
      el('div', { class: 'section-heading' }, [
        el('div', {}, [
          el('h2', { text: 'Schedule Next Inspection' }),
          el('p', { class: 'section-description', text: 'Choose the fastest way to get your next inspection on the calendar.' })
        ])
      ]),
      el('div', { class: 'schedule-actions' }, [
        el('a', { class: 'schedule-button schedule-button-primary', href: company.bookingUrl, target: '_blank', rel: 'noopener' }, [
          el('span', { class: 'schedule-button-icon', text: '＋', 'aria-hidden': 'true' }),
          el('span', { text: 'Book Online' })
        ]),
        el('a', { class: 'schedule-button', href: `tel:${company.phone.replace(/[^\d+]/g, '')}` }, [
          el('span', { class: 'schedule-button-icon', text: '☎', 'aria-hidden': 'true' }),
          el('span', { text: 'Call' })
        ]),
        el('a', { class: 'schedule-button', href: company.whatsappUrl, target: '_blank', rel: 'noopener' }, [
          el('span', { class: 'schedule-button-icon', text: '✉', 'aria-hidden': 'true' }),
          el('span', { text: 'Message' })
        ])
      ])
    ])
  );

  app.append(
    el('section', { class: 'section dashboard-section' }, [
      el('h2', { text: 'Relationship Snapshot' }),
      el('div', { class: 'metrics' }, [
        el('div', { class: 'metric' }, [el('strong', { text: stats.totalInspections }), el('span', { text: 'Total' })]),
        el('div', { class: 'metric' }, [el('strong', { text: stats.buyingInspections }), el('span', { text: 'Buying' })]),
        el('div', { class: 'metric' }, [el('strong', { text: stats.sellingInspections }), el('span', { text: 'Selling' })])
      ])
    ])
  );

  app.append(
    el('section', { class: 'section dashboard-section' }, [
      el('h2', { text: 'Partnership' }),
      el('div', { class: 'partnership' }, [
        el('div', { class: 'partnership-row' }, [
          el('span', { text: fmtDate(stats.firstInspection) || 'Start' }),
          el('span', { text: fmtDate(stats.lastInspection) || 'Present' })
        ]),
        el('div', { class: 'bar', 'aria-hidden': 'true' }, [el('span')]),
        el('p', {
          class: 'privacy-note',
          text: portalModeCopy.modeNotice(data.meta?.mode)
        })
      ])
    ])
  );

  app.append(renderProfileSection(agent));

  app.append(renderInspectionHistory(inspections));

  app.append(
    el('footer', { class: 'footer' }, [
      document.createTextNode(`${company.license} | ${company.website}`)
    ]),
    el('nav', { class: 'bottom-nav bottom-nav-three', 'aria-label': 'Agent app navigation' }, [
      el('a', { href: '#top', text: 'Home' }),
      el('a', { href: '#profile', text: 'Profile' }),
      el('a', { href: '#history', text: 'History' })
    ])
  );
}

async function load() {
  try {
    if (location.pathname === '/design-preview') {
      const response = await fetch('/api/design-preview', { cache: 'no-store' });
      if (!response.ok) throw new Error('Design preview is unavailable on this deployment.');
      renderDashboard(await response.json());
      return;
    }
    if (!auth.connectionId && location.pathname === '/') {
      throw new Error('Open your personal Inspectology invite link once to connect this device.');
    }
    const requestOptions = { cache: 'no-store', headers: {} };
    if (auth.grant) requestOptions.headers.Authorization = `Bearer ${auth.grant}`;
    const response = await fetch(`/api/agent/${encodeURIComponent(getConnectionId())}`, requestOptions);
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body.detail || body.error || '';
      } catch {}
      if (response.status === 401 && auth.connectionId) {
        localStorage.removeItem(`portalGrant:${auth.connectionId}`);
        detail = 'Your secure portal link has expired. Ask Inspectology for a new invite link.';
      }
      throw new Error(detail ? `Request failed: ${response.status} - ${detail}` : `Request failed: ${response.status}`);
    }
    renderDashboard(await response.json());
  } catch (error) {
    app.replaceChildren(
      el('section', { class: 'error' }, [
        el('img', { class: 'error-icon', src: '/assets/inspectology-app.svg', alt: '' }),
        el('h1', { text: 'Portal unavailable' }),
        el('p', { text: error.message })
      ])
    );
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  if (currentData) renderDashboard(currentData);
});

window.matchMedia('(display-mode: standalone)').addEventListener?.('change', () => {
  if (currentData) renderDashboard(currentData);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

load();
