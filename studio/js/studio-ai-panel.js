(function () {
  'use strict';

  var DIGEST_CACHE_KEY = 'bf_site_digest_cache_v5';
  var asking = false;
  var autoAsked = false;
  var pendingMoveAction = null;

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

  function authHeaders() {
    const auth = window.BurnfolderStudioAuth;
    return auth && auth.getAuthHeaders ? auth.getAuthHeaders() : {};
  }

  function hasAuth() {
    const auth = window.BurnfolderStudioAuth;
    return !!(auth && auth.getAuthHeaders && Object.keys(auth.getAuthHeaders()).length);
  }

  function setLine(text) {
    const el = document.getElementById('siteDigestHeadline');
    if (el) el.textContent = text || '';
  }

  function setBusy(busy) {
    const refresh = document.getElementById('marketDeskRefresh');
    const doBtn = document.getElementById('siteDigestQueueMove');
    if (refresh) refresh.disabled = !!busy;
    if (doBtn) doBtn.disabled = !!busy;
  }

  function dashboardContext(audiences) {
    const ctx = {
      goal:
        'marketing advisor: turn all snapshot data into one punchy action to maintain/scale; thank rarely and selectively; AI never pens fan-facing copy',
      antiGeneration: true,
      maxWeeklyActs: 7,
      ux: 'one imperative nextMove; artist opts in with do this'
    };
    try {
      const period = document.getElementById('dashboardAnalyticsPeriod');
      if (period && period.value) ctx.period = period.value;
    } catch (e) {
      /* noop */
    }
    if (audiences) ctx.audiences = audiences;
    return ctx;
  }

  function deskFetch(path, opts) {
    return fetch(apiBase() + path, opts).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    });
  }

  function snapshotFingerprint(snap) {
    if (!snap || typeof snap !== 'object') return '';
    const site = snap.site || {};
    const email = snap.email || snap.newsletter || {};
    const commerce = snap.commerce || {};
    return [
      snap.period || '',
      site.lands || 0,
      site.songPlays || 0,
      site.listenSeconds || 0,
      email.subscribers || 0,
      (commerce.tips && commerce.tips.count) || 0,
      (commerce.digital && commerce.digital.count) || 0,
      (commerce.shop && commerce.shop.count) || 0
    ].join(':');
  }

  function readDigestCache() {
    try {
      const raw = sessionStorage.getItem(DIGEST_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeDigestCache(digest, actions, fingerprint) {
    try {
      sessionStorage.setItem(
        DIGEST_CACHE_KEY,
        JSON.stringify({
          fingerprint: fingerprint || '',
          digest: digest || null,
          actions: Array.isArray(actions) ? actions : [],
          savedAt: Date.now()
        })
      );
    } catch (e) {
      /* noop */
    }
  }

  function restoreCachedDigest() {
    const snap =
      typeof window.studioGetAnalyticsSnapshot === 'function'
        ? window.studioGetAnalyticsSnapshot()
        : null;
    const cache = readDigestCache();
    if (!cache || !cache.digest) return false;
    if (snap && cache.fingerprint && cache.fingerprint !== snapshotFingerprint(snap)) return false;
    renderDigest(cache.digest, cache.actions || []);
    return true;
  }

  function loadDesk() {
    const list = document.getElementById('marketDeskQueue');
    const wrap = document.getElementById('marketDeskActs');
    if (!list) return Promise.resolve(null);

    return deskFetch('/studio-market-desk', { headers: authHeaders() })
      .then(function (result) {
        if (!result.ok || !result.data) {
          list.innerHTML = '';
          if (wrap) wrap.hidden = true;
          return null;
        }
        renderQueue(list, result.data.queue || []);
        return result.data;
      })
      .catch(function () {
        list.innerHTML = '';
        if (wrap) wrap.hidden = true;
        return null;
      });
  }

  function renderQueue(list, items) {
    const wrap = document.getElementById('marketDeskActs');
    list.innerHTML = '';
    const open = (items || []).filter(function (item) {
      return item.status !== 'cancelled' && item.status !== 'sent' && item.status !== 'done';
    });

    if (!open.length) {
      if (wrap) wrap.hidden = true;
      return;
    }

    if (wrap) wrap.hidden = false;
    open.forEach(function (item) {
      list.appendChild(queueCard(item));
    });
  }

  function isEmailable(item) {
    const mode = String((item && item.audience && item.audience.mode) || 'none').toLowerCase();
    if (mode === 'none' || mode === 'task' || !mode) return false;
    if (mode === 'manual') {
      return !!(item.audience && item.audience.emails && item.audience.emails.length);
    }
    if (mode === 'action') return !!(item.audience && item.audience.actionKey);
    if (mode === 'subscribers' || mode === 'subscribe') return true;
    return false;
  }

  function queueCard(item) {
    const card = document.createElement('article');
    card.className = 'studio-market-queue-card';
    card.dataset.id = item.id;

    const title = document.createElement('span');
    title.className = 'studio-market-queue-title';
    title.textContent = item.title || item.move || 'move';
    card.appendChild(title);

    if (item.why) {
      const why = document.createElement('p');
      why.className = 'studio-market-queue-meta';
      why.textContent = item.why;
      card.appendChild(why);
    }

    const emailable = isEmailable(item);
    let body = null;
    if (emailable) {
      body = document.createElement('textarea');
      body.className = 'studio-journal-textarea studio-journal-textarea--compact';
      body.rows = 3;
      body.placeholder = 'your words';
      body.value = item.body || '';
      body.setAttribute('aria-label', 'Email body');
      card.appendChild(body);
    } else if (item.aiHint) {
      const hint = document.createElement('p');
      hint.className = 'studio-dashboard-hint';
      hint.textContent = item.aiHint;
      card.appendChild(hint);
    }

    const actions = document.createElement('div');
    actions.className = 'studio-market-queue-actions';

    if (emailable) {
      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'studio-dashboard-action';
      send.textContent = 'send';
      send.addEventListener('click', function () {
        const firstLine = (body.value || '').split('\n')[0].trim();
        const subject = item.subject || firstLine.slice(0, 80) || title.textContent;
        updateItem(item.id, { subject: subject, body: body.value }).then(function () {
          return sendItem(item.id);
        });
      });
      actions.appendChild(send);
    } else {
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'studio-dashboard-action';
      done.textContent = 'done';
      done.addEventListener('click', function () {
        deskFetch('/studio-market-desk', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({ action: 'update', id: item.id, status: 'done' })
        }).then(loadDesk);
      });
      actions.appendChild(done);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'studio-dashboard-action';
    cancel.textContent = 'skip';
    cancel.addEventListener('click', function () {
      deskFetch('/studio-market-desk', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ action: 'cancel', id: item.id })
      }).then(loadDesk);
    });

    actions.appendChild(cancel);
    card.appendChild(actions);
    return card;
  }

  function updateItem(id, patch) {
    return deskFetch('/studio-market-desk', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(Object.assign({ action: 'update', id: id }, patch))
    }).then(function () {
      return loadDesk();
    });
  }

  function sendItem(id) {
    return deskFetch('/studio-market-desk', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ action: 'send', id: id })
    }).then(function () {
      return loadDesk();
    });
  }

  function queueActions(actions) {
    if (!actions || !actions.length) return Promise.resolve();
    return deskFetch('/studio-market-desk', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ action: 'queue', actions: actions })
    }).then(function () {
      return loadDesk();
    });
  }

  function normalizeAction(row) {
    if (!row || typeof row !== 'object') return null;
    const title = String(row.title || '').trim();
    if (title.length < 8) return null;
    if (/^(untitled|note|other|move|todo|action|act|item)\b/i.test(title)) return null;
    if (/^(more plays|nice week|looking good|keep going|great job)\b/i.test(title)) return null;
    const audience = row.audience && typeof row.audience === 'object' ? row.audience : {};
    return {
      move: String(row.move || 'act').slice(0, 40),
      title: title.slice(0, 160),
      why: String(row.why || '').slice(0, 600),
      cohortLabel: String(row.cohortLabel || '').slice(0, 160),
      audience: {
        mode: String(audience.mode || 'none').toLowerCase() || 'none',
        actionKey: String(audience.actionKey || '').slice(0, 80),
        emails: Array.isArray(audience.emails) ? audience.emails.slice(0, 50) : []
      },
      aiHint: String(row.aiHint || 'artist pens any outbound words').slice(0, 600),
      shareHint: String(row.shareHint || '').slice(0, 400)
    };
  }

  function actionFromDigest(digest, actions) {
    if (Array.isArray(actions) && actions.length) {
      const first = normalizeAction(actions[0]);
      if (first) return first;
    }
    if (!digest || !digest.nextMove) return null;
    const title = String(digest.nextMove).trim();
    return normalizeAction({
      move: 'act',
      title: title,
      why: '',
      audience: { mode: 'none', actionKey: '', emails: [] },
      aiHint: 'studio task — you do the move'
    });
  }

  function renderDigest(digest, actions) {
    const doBtn = document.getElementById('siteDigestQueueMove');

    if (!digest) {
      setLine('nothing to act on yet');
      if (doBtn) doBtn.hidden = true;
      pendingMoveAction = null;
      return;
    }

    const line = digest.nextMove || digest.headline || 'nothing to act on yet';
    setLine(line);

    pendingMoveAction = digest.nextMove ? actionFromDigest(digest, actions) : null;
    if (doBtn) doBtn.hidden = !pendingMoveAction;

    const snap =
      typeof window.studioGetAnalyticsSnapshot === 'function'
        ? window.studioGetAnalyticsSnapshot()
        : null;
    writeDigestCache(
      digest,
      pendingMoveAction ? [pendingMoveAction] : [],
      snapshotFingerprint(snap)
    );
  }

  function askDigest(force) {
    if (asking) return Promise.resolve();
    if (!hasAuth() && !force) {
      setLine('sign in to read the room');
      return Promise.resolve();
    }

    asking = true;
    setBusy(true);
    setLine('…');

    return loadDesk()
      .then(function (deskData) {
        const payload = {
          intent: 'digest',
          context: dashboardContext(deskData && deskData.audiences)
        };
        if (typeof window.studioGetAnalyticsSnapshot === 'function') {
          const snap = window.studioGetAnalyticsSnapshot();
          if (snap) payload.metricsSnapshot = snap;
        }
        return deskFetch('/studio-ai', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify(payload)
        });
      })
      .then(function (result) {
        const data = result.data || {};
        if (result.ok && data.digest) {
          renderDigest(data.digest, data.actions);
          return;
        }
        if (result.ok && data.reply) {
          setLine(String(data.reply).split('\n')[0].slice(0, 180));
          return;
        }
        setLine((data && data.message) || 'could not read the room');
      })
      .catch(function () {
        setLine('could not reach the desk');
      })
      .then(function () {
        asking = false;
        setBusy(false);
      });
  }

  function onAnalyticsReady(snapshot) {
    if (restoreCachedDigest()) {
      loadDesk();
      return;
    }

    loadDesk().then(function () {
      if (autoAsked) return;
      if (!snapshot) {
        setLine('nothing to say yet');
        return;
      }
      autoAsked = true;
      askDigest(false);
    });
  }

  function bind() {
    const refresh = document.getElementById('marketDeskRefresh');
    if (refresh && refresh.dataset.bound !== '1') {
      refresh.dataset.bound = '1';
      refresh.addEventListener('click', function () {
        autoAsked = true;
        const reload =
          typeof window.studioReloadAnalytics === 'function'
            ? window.studioReloadAnalytics()
            : Promise.resolve();
        Promise.resolve(reload)
          .catch(function () {})
          .then(function () {
            return askDigest(true);
          });
      });
    }

    const doBtn = document.getElementById('siteDigestQueueMove');
    if (doBtn && doBtn.dataset.bound !== '1') {
      doBtn.dataset.bound = '1';
      doBtn.addEventListener('click', function () {
        if (!pendingMoveAction) return;
        doBtn.disabled = true;
        queueActions([pendingMoveAction]).then(function () {
          pendingMoveAction = null;
          doBtn.hidden = true;
          doBtn.disabled = false;
          if (typeof window.studioFocusMarketQueue === 'function') {
            window.studioFocusMarketQueue();
          } else if (typeof window.studioShowDashboardPane === 'function') {
            window.studioShowDashboardPane('actions');
          }
        });
      });
    }
  }

  window.studioInitStudioAiPanel = function () {
    whenReady().then(function () {
      bind();
      onAnalyticsReady(
        typeof window.studioGetAnalyticsSnapshot === 'function'
          ? window.studioGetAnalyticsSnapshot()
          : null
      );
    });
  };

  window.studioAskDashboardAi = function (opts) {
    if (opts && opts.message) {
      return askDigest(true);
    }
    return askDigest(!!(opts && opts.intent));
  };
  window.studioLoadMarketDesk = loadDesk;
  window.studioRenderSiteDigest = renderDigest;
  window.studioOnAnalyticsReady = onAnalyticsReady;
  window.studioInitStudioAiPanel();
})();
