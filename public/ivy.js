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
const exceptionsList = document.getElementById('exceptionsList');
const exceptionCount = document.getElementById('exceptionCount');
const voiceButton = document.getElementById('voiceButton');
const voiceStatus = document.getElementById('voiceStatus');
const installButton = document.getElementById('installButton');

let pendingChallenge = sessionStorage.getItem('ivyAdminChallenge') || '';
let pendingEmail = sessionStorage.getItem('ivyAdminEmail') || '';
let installPrompt = null;

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

function renderActivity(body) {
  const activity = Array.isArray(body.activity) ? body.activity : [];
  const exceptions = Array.isArray(body.exceptions) ? body.exceptions : [];

  activityList.replaceChildren();
  exceptionsList.replaceChildren();
  exceptionCount.textContent = String(exceptions.length);

  if (!activity.length) {
    activityList.append(el('div', { class: 'ivy-empty', text: 'No vendor activity yet.' }));
  } else {
    for (const item of activity) {
      activityList.append(
        el('article', { class: 'ivy-card' }, [
          el('div', { class: 'ivy-card-top' }, [
            el('strong', { text: item.vendor || item.entryType || 'Vendor activity' }),
            el('span', { class: 'ivy-status', text: item.status || item.entryType || '' })
          ]),
          el('p', { text: [item.propertyAddress, item.service].filter(Boolean).join(' · ') }),
          el('p', { text: [formatWhen(item.receivedAt), item.attachmentFilename].filter(Boolean).join(' · ') })
        ])
      );
    }
  }

  if (!exceptions.length) {
    exceptionsList.append(el('div', { class: 'ivy-empty', text: 'Nothing needs attention.' }));
  } else {
    for (const item of exceptions) {
      exceptionsList.append(
        el('article', { class: 'ivy-card' }, [
          el('div', { class: 'ivy-card-top' }, [
            el('strong', { text: item.vendor || 'IVY exception' }),
            el('span', { class: 'ivy-status', text: item.status || 'Open' })
          ]),
          el('p', { text: item.reason || 'Review needed' }),
          el('p', { text: [item.propertyAddress, formatWhen(item.createdAt)].filter(Boolean).join(' · ') })
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
