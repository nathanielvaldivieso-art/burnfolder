(function () {
  'use strict';

  function whenReady() {
    if (window.BurnfolderStudioAuth && window.BurnfolderStudioAuth.whenReady) {
      return window.BurnfolderStudioAuth.whenReady();
    }
    return Promise.resolve();
  }

  function apiBase() {
    const auth = window.BurnfolderStudioAuth;
    return auth && auth.getApiBase ? auth.getApiBase() : '/.netlify/functions';
  }

  function bindAi() {
    const form = document.getElementById('studioAiForm');
    const input = document.getElementById('studioAiInput');
    const out = document.getElementById('studioAiReply');
    if (!form || !input || !out || form.dataset.aiBound === '1') return;
    form.dataset.aiBound = '1';

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const auth = window.BurnfolderStudioAuth;
      out.textContent = '…';
      fetch(apiBase() + '/studio-ai', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, auth.getAuthHeaders()),
        body: JSON.stringify({ message: input.value.trim() })
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          const data = result.data || {};
          if (result.ok && data.reply) {
            out.textContent = data.reply;
            return;
          }
          out.textContent = data.message || 'No response';
        })
        .catch(function () {
          out.textContent = 'Could not reach AI.';
        });
    });
  }

  window.studioInitStudioAiPanel = function () {
    whenReady().then(bindAi);
  };

  window.studioInitStudioAiPanel();
})();
