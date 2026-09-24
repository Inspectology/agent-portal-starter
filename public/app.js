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

function fmtAppointmentTime(value) {
  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function inspectionDateTime(inspection) {
  return parseDate(inspection?.datetime || inspection?.date);
}

function isPastInspection(inspection) {
  if (inspection?.canceled) return false;
  const date = inspectionDateTime(inspection);
  return !date || date.getTime() <= Date.now();
}

function findNextInspection(inspections) {
  return (inspections || [])
    .filter(inspection => {
      if (inspection?.canceled) return false;
      const date = inspectionDateTime(inspection);
      return date && date.getTime() > Date.now();
    })
    .sort((a, b) => inspectionDateTime(a).getTime() - inspectionDateTime(b).getTime())[0] || null;
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

function photoKey() {
  return `agentPhoto:${getConnectionId()}`;
}

function getSavedPhoto() {
  try {
    return localStorage.getItem(photoKey()) || '';
  } catch {
    return '';
  }
}

function mergedAgent(agent) {
  const savedPhoto = getSavedPhoto();
  return {
    ...agent,
    ...getProfileOverrides(),
    photoUrl: savedPhoto || agent.photoUrl
  };
}

function resizeProfilePhoto(file, size = 360) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//i.test(file.type || '')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    if (file.size > 8_000_000) {
      reject(new Error('Please choose a photo smaller than 8 MB.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The photo could not be read.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('The photo could not be opened.'));
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Photo editing is not supported on this device.'));
          return;
        }

        const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
        const sx = (image.naturalWidth - sourceSize) / 2;
        const sy = (image.naturalHeight - sourceSize) / 2;
        context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function renderProfilePhotoControl(agent) {
  const hasCustomPhoto = Boolean(getSavedPhoto());
  const input = el('input', {
    class: 'profile-photo-input',
    type: 'file',
    accept: 'image/*',
    'aria-label': hasCustomPhoto ? 'Change profile photo' : 'Add profile photo'
  });

  const status = el('span', {
    class: 'profile-photo-reminder',
    text: hasCustomPhoto ? 'Change photo' : 'Add profile photo'
  });

  const triggerPicker = () => input.click();

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    status.textContent = 'Updating photo…';

    try {
      const photo = await resizeProfilePhoto(file);
      localStorage.setItem(photoKey(), photo);
      currentData = {
        ...currentData,
        agent: {
          ...currentData.agent,
          photoUrl: photo
        }
      };
      renderDashboard(currentData);
    } catch (error) {
      status.textContent = error.message;
      input.value = '';
    }
  });

  return el('div', { class: 'profile-photo-control' }, [
    el('button', {
      class: 'profile-photo-button',
      type: 'button',
      'aria-label': hasCustomPhoto ? 'Change profile photo' : 'Add profile photo',
      onclick: triggerPicker
    }, [
      el('img', {
        class: 'avatar',
        src: agent.photoUrl || '/assets/mock-agent.svg',
        alt: `${agent.firstName} ${agent.lastName}`
      }),
      el('span', {
        class: 'profile-photo-badge',
        text: hasCustomPhoto ? '✎' : '+',
        'aria-hidden': 'true'
      })
    ]),
    input,
    el('button', {
      class: `profile-photo-reminder-button${hasCustomPhoto ? ' profile-photo-reminder-button-subtle' : ''}`,
      type: 'button',
      onclick: triggerPicker
    }, [status])
  ]);
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

function openAgentInfo(agent) {
  document.querySelector('.info-overlay')?.remove();

  const saveMessage = el('p', { class: 'save-message info-save-message', 'aria-live': 'polite' });
  const form = el('form', { class: 'profile-form info-profile-form' }, [
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
      text: 'Update anything that has changed. Inspectology will be notified so we can keep your Spectora information current.'
    }),
    el('button', { class: 'primary-button', type: 'submit', text: 'Update My Information' }),
    saveMessage
  ]);

  const closePanel = () => {
    overlay.classList.remove('info-overlay-open');
    setTimeout(() => overlay.remove(), 160);
    document.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = event => {
    if (event.key === 'Escape') closePanel();
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    saveMessage.textContent = 'Saving changes…';

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
      ? 'Saved. Inspectology was notified of your changes.'
      : (notificationPending
          ? 'Saved. Inspectology notification is pending setup.'
          : 'Saved.');

    setTimeout(() => {
      closePanel();
      renderDashboard(currentData);
    }, 850);
  });

  const panel = el('section', {
    class: 'info-sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'My Info'
  }, [
    el('div', { class: 'info-sheet-header' }, [
      el('div', {}, [
        el('span', { class: 'info-kicker', text: 'Agent Profile' }),
        el('h2', { text: 'My Info' }),
        el('p', { text: 'Keep your contact information current with Inspectology.' })
      ]),
      el('button', {
        class: 'info-close',
        type: 'button',
        text: '×',
        'aria-label': 'Close My Info',
        onclick: closePanel
      })
    ]),
    el('div', { class: 'info-sheet-body' }, [form])
  ]);

  const overlay = el('div', {
    class: 'info-overlay',
    onclick: event => {
      if (event.target === overlay) closePanel();
    }
  }, [panel]);

  document.body.append(overlay);
  document.addEventListener('keydown', onKeyDown);
  requestAnimationFrame(() => overlay.classList.add('info-overlay-open'));
}

function renderMyInfoButton(agent) {
  return el('button', {
    class: 'hero-info-button',
    type: 'button',
    onclick: () => openAgentInfo(agent)
  }, [
    el('span', { text: 'My Info' }),
    el('span', { class: 'hero-info-arrow', text: '›', 'aria-hidden': 'true' })
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

function officeEmailHref() {
  const subject = encodeURIComponent('Inspectology Agent Dashboard Message');
  return `mailto:info@inspect-ology.com?subject=${subject}`;
}

async function emailInspector(inspection) {
  if (currentData?.meta?.mode === 'design-preview') {
    alert(`Design preview: this will open a new email to the inspector assigned to ${inspection.location || inspection.address || 'this property'}.`);
    return;
  }

  try {
    const body = await portalApi(
      `/api/agent/${encodeURIComponent(getConnectionId())}/inspector-contact?inspectionId=${encodeURIComponent(inspection.id || '')}`
    );

    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    if (!contacts.length) throw new Error('Inspector email is not available for this inspection.');

    const emails = [...new Set(contacts.map(contact => contact.email).filter(Boolean))];
    if (!emails.length) throw new Error('Inspector email is not available for this inspection.');

    const inspectorNames = [...new Set(contacts.map(contact => contact.name).filter(Boolean))];
    const property = inspection.location || inspection.address || 'Inspection property';
    const subject = encodeURIComponent(`Question about inspection - ${property}`);
    const greeting = inspectorNames.length === 1 ? `Hi ${inspectorNames[0]},` : 'Hello,';
    const message = encodeURIComponent(
      `${greeting}\n\nI have a question about the inspection at ${property}.\n\n`
    );

    location.href = `mailto:${emails.join(',')}?subject=${subject}&body=${message}`;
  } catch (error) {
    alert(
      `${error.message}\n\nYou can also contact the Inspectology office at info@inspect-ology.com.`
    );
  }
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
        class: 'inspection-inspector-button',
        type: 'button',
        onclick: () => emailInspector(inspection)
      }, [
        el('span', { text: 'Email Inspector' }),
        el('span', { class: 'inspection-mail-icon', text: '✉', 'aria-hidden': 'true' })
      ])
    );

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

function renderNextInspection(inspection) {
  if (!inspection) return null;

  const children = [
    el('div', { class: 'next-inspection-date' }, [
      el('span', { text: 'Next inspection' }),
      el('strong', { text: fmtAppointmentTime(inspection.datetime || inspection.date) })
    ]),
    el('div', { class: 'next-inspection-main' }, [
      el('strong', { class: 'next-inspection-address', text: inspection.location || inspection.address || 'Property address unavailable' }),
      el('span', { class: 'next-inspection-services', text: inspection.services || 'Inspection' }),
      inspection.inspector
        ? el('span', { class: 'next-inspection-inspector', text: `Inspector: ${inspection.inspector}` })
        : document.createTextNode('')
    ])
  ];

  if (inspection.spectoraUrl || currentData?.meta?.mode === 'design-preview') {
    children.push(
      el('button', {
        class: 'next-inspection-button',
        type: 'button',
        onclick: () => openSpectoraInspection(inspection)
      }, [
        el('span', { text: 'Open in Spectora' }),
        el('span', { text: '↗', 'aria-hidden': 'true' })
      ])
    );
  }

  return el('section', { class: 'section dashboard-section next-inspection-section' }, [
    ...children
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

  const pastInspections = (inspections || []).filter(isPastInspection);
  showInspections(pastInspections.slice(0, 5));

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
      showInspections(pastInspections.slice(0, 5));
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
        matches = pastInspections.filter(item =>
          [item.location, item.address, item.city, item.state, item.date, item.inspector, item.services]
            .filter(Boolean)
            .some(value => String(value).toLowerCase().includes(normalized))
        );
      } else {
        const body = await portalApi(
          `/api/agent/${encodeURIComponent(getConnectionId())}/inspections-search?q=${encodeURIComponent(query)}`
        );
        matches = (body.inspections || []).filter(isPastInspection);
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

  const profilePhotoControl = renderProfilePhotoControl(agent);

  app.append(
    el('section', { class: 'hero' }, [
      profilePhotoControl,
      el('h1', { class: 'agent-name', text: `${agent.firstName} ${agent.lastName}` }),
      el('p', { class: 'agency', text: agent.agency || 'Real estate partner' }),
      el('p', { class: 'agent-location', text: [agent.city, agent.state].filter(Boolean).join(', ') }),
      el('div', { class: 'tier' }, [
        el('span', { class: 'tier-dot', 'aria-hidden': 'true' }),
        document.createTextNode(tier.label || 'Partner')
      ]),
      renderMyInfoButton(agent)
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
          el('span', { text: 'Schedule an Inspection' })
        ]),
        el('a', { class: 'schedule-button', href: `tel:${company.phone.replace(/[^\d+]/g, '')}` }, [
          el('span', { class: 'schedule-button-icon', text: '☎', 'aria-hidden': 'true' }),
          el('span', { text: 'Call' })
        ]),
        el('a', { class: 'schedule-button', href: officeEmailHref() }, [
          el('span', { class: 'schedule-button-icon', text: '✉', 'aria-hidden': 'true' }),
          el('span', { text: 'Message' })
        ])
      ])
    ])
  );

  const nextInspection = findNextInspection(inspections);
  const nextInspectionCard = renderNextInspection(nextInspection);
  if (nextInspectionCard) app.append(nextInspectionCard);

  const additionalServices = [
    { name: 'Radon Testing', note: 'Know the level before closing.' },
    { name: 'Sewer Scope', note: 'Camera evaluation of the main sewer line.' },
    { name: 'Termite / WDO', note: 'Wood-destroying organism inspection.' },
    { name: 'Mold Testing', note: 'Air and surface sampling when needed.' },
    { name: 'Asbestos Testing', note: 'Material sampling and laboratory analysis.' },
    { name: 'Environmental Testing', note: 'Targeted testing for property concerns.' }
  ];

  app.append(
    el('section', { class: 'section dashboard-section services-section' }, [
      el('div', { class: 'section-heading services-heading' }, [
        el('div', {}, [
          el('h2', { text: 'Additional Services' }),
          el('p', {
            class: 'section-description',
            text: 'Add specialized testing or evaluations to help your client get a more complete picture of the property.'
          })
        ])
      ]),
      el('div', { class: 'service-grid' },
        additionalServices.map(service =>
          el('div', { class: 'service-card' }, [
            el('strong', { text: service.name }),
            el('span', { text: service.note })
          ])
        )
      ),
      el('a', {
        class: 'services-cta',
        href: company.bookingUrl,
        target: '_blank',
        rel: 'noopener',
        text: 'Schedule or Add Services'
      })
    ])
  );

  const totalInspections = Number(stats.totalInspections || 0);
  const partnershipMilestone = totalInspections >= 100
    ? '100+ inspections together'
    : totalInspections >= 50
      ? '50+ inspections together'
      : totalInspections >= 25
        ? '25+ inspections together'
        : totalInspections >= 10
          ? '10+ inspections together'
          : '';

  app.append(
    el('section', { class: 'section dashboard-section partnership-section' }, [
      el('div', { class: 'section-heading partnership-heading' }, [
        el('div', {}, [
          el('h2', { text: 'Your Inspectology Partnership' }),
          el('p', { class: 'section-description', text: 'A quick look at the inspections we have completed together.' })
        ]),
        partnershipMilestone
          ? el('span', { class: 'partnership-badge', text: partnershipMilestone })
          : document.createTextNode('')
      ]),
      el('div', { class: 'partnership-metrics' }, [
        el('div', { class: 'partnership-metric partnership-metric-primary' }, [
          el('strong', { text: totalInspections }),
          el('span', { text: 'Inspections Together' })
        ]),
        el('div', { class: 'partnership-metric' }, [
          el('strong', { text: stats.buyingInspections }),
          el('span', { text: 'Buyer Inspections' })
        ]),
        el('div', { class: 'partnership-metric' }, [
          el('strong', { text: stats.sellingInspections }),
          el('span', { text: 'Seller Inspections' })
        ])
      ]),
      el('div', { class: 'partnership-dates' }, [
        el('div', {}, [
          el('span', { text: 'Partner since' }),
          el('strong', { text: fmtDate(stats.firstInspection) || 'Not available' })
        ]),
        el('div', {}, [
          el('span', { text: 'Most recent inspection' }),
          el('strong', { text: fmtDate(stats.lastInspection) || 'Not available' })
        ])
      ]),
      el('p', { class: 'partnership-thank-you', text: 'Thanks for trusting Inspectology with your clients.' }),
      el('p', {
        class: 'privacy-note partnership-privacy',
        text: portalModeCopy.modeNotice(data.meta?.mode)
      })
    ])
  );

  app.append(renderInspectionHistory(inspections));

  app.append(
    el('footer', { class: 'footer' }, [
      document.createTextNode(company.website)
    ]),
    el('nav', { class: 'bottom-nav bottom-nav-three', 'aria-label': 'Agent app navigation' }, [
      el('a', { href: '#top', text: 'Home' }),
      el('button', { type: 'button', text: 'My Info', onclick: () => openAgentInfo(mergedAgent(currentData.agent)) }),
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
