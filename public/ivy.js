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
const inboxReviewList = document.getElementById('inboxReviewList');
const inboxReviewMessage = document.getElementById('inboxReviewMessage');
const inboxActionCount = document.getElementById('inboxActionCount');
const inboxRefreshButton = document.getElementById('inboxRefreshButton');

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

function showExceptionSuccess(card, label) {
  if (!card) return;
  card.classList.add('ivy-card-success');

  const banner = el('div', {
    class: 'ivy-success-banner',
    role: 'status',
    'aria-live': 'polite'
  }, [
    el('span', { class: 'ivy-success-check', text: '✓' }),
    el('strong', { text: label })
  ]);

  card.prepend(banner);
  banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  window.setTimeout(() => {
    loadActivity().catch(() => {});
  }, 2400);
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
      let exceptionCard = null;
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
        let completed = false;
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
          const resolved = body?.result?.exceptionResolved === true;
          if (action === 'review' || !resolved) {
            reviewMessage.textContent = action === 'review'
              ? 'IVY still needs more information for this item.'
              : 'The retry completed, but this item still needs review.';
          } else {
            completed = true;
            reviewMessage.textContent = '';
            showExceptionSuccess(exceptionCard, 'Corrected');
          }
        } catch (error) {
          reviewMessage.textContent = error.message;
        } finally {
          if (!completed) {
            retryButton.disabled = false;
            resolveButton.disabled = false;
          }
        }
      });

      resolveButton.addEventListener('click', async () => {
        if (!item.sourceEmailId) return;
        resolveButton.disabled = true;
        retryButton.disabled = true;
        reviewMessage.textContent = 'Resolving...';
        let completed = false;
        try {
          await api('/api/admin/ivy/exceptions/resolve', {
            method: 'POST',
            body: JSON.stringify({
              sourceEmailId: item.sourceEmailId,
              attachmentFilename: item.attachmentFilename,
              note: 'Manually resolved from the IVY dashboard.'
            })
          });
          completed = true;
          reviewMessage.textContent = '';
          showExceptionSuccess(exceptionCard, 'Resolved');
        } catch (error) {
          reviewMessage.textContent = error.message;
        } finally {
          if (!completed) {
            resolveButton.disabled = false;
            retryButton.disabled = false;
          }
        }
      });

      const sourcePanel = el('div', { class: 'ivy-source-panel' });
      sourcePanel.hidden = true;
      let sourceLoaded = false;

      const sourceButton = el('button', {
        class: 'ivy-source-button',
        type: 'button',
        text: 'View source email',
        'aria-expanded': 'false'
      });

      sourceButton.addEventListener('click', async () => {
        const expanded = sourceButton.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          sourceButton.setAttribute('aria-expanded', 'false');
          sourceButton.textContent = 'View source email';
          sourcePanel.hidden = true;
          return;
        }

        sourceButton.setAttribute('aria-expanded', 'true');
        sourceButton.textContent = 'Hide source email';
        sourcePanel.hidden = false;

        if (sourceLoaded) return;
        sourcePanel.replaceChildren(el('p', { class: 'ivy-muted', text: 'Loading original email...' }));

        try {
          const body = await api('/api/admin/ivy/exceptions/source', {
            method: 'POST',
            body: JSON.stringify({ sourceEmailId: item.sourceEmailId })
          });
          const source = body.source || {};
          const attachments = Array.isArray(source.attachments) ? source.attachments : [];

          const attachmentList = el('div', { class: 'ivy-source-attachments' });
          if (!attachments.length) {
            attachmentList.append(el('p', { class: 'ivy-muted', text: 'No attachments on this email.' }));
          } else {
            for (const attachment of attachments) {
              const href = '/api/admin/ivy/exceptions/attachment?' +
                'emailId=' + encodeURIComponent(item.sourceEmailId) +
                '&attachmentId=' + encodeURIComponent(attachment.id || '');
              attachmentList.append(
                el('a', {
                  class: 'ivy-source-attachment',
                  href,
                  target: '_blank',
                  rel: 'noopener',
                  text: attachment.filename || 'Open attachment'
                })
              );
            }
          }

          sourcePanel.replaceChildren(
            el('div', { class: 'ivy-source-meta' }, [
              el('p', { text: 'From: ' + (source.from || 'Unknown sender') }),
              el('p', { text: 'Subject: ' + (source.subject || '(no subject)') }),
              source.createdAt ? el('p', { text: 'Received: ' + formatWhen(source.createdAt) }) : null
            ].filter(Boolean)),
            el('div', { class: 'ivy-source-message' }, [
              el('span', { class: 'ivy-review-label', text: 'Original message' }),
              el('pre', { class: 'ivy-source-body', text: source.text || 'No plain-text email body was available.' })
            ]),
            el('div', { class: 'ivy-source-message' }, [
              el('span', { class: 'ivy-review-label', text: 'Attachments' }),
              attachmentList
            ])
          );
          sourceLoaded = true;
        } catch (error) {
          sourcePanel.replaceChildren(
            el('p', { class: 'ivy-review-message', text: 'Could not load source: ' + error.message })
          );
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
        item.sourceEmailId ? sourceButton : null,
        item.sourceEmailId ? sourcePanel : null,
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

      exceptionCard = el('article', { class: 'ivy-card' }, [
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
      ]);
      exceptionsList.append(exceptionCard);
    }
  }
}

async function loadActivity() {
  const body = await api('/api/admin/ivy/activity');
  renderActivity(body);
}

function formatConfidence(value) {
  const n = Number(value || 0);
  return Math.round(Math.max(0, Math.min(1, n)) * 100) + '%';
}

function renderInboxReview(items) {
  const rows = Array.isArray(items) ? items : [];
  inboxReviewList.replaceChildren();

  const sorted = [...rows].sort((a, b) => {
    if (Boolean(a.actionNeeded) !== Boolean(b.actionNeeded)) return a.actionNeeded ? -1 : 1;
    return String(b.receivedAt || '').localeCompare(String(a.receivedAt || ''));
  });

  inboxActionCount.textContent = String(sorted.filter(item => item.actionNeeded).length);

  if (!sorted.length) {
    inboxReviewList.append(
      el('div', { class: 'ivy-empty', text: 'No recent inbox threads to review.' })
    );
    return;
  }

  for (const item of sorted.slice(0, 12)) {
    const badgeText = item.actionNeeded ? 'Action needed' : 'No action';
    const badgeClass = item.actionNeeded ? 'ivy-inbox-badge ivy-inbox-badge-action' : 'ivy-inbox-badge';

    const suggestion = el('div', { class: 'ivy-inbox-suggestion' });
    suggestion.hidden = true;

    if (item.suggestedReply) {
      const replyText = el('div', { class: 'ivy-inbox-reply', text: item.suggestedReply });
      const copyButton = el('button', {
        type: 'button',
        class: 'ivy-mini-button',
        text: 'Copy suggestion'
      });
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.suggestedReply);
          copyButton.textContent = 'Copied';
          window.setTimeout(() => { copyButton.textContent = 'Copy suggestion'; }, 1800);
        } catch {
          copyButton.textContent = 'Copy unavailable';
        }
      });
      suggestion.append(
        el('span', { class: 'ivy-review-label', text: 'Suggested reply' }),
        replyText,
        copyButton
      );
    } else {
      suggestion.append(
        el('div', { class: 'ivy-muted', text: 'IVY does not recommend a reply for this thread.' })
      );
    }

    const toggle = el('button', {
      type: 'button',
      class: 'ivy-details-button',
      text: item.suggestedReply ? 'Show recommendation' : 'Show reasoning',
      'aria-expanded': 'false'
    });

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.textContent = open
        ? (item.suggestedReply ? 'Show recommendation' : 'Show reasoning')
        : 'Hide recommendation';
      suggestion.hidden = open;
    });

    suggestion.append(
      el('p', {
        class: 'ivy-inbox-rationale',
        text: [
          item.rationale ? 'Why: ' + item.rationale : '',
          'Confidence: ' + formatConfidence(item.confidence)
        ].filter(Boolean).join(' · ')
      })
    );

    inboxReviewList.append(
      el('article', { class: 'ivy-card ivy-inbox-card' }, [
        el('div', { class: 'ivy-card-top' }, [
          el('strong', { text: item.subject || '(no subject)' }),
          el('span', { class: badgeClass, text: badgeText })
        ]),
        el('p', { text: [item.from, formatWhen(item.receivedAt)].filter(Boolean).join(' · ') }),
        el('p', { class: 'ivy-inbox-category', text: item.category || 'Other' }),
        el('p', { text: item.summary || 'No summary available.' }),
        item.alreadyReplied
          ? el('p', { class: 'ivy-inbox-note', text: 'Inspectology is currently the latest sender in this thread.' })
          : null,
        toggle,
        suggestion
      ].filter(Boolean))
    );
  }
}

async function loadInboxReview() {
  inboxReviewMessage.textContent = 'IVY is reviewing the inbox...';
  inboxRefreshButton.disabled = true;
  try {
    const body = await api('/api/admin/ivy/inbox-review');
    renderInboxReview(body.items || []);
    inboxReviewMessage.textContent = body.readOnly
      ? 'Shadow Mode is read-only. No emails were changed or sent.'
      : '';
  } catch (error) {
    inboxReviewList.replaceChildren();
    inboxActionCount.textContent = '0';
    inboxReviewMessage.textContent = 'Inbox Review unavailable: ' + error.message;
  } finally {
    inboxRefreshButton.disabled = false;
  }
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
    loadInboxReview().catch(() => {});
    loadInboxReview().catch(() => {});
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
  try {
    await Promise.all([loadActivity(), loadInboxReview()]);
  } finally {
    refreshButton.disabled = false;
  }
});

inboxRefreshButton.addEventListener('click', async () => {
  await loadInboxReview();
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
    loadInboxReview().catch(() => {});
  } catch {
    showLogin();
  }
})();
