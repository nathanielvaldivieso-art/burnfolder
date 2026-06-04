(function () {
  'use strict';

  const SESSION_KEY = 'burnfolder_studio_token';
  const waiters = [];
  let ready = false;

  // Capture the real fetch before we wrap window.fetch below. The login check
  // must use this directly, otherwise it would wait on whenReady() (which only
  // resolves after a successful login) and deadlock — the unlock button would
  // appear to do nothing.
  const nativeFetch = window.fetch.bind(window);

  function getMuxApiBase() {
    const cfg = window.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');
    if (location.port === '8888' || location.hostname.endsWith('.netlify.app')) {
      return '/.netlify/functions';
    }
    return 'http://localhost:8888/.netlify/functions';
  }

  function needsStudioAuth(url) {
    const u = String(url || '');
    // Mux management calls and the personal-cloud state store need the bearer.
    // The login check carries the password in its body and must NOT route
    // through the auth wrapper.
    return u.indexOf('/mux-') > -1 || u.indexOf('/studio-state') > -1;
  }

  function getToken() {
    return sessionStorage.getItem(SESSION_KEY) || '';
  }

  function getAuthHeaders() {
    const token = getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    ready = false;
    window.location.reload();
  }

  function ensureNavTools() {
    const nav = document.querySelector('.studio-main-nav');
    if (!nav) return null;
    let tools = nav.querySelector('.studio-nav-tools');
    if (!tools) {
      tools = document.createElement('span');
      tools.className = 'studio-nav-tools';
      nav.appendChild(tools);
    }
    return tools;
  }

  function mountLockButton() {
    const tools = ensureNavTools();
    if (!tools || tools.querySelector('.studio-lock-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'studio-lock-btn';
    btn.textContent = 'lock';
    btn.setAttribute('aria-label', 'Lock studio');
    btn.addEventListener('click', function () {
      logout();
    });
    tools.appendChild(btn);
  }

  function markReady() {
    ready = true;
    document.body.classList.remove('studio-locked');
    const gate = document.getElementById('studioAuthGate');
    if (gate) gate.remove();
    mountLockButton();
    waiters.splice(0).forEach(function (resolve) {
      resolve();
    });
    window.dispatchEvent(new CustomEvent('burnfolder-studio-authed'));
  }

  function whenReady() {
    if (ready) return Promise.resolve();
    return new Promise(function (resolve) {
      waiters.push(resolve);
    });
  }

  function verifyToken(token) {
    return nativeFetch(getMuxApiBase() + '/studio-auth-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: token })
    }).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (data) {
        return res.ok && data.ok === true;
      });
    });
  }

  function showLoginGate() {
    document.body.classList.add('studio-locked');

    const gate = document.createElement('div');
    gate.id = 'studioAuthGate';
    gate.className = 'studio-auth-gate';
    gate.innerHTML =
      '<form class="studio-auth-form" autocomplete="current-password">' +
      '<p class="page-id">studio</p>' +
      '<p class="studio-auth-lede">Enter your studio password to manage uploads and the stream library.</p>' +
      '<label class="studio-auth-label" for="studioAuthPassword">password</label>' +
      '<input id="studioAuthPassword" class="studio-auth-input" type="password" autocomplete="current-password" required>' +
      '<p class="studio-auth-error" id="studioAuthError" hidden></p>' +
      '<button type="submit" class="studio-auth-submit">unlock</button>' +
      '</form>';

    document.body.appendChild(gate);

    const form = gate.querySelector('.studio-auth-form');
    const input = gate.querySelector('#studioAuthPassword');
    const errorEl = gate.querySelector('#studioAuthError');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const password = input.value || '';
      errorEl.hidden = true;
      errorEl.textContent = '';

      verifyToken(password).then(function (ok) {
        if (!ok) {
          errorEl.textContent = 'Wrong password.';
          errorEl.hidden = false;
          input.select();
          return;
        }
        sessionStorage.setItem(SESSION_KEY, password);
        markReady();
      }).catch(function () {
        errorEl.textContent = 'Could not reach the server. Try again.';
        errorEl.hidden = false;
      });
    });

    window.setTimeout(function () {
      input.focus();
    }, 0);
  }

  function boot() {
    const existing = getToken();
    if (existing) {
      verifyToken(existing).then(function (ok) {
        if (ok) {
          markReady();
          return;
        }
        sessionStorage.removeItem(SESSION_KEY);
        showLoginGate();
      }).catch(function () {
        showLoginGate();
      });
      return;
    }
    showLoginGate();
  }

  window.fetch = function (url, options) {
    if (!needsStudioAuth(url)) {
      return nativeFetch(url, options);
    }

    return whenReady().then(function () {
      const opts = options ? Object.assign({}, options) : {};
      const headers = new Headers(opts.headers || {});
      const authHeaders = getAuthHeaders();
      Object.keys(authHeaders).forEach(function (key) {
        if (!headers.has(key)) headers.set(key, authHeaders[key]);
      });
      opts.headers = headers;
      return nativeFetch(url, opts);
    });
  };

  window.BurnfolderStudioAuth = {
    whenReady: whenReady,
    getAuthHeaders: getAuthHeaders,
    logout: logout
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
