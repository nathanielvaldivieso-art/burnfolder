(function () {
  'use strict';

  const auth = window.BurnfolderStudioAuth;
  const kit = window.BurnfolderCloudStoreKit;
  const subjectEl = document.getElementById('sendEmailSubject');
  const textEl = document.getElementById('sendEmailText');
  const sendBtn = document.getElementById('sendEmailSendBtn');
  const countEl = document.getElementById('sendEmailSubscriberCount');
  const statusEl = document.getElementById('sendEmailStatus');

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'studio-song-designer-status' + (kind ? ' is-' + kind : '');
  }

  function textToHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split(/\n\n+/)
      .map(function (p) {
        return '<p>' + p.trim().replace(/\n/g, '<br>') + '</p>';
      })
      .join('\n');
  }

  function loadSubscribers() {
    if (!countEl) return;
    window
      .fetch(kit.getFunctionsBase() + '/studio-send-newsletter', { method: 'GET' })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        });
      })
      .then(function (data) {
        const count = Number(data.count) || 0;
        countEl.textContent = count + ' subscriber' + (count === 1 ? '' : 's');
      })
      .catch(function (err) {
        countEl.textContent = 'unknown';
        setStatus(err.message || 'could not load list', 'error');
      });
  }

  function sendEmail() {
    if (!subjectEl || !textEl || !sendBtn) return;
    const subject = String(subjectEl.value || '').trim();
    const text = String(textEl.value || '').trim();

    if (!subject || !text) {
      setStatus('subject and message are required', 'error');
      return;
    }

    if (!window.confirm('Send this email to the newsletter list?')) return;

    setStatus('sending…');
    sendBtn.disabled = true;

    window
      .fetch(kit.getFunctionsBase() + '/studio-send-newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject,
          text: text,
          html: textToHtml(text)
        })
      })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { res: res, data: data };
          });
      })
      .then(function (outcome) {
        if (!outcome.res.ok) {
          throw new Error((outcome.data && outcome.data.message) || 'send failed');
        }
        const sent = Number(outcome.data.sent) || 0;
        setStatus('sent to ' + sent + ' subscriber' + (sent === 1 ? '' : 's'), 'success');
        textEl.value = '';
      })
      .catch(function (err) {
        setStatus(err.message || 'send failed', 'error');
      })
      .then(function () {
        sendBtn.disabled = false;
      });
  }

  if (auth && auth.whenReady) {
    auth.whenReady().then(function () {
      loadSubscribers();
      if (sendBtn) sendBtn.addEventListener('click', sendEmail);
    });
  } else {
    setStatus('studio auth not loaded', 'error');
  }
})();
