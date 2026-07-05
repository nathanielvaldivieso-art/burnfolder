(function () {
  'use strict';

  const SESSION_KEY = 'burnfolder_studio_session';
  const SESSION_PERSIST_KEY = 'burnfolder_studio_session_persist';
  const LEGACY_TOKEN_KEY = 'burnfolder_studio_token';
  const waiters = [];
  let ready = false;
  let authMode = 'legacy';
  let session = null;
  let supabaseConfig = null;

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
      const raw =
        sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_PERSIST_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(next) {
    session = next;
    if (next) {
      const payload = JSON.stringify(next);
      sessionStorage.setItem(SESSION_KEY, payload);
      try {
        localStorage.setItem(SESSION_PERSIST_KEY, payload);
      } catch (e) {
        /* quota */
      }
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      try {
        localStorage.removeItem(SESSION_PERSIST_KEY);
      } catch (e) {
        /* noop */
      }
    }
  }

  function loadLegacyToken() {
    return (
      sessionStorage.getItem(LEGACY_TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || ''
    );
  }

  function saveLegacyToken(token) {
    if (token) {
      sessionStorage.setItem(LEGACY_TOKEN_KEY, token);
      try {
        localStorage.setItem(LEGACY_TOKEN_KEY, token);
      } catch (e) {
        /* quota */
      }
    } else {
      sessionStorage.removeItem(LEGACY_TOKEN_KEY);
      try {
        localStorage.removeItem(LEGACY_TOKEN_KEY);
      } catch (e) {
        /* noop */
      }
    }
  }

  function getToken() {
    if (authMode === 'supabase' && session && session.access_token) return session.access_token;
    return loadLegacyToken();
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
    saveLegacyToken('');
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

  /** Session expired or rejected — show login again without a full reload. */
  function revokeSession(showGate) {
    ready = false;
    hideBooting();
    document.body.classList.remove('studio-ready');
    const gate = document.getElementById('studioAuthGate');
    if (gate) gate.remove();
    if (typeof showGate === 'function') showGate();
  }

  function restoreSupabaseSession(existing, config) {
    session = existing;
    markReady();
    verifySupabaseSession(existing)
      .then(function (ok) {
        if (ok) {
          session = loadSession() || existing;
          return;
        }
        saveSession(null);
        session = null;
        revokeSession(function () {
          showSupabaseLoginGate(config);
        });
      })
      .catch(function () {
        /* offline / transient — keep the cached session */
      });
  }

  function restoreLegacySession(token) {
    markReady();
    verifyLegacyToken(token)
      .then(function (ok) {
        if (ok) return;
        saveLegacyToken('');
        revokeSession(showLegacyLoginGate);
      })
      .catch(function () {
        /* offline / transient — keep the cached session */
      });
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
      .then(function (config) {
        supabaseConfig = config || null;
        return config;
      })
      .catch(function () {
        return { authMode: 'legacy' };
      });
  }

  function refreshSupabaseToken(existing) {
    if (!existing || !existing.refresh_token || !supabaseConfig || !supabaseConfig.supabaseUrl) {
      return Promise.resolve(null);
    }
    return nativeFetch(supabaseConfig.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: {
        apikey: supabaseConfig.supabaseAnonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: existing.refresh_token })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) return null;
          return data;
        });
      })
      .catch(function () {
        return null;
      });
  }

  function applyRefreshedTokens(existing, data) {
    if (!data || !data.access_token) return false;
    existing.access_token = data.access_token;
    if (data.refresh_token) existing.refresh_token = data.refresh_token;
    saveSession(existing);
    return true;
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
      if (res.status === 401 && existing.refresh_token) {
        return refreshSupabaseToken(existing).then(function (data) {
          if (!applyRefreshedTokens(existing, data)) return false;
          return verifySupabaseSession(existing);
        });
      }
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

  function refreshSessionIfNeeded() {
    if (authMode !== 'supabase' || !session || !session.access_token) return Promise.resolve();
    return verifySupabaseSession(session)
      .then(function (ok) {
        if (!ok) return;
        session = loadSession() || session;
      })
      .catch(function () {
        /* keep current session until an API call fails */
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
          saveLegacyToken(password);
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
          restoreSupabaseSession(existing, config);
          return;
        }
        showSupabaseLoginGate(config);
        return;
      }

      const legacy = loadLegacyToken();
      if (legacy) {
        restoreLegacySession(legacy);
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

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    refreshSessionIfNeeded();
  });
})();
