(function () {
  'use strict';

  var lastSnapshot = null;

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

  function bindOwnerMeta() {
    const auth = window.BurnfolderStudioAuth;
    if (!auth || auth.getAuthMode() !== 'supabase') return;

    const meta = document.getElementById('dashboardWorkspaceMeta');
    const session = auth.getSession();
    if (meta && session && session.accessMode === 'owner') {
      meta.textContent = (session.name || session.slug || 'workspace') + ' · owner';
      meta.hidden = false;
    }

    const ownerTools = document.getElementById('ownerToolsSection');
    if (ownerTools && auth.canPublish()) {
      ownerTools.hidden = false;
    }
  }

  function bindExport() {
    const btn = document.getElementById('workspaceExportBtn');
    if (!btn || btn.dataset.exportBound === '1') return;
    btn.dataset.exportBound = '1';
    btn.addEventListener('click', function () {
      const auth = window.BurnfolderStudioAuth;
      if (!auth || !auth.canPublish()) return;
      fetch(apiBase() + '/studio-export', { headers: auth.getAuthHeaders() })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'burnfolder-workspace-export.json';
          link.click();
          URL.revokeObjectURL(url);
        });
    });
  }

  function fmtNum(n) {
    return String(Math.round(Number(n) || 0));
  }

  function fmtSeconds(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return m + 'm ' + rem + 's';
    const h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm';
  }

  function fmtMoney(n) {
    return '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function section(title) {
    const wrap = el('div', 'studio-analytics-block');
    wrap.appendChild(el('h3', 'studio-analytics-heading', title));
    return wrap;
  }

  function metricRow(label, value) {
    const row = el('div', 'studio-analytics-metric');
    row.appendChild(el('span', 'studio-analytics-metric-label', label));
    row.appendChild(el('span', 'studio-analytics-metric-value', value));
    return row;
  }

  function listRows(items, mapFn) {
    const list = el('div', 'studio-dashboard-list studio-analytics-list');
    (items || []).forEach(function (item) {
      const mapped = mapFn(item);
      if (!mapped) return;
      const row = el('div', 'studio-dashboard-list-row');
      row.appendChild(el('span', 'studio-dashboard-list-label', mapped.label));
      row.appendChild(el('span', 'studio-dashboard-list-date', mapped.value));
      list.appendChild(row);
    });
    if (!list.children.length) {
      list.appendChild(el('p', 'studio-dashboard-hint', 'no data yet'));
    }
    return list;
  }

  function renderSnapshot(snapshot) {
    const empty = document.getElementById('dashboardAnalyticsEmpty');
    const feed = document.getElementById('dashboardAnalyticsFeed');
    if (!feed) return;

    lastSnapshot = snapshot || null;
    window.__burnfolderAnalyticsSnapshot = lastSnapshot;

    if (!snapshot) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'could not load analytics.';
      }
      feed.hidden = true;
      feed.innerHTML = '';
      return;
    }

    if (empty) empty.hidden = true;
    feed.hidden = false;
    feed.innerHTML = '';

    const site = snapshot.site || {};
    const overview = section('site');
    const grid = el('div', 'studio-analytics-grid');
    grid.appendChild(metricRow('lands', fmtNum(site.lands)));
    grid.appendChild(metricRow('plays', fmtNum(site.songPlays)));
    grid.appendChild(metricRow('listen time', fmtSeconds(site.listenSeconds)));
    grid.appendChild(metricRow('completions', fmtNum(site.completions)));
    overview.appendChild(grid);
    feed.appendChild(overview);

    const songs = section('songs');
    songs.appendChild(
      listRows(snapshot.songs, function (song) {
        return {
          label: song.title || song.groupKey || 'untitled',
          value: fmtNum(song.plays) + ' · ' + fmtSeconds(song.seconds)
        };
      })
    );
    feed.appendChild(songs);

    const shares = snapshot.shares || {};
    const shareBlock = section('share links');
    const shareGrid = el('div', 'studio-analytics-grid');
    shareGrid.appendChild(metricRow('links', fmtNum(shares.linkCount)));
    shareGrid.appendChild(metricRow('plays', fmtNum(shares.totalPlays)));
    shareBlock.appendChild(shareGrid);
    shareBlock.appendChild(
      listRows(shares.top, function (row) {
        return {
          label: row.title || 'untitled',
          value: fmtNum(row.playCount)
        };
      })
    );
    feed.appendChild(shareBlock);

    const commerce = snapshot.commerce || {};
    const money = section('money');
    const moneyGrid = el('div', 'studio-analytics-grid');
    moneyGrid.appendChild(
      metricRow('tips', fmtNum(commerce.tips && commerce.tips.count) + ' · ' + fmtMoney(commerce.tips && commerce.tips.dollars))
    );
    moneyGrid.appendChild(
      metricRow(
        'digital',
        fmtNum(commerce.digital && commerce.digital.count) +
          ' · ' +
          fmtMoney(commerce.digital && commerce.digital.dollars)
      )
    );
    moneyGrid.appendChild(
      metricRow('shop', fmtNum(commerce.shop && commerce.shop.count) + ' · ' + fmtMoney(commerce.shop && commerce.shop.dollars))
    );
    if (snapshot.newsletter && snapshot.newsletter.subscribers != null) {
      moneyGrid.appendChild(metricRow('newsletter', fmtNum(snapshot.newsletter.subscribers)));
    }
    money.appendChild(moneyGrid);
    feed.appendChild(money);

    const pathBlock = section('paths / utm');
    pathBlock.appendChild(
      listRows(snapshot.paths, function (row) {
        return {
          label: row.page || '/',
          value: fmtNum(row.lands) + ' land · ' + fmtNum(row.plays) + ' play'
        };
      })
    );
    if (snapshot.utm && snapshot.utm.length) {
      pathBlock.appendChild(el('p', 'studio-analytics-subhead', 'utm'));
      pathBlock.appendChild(
        listRows(snapshot.utm, function (row) {
          const label = [row.source, row.medium, row.campaign].filter(Boolean).join(' / ') || 'utm';
          return { label: label, value: fmtNum(row.lands) };
        })
      );
    }
    if (snapshot.referrers && snapshot.referrers.length) {
      pathBlock.appendChild(el('p', 'studio-analytics-subhead', 'referrers'));
      pathBlock.appendChild(
        listRows(snapshot.referrers, function (row) {
          return { label: row.host || 'direct', value: fmtNum(row.lands) };
        })
      );
    }
    feed.appendChild(pathBlock);

    const outbound = section('outbound');
    outbound.appendChild(
      listRows(snapshot.outbound, function (row) {
        return { label: row.dest || 'other', value: fmtNum(row.clicks) };
      })
    );
    feed.appendChild(outbound);

    const cf = snapshot.cloudflare || {};
    const traffic = section('cloudflare');
    if (cf.configured && !cf.error) {
      const cfGrid = el('div', 'studio-analytics-grid');
      cfGrid.appendChild(metricRow('pageviews (7d)', fmtNum(cf.pageviews)));
      cfGrid.appendChild(metricRow('visits (7d)', fmtNum(cf.visits)));
      traffic.appendChild(cfGrid);
    } else {
      traffic.appendChild(
        el(
          'p',
          'studio-dashboard-hint',
          cf.error ||
            cf.hint ||
            'Cloudflare beacon is live on the public site. Optional API env pulls volume here.'
        )
      );
    }
    feed.appendChild(traffic);

    const dsp = snapshot.dsp || {};
    const dspBlock = section('dsp');
    dspBlock.appendChild(el('p', 'studio-dashboard-hint', dsp.note || 'pending after release goes live'));
    feed.appendChild(dspBlock);

    if (site.updatedAt) {
      feed.appendChild(el('p', 'studio-dashboard-hint', 'updated ' + site.updatedAt));
    }
  }

  function loadAnalytics() {
    const auth = window.BurnfolderStudioAuth;
    const empty = document.getElementById('dashboardAnalyticsEmpty');
    if (!auth || !auth.getAuthHeaders) {
      if (empty) empty.textContent = 'sign in to load analytics.';
      return Promise.resolve();
    }
    if (empty) empty.textContent = 'loading…';

    return fetch(apiBase() + '/studio-analytics', { headers: auth.getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data || !result.data.snapshot) {
          if (empty) {
            empty.hidden = false;
            empty.textContent = (result.data && result.data.message) || 'analytics unavailable.';
          }
          return;
        }
        renderSnapshot(result.data.snapshot);
      })
      .catch(function () {
        if (empty) {
          empty.hidden = false;
          empty.textContent = 'could not reach analytics.';
        }
      });
  }

  function initDashboardPage() {
    const auth = window.BurnfolderStudioAuth;
    if (auth && auth.isMusicProjectOnly && auth.isMusicProjectOnly()) {
      window.location.replace('/studio/stream.html');
      return;
    }
    bindOwnerMeta();
    bindExport();
    loadAnalytics().then(function () {
      if (window.studioInitStudioAiPanel) window.studioInitStudioAiPanel();
    });
  }

  window.studioGetAnalyticsSnapshot = function () {
    return lastSnapshot || window.__burnfolderAnalyticsSnapshot || null;
  };

  window.studioInitDashboardPage = function () {
    whenReady().then(initDashboardPage);
  };

  window.studioInitDashboardPage();
})();
