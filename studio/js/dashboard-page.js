(function () {
  'use strict';

  var lastSnapshot = null;
  var currentPeriod = 'week';
  var currentPane = 'listen';
  var currentListenSource = 'site';
  var PERIOD_KEY = 'bf_analytics_period';
  var LISTEN_SOURCE_KEY = 'bf_analytics_listen_source';

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

  function readStoredPeriod() {
    try {
      const stored = localStorage.getItem(PERIOD_KEY);
      if (stored && /^(hour|day|week|month|year|all)$/.test(stored)) return stored;
    } catch (e) {
      /* noop */
    }
    return 'week';
  }

  function storePeriod(period) {
    currentPeriod = period;
    try {
      localStorage.setItem(PERIOD_KEY, period);
    } catch (e) {
      /* noop */
    }
  }

  function bindOwnerMeta() {
    const auth = window.BurnfolderStudioAuth;
    if (!auth || auth.getAuthMode() !== 'supabase') return;

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

  function readStoredListenSource() {
    try {
      const stored = localStorage.getItem(LISTEN_SOURCE_KEY);
      if (stored === 'site' || stored === 'dsp') return stored;
    } catch (e) {
      /* noop */
    }
    return 'site';
  }

  function storeListenSource(source) {
    currentListenSource = source === 'dsp' ? 'dsp' : 'site';
    try {
      localStorage.setItem(LISTEN_SOURCE_KEY, currentListenSource);
    } catch (e) {
      /* noop */
    }
  }

  function bindListenSubtabs() {
    const nav = document.getElementById('dashboardListenSubtabs');
    if (!nav || nav.dataset.bound === '1') return;
    nav.dataset.bound = '1';
    nav.addEventListener('click', function (event) {
      const btn = event.target.closest('.studio-analytics-subtab');
      if (!btn || !nav.contains(btn)) return;
      const source = btn.dataset.listen;
      if (!source || source === currentListenSource) return;
      storeListenSource(source);
      syncListenSubtabs();
      showListenSource();
    });
  }

  function syncListenSubtabs() {
    const nav = document.getElementById('dashboardListenSubtabs');
    if (!nav) return;
    const onListen = currentPane === 'listen';
    nav.hidden = !onListen;
    Array.prototype.forEach.call(nav.querySelectorAll('.studio-analytics-subtab'), function (btn) {
      btn.classList.toggle('is-active', btn.dataset.listen === currentListenSource);
    });
  }

  function showListenSource() {
    const sitePane = document.getElementById('listenSourceSite');
    const dspPane = document.getElementById('listenSourceDsp');
    if (sitePane) sitePane.hidden = currentListenSource !== 'site';
    if (dspPane) dspPane.hidden = currentListenSource !== 'dsp';
  }

  function bindPeriodNav() {
    const select = document.getElementById('dashboardAnalyticsPeriod');
    if (!select || select.dataset.bound === '1') return;
    select.dataset.bound = '1';
    select.addEventListener('change', function () {
      const period = select.value;
      if (!period || period === currentPeriod) return;
      storePeriod(period);
      loadAnalytics(period);
    });
  }

  function syncPeriodButtons() {
    const nav = document.getElementById('dashboardAnalyticsNav');
    const tabs = document.getElementById('dashboardAnalyticsTabs');
    const select = document.getElementById('dashboardAnalyticsPeriod');
    if (nav) nav.hidden = false;
    if (tabs) tabs.hidden = false;
    if (select) select.value = currentPeriod;
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

  function metricRow(label, value) {
    const row = el('div', 'studio-analytics-metric');
    row.appendChild(el('span', 'studio-analytics-metric-label', label));
    row.appendChild(el('span', 'studio-analytics-metric-value', value));
    return row;
  }

  function listRows(items, mapFn, emptyText) {
    const list = el('div', 'studio-dashboard-list studio-analytics-list');
    let count = 0;
    (items || []).forEach(function (item, index) {
      const mapped = mapFn(item, index);
      if (!mapped) return;
      count += 1;
      const row = el('div', 'studio-dashboard-list-row');
      row.appendChild(el('span', 'studio-dashboard-list-label', mapped.label));
      row.appendChild(el('span', 'studio-dashboard-list-date', mapped.value));
      list.appendChild(row);
    });
    if (!count) {
      list.appendChild(el('p', 'studio-dashboard-hint', emptyText || 'no data yet'));
    }
    return list;
  }

  function fmtTimecode(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m + ':' + String(rem).padStart(2, '0');
  }

  function songHeatSeconds(song) {
    const raw = Array.isArray(song && song.heat) ? song.heat : [];
    let heat = raw.map(function (v) {
      return Number(v) || 0;
    });
    let hasHeat = heat.some(function (v) {
      return v > 0;
    });
    const heatUnit = song && song.heatUnit;

    const samples = Number(song && song.spanSamples) || 0;
    let start = song && song.lastStartSeconds;
    let stop = song && song.lastStopSeconds;
    if (samples > 0 && song.startSum != null && song.stopSum != null) {
      start = song.startSum / samples;
      stop = song.stopSum / samples;
    }
    const durationSeconds = Number(song && song.durationSeconds) || 0;
    // length-32 arrays are almost always legacy coarse bins, even if mis-tagged.
    const legacyBins = heat.length === 32 && (heatUnit !== 's' || durationSeconds > 40);
    const duration = Math.max(
      durationSeconds,
      legacyBins ? 0 : heat.length,
      Number(stop) || 0,
      1
    );
    const len = Math.max(1, Math.ceil(duration));

    if (hasHeat && legacyBins) {
      const expanded = [];
      for (let i = 0; i < len; i++) expanded.push(0);
      for (let i = 0; i < 32; i++) {
        const v = heat[i];
        if (v <= 0) continue;
        const a = Math.floor((i / 32) * len);
        const b = Math.max(a + 1, Math.floor(((i + 1) / 32) * len));
        // Coverage only — legacy weights were not true pass counts.
        for (let s = a; s < b && s < len; s++) expanded[s] = Math.max(expanded[s], 1);
      }
      heat = expanded;
    } else if (hasHeat && heat.length < len) {
      while (heat.length < len) heat.push(0);
    } else if (!hasHeat) {
      heat = [];
      for (let i = 0; i < len; i++) heat.push(0);
    }

    if (hasHeat) {
      for (let i = 0; i < heat.length; i++) {
        heat[i] = Math.max(0, Math.round(Number(heat[i]) || 0));
      }
    }

    // Display curve: median-smooth kills single-second boundary spikes while
    // keeping the real shape. Scrub readout still uses raw pass counts.
    const display = smoothHeatMedian(heat, 2);
    let max = 0;
    let peakAt = 0;
    let rawMax = 0;
    for (let i = 0; i < heat.length; i++) {
      if (heat[i] > rawMax) rawMax = heat[i];
      if (display[i] > max) {
        max = display[i];
        peakAt = i;
      }
    }
    return {
      heat: heat,
      display: display,
      max: max,
      rawMax: rawMax,
      peakAt: peakAt,
      duration: heat.length,
      approxSpan:
        !hasHeat && start != null && stop != null && stop > start
          ? { start: start, stop: stop }
          : null
    };
  }

  function smoothHeatMedian(heat, radius) {
    const r = Math.max(0, Number(radius) || 0);
    const out = [];
    for (let i = 0; i < heat.length; i++) {
      const window = [];
      for (let j = i - r; j <= i + r; j++) {
        if (j < 0 || j >= heat.length) continue;
        window.push(Number(heat[j]) || 0);
      }
      window.sort(function (a, b) {
        return a - b;
      });
      const mid = Math.floor(window.length / 2);
      out.push(window.length % 2 ? window[mid] : (window[mid - 1] + window[mid]) / 2);
    }
    return out;
  }

  function scrubTrend(heat, index, max) {
    const cur = Number(heat[index]) || 0;
    const prev = Number(heat[Math.max(0, index - 1)]) || 0;
    const next = Number(heat[Math.min(heat.length - 1, index + 1)]) || 0;
    const peak = Math.max(Number(max) || 0, 1);
    if (cur <= 0) return 'quiet';
    if (cur >= peak * 0.98) return 'most heard';
    if (cur - prev >= peak * 0.2 && cur >= next) return 'picking up';
    if (prev - cur >= peak * 0.2 && cur <= next) return 'slowing';
    if (cur > 0) return 'relative';
    return 'quiet';
  }

  function relativeShade(passes, max) {
    if (!(max > 0) || !(passes > 0)) return 0;
    return Math.max(0, Math.min(1, passes / max));
  }

  function renderSongHeat(song) {
    const data = songHeatSeconds(song);
    const wrap = el('div', 'studio-song-scrub');
    const track = el('div', 'studio-song-scrub-track');
    const canvas = document.createElement('canvas');
    canvas.className = 'studio-song-scrub-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const playhead = el('div', 'studio-song-scrub-playhead');
    playhead.hidden = true;
    const readout = el(
      'p',
      'studio-song-scrub-readout',
      data.max > 0 ? 'scrub — shade is relative to this song' : 'play the track to build second markers'
    );
    track.appendChild(canvas);
    track.appendChild(playhead);
    wrap.appendChild(track);
    wrap.appendChild(readout);

    track.setAttribute('role', 'slider');
    track.setAttribute('tabindex', '0');
    track.setAttribute('aria-label', 'Listen density scrubber');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(Math.max(0, data.duration - 1)));
    track.setAttribute('aria-valuenow', '0');
    track.setAttribute('aria-valuetext', '0:00');

    function draw() {
      const width = Math.max(1, track.clientWidth || wrap.clientWidth || 320);
      const height = 28;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const series = data.display || data.heat;
      const n = Math.max(1, series.length);
      const gap = 0;
      const barW = Math.max(1, width / n - gap);
      const color = getComputedStyle(wrap).color || '#111';
      ctx.fillStyle = color;

      for (let i = 0; i < n; i++) {
        const passes = series[i] || 0;
        const t = relativeShade(passes, data.max);
        if (passes <= 0) {
          ctx.globalAlpha = 0.05;
          ctx.fillRect(i * (width / n), height - 1, barW, 1);
          continue;
        }
        const h = Math.max(2, Math.round(t * (height - 2)));
        ctx.globalAlpha = 0.12 + t * 0.88;
        ctx.fillRect(i * (width / n), height - h, barW, h);
      }
      ctx.globalAlpha = 1;
    }

    function setScrub(sec) {
      const n = Math.max(1, data.heat.length);
      const index = Math.max(0, Math.min(n - 1, Math.floor(sec)));
      const pct = ((index + 0.5) / n) * 100;
      playhead.hidden = false;
      playhead.style.left = pct + '%';
      const passes = Math.round(Number(data.heat[index]) || 0);
      const displayPasses = Number((data.display && data.display[index]) || passes);
      const t = relativeShade(displayPasses, data.max);
      const trend = scrubTrend(data.display || data.heat, index, data.max);
      const rel =
        passes <= 0
          ? 'quiet'
          : t >= 0.98
            ? 'most heard'
            : Math.round(t * 100) + '% of peak';
      readout.textContent =
        fmtTimecode(index) +
        ' · ' +
        rel +
        (passes > 0 ? ' · ' + (passes === 1 ? '1 listen' : passes + ' listens') : '') +
        (trend === 'picking up' || trend === 'slowing' ? ' · ' + trend : '');
      track.setAttribute('aria-valuenow', String(index));
      track.setAttribute('aria-valuetext', fmtTimecode(index) + ', ' + rel);
    }

    function scrubFromEvent(event) {
      const rect = track.getBoundingClientRect();
      if (!rect.width) return;
      const x = (event.clientX != null ? event.clientX : 0) - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      setScrub(ratio * data.heat.length);
    }

    let dragging = false;
    track.addEventListener('pointerdown', function (event) {
      dragging = true;
      track.setPointerCapture(event.pointerId);
      scrubFromEvent(event);
    });
    track.addEventListener('pointermove', function (event) {
      if (!dragging && event.buttons === 0) {
        // hover scrub
        scrubFromEvent(event);
        return;
      }
      if (!dragging) return;
      scrubFromEvent(event);
    });
    track.addEventListener('pointerup', function () {
      dragging = false;
    });
    track.addEventListener('pointerleave', function () {
      if (dragging) return;
    });
    track.addEventListener('keydown', function (event) {
      const now = Number(track.getAttribute('aria-valuenow')) || 0;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setScrub(now - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setScrub(now + 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setScrub(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setScrub(data.heat.length - 1);
      }
    });

    // Draw after layout.
    requestAnimationFrame(function () {
      draw();
      if (data.max > 0) setScrub(data.peakAt);
    });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(function () {
        draw();
      });
      ro.observe(track);
    }

    return wrap;
  }

  function renderSongLeaderboard(items, emptyText) {
    const wrap = el('div', 'studio-song-board');
    const rows = items || [];
    if (!rows.length) {
      wrap.appendChild(el('p', 'studio-dashboard-hint', emptyText || 'no site plays in this range'));
      return wrap;
    }
    rows.forEach(function (song, index) {
      const card = el('div', 'studio-song-card');
      const head = el('div', 'studio-song-card-head');
      head.appendChild(el('span', 'studio-song-rank', '#' + (index + 1)));
      head.appendChild(el('span', 'studio-song-title', song.title || song.groupKey || 'untitled'));
      const meta =
        fmtNum(song.plays) +
        ' plays · ' +
        fmtSeconds(song.seconds) +
        (song.completions ? ' · ' + fmtNum(song.completions) + ' done' : '');
      head.appendChild(el('span', 'studio-song-meta', meta));
      card.appendChild(head);
      card.appendChild(renderSongHeat(song));
      wrap.appendChild(card);
    });
    return wrap;
  }

  function pane(id, title, hint) {
    const wrap = el('div', 'studio-analytics-pane');
    wrap.dataset.pane = id;
    wrap.hidden = true;
    if (title) wrap.appendChild(el('h3', 'studio-analytics-heading', title));
    if (hint) wrap.appendChild(el('p', 'studio-dashboard-hint', hint));
    return wrap;
  }

  function hasRows(arr) {
    return Array.isArray(arr) && arr.length > 0;
  }

  function moneyTotal(commerce) {
    const tips = (commerce.tips && commerce.tips.dollars) || 0;
    const digital = (commerce.digital && commerce.digital.dollars) || 0;
    const shop = (commerce.shop && commerce.shop.dollars) || 0;
    return tips + digital + shop;
  }

  function splitPathway(row) {
    const steps = Array.isArray(row && row.steps) && row.steps.length
      ? row.steps.slice()
      : String((row && row.path) || '')
          .split('→')
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
    if (!steps.length) {
      return { landed: '—', clicked: [], left: '—' };
    }
    if (steps.length === 1) {
      return { landed: steps[0], clicked: [], left: steps[0] };
    }
    return {
      landed: steps[0],
      clicked: steps.slice(1, -1),
      left: steps[steps.length - 1]
    };
  }

  function renderPathwayLeaderboard(items, emptyText) {
    const wrap = el('div', 'studio-pathway-board');
    const rows = items || [];
    if (!rows.length) {
      wrap.appendChild(el('p', 'studio-dashboard-hint', emptyText || 'no pathways yet'));
      return wrap;
    }

    rows.forEach(function (item, index) {
      const parts = splitPathway(item);
      const card = el('article', 'studio-pathway-card');

      const head = el('div', 'studio-pathway-card-head');
      head.appendChild(el('span', 'studio-pathway-rank', '#' + (index + 1)));
      head.appendChild(el('span', 'studio-pathway-count', fmtNum(item.count) + (item.count === 1 ? ' session' : ' sessions')));
      card.appendChild(head);

      function addStage(label, value) {
        const stage = el('div', 'studio-pathway-stage');
        stage.appendChild(el('span', 'studio-pathway-stage-label', label));
        stage.appendChild(el('span', 'studio-pathway-stage-value', value));
        card.appendChild(stage);
      }

      addStage('landed', parts.landed);
      addStage(
        'clicked',
        parts.clicked.length ? parts.clicked.join(' → ') : '—'
      );
      addStage('left', parts.left);

      wrap.appendChild(card);
    });

    return wrap;
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
    const commerce = snapshot.commerce || {};
    const cf = snapshot.cloudflare || {};

    const tabs = document.getElementById('dashboardAnalyticsTabs');
    const panes = el('div', 'studio-analytics-panes');

    function showPane(id) {
      currentPane = id || 'listen';
      if (tabs) {
        Array.prototype.forEach.call(tabs.querySelectorAll('.studio-analytics-tab'), function (btn) {
          const on = btn.dataset.pane === currentPane;
          btn.classList.toggle('is-active', on);
          btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
      }
      Array.prototype.forEach.call(panes.querySelectorAll('.studio-analytics-pane'), function (node) {
        node.hidden = node.dataset.pane !== currentPane;
      });
      fillOverview();
      syncListenSubtabs();
      if (currentPane === 'listen') showListenSource();
    }

    if (tabs && tabs.dataset.bound !== '1') {
      tabs.dataset.bound = '1';
      tabs.addEventListener('click', function (event) {
        const btn = event.target.closest('.studio-analytics-tab');
        if (!btn || !tabs.contains(btn)) return;
        showPane(btn.dataset.pane);
      });
    }
    if (tabs) tabs.hidden = false;
    syncPeriodButtons();
    bindListenSubtabs();

    const overview = el('div', 'studio-analytics-overview');
    overview.id = 'dashboardAnalyticsOverview';
    feed.appendChild(overview);

    function outboundClicks() {
      return (snapshot.outbound || []).reduce(function (sum, row) {
        return sum + (Number(row.clicks) || 0);
      }, 0);
    }

    function pathwayCount() {
      return Array.isArray(snapshot.pathways) ? snapshot.pathways.length : 0;
    }

    function fillOverview() {
      overview.innerHTML = '';
      if (currentPane === 'traffic') {
        overview.appendChild(metricRow('lands', fmtNum(site.lands)));
        overview.appendChild(metricRow('pathways', fmtNum(pathwayCount())));
        overview.appendChild(metricRow('outbound', fmtNum(outboundClicks())));
        if (cf.configured && !cf.error) {
          overview.appendChild(metricRow('cf visits', fmtNum(cf.visits)));
        }
        return;
      }
      if (currentPane === 'money') {
        overview.appendChild(metricRow('earned', fmtMoney(moneyTotal(commerce))));
        overview.appendChild(
          metricRow('tips', fmtMoney(commerce.tips && commerce.tips.dollars))
        );
        overview.appendChild(
          metricRow('digital', fmtMoney(commerce.digital && commerce.digital.dollars))
        );
        overview.appendChild(
          metricRow('shop', fmtMoney(commerce.shop && commerce.shop.dollars))
        );
        return;
      }
      overview.appendChild(metricRow('plays', fmtNum(site.songPlays)));
      overview.appendChild(metricRow('listen', fmtSeconds(site.listenSeconds)));
    }

    const listenPane = pane('listen', null, null);
    const listenSite = el('div', 'studio-analytics-listen-source');
    listenSite.id = 'listenSourceSite';
    listenSite.appendChild(el('p', 'studio-analytics-subhead', 'songs'));
    listenSite.appendChild(renderSongLeaderboard(snapshot.songs, 'no site plays in this range'));

    const listenDsp = el('div', 'studio-analytics-listen-source');
    listenDsp.id = 'listenSourceDsp';
    const dsp = snapshot.dsp || {};
    listenDsp.appendChild(
      el(
        'p',
        'studio-dashboard-hint',
        dsp.note || 'spotify / apple / other dsp streams — connect after release.'
      )
    );
    listenDsp.appendChild(el('p', 'studio-analytics-subhead', 'streams'));
    listenDsp.appendChild(
      listRows(
        dsp.songs || dsp.tracks || [],
        function (song) {
          return {
            label: song.title || song.name || song.groupKey || 'untitled',
            value:
              fmtNum(song.streams || song.plays) +
              ' streams' +
              (song.seconds ? ' · ' + fmtSeconds(song.seconds) : '')
          };
        },
        'no dsp data yet'
      )
    );

    listenPane.appendChild(listenSite);
    listenPane.appendChild(listenDsp);
    panes.appendChild(listenPane);

    const trafficPane = pane(
      'traffic',
      null,
      'how they moved through the site in this range — pathways first, then landings and exits.'
    );

    if (cf.configured && !cf.error) {
      const cfGrid = el('div', 'studio-analytics-grid');
      cfGrid.appendChild(metricRow('cf pageviews', fmtNum(cf.pageviews)));
      cfGrid.appendChild(metricRow('cf visits', fmtNum(cf.visits)));
      trafficPane.appendChild(cfGrid);
    }

    trafficPane.appendChild(el('p', 'studio-analytics-subhead', 'pathways'));
    trafficPane.appendChild(
      renderPathwayLeaderboard(
        snapshot.pathways,
        'no pathways yet — browse a couple pages on the public site, then leave or hit a streaming link'
      )
    );

    trafficPane.appendChild(el('p', 'studio-analytics-subhead', 'landing pages'));
    trafficPane.appendChild(
      listRows(
        snapshot.paths,
        function (row) {
          return {
            label: row.page || '/',
            value: fmtNum(row.lands) + ' land · ' + fmtNum(row.plays) + ' play'
          };
        },
        'no landings in this range'
      )
    );

    trafficPane.appendChild(el('p', 'studio-analytics-subhead', 'sources'));
    const sourceItems = [];
    (snapshot.utm || []).forEach(function (row) {
      sourceItems.push({
        label: [row.source, row.medium, row.campaign].filter(Boolean).join(' / ') || 'utm',
        value: fmtNum(row.lands) + ' · utm'
      });
    });
    (snapshot.referrers || []).forEach(function (row) {
      sourceItems.push({
        label: row.host || 'direct',
        value: fmtNum(row.lands) + ' · referrer'
      });
    });
    trafficPane.appendChild(
      listRows(
        sourceItems,
        function (row) {
          return row;
        },
        'no utm or referrers in this range'
      )
    );

    trafficPane.appendChild(el('p', 'studio-analytics-subhead', 'outbound'));
    trafficPane.appendChild(
      listRows(
        snapshot.outbound,
        function (row) {
          return { label: row.dest || 'other', value: fmtNum(row.clicks) + ' clicks' };
        },
        'no outbound clicks in this range'
      )
    );
    panes.appendChild(trafficPane);

    const moneyPane = pane('money', null, 'money in this range.');
    const moneyGrid = el('div', 'studio-analytics-grid');
    moneyGrid.appendChild(
      metricRow(
        'tips',
        fmtNum(commerce.tips && commerce.tips.count) + ' · ' + fmtMoney(commerce.tips && commerce.tips.dollars)
      )
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
      metricRow(
        'shop',
        fmtNum(commerce.shop && commerce.shop.count) + ' · ' + fmtMoney(commerce.shop && commerce.shop.dollars)
      )
    );
    if (snapshot.newsletter && snapshot.newsletter.subscribers != null) {
      moneyGrid.appendChild(metricRow('newsletter', fmtNum(snapshot.newsletter.subscribers)));
    }
    moneyPane.appendChild(moneyGrid);

    if (hasRows(commerce.recent)) {
      moneyPane.appendChild(el('p', 'studio-analytics-subhead', 'recent'));
      moneyPane.appendChild(
        listRows(commerce.recent, function (row) {
          return {
            label: (row.kind || 'order') + (row.productTitle ? ' · ' + row.productTitle : ''),
            value: fmtMoney((row.cents || 0) / 100)
          };
        })
      );
    }
    panes.appendChild(moneyPane);

    feed.appendChild(panes);

    showPane(currentPane);
    showListenSource();
  }

  function loadAnalytics(period) {
    const auth = window.BurnfolderStudioAuth;
    const empty = document.getElementById('dashboardAnalyticsEmpty');
    if (!auth || !auth.getAuthHeaders) {
      if (empty) empty.textContent = 'sign in to load analytics.';
      return Promise.resolve();
    }
    if (period) storePeriod(period);
    syncPeriodButtons();
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'loading…';
    }

    const url = apiBase() + '/studio-analytics?period=' + encodeURIComponent(currentPeriod);
    return fetch(url, { headers: auth.getAuthHeaders() })
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
    currentPeriod = readStoredPeriod();
    currentListenSource = readStoredListenSource();
    bindOwnerMeta();
    bindExport();
    bindPeriodNav();
    bindListenSubtabs();
    syncPeriodButtons();
    syncListenSubtabs();
    loadAnalytics(currentPeriod).then(function () {
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
