'use strict';

const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const emailForm = document.getElementById('emailForm');
const codeForm = document.getElementById('codeForm');
const emailInput = document.getElementById('emailInput');
const codeInput = document.getElementById('codeInput');
const codeEmail = document.getElementById('codeEmail');
const changeEmail = document.getElementById('changeEmail');
const loginMessage = document.getElementById('loginMessage');
const signedInAs = document.getElementById('signedInAs');
const signOut = document.getElementById('signOut');
const refreshButton = document.getElementById('refreshButton');
const commandForm = document.getElementById('commandForm');
const commandInput = document.getElementById('commandInput');
const conversation = document.getElementById('conversation');
const activityList = document.getElementById('activityList');
const activityToggle = document.getElementById('activityToggle');
const exceptionsList = document.getElementById('exceptionsList');
const exceptionCount = document.getElementById('exceptionCount');
const voiceButton = document.getElementById('voiceButton');
const voiceStatus = document.getElementById('voiceStatus');
const installButton = document.getElementById('installButton');

let pendingChallenge = sessionStorage.getItem('ivyAdminChallenge') || '';
let pendingEmail = sessionStorage.getItem('ivyAdminEmail') || '';
let installPrompt = null;
let latestActivity = [];
let activityExpanded = false;
const ACTIVITY_PREVIEW_COUNT = 5;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value == null ? '' : String(value);
    else if (value != null) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || body.error || 'Request failed: ' + response.status);
  return body;
}

function showLogin() {
  appView.hidden = true;
  loginView.hidden = false;
  if (pendingChallenge && pendingEmail) {
    emailForm.hidden = true;
    codeForm.hidden = false;
    codeEmail.textContent = pendingEmail;
    codeInput.focus();
  } else {
    emailForm.hidden = false;
    codeForm.hidden = true;
    emailInput.focus();
  }
}

function showApp(session) {
  loginView.hidden = true;
  appView.hidden = false;
  signedInAs.textContent = session?.admin?.email || '';
}

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderActivityList() {
  activityList.replaceChildren();

  if (!latestActivity.length) {
    activityList.append(el('div', { class: 'ivy-empty', text: 'No vendor activity yet.' }));
    activityToggle.hidden = true;
    return;
  }

  const visible = activityExpanded
    ? latestActivity
    : latestActivity.slice(0, ACTIVITY_PREVIEW_COUNT);

  for (const item of visible) {
    activityList.append(
      el('article', { class: 'ivy-card' }, [
        el('div', { class: 'ivy-card-top' }, [
          el('strong', { text: item.vendor || item.entryType || 'Vendor activity' }),
          el('span', { class: 'ivy-status', text: 'Status: ' + (item.status || item.entryType || ''), title: 'Status only' })
        ]),
        el('p', { text: [item.propertyAddress, item.service].filter(Boolean).join(' · ') }),
        el('p', { text: [formatWhen(item.receivedAt), item.attachmentFilename].filter(Boolean).join(' · ') })
      ])
    );
  }

  const hiddenCount = Math.max(0, latestActivity.length - ACTIVITY_PREVIEW_COUNT);
  activityToggle.hidden = hiddenCount === 0;
  activityToggle.textContent = activityExpanded
    ? 'Show less'
    : 'Show more (' + hiddenCount + ')';
  activityToggle.setAttribute('aria-expanded', String(activityExpanded));
}

function renderActivity(body) {
  latestActivity = Array.isArray(body.activity) ? body.activity : [];
  const exceptions = Array.isArray(body.exceptions) ? body.exceptions : [];

  renderActivityList();
  exceptionsList.replaceChildren();
  exceptionCount.textContent = String(exceptions.length);

  if (!exceptions.length) {
    exceptionsList.append(el('div', { class: 'ivy-empty', text: 'Nothing needs attention.' }));
  } else {
    for (const item of exceptions) {
      const vendorSelect = el('select', { class: 'ivy-review-input', 'aria-label': 'Correct vendor' }, [
        el('option', { value: '', text: 'Choose vendor if needed' }),
        el('option', { value: 'termite', text: 'Lynn Pest Management' }),
        el('option', { value: 'chimney', text: 'Cambro Services' }),
        el('option', { value: 'well_water', text: 'Atlantic Blue' }),
        el('option', { value: 'septic', text: 'Young Septic' })
      ]);

      const knownVendor = {
        'Lynn Pest Management': 'termite',
        'Cambro Services': 'chimney',
        'Atlantic Blue': 'well_water',
        'Young Septic': 'septic'
      }[item.vendor || ''];
      if (knownVendor) vendorSelect.value = knownVendor;

      const addressInput = el('input', {
        class: 'ivy-review-input',
        type: 'text',
        placeholder: 'Correct property address if needed',
        value: item.propertyAddress || ''
      });

      const reviewMessage = el('p', { class: 'ivy-review-message' });

      const retryButton = el('button', {
        class: 'ivy-primary ivy-review-action',
        type: 'button',
        text: 'Retry with corrections'
      });

      const resolveButton = el('button', {
        class: 'ivy-ghost ivy-review-action',
        type: 'button',
        text: 'Mark resolved'
      });

      retryButton.addEventListener('click', async () => {
        retryButton.disabled = true;
        resolveButton.disabled = true;
        reviewMessage.textContent = 'Retrying...';
        try {
          const body = await api('/api/admin/ivy/exceptions/retry', {
            method: 'POST',
            body: JSON.stringify({
              sourceEmailId: item.sourceEmailId,
              attachmentFilename: item.attachmentFilename,
              vendorKey: vendorSelect.value,
              propertyAddress: addressInput.value.trim()
            })
          });
          const action = body?.result?.action || 'processed';
          reviewMessage.textContent = action === 'review'
            ? 'IVY still needs more information for this item.'
            : 'Corrected. IVY reprocessed this item successfully.';
          await loadActivity();
        } catch (error) {
          reviewMessage.textContent = error.message;
        } finally {
          retryButton.disabled = false;
          resolveButton.disabled = false;
        }
      });

      resolveButton.addEventListener('click', async () => {
        if (!item.sourceEmailId) return;
        resolveButton.disabled = true;
        retryButton.disabled = true;
        reviewMessage.textContent = 'Resolving...';
        try {
          await api('/api/admin/ivy/exceptions/resolve', {
            method: 'POST',
            body: JSON.stringify({
              sourceEmailId: item.sourceEmailId,
              attachmentFilename: item.attachmentFilename,
              note: 'Manually resolved from the IVY dashboard.'
            })
          });
          await loadActivity();
        } catch (error) {
          reviewMessage.textContent = error.message;
        } finally {
          resolveButton.disabled = false;
          retryButton.disabled = false;
        }
      });

      const correctionForm = el('div', { class: 'ivy-review-form' }, [
        el('label', { class: 'ivy-review-label' }, [
          el('span', { text: 'Vendor correction' }),
          vendorSelect
        ]),
        el('label', { class: 'ivy-review-label' }, [
          el('span', { text: 'Property correction' }),
          addressInput
        ]),
        el('div', { class: 'ivy-review-actions' }, [
          retryButton,
          resolveButton
        ]),
        reviewMessage
      ]);

      const details = el('div', { class: 'ivy-exception-details' }, [
        item.propertyAddress
          ? el('p', { text: 'Property: ' + item.propertyAddress })
          : null,
        item.attachmentFilename
          ? el('p', { text: 'Source file: ' + item.attachmentFilename })
          : null,
        item.candidateInspections
          ? el('p', { text: 'Candidate matches: ' + item.candidateInspections })
          : null,
        item.resolutionNotes
          ? el('p', { text: 'Review note: ' + item.resolutionNotes })
          : null,
        correctionForm,
        item.sourceEmailId
          ? el('p', { class: 'ivy-technical', text: 'Email ID: ' + item.sourceEmailId })
          : null
      ].filter(Boolean));
      details.hidden = true;

      const detailsButton = el('button', {
        class: 'ivy-details-button',
        type: 'button',
        text: 'Review / Fix',
        'aria-expanded': 'false'
      });

      detailsButton.addEventListener('click', () => {
        const expanded = detailsButton.getAttribute('aria-expanded') === 'true';
        detailsButton.setAttribute('aria-expanded', String(!expanded));
        detailsButton.textContent = expanded ? 'Review / Fix' : 'Hide review';
        details.hidden = expanded;
      });

      exceptionsList.append(
        el('article', { class: 'ivy-card' }, [
          el('div', { class: 'ivy-card-top' }, [
            el('strong', { text: item.vendor || 'IVY exception' }),
            el('span', {
              class: 'ivy-status',
              text: 'Status: ' + (item.status || 'Open'),
              title: 'Status only'
            })
          ]),
          el('p', { text: item.reason || 'Review needed' }),
          el('p', { text: [item.propertyAddress, formatWhen(item.createdAt)].filter(Boolean).join(' · ') }),
          detailsButton,
          details
        ])
      );
    }
  }
}

async function loadActivity() {
  const body = await api('/api/admin/ivy/activity');
  renderActivity(body);
}

function addBubble(text, kind) {
  conversation.append(
    el('div', { class: 'ivy-bubble ivy-bubble-' + kind, text })
  );
  conversation.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

emailForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = 'Sending sign-in code...';
  const email = emailInput.value.trim().toLowerCase();
  try {
    const body = await api('/api/admin/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    pendingChallenge = body.challenge || '';
    pendingEmail = email;
    sessionStorage.setItem('ivyAdminChallenge', pendingChallenge);
    sessionStorage.setItem('ivyAdminEmail', pendingEmail);
    codeEmail.textContent = email;
    emailForm.hidden = true;
    codeForm.hidden = false;
    loginMessage.textContent = body.message || 'Check your email for the sign-in code.';
    codeInput.focus();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

codeForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = 'Signing in...';
  try {
    await api('/api/admin/auth/verify', {
      method: 'POST',
      body: JSON.stringify({
        email: pendingEmail,
        code: codeInput.value.trim(),
        challenge: pendingChallenge
      })
    });
    pendingChallenge = '';
    pendingEmail = '';
    sessionStorage.removeItem('ivyAdminChallenge');
    sessionStorage.removeItem('ivyAdminEmail');
    const session = await api('/api/admin/session');
    showApp(session);
    await loadActivity();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

changeEmail.addEventListener('click', () => {
  pendingChallenge = '';
  pendingEmail = '';
  sessionStorage.removeItem('ivyAdminChallenge');
  sessionStorage.removeItem('ivyAdminEmail');
  codeForm.hidden = true;
  emailForm.hidden = false;
  loginMessage.textContent = '';
  emailInput.focus();
});

signOut.addEventListener('click', async () => {
  try { await api('/api/admin/auth/logout', { method: 'POST' }); } catch {}
  showLogin();
});

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  try { await loadActivity(); }
  finally { refreshButton.disabled = false; }
});

activityToggle.addEventListener('click', () => {
  activityExpanded = !activityExpanded;
  renderActivityList();
});

commandForm.addEventListener('submit', async event => {
  event.preventDefault();
  const prompt = commandInput.value.trim();
  if (!prompt) return;
  commandInput.value = '';
  addBubble(prompt, 'user');
  addBubble('Working on it...', 'assistant');
  const working = conversation.lastElementChild;
  try {
    const body = await api('/api/admin/ivy/command', {
      method: 'POST',
      body: JSON.stringify({ prompt })
    });
    working.textContent = body.answer || 'I did not get a usable answer.';
    await loadActivity();
  } catch (error) {
    working.textContent = error.message;
  }
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;

  voiceButton.addEventListener('click', () => {
    voiceStatus.textContent = 'Listening...';
    try { recognition.start(); } catch {}
  });
  recognition.addEventListener('result', event => {
    const text = event.results?.[0]?.[0]?.transcript || '';
    if (text) commandInput.value = text;
  });
  recognition.addEventListener('end', () => { voiceStatus.textContent = ''; });
  recognition.addEventListener('error', () => { voiceStatus.textContent = 'Voice input unavailable.'; });
} else {
  voiceButton.hidden = true;
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  installButton.hidden = true;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

(async () => {
  try {
    const session = await api('/api/admin/session');
    showApp(session);
    await loadActivity();
  } catch {
    showLogin();
  }
})();
