(function () {
  'use strict';

  var lastSnapshot = null;
  var currentPeriod = 'week';
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

  function showListenSource() {
    const sitePane = document.getElementById('listenSourceSite');
    const dspPane = document.getElementById('listenSourceDsp');
    if (sitePane) sitePane.hidden = currentListenSource !== 'site';
    if (dspPane) dspPane.hidden = currentListenSource !== 'dsp';
  }

  function syncListenSourceToggle() {
    const select = document.getElementById('dashboardListenSource');
    const wrap = select && select.closest('.studio-analytics-listen-wrap');
    const showDsp = hasDspData(lastSnapshot);
    if (wrap) wrap.hidden = !showDsp;
    if (select) select.value = currentListenSource;
  }

  function bindListenSourceToggle() {
    const select = document.getElementById('dashboardListenSource');
    if (!select || select.dataset.bound === '1') return;
    select.dataset.bound = '1';
    select.addEventListener('change', function () {
      const source = select.value === 'dsp' ? 'dsp' : 'site';
      if (source === currentListenSource) return;
      storeListenSource(source);
      showListenSource();
    });
  }

  function focusMarketQueue() {
    const desk = document.getElementById('marketDeskSection');
    const acts = document.getElementById('marketDeskActs');
    if (acts && !acts.hidden && typeof acts.scrollIntoView === 'function') {
      acts.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (desk && typeof desk.scrollIntoView === 'function') {
      desk.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  window.studioShowDashboardPane = function (id) {
    if (id === 'actions') focusMarketQueue();
  };
  window.studioFocusMarketQueue = focusMarketQueue;

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
    const select = document.getElementById('dashboardAnalyticsPeriod');
    if (nav) nav.hidden = false;
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

  function fmtPct(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return (Math.round(Number(n) * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%';
  }

  function fmtMoney(n) {
    return '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }

  function emailStats(snapshot) {
    return snapshot.email || snapshot.newsletter || {};
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
      const body = el('div', 'studio-dashboard-list-body');
      body.appendChild(el('span', 'studio-dashboard-list-label', mapped.label));
      if (mapped.meta) {
        body.appendChild(el('span', 'studio-dashboard-list-meta', mapped.meta));
      }
      row.appendChild(body);
      row.appendChild(el('span', 'studio-dashboard-list-value', mapped.value));
      list.appendChild(row);
    });
    if (!count) {
      list.appendChild(el('p', 'studio-dashboard-hint', emptyText || 'no data yet'));
    }
    return list;
  }

  function collapsibleSection(title, contentNode, openByDefault) {
    const details = el('details', 'studio-analytics-disclosure');
    if (openByDefault) details.open = true;
    const summary = el('summary', 'studio-analytics-disclosure-summary', title);
    details.appendChild(summary);
    details.appendChild(contentNode);
    return details;
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
        const v = Number(heat[i]) || 0;
        // Keep coverage: fractional legacy shares must not round to quiet holes.
        heat[i] = v > 0 ? Math.max(1, Math.round(v)) : 0;
      }
    }

    // Display curve: median-smooth kills single-second boundary spikes, then
    // bridge tiny tracking holes so a whole listen reads as a solid band.
    // Scrub readout still uses raw pass counts.
    const display = bridgeHeatGaps(smoothHeatMedian(heat, 2), 4);
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

  /** Fill gaps of <= maxGap seconds between heard regions (tracking holes, not skips). */
  function bridgeHeatGaps(heat, maxGap) {
    const max = Math.max(0, Number(maxGap) || 0);
    if (!max || !heat || !heat.length) return heat || [];
    const out = heat.slice();
    let i = 0;
    while (i < out.length) {
      if (out[i] > 0) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < out.length && !(out[j] > 0)) j += 1;
      const gap = j - i;
      if (gap > 0 && gap <= max && i > 0 && j < out.length) {
        const fill = Math.min(Number(out[i - 1]) || 0, Number(out[j]) || 0);
        if (fill > 0) {
          for (let k = i; k < j; k++) out[k] = Math.max(Number(out[k]) || 0, fill);
        }
      }
      i = j;
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
      data.max > 0 ? 'scrub' : 'no heat yet'
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
      const width = Math.max(1, Math.floor(track.clientWidth || wrap.clientWidth || 320));
      const height = 8;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);

      const series = data.display || data.heat;
      const n = Math.max(1, series.length);
      const color = getComputedStyle(wrap).color || '#111';
      ctx.fillStyle = color;

      // Downsample to one column per CSS pixel (max of seconds in that column),
      // then coalesce equal-opacity runs into single rects — avoids zebra seams
      // from one fillRect per second with fractional x / Math.max(1, width/n).
      const cols = [];
      for (let x = 0; x < width; x++) {
        const s0 = Math.floor((x * n) / width);
        const s1 = Math.max(s0 + 1, Math.floor(((x + 1) * n) / width));
        let passes = 0;
        for (let s = s0; s < s1 && s < n; s++) {
          passes = Math.max(passes, Number(series[s]) || 0);
        }
        const t = relativeShade(passes, data.max);
        cols.push(passes <= 0 ? 0.06 : 0.14 + t * 0.86);
      }

      let x = 0;
      while (x < cols.length) {
        const alpha = cols[x];
        let x2 = x + 1;
        while (x2 < cols.length && cols[x2] === alpha) x2 += 1;
        ctx.globalAlpha = alpha;
        ctx.fillRect(x, 0, x2 - x, height);
        x = x2;
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
      readout.textContent =
        fmtTimecode(index) +
        ' · ' +
        (passes <= 0
          ? 'quiet'
          : passes +
            (passes === 1 ? ' listen' : ' listens') +
            (t < 0.98 ? ' · ' + Math.round(t * 100) + '%' : '')) +
        (trend === 'picking up' || trend === 'slowing' ? ' · ' + trend : '');
      track.setAttribute('aria-valuenow', String(index));
      track.setAttribute(
        'aria-valuetext',
        fmtTimecode(index) + (passes > 0 ? ', ' + passes + ' listens' : ', quiet')
      );
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

      const identity = el('div', 'studio-song-identity');
      identity.appendChild(el('span', 'studio-song-title', song.title || song.groupKey || 'untitled'));
      const metaParts = [fmtSeconds(song.seconds)];
      if (song.completions) metaParts.push(fmtNum(song.completions) + ' done');
      identity.appendChild(el('span', 'studio-song-meta', metaParts.join(' · ')));
      head.appendChild(identity);

      head.appendChild(
        el(
          'span',
          'studio-song-metric',
          fmtNum(song.plays) + (Number(song.plays) === 1 ? ' play' : ' plays')
        )
      );
      card.appendChild(head);

      const detail = el('div', 'studio-song-detail');
      detail.appendChild(renderSongHeat(song));
      card.appendChild(detail);
      wrap.appendChild(card);
    });
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

      const identity = el('div', 'studio-pathway-identity');
      const pathLabel =
        parts.landed +
        (parts.left && parts.left !== parts.landed ? ' → ' + parts.left : '');
      identity.appendChild(el('span', 'studio-pathway-title', pathLabel));
      if (parts.clicked.length) {
        identity.appendChild(
          el('span', 'studio-pathway-meta', parts.clicked.join(' → '))
        );
      }
      head.appendChild(identity);

      head.appendChild(
        el(
          'span',
          'studio-pathway-metric',
          fmtNum(item.count) + (item.count === 1 ? ' session' : ' sessions')
        )
      );
      card.appendChild(head);
      wrap.appendChild(card);
    });

    return wrap;
  }

  function hasDspData(snapshot) {
    const dsp = (snapshot && snapshot.dsp) || {};
    const tracks = dsp.songs || dsp.tracks || [];
    return Array.isArray(tracks) && tracks.length > 0;
  }

  function closerBlock(title) {
    const block = el('section', 'studio-dashboard-closer-block');
    block.appendChild(el('h3', 'studio-analytics-subhead', title));
    return block;
  }

  function renderPulse(snapshot) {
    const pulse = document.getElementById('dashboardPulse');
    const section = document.getElementById('dashboardPulseSection');
    if (!pulse || !section) return;

    const site = (snapshot && snapshot.site) || {};
    const commerce = (snapshot && snapshot.commerce) || {};
    pulse.innerHTML = '';
    pulse.appendChild(metricRow('listen', fmtSeconds(site.listenSeconds)));
    pulse.appendChild(metricRow('lands', fmtNum(site.lands)));
    pulse.appendChild(metricRow('earned', fmtMoney(moneyTotal(commerce))));
    section.hidden = false;
  }

  function renderCloser(snapshot) {
    const feed = document.getElementById('dashboardCloserFeed');
    const section = document.getElementById('dashboardCloserSection');
    if (!feed || !section) return;

    feed.innerHTML = '';
    const commerce = snapshot.commerce || {};
    const email = emailStats(snapshot);
    const dsp = snapshot.dsp || {};

    const listen = closerBlock('listen');
    const listenToggle = el('label', 'studio-analytics-listen-wrap');
    listenToggle.hidden = !hasDspData(snapshot);
    listenToggle.appendChild(el('span', 'studio-analytics-period-label', 'source'));
    const select = document.createElement('select');
    select.id = 'dashboardListenSource';
    select.className = 'studio-analytics-period-select';
    select.setAttribute('aria-label', 'Listen source');
    select.innerHTML =
      '<option value="site">site</option><option value="dsp">dsp</option>';
    select.value = currentListenSource;
    listenToggle.appendChild(select);
    listen.appendChild(listenToggle);

    const listenSite = el('div', 'studio-analytics-listen-source');
    listenSite.id = 'listenSourceSite';
    listenSite.appendChild(renderSongLeaderboard(snapshot.songs, 'no plays'));

    const listenDsp = el('div', 'studio-analytics-listen-source');
    listenDsp.id = 'listenSourceDsp';
    listenDsp.appendChild(
      listRows(
        dsp.songs || dsp.tracks || [],
        function (song) {
          return {
            label: song.title || song.name || song.groupKey || 'untitled',
            meta: song.seconds ? fmtSeconds(song.seconds) : '',
            value:
              fmtNum(song.streams || song.plays) +
              (Number(song.streams || song.plays) === 1 ? ' stream' : ' streams')
          };
        },
        dsp.note || 'no dsp yet'
      )
    );
    listen.appendChild(listenSite);
    listen.appendChild(listenDsp);
    feed.appendChild(listen);

    const traffic = closerBlock('pathways');
    traffic.appendChild(renderPathwayLeaderboard(snapshot.pathways, 'no pathways'));
    traffic.appendChild(
      collapsibleSection(
        'landings',
        listRows(
          snapshot.paths,
          function (row) {
            return {
              label: row.page || '/',
              meta: fmtNum(row.plays) + (Number(row.plays) === 1 ? ' play' : ' plays'),
              value: fmtNum(row.lands) + (Number(row.lands) === 1 ? ' land' : ' lands')
            };
          },
          'none'
        ),
        false
      )
    );

    const sourceItems = [];
    (snapshot.utm || []).forEach(function (row) {
      sourceItems.push({
        label: [row.source, row.medium, row.campaign].filter(Boolean).join(' / ') || 'utm',
        meta: 'utm',
        value: fmtNum(row.lands) + (Number(row.lands) === 1 ? ' land' : ' lands')
      });
    });
    (snapshot.referrers || []).forEach(function (row) {
      sourceItems.push({
        label: row.host || 'direct',
        meta: 'referrer',
        value: fmtNum(row.lands) + (Number(row.lands) === 1 ? ' land' : ' lands')
      });
    });
    traffic.appendChild(
      collapsibleSection(
        'sources',
        listRows(
          sourceItems,
          function (row) {
            return row;
          },
          'none'
        ),
        false
      )
    );
    traffic.appendChild(
      collapsibleSection(
        'outbound',
        listRows(
          snapshot.outbound,
          function (row) {
            return {
              label: row.dest || 'other',
              value: fmtNum(row.clicks) + (Number(row.clicks) === 1 ? ' click' : ' clicks')
            };
          },
          'none'
        ),
        false
      )
    );
    feed.appendChild(traffic);

    const emailBlock = closerBlock('email');
    const emailPulse = el('div', 'studio-analytics-overview');
    emailPulse.appendChild(metricRow('subscribers', fmtNum(email.subscribers)));
    emailPulse.appendChild(metricRow('click rate', fmtPct(email.clickRate)));
    emailBlock.appendChild(emailPulse);
    emailBlock.appendChild(
      listRows(
        email.campaigns,
        function (row) {
          const label = row.entry
            ? row.entry
            : row.campaign === 'welcome'
              ? 'welcome'
              : row.campaign || row.kind || 'blast';
          const rate = row.clickRate != null ? fmtPct(row.clickRate) : '—';
          return {
            label: label,
            meta: fmtNum(row.sent) + ' sent · ' + rate,
            value: fmtNum(row.lands) + (Number(row.lands) === 1 ? ' land' : ' lands')
          };
        },
        'no campaigns'
      )
    );
    if (email.failed) {
      emailBlock.appendChild(el('p', 'studio-dashboard-hint', fmtNum(email.failed) + ' failed'));
    }
    feed.appendChild(emailBlock);

    const money = closerBlock('money');
    money.appendChild(
      el(
        'p',
        'studio-dashboard-hint',
        'tips ' +
          fmtNum(commerce.tips && commerce.tips.count) +
          ' · ' +
          fmtMoney(commerce.tips && commerce.tips.dollars) +
          '  ·  digital ' +
          fmtNum(commerce.digital && commerce.digital.count) +
          ' · ' +
          fmtMoney(commerce.digital && commerce.digital.dollars) +
          '  ·  shop ' +
          fmtNum(commerce.shop && commerce.shop.count) +
          ' · ' +
          fmtMoney(commerce.shop && commerce.shop.dollars)
      )
    );
    if (hasRows(commerce.recent)) {
      money.appendChild(
        listRows(commerce.recent, function (row) {
          return {
            label: (row.kind || 'order') + (row.productTitle ? ' · ' + row.productTitle : ''),
            value: fmtMoney((row.cents || 0) / 100)
          };
        })
      );
    } else {
      money.appendChild(el('p', 'studio-dashboard-hint', 'no orders'));
    }
    feed.appendChild(money);

    section.hidden = false;
    if (!hasDspData(snapshot) && currentListenSource === 'dsp') {
      storeListenSource('site');
    }
    bindListenSourceToggle();
    syncListenSourceToggle();
    showListenSource();
  }

  function renderSnapshot(snapshot) {
    const empty = document.getElementById('dashboardAnalyticsEmpty');
    const pulseSection = document.getElementById('dashboardPulseSection');
    const closerSection = document.getElementById('dashboardCloserSection');

    lastSnapshot = snapshot || null;
    window.__burnfolderAnalyticsSnapshot = lastSnapshot;

    if (!snapshot) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'could not load analytics.';
      }
      if (pulseSection) pulseSection.hidden = true;
      if (closerSection) closerSection.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    syncPeriodButtons();
    renderPulse(snapshot);
    renderCloser(snapshot);

    if (typeof window.studioOnAnalyticsReady === 'function') {
      window.studioOnAnalyticsReady(snapshot);
    }
  }

  function loadAnalytics(period) {
    const empty = document.getElementById('dashboardAnalyticsEmpty');
    if (period) storePeriod(period);
    syncPeriodButtons();

    const auth = window.BurnfolderStudioAuth;
    if (!auth || !auth.getAuthHeaders) {
      if (empty) empty.textContent = 'sign in to load analytics.';
      return Promise.resolve();
    }
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
    bindPeriodNav();
    syncPeriodButtons();
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
