(function () {
  'use strict';

  const SESSION_KEY = 'burnfolder_studio_session';
  const waiters = [];
  let ready = false;
  let authMode = 'legacy';
  let session = null;

  const nativeFetch = window.fetch.bind(window);

  function getMuxApiBase() {
    const cfg = window.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');
    const host = location.hostname;
    const isLocalDevServer =
      (host === 'localhost' || host === '127.0.0.1') && location.port && location.port !== '8888';
    if (isLocalDevServer) return 'http://localhost:8888/.netlify/functions';
    return '/.netlify/functions';
  }

  function needsStudioAuth(url) {
    const u = String(url || '');
    return (
      u.indexOf('/mux-') > -1 ||
      u.indexOf('/studio-state') > -1 ||
      u.indexOf('/studio-publish') > -1 ||
      u.indexOf('/studio-share-links') > -1 ||
      u.indexOf('/studio-workspace') > -1 ||
      u.indexOf('/studio-music-projects') > -1 ||
      u.indexOf('/studio-ai') > -1 ||
      u.indexOf('/studio-export') > -1
    );
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(next) {
    session = next;
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
  }

  function getToken() {
    if (authMode === 'supabase' && session && session.access_token) return session.access_token;
    return sessionStorage.getItem('burnfolder_studio_token') || '';
  }

  function getAuthHeaders() {
    if (authMode === 'supabase' && session && session.access_token) {
      const headers = { Authorization: 'Bearer ' + session.access_token };
      if (session.workspaceId) headers['X-Workspace-Id'] = session.workspaceId;
      return headers;
    }
    const token = getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function logout() {
    saveSession(null);
    sessionStorage.removeItem('burnfolder_studio_token');
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
    btn.addEventListener('click', logout);
    tools.appendChild(btn);
  }

  function hideBooting() {
    document.body.classList.remove('studio-booting');
  }

  function showBooting() {
    document.body.classList.add('studio-booting');
  }

  function applyAccessGating() {
    if (!session || session.accessMode !== 'music-project') return;
    document.body.classList.add('studio-music-only');
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      if (link.dataset.nav !== 'stream') link.hidden = true;
    });
    const path = location.pathname || '';
    if (
      path.indexOf('/studio/stream') < 0 &&
      path.indexOf('stream.html') < 0 &&
      path.indexOf('stream-album') < 0 &&
      path.indexOf('stream-song') < 0 &&
      path.indexOf('invite.html') < 0
    ) {
      window.location.replace('/studio/stream.html');
    }
  }

  function markReady() {
    ready = true;
    hideBooting();
    document.body.classList.remove('studio-locked');
    document.body.classList.add('studio-ready');
    const gate = document.getElementById('studioAuthGate');
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    if (gate) gate.remove();
    mountLockButton();
    applyAccessGating();
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

  function fetchPublicConfig() {
    return nativeFetch(getMuxApiBase() + '/studio-public-config')
      .then(function (res) {
        return res.json();
      })
      .catch(function () {
        return { authMode: 'legacy' };
      });
  }

  function loadWorkspaceSession(accessToken) {
    return nativeFetch(getMuxApiBase() + '/studio-workspace', {
      headers: {
        Authorization: 'Bearer ' + accessToken
      }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('workspace');
        return res.json();
      })
      .then(function (data) {
        const ws = data.workspace || {};
        const projects = Array.isArray(data.projects) ? data.projects : [];
        return {
          access_token: accessToken,
          workspaceId: ws.id,
          slug: ws.slug,
          name: ws.name,
          role: ws.role,
          accessMode: ws.accessMode || 'owner',
          projects: projects,
          email: null
        };
      });
  }

  function supabaseSignIn(config, email, password) {
    return nativeFetch(config.supabaseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: email, password: password })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            throw new Error((data && data.error_description) || (data && data.msg) || 'Sign in failed');
          }
          return data;
        });
      })
      .then(function (data) {
        return loadWorkspaceSession(data.access_token).then(function (wsSession) {
          wsSession.access_token = data.access_token;
          wsSession.refresh_token = data.refresh_token;
          wsSession.email = email;
          return wsSession;
        });
      });
  }

  function verifySupabaseSession(existing) {
    return nativeFetch(getMuxApiBase() + '/studio-workspace', {
      headers: {
        Authorization: 'Bearer ' + existing.access_token,
        'X-Workspace-Id': existing.workspaceId || ''
      }
    }).then(function (res) {
      if (!res.ok) return false;
      return res.json().then(function (data) {
        const ws = data.workspace || {};
        existing.workspaceId = ws.id;
        existing.slug = ws.slug;
        existing.name = ws.name;
        existing.role = ws.role;
        existing.accessMode = ws.accessMode || 'owner';
        existing.projects = Array.isArray(data.projects) ? data.projects : [];
        saveSession(existing);
        return true;
      });
    });
  }

  function verifyLegacyToken(token) {
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

  function showSupabaseLoginGate(config) {
    hideBooting();
    document.body.classList.add('studio-ready', 'studio-locked');

    const gate = document.createElement('div');
    gate.id = 'studioAuthGate';
    gate.className = 'studio-auth-gate';
    gate.innerHTML =
      '<form class="studio-auth-form" autocomplete="on">' +
      '<p class="page-id">studio</p>' +
      '<p class="studio-auth-lede">Sign in with your Burnfolder Studio account.</p>' +
      '<label class="studio-auth-label" for="studioAuthEmail">email</label>' +
      '<input id="studioAuthEmail" class="studio-auth-input" type="email" autocomplete="username" required>' +
      '<label class="studio-auth-label" for="studioAuthPassword">password</label>' +
      '<input id="studioAuthPassword" class="studio-auth-input" type="password" autocomplete="current-password" required>' +
      '<p class="studio-auth-error" id="studioAuthError" hidden></p>' +
      '<button type="submit" class="studio-auth-submit">sign in</button>' +
      '</form>';

    document.body.appendChild(gate);

    const form = gate.querySelector('.studio-auth-form');
    const emailInput = gate.querySelector('#studioAuthEmail');
    const passwordInput = gate.querySelector('#studioAuthPassword');
    const errorEl = gate.querySelector('#studioAuthError');
    const submitBtn = gate.querySelector('.studio-auth-submit');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      errorEl.hidden = true;
      errorEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'signing in…';

      supabaseSignIn(config, emailInput.value.trim(), passwordInput.value)
        .then(function (nextSession) {
          saveSession(nextSession);
          markReady();
        })
        .catch(function (err) {
          errorEl.textContent = (err && err.message) || 'Sign in failed.';
          errorEl.hidden = false;
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'sign in';
        });
    });
  }

  function showLegacyLoginGate() {
    hideBooting();
    document.body.classList.add('studio-ready', 'studio-locked');

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
    const submitBtn = gate.querySelector('.studio-auth-submit');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const password = input.value || '';
      errorEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'checking…';

      verifyLegacyToken(password)
        .then(function (ok) {
          if (!ok) {
            errorEl.textContent = 'Wrong password.';
            errorEl.hidden = false;
            input.select();
            return;
          }
          sessionStorage.setItem('burnfolder_studio_token', password);
          markReady();
        })
        .catch(function () {
          errorEl.textContent = 'Could not reach the server. Try again.';
          errorEl.hidden = false;
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'unlock';
        });
    });
  }

  function boot() {
    fetchPublicConfig().then(function (config) {
      authMode = config.authMode === 'supabase' ? 'supabase' : 'legacy';

      if (authMode === 'supabase') {
        const existing = loadSession();
        if (existing && existing.access_token) {
          showBooting();
          verifySupabaseSession(existing)
            .then(function (ok) {
              if (ok) {
                session = existing;
                markReady();
                return;
              }
              saveSession(null);
              showSupabaseLoginGate(config);
            })
            .catch(function () {
              showSupabaseLoginGate(config);
            });
          return;
        }
        showSupabaseLoginGate(config);
        return;
      }

      const legacy = sessionStorage.getItem('burnfolder_studio_token');
      if (legacy) {
        showBooting();
        verifyLegacyToken(legacy).then(function (ok) {
          if (ok) markReady();
          else {
            sessionStorage.removeItem('burnfolder_studio_token');
            showLegacyLoginGate();
          }
        }).catch(function () {
          showLegacyLoginGate();
        });
        return;
      }
      showLegacyLoginGate();
    });
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
    isReady: function () {
      return ready;
    },
    getAuthHeaders: getAuthHeaders,
    logout: logout,
    getSession: function () {
      return session;
    },
    getRole: function () {
      return (session && session.role) || (authMode === 'legacy' ? 'owner' : 'guest');
    },
    canPublish: function () {
      return window.BurnfolderStudioAuth.getRole() === 'owner';
    },
    isMusicProjectOnly: function () {
      return session && session.accessMode === 'music-project';
    },
    canWriteMusic: function () {
      if (!session) return authMode === 'legacy';
      if (session.accessMode === 'owner' || session.role === 'owner') return true;
      return session.role === 'music-collaborator';
    },
    getApiBase: getMuxApiBase,
    getAuthMode: function () {
      return authMode;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
